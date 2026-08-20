// functions/api/audit.js
//
// Cloudflare Pages Function backing the free live SEO audit at
// /free-seo-audit. Runs server-side because browsers can't fetch arbitrary
// cross-origin HTML (CORS) -- a Function on this same domain can. This is
// the first server-side code added since the VYNTRA Pixel/CAPI removal
// (2026-07-02); unlike that, this makes no third-party ad-tracking calls,
// stores nothing, and only ever fetches the single URL the visitor typed
// (plus its own /robots.txt, /sitemap.xml and /favicon.ico, same origin).
//
// Lead capture (name/email/phone) is NOT handled here -- the page posts
// that directly to Web3Forms client-side, same as the existing #contact
// form. This endpoint's only job is: fetch one page, analyze it, return
// findings. Nothing about the visitor is logged by this file.
//
// Safety:
//   - http(s) only, no credentials-in-URL, blocklist of private/loopback/
//     link-local hostnames checked both before the fetch AND again on the
//     final URL after redirects (a redirect chain could otherwise land on
//     an internal address -- classic SSRF-via-redirect). Same guard applies
//     to the same-origin robots.txt/sitemap.xml/favicon fetches.
//   - 8s fetch timeout; response body capped at 3MB while streaming
//     (doesn't rely on a possibly-absent/false Content-Length header).
//   - Only text/html responses are analyzed.
//   - Cloudflare Turnstile (env.TURNSTILE_SECRET_KEY) verifies the visitor
//     is human before any audit runs.
//   - Per-IP rate limiting via Workers KV (env.AUDIT_KV, binding created
//     2026-08-19): max REQUESTS_PER_HOUR audits/hour/IP, fixed hourly
//     window. Both checks fail OPEN (allow the request) if their env
//     binding is missing, so a misconfigured deploy degrades gracefully
//     instead of taking the whole tool down.
//
// Checks: every distinct thing this tool evaluates is one entry in the
// CHECKS registry near the bottom of this file -- each returns pass/fail/
// n-a against a shared `ctx` built from the page fetch + parse below. That
// single registry is the source of truth for both the score (only "fail"
// rows count) AND the full pass/fail checklist returned to the frontend,
// so the two can never drift out of sync. checksRun in the response is
// CHECKS.length, not a hand-maintained number -- if you add/remove a check,
// also update the "N checks" line in free-seo-audit.html (that one static
// line is the only place left to update by hand).

const MAX_BYTES = 3 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8000;
const REQUESTS_PER_HOUR = 8;
const BLOCKED_HOST_RE =
  /(^|\.)(localhost|local)$|^0\.0\.0\.0$|^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\.|^\[?::1\]?$|^\[?fc[0-9a-f]{2}:|^\[?fe80:/i;
// Sole/full link text that tells a reader nothing about where the link
// goes -- flagged, not penalized much (severity is "low"), since it's a
// style nit rather than a functional problem.
const GENERIC_ANCHOR_TEXTS = new Set(["click here", "here", "this link", "read more", "more", "link"]);

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid request." }, 400);
  }

  const targetUrl = validateUrl(body && body.url);
  if (!targetUrl) {
    return json({ ok: false, error: "Enter a valid http(s) website URL." }, 400);
  }
  const keyword = sanitizeKeyword(body && body.keyword);

  const ip = request.headers.get("cf-connecting-ip") || "";

  const withinLimit = await checkRateLimit(env, ip);
  if (!withinLimit) {
    return json(
      { ok: false, error: `You've hit the free-audit limit for now (max ${REQUESTS_PER_HOUR} per hour). Try again later, or book a call for a full manual review.` },
      429
    );
  }

  const humanVerified = await verifyTurnstile(env, body && body.turnstileToken, ip);
  if (!humanVerified) {
    return json({ ok: false, error: "Bot verification failed. Please reload the page and try again." }, 403);
  }

  let res;
  const fetchStarted = Date.now();
  try {
    res = await fetchWithTimeout(targetUrl, FETCH_TIMEOUT_MS);
  } catch {
    return json(
      { ok: false, error: "Couldn't reach that URL. Check it's correct and publicly accessible." },
      502
    );
  }
  const responseMs = Date.now() - fetchStarted;

  if (!res.ok) {
    return json({ ok: false, error: `That URL returned an error (HTTP ${res.status}).` }, 502);
  }

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) {
    return json({ ok: false, error: "That URL did not return an HTML page." }, 415);
  }
  const lenHeader = res.headers.get("content-length");
  if (lenHeader && Number(lenHeader) > MAX_BYTES) {
    return json({ ok: false, error: "That page is too large to audit." }, 413);
  }

  const finalUrl = res.url || targetUrl;
  const isHttps = new URL(finalUrl).protocol === "https:";
  const hstsPresent = res.headers.has("strict-transport-security");
  const headerFlags = {
    csp: res.headers.has("content-security-policy"),
    xContentTypeOptions: (res.headers.get("x-content-type-options") || "").toLowerCase().includes("nosniff"),
    frameProtection: res.headers.has("x-frame-options") || /frame-ancestors/i.test(res.headers.get("content-security-policy") || ""),
    referrerPolicy: res.headers.has("referrer-policy"),
  };
  const hasCacheControl = res.headers.has("cache-control");
  // No "is this response gzip/brotli compressed" check: Workers' fetch()
  // transparently decompresses the body and strips Content-Encoding from
  // the Response we see, even for origins that verifiably do compress
  // (confirmed against real sites via curl -H "Accept-Encoding: gzip, br"
  // vs what this Function saw -- always empty). A check that always fails
  // regardless of the truth is worse than no check; don't re-add this
  // without a way to see the real header.

  // Cheap, parallel, best-effort checks against the same origin -- each one
  // is wrapped so a timeout/404/network hiccup on either just means "not
  // found", not a failed audit.
  const origin = new URL(finalUrl).origin;
  const [robots, sitemap, hasDoctype] = await Promise.all([
    checkRobots(origin),
    checkSitemap(origin),
    peekDoctype(res.clone()),
  ]);

  let state;
  try {
    state = await parseHtml(res, { isHttps, origin, finalUrl, keyword });
  } catch {
    return json({ ok: false, error: "Audit failed while reading that page." }, 500);
  }

  // Favicon is checked last and only if the page didn't already declare one
  // -- avoids a wasted extra fetch on the (common) case where it's linked.
  const faviconFallbackOk = state.hasFaviconLink ? null : await checkExists(origin + "/favicon.ico");

  const ctx = {
    state,
    finalUrl,
    origin,
    isHttps,
    hstsPresent,
    headerFlags,
    robots,
    sitemap,
    responseMs,
    faviconFallbackOk,
    canonical: buildCanonicalInfo(state.canonical, finalUrl),
    hasCacheControl,
    hasDoctype,
  };

  const results = CHECKS.map((c) => {
    const r = c.run(ctx);
    return { id: c.id, category: c.category, label: c.label, status: r.status, severity: r.severity || null, message: r.message || null };
  });

  const findings = results
    .filter((r) => r.status === "fail")
    .map((r) => ({ severity: r.severity, category: r.category, message: r.message }))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const checklist = results.map((r) => ({
    id: r.id,
    category: r.category,
    label: r.label,
    status: r.status,
    severity: r.severity,
    message: r.message,
  }));

  const score = computeScore(findings);
  const categoryScores = computeCategoryScores(findings);

  return json({
    ok: true,
    url: targetUrl,
    checksRun: CHECKS.length,
    findings,
    checklist,
    score,
    grade: letterGrade(score),
    categoryScores,
    keywordReport: state.keywordReport || null,
    extracted: {
      title: state.title.trim(),
      description: (state.meta["description"] || "").trim(),
      h1Count: state.h1Count,
      wordCount: state.bodyWords,
      imageCount: state.imgTotal,
      internalLinks: state.internalLinks,
      externalLinks: state.externalLinks,
    },
  });
}

function buildCanonicalInfo(canonicalHref, finalUrl) {
  if (!canonicalHref) return { present: false };
  try {
    const resolved = new URL(canonicalHref, finalUrl).toString();
    const normalize = (u) => u.replace(/\/$/, "");
    return { present: true, resolved, matches: normalize(resolved) === normalize(finalUrl) };
  } catch {
    return { present: true, unparseable: true };
  }
}

// HEAD-first existence check for a same-origin file; falls back to GET for
// servers that don't implement HEAD. Body is never read either way.
async function checkExists(url) {
  for (const method of ["HEAD", "GET"]) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      try {
        const res = await fetch(url, { method, redirect: "follow", signal: controller.signal });
        if (res.body) res.body.cancel().catch(() => {});
        const finalHost = new URL(res.url || url).hostname;
        if (BLOCKED_HOST_RE.test(finalHost)) return false; // SSRF-via-redirect guard, same as the main fetch
        if (res.status === 405 || res.status === 501) continue; // method not supported, try GET
        return res.ok;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return false;
    }
  }
  return false;
}

// Small GET-and-read-as-text helper, capped and timeboxed, for the two
// same-origin files (robots.txt, sitemap.xml) where we need actual content,
// not just a status code.
async function fetchTextSmall(url, maxBytes = 51200, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "GET", redirect: "follow", signal: controller.signal });
    const finalHost = new URL(res.url || url).hostname;
    if (BLOCKED_HOST_RE.test(finalHost)) return null; // SSRF-via-redirect guard
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      text += decoder.decode(value, { stream: true });
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
    return text;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function checkRobots(origin) {
  const text = await fetchTextSmall(origin + "/robots.txt");
  if (text === null) return { exists: false, disallowsAll: false };
  return { exists: true, disallowsAll: robotsDisallowsAll(text) };
}

// Parses robots.txt well enough to catch the common, high-impact mistake:
// a "User-agent: *" group that blocks the entire site with "Disallow: /"
// and no overriding "Allow:". Not a full spec-compliant parser -- good
// enough as a lint check, not a crawler.
function robotsDisallowsAll(text) {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/#.*/, "").trim()).filter(Boolean);
  let inWildcardGroup = false;
  let sawWildcardGroup = false;
  let hasRootDisallow = false;
  let hasOverridingAllow = false;
  for (const line of lines) {
    const m = line.match(/^([a-zA-Z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === "user-agent") {
      inWildcardGroup = value === "*";
      if (inWildcardGroup) sawWildcardGroup = true;
      continue;
    }
    if (!inWildcardGroup) continue;
    if (field === "disallow" && value === "/") hasRootDisallow = true;
    if (field === "allow" && (value === "/" || value === "")) hasOverridingAllow = true;
  }
  return sawWildcardGroup && hasRootDisallow && !hasOverridingAllow;
}

// Reads just enough of a (cloned) response body to tell whether the page
// declares an HTML5 doctype. HTMLRewriter has no doctype event, so this
// peeks the raw stream directly instead. Cheap: stops after the first
// chunk, well before any real content.
async function peekDoctype(clonedRes) {
  try {
    if (!clonedRes.body) return false;
    const reader = clonedRes.body.getReader();
    const { value } = await reader.read();
    reader.cancel().catch(() => {});
    if (!value) return false;
    const prefix = new TextDecoder().decode(value.slice(0, 100));
    return /^\s*<!doctype\s+html/i.test(prefix);
  } catch {
    return false;
  }
}

async function checkSitemap(origin) {
  const text = await fetchTextSmall(origin + "/sitemap.xml");
  if (text === null) return { exists: false, looksValid: false };
  const head = text.slice(0, 300).toLowerCase();
  const looksValid = head.includes("<urlset") || head.includes("<sitemapindex") || head.includes("<?xml");
  return { exists: true, looksValid };
}

// Anything other than POST -> explicit 405 instead of a silent 404.
export async function onRequestGet() {
  return json({ ok: false, error: "Use POST." }, 405);
}

// Fixed-hourly-window per-IP counter in KV. Not perfectly atomic under
// concurrent requests from the same IP in the same window (KV read-then-write
// isn't transactional), but that's an acceptable approximation for an abuse
// deterrent, not a billing-grade limiter.
async function checkRateLimit(env, ip) {
  if (!env.AUDIT_KV || !ip) return true; // fail open if unbound or IP unknown
  const bucket = Math.floor(Date.now() / 3600000);
  const key = `rl:${ip}:${bucket}`;
  let count = 0;
  try {
    const current = await env.AUDIT_KV.get(key);
    count = current ? parseInt(current, 10) || 0 : 0;
  } catch {
    return true; // KV read failed -- don't block real visitors over it
  }
  if (count >= REQUESTS_PER_HOUR) return false;
  try {
    // A little over an hour so a request right at the window edge doesn't
    // expire mid-check.
    await env.AUDIT_KV.put(key, String(count + 1), { expirationTtl: 3900 });
  } catch {
    /* best-effort -- if the write fails, worst case is a slightly under-strict limit */
  }
  return true;
}

async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET_KEY) return true; // fail open if unconfigured
  if (!token || typeof token !== "string") return false;
  const form = new URLSearchParams();
  form.set("secret", env.TURNSTILE_SECRET_KEY);
  form.set("response", token);
  if (ip) form.set("remoteip", ip);
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
    });
    const data = await res.json();
    return data && data.success === true;
  } catch {
    return false;
  }
}

function validateUrl(raw) {
  if (!raw || typeof raw !== "string") return null;
  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  if (BLOCKED_HOST_RE.test(u.hostname)) return null;
  return u.toString();
}

// Optional target-keyword field for the on-page keyword-optimization
// report -- trimmed, newlines stripped, capped well short of anything a
// real keyword phrase would need.
function sanitizeKeyword(raw) {
  if (!raw || typeof raw !== "string") return null;
  const cleaned = raw.trim().replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").slice(0, 80);
  return cleaned || null;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; NikhilRaiFreeSEOAuditBot/1.0; +https://nikhilrai7081.com/free-seo-audit)",
      },
    });
    // Re-check the FINAL host after redirects -- a redirect chain could
    // otherwise land on a private/internal address even if the original
    // URL looked safe.
    const finalHost = new URL(res.url || url).hostname;
    if (BLOCKED_HOST_RE.test(finalHost)) {
      throw new Error("blocked host after redirect");
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘",
  rdquo: "”", ldquo: "“", hellip: "…",
};
// HTMLRewriter hands back attribute values as raw source bytes -- it does
// NOT decode HTML entities the way a browser's DOM parser does. Without
// this, a title/description written with &#39; or &rsquo; in the source
// (common; some CMSes always encode apostrophes) shows up literally in the
// report instead of as the punctuation it represents.
function decodeEntities(str) {
  if (!str) return str;
  return str.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, ent) => {
    if (ent[0] === "#") {
      const code = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ent in NAMED_ENTITIES ? NAMED_ENTITIES[ent] : whole;
  });
}

// Streams and parses the page once with HTMLRewriter, collecting the raw
// signals every check in the CHECKS registry below reads from. Pure
// extraction only -- no pass/fail judgment happens here.
async function parseHtml(res, { isHttps, origin, finalUrl, keyword }) {
  const state = {
    title: "",
    titleCount: 0,
    h1Text: "",
    meta: {},
    metaDescriptionCount: 0,
    hasCharset: false,
    canonical: null,
    h1Count: 0,
    h2Count: 0,
    lang: null,
    imgTotal: 0,
    imgMissingAlt: 0,
    imgMissingDimensions: 0,
    hasFaviconLink: false,
    mixedContentCount: 0,
    internalLinks: 0,
    externalLinks: 0,
    genericAnchorTextCount: 0,
    hiddenLinksCount: 0,
    hreflangTags: [],
    ldjsonBlocks: [],
    bodyWords: 0,
    looksLikeSPA: false,
    domElementCount: 0,
    renderBlockingScripts: 0,
    keywordOccurrences: 0,
    firstBodyText: "",
  };
  let currentLdBuf = null;
  let currentAnchorText = null;
  const isHttpUrl = (v) => typeof v === "string" && /^http:\/\//i.test(v);
  const kwRegex = keyword ? new RegExp(escapeRegex(keyword), "gi") : null;
  const FIRST_TEXT_CAP = 800;

  const rewriter = new HTMLRewriter()
    .on("html", {
      element(el) {
        state.lang = el.getAttribute("lang");
      },
    })
    // Scoped to "head title", not bare "title" -- inline SVG icons commonly
    // carry their own <title> elements for accessibility (e.g. GitHub's
    // icon set), and those aren't the document title. Matching bare "title"
    // was corrupting both the extracted title and the title-length/
    // duplicate-title checks on any page using accessible SVG icons.
    .on("head title", {
      element() {
        state.titleCount++;
      },
      text(t) {
        state.title += decodeEntities(t.text);
      },
    })
    .on("meta", {
      element(el) {
        if (el.getAttribute("charset") !== null) state.hasCharset = true;
        if ((el.getAttribute("http-equiv") || "").toLowerCase() === "content-type") state.hasCharset = true;
        const key = (el.getAttribute("name") || el.getAttribute("property") || "").toLowerCase();
        if (key === "description") state.metaDescriptionCount++;
        if (key) state.meta[key] = decodeEntities(el.getAttribute("content") || "");
      },
    })
    .on("link", {
      element(el) {
        const rel = (el.getAttribute("rel") || "").toLowerCase();
        if (rel === "canonical") state.canonical = el.getAttribute("href");
        if (rel.includes("icon")) state.hasFaviconLink = true;
        if (rel === "stylesheet" && isHttps && isHttpUrl(el.getAttribute("href"))) state.mixedContentCount++;
        if (rel === "alternate") {
          const hreflang = el.getAttribute("hreflang");
          if (hreflang) state.hreflangTags.push({ hreflang, href: el.getAttribute("href") });
        }
      },
    })
    .on("head script[src]", {
      element(el) {
        if (!el.hasAttribute("async") && !el.hasAttribute("defer")) state.renderBlockingScripts++;
      },
    })
    .on("*", {
      element() {
        state.domElementCount++;
      },
    })
    .on("h1", {
      element() {
        state.h1Count++;
      },
      text(t) {
        state.h1Text += t.text;
      },
    })
    .on("h2", {
      element() {
        state.h2Count++;
      },
    })
    .on("img", {
      element(el) {
        state.imgTotal++;
        if (el.getAttribute("alt") === null) state.imgMissingAlt++;
        if (!el.getAttribute("width") || !el.getAttribute("height")) state.imgMissingDimensions++;
        if (isHttps && isHttpUrl(el.getAttribute("src"))) state.mixedContentCount++;
      },
    })
    .on("script, iframe, source", {
      element(el) {
        if (isHttps && isHttpUrl(el.getAttribute("src"))) state.mixedContentCount++;
      },
    })
    .on("a", {
      element(el) {
        const style = (el.getAttribute("style") || "").toLowerCase();
        const isHiddenStyle = /display\s*:\s*none/.test(style) || /visibility\s*:\s*hidden/.test(style);
        currentAnchorText = "";
        el.onEndTag(() => {
          if (currentAnchorText !== null) {
            const text = currentAnchorText.trim().toLowerCase();
            if (text) {
              if (isHiddenStyle) state.hiddenLinksCount++;
              if (GENERIC_ANCHOR_TEXTS.has(text)) state.genericAnchorTextCount++;
            }
            currentAnchorText = null;
          }
        });

        const href = el.getAttribute("href");
        if (!href) return;
        if (/^(mailto|tel|javascript):/i.test(href)) return;
        try {
          const resolved = new URL(href, finalUrl);
          if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return;
          if (resolved.origin === origin) state.internalLinks++;
          else state.externalLinks++;
        } catch {
          /* unparseable href -- ignore rather than miscount */
        }
      },
      text(t) {
        if (currentAnchorText !== null) currentAnchorText += t.text;
      },
    })
    .on('div[id="root"], div[id="app"], div[id="__next"], div[id="__nuxt"]', {
      element() {
        state.looksLikeSPA = true;
      },
    })
    .on('script[type="application/ld+json"]', {
      element(el) {
        currentLdBuf = "";
        el.onEndTag(() => {
          if (currentLdBuf !== null) {
            state.ldjsonBlocks.push(currentLdBuf);
            currentLdBuf = null;
          }
        });
      },
      text(t) {
        if (currentLdBuf !== null) currentLdBuf += t.text;
      },
    })
    .on("body *", {
      text(t) {
        const words = t.text.match(/\S+/g);
        if (words) state.bodyWords += words.length;
        if (kwRegex) {
          const matches = t.text.match(kwRegex);
          if (matches) state.keywordOccurrences += matches.length;
        }
        if (keyword && state.firstBodyText.length < FIRST_TEXT_CAP) {
          state.firstBodyText += t.text;
        }
      },
    });

  const transformed = rewriter.transform(res);
  const reader = transformed.body.getReader();
  let bytesSeen = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesSeen += value.length;
      if (bytesSeen > MAX_BYTES) {
        await reader.cancel();
        break;
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released via cancel() */
    }
  }

  if (keyword) {
    const kwLower = keyword.toLowerCase();
    const kwHyphenated = kwLower.replace(/\s+/g, "-");
    const kwJoined = kwLower.replace(/\s+/g, "");
    const urlLower = finalUrl.toLowerCase();
    state.keywordReport = {
      keyword,
      inTitle: state.title.toLowerCase().includes(kwLower),
      inH1: state.h1Text.toLowerCase().includes(kwLower),
      inMetaDescription: (state.meta.description || "").toLowerCase().includes(kwLower),
      inUrl: urlLower.includes(kwHyphenated) || urlLower.includes(kwJoined) || urlLower.includes(kwLower),
      inFirstParagraph: state.firstBodyText.toLowerCase().includes(kwLower),
      occurrences: state.keywordOccurrences,
      totalWords: state.bodyWords,
      density: state.bodyWords > 0 ? Math.round((state.keywordOccurrences / state.bodyWords) * 10000) / 100 : 0,
    };
  }

  return state;
}

// ---------------------------------------------------------------------
// Check registry -- single source of truth for both scoring and the full
// pass/fail checklist. Categories match the grouping convention used
// across most SEO audit tools (SEOptimer, Sitechecker, etc): Technical,
// On-Page, Content, Social, Structured Data, Security -- so this reads as
// a familiar audit report, not a flat dev-tool lint list.
//
// Each check's run(ctx) returns one of:
//   { status: "pass" }
//   { status: "fail", severity, message }
//   { status: "na" }   -- doesn't apply given this page (e.g. can't judge
//                          title length when there's no title at all).
//                          Never affects the score either way.
// ---------------------------------------------------------------------

const pass = () => ({ status: "pass" });
const fail = (severity, message) => ({ status: "fail", severity, message });
const na = () => ({ status: "na" });

const CHECKS = [
  {
    id: "server-rendered",
    category: "Content",
    label: "Content is server-rendered, not JS-only",
    run: (ctx) =>
      ctx.state.looksLikeSPA && ctx.state.bodyWords < 50
        ? fail(
            "info",
            "This looks like a JavaScript-rendered app (React/Vue/Next/Nuxt-style root element with very little text in the raw HTML). This audit only reads the HTML as served, not what JavaScript renders afterward -- some findings below (especially thin content) may not reflect what a user or Google actually sees."
          )
        : pass(),
  },
  {
    id: "title-present",
    category: "On-Page",
    label: "Title tag present",
    run: (ctx) => (ctx.state.title.trim() ? pass() : fail("critical", "Missing <title> tag.")),
  },
  {
    id: "title-length",
    category: "On-Page",
    label: "Title tag length (under ~60 characters)",
    run: (ctx) => {
      const title = ctx.state.title.trim();
      if (!title) return na();
      return title.length > 65
        ? fail("low", `Title is ${title.length} characters (keep it under ~60 so it doesn't get cut off in search results).`)
        : pass();
    },
  },
  {
    id: "meta-description-present",
    category: "On-Page",
    label: "Meta description present",
    run: (ctx) => ((ctx.state.meta["description"] || "").trim() ? pass() : fail("high", "Missing meta description.")),
  },
  {
    id: "meta-description-length",
    category: "On-Page",
    label: "Meta description length (70-160 characters)",
    run: (ctx) => {
      const desc = (ctx.state.meta["description"] || "").trim();
      if (!desc) return na();
      return desc.length < 70 || desc.length > 170
        ? fail("low", `Meta description is ${desc.length} characters (ideal range is 70-160).`)
        : pass();
    },
  },
  {
    id: "indexable",
    category: "Technical",
    label: "Page is indexable (no noindex)",
    run: (ctx) =>
      (ctx.state.meta["robots"] || "").toLowerCase().includes("noindex")
        ? fail("critical", "This page is set to noindex -- Google will not show it in search results.")
        : pass(),
  },
  {
    id: "canonical-present",
    category: "Technical",
    label: "Canonical tag present",
    run: (ctx) => (ctx.canonical.present ? pass() : fail("medium", "No canonical tag found.")),
  },
  {
    id: "canonical-matches",
    category: "Technical",
    label: "Canonical tag matches page URL",
    run: (ctx) => {
      if (!ctx.canonical.present) return na();
      if (ctx.canonical.unparseable) return fail("low", "Canonical tag has an unparseable href value.");
      return ctx.canonical.matches
        ? pass()
        : fail(
            "medium",
            `Canonical tag points to a different URL (${ctx.canonical.resolved}) than the page itself -- make sure that's intentional (e.g. consolidating a known duplicate), not a mistake that tells Google to ignore this page.`
          );
    },
  },
  {
    id: "h1-present",
    category: "On-Page",
    label: "Has at least one <h1>",
    run: (ctx) => (ctx.state.h1Count === 0 ? fail("high", "No <h1> heading found on the page.") : pass()),
  },
  {
    id: "h1-single",
    category: "On-Page",
    label: "Exactly one <h1>",
    run: (ctx) => {
      if (ctx.state.h1Count === 0) return na();
      return ctx.state.h1Count > 1
        ? fail("medium", `${ctx.state.h1Count} <h1> tags found (a page should have exactly one).`)
        : pass();
    },
  },
  {
    id: "h2-structure",
    category: "On-Page",
    label: "Uses <h2> subheadings on longer content",
    run: (ctx) => {
      if (ctx.state.bodyWords <= 300) return na();
      return ctx.state.h2Count === 0
        ? fail("low", "No <h2> subheadings found despite substantial content -- subheadings help both readability and how search engines parse page structure.")
        : pass();
    },
  },
  {
    id: "internal-links",
    category: "On-Page",
    label: "Has internal links",
    run: (ctx) =>
      ctx.state.internalLinks === 0
        ? fail("medium", "No internal links found on this page -- internal linking helps search engines discover and rank the rest of your site.")
        : pass(),
  },
  {
    id: "lang-attribute",
    category: "Technical",
    label: "<html lang> attribute present",
    run: (ctx) => (ctx.state.lang ? pass() : fail("low", "Missing lang attribute on <html>.")),
  },
  {
    id: "charset",
    category: "Technical",
    label: "Character encoding declared",
    run: (ctx) => (ctx.state.hasCharset ? pass() : fail("low", "No character encoding declared (missing <meta charset>) -- can cause text rendering issues in some browsers.")),
  },
  {
    id: "viewport",
    category: "Technical",
    label: "Viewport meta tag present",
    run: (ctx) => ("viewport" in ctx.state.meta ? pass() : fail("medium", "Missing viewport meta tag -- can hurt mobile usability and rankings.")),
  },
  {
    id: "og-title",
    category: "Social",
    label: "og:title present",
    run: (ctx) => ("og:title" in ctx.state.meta ? pass() : fail("low", "Missing og:title -- affects how this page looks when shared on social media.")),
  },
  {
    id: "og-description",
    category: "Social",
    label: "og:description present",
    run: (ctx) => ("og:description" in ctx.state.meta ? pass() : fail("low", "Missing og:description -- affects how this page looks when shared on social media.")),
  },
  {
    id: "og-image",
    category: "Social",
    label: "og:image present",
    run: (ctx) => ("og:image" in ctx.state.meta ? pass() : fail("low", "Missing og:image -- affects how this page looks when shared on social media.")),
  },
  {
    id: "twitter-card",
    category: "Social",
    label: "twitter:card present",
    run: (ctx) => ("twitter:card" in ctx.state.meta ? pass() : fail("low", "Missing twitter:card tag.")),
  },
  {
    id: "structured-data-present",
    category: "Structured Data",
    label: "Structured data (JSON-LD) present",
    run: (ctx) =>
      ctx.state.ldjsonBlocks.length === 0
        ? fail("info", "No structured data (JSON-LD / Schema.org) found -- adding it can unlock rich search results.")
        : pass(),
  },
  {
    id: "structured-data-valid",
    category: "Structured Data",
    label: "Structured data is valid JSON",
    run: (ctx) => {
      if (ctx.state.ldjsonBlocks.length === 0) return na();
      const allValid = ctx.state.ldjsonBlocks.every((block) => {
        try {
          JSON.parse(block);
          return true;
        } catch {
          return false;
        }
      });
      return allValid ? pass() : fail("high", "Invalid JSON-LD structured data found -- Google will ignore it as written.");
    },
  },
  {
    id: "image-alt-text",
    category: "Content",
    label: "Images have alt text",
    run: (ctx) => {
      if (ctx.state.imgTotal === 0) return na();
      return ctx.state.imgMissingAlt > 0
        ? fail("medium", `${ctx.state.imgMissingAlt} of ${ctx.state.imgTotal} image(s) have no alt attribute.`)
        : pass();
    },
  },
  {
    id: "content-length",
    category: "Content",
    label: "Content length (at least ~150 words)",
    run: (ctx) =>
      ctx.state.bodyWords < 150 ? fail("low", `Thin content: only about ${ctx.state.bodyWords} words of visible text on the page.`) : pass(),
  },
  {
    id: "mixed-content",
    category: "Security",
    label: "No mixed content on HTTPS page",
    run: (ctx) => {
      if (!ctx.isHttps) return na();
      return ctx.state.mixedContentCount > 0
        ? fail("high", `${ctx.state.mixedContentCount} resource(s) load over plain HTTP on an HTTPS page (mixed content) -- browsers may block them or show a "not fully secure" warning.`)
        : pass();
    },
  },
  {
    id: "https",
    category: "Security",
    label: "Served over HTTPS",
    run: (ctx) => (ctx.isHttps ? pass() : fail("critical", "This page is served over HTTP, not HTTPS -- browsers flag it as insecure and it's a known ranking factor.")),
  },
  {
    id: "hsts",
    category: "Security",
    label: "HSTS header present",
    run: (ctx) => {
      if (!ctx.isHttps) return na();
      return ctx.hstsPresent ? pass() : fail("info", "No Strict-Transport-Security (HSTS) header -- a minor hardening step once HTTPS is already in place.");
    },
  },
  {
    id: "csp",
    category: "Security",
    label: "Content-Security-Policy header present",
    run: (ctx) => (ctx.headerFlags.csp ? pass() : fail("info", "No Content-Security-Policy header -- helps prevent XSS and other injection attacks. Optional but good practice.")),
  },
  {
    id: "x-content-type-options",
    category: "Security",
    label: "X-Content-Type-Options header present",
    run: (ctx) =>
      ctx.headerFlags.xContentTypeOptions
        ? pass()
        : fail("low", "Missing X-Content-Type-Options: nosniff header -- stops browsers from MIME-sniffing responses in a way that can be exploited."),
  },
  {
    id: "frame-protection",
    category: "Security",
    label: "Clickjacking protection present",
    run: (ctx) =>
      ctx.headerFlags.frameProtection
        ? pass()
        : fail("low", "No clickjacking protection (X-Frame-Options or frame-ancestors) -- without it, this page can be embedded in a hidden iframe on another site."),
  },
  {
    id: "referrer-policy",
    category: "Security",
    label: "Referrer-Policy header present",
    run: (ctx) =>
      ctx.headerFlags.referrerPolicy
        ? pass()
        : fail("info", "No Referrer-Policy header -- without one, the browser default may leak full URLs to third-party sites your page links to."),
  },
  {
    id: "robots-txt-present",
    category: "Technical",
    label: "robots.txt present",
    run: (ctx) => (ctx.robots.exists ? pass() : fail("medium", "No robots.txt found at the site root -- search engines rely on it for crawl guidance.")),
  },
  {
    id: "robots-txt-not-blocking",
    category: "Technical",
    label: "robots.txt doesn't block the whole site",
    run: (ctx) => {
      if (!ctx.robots.exists) return na();
      return ctx.robots.disallowsAll
        ? fail(
            "critical",
            'robots.txt blocks all search engines from crawling the entire site ("User-agent: *" / "Disallow: /") -- if that\'s not intentional, it\'s the single biggest thing keeping this site out of search results.'
          )
        : pass();
    },
  },
  {
    id: "sitemap-present",
    category: "Technical",
    label: "sitemap.xml present",
    run: (ctx) =>
      ctx.sitemap.exists
        ? pass()
        : fail("low", "No sitemap.xml found at the site root (it may be referenced elsewhere, e.g. from robots.txt, but the common default location returned nothing)."),
  },
  {
    id: "sitemap-valid",
    category: "Technical",
    label: "sitemap.xml is valid XML",
    run: (ctx) => {
      if (!ctx.sitemap.exists) return na();
      return ctx.sitemap.looksValid
        ? pass()
        : fail("medium", "sitemap.xml exists but doesn't look like valid XML (no <urlset> / <sitemapindex> / XML declaration found) -- search engines may not be able to parse it.");
    },
  },
  {
    id: "response-time",
    category: "Technical",
    label: "Fast server response time",
    run: (ctx) => {
      const secs = (ctx.responseMs / 1000).toFixed(1);
      if (ctx.responseMs > 2500) {
        return fail("medium", `The server took about ${secs}s to respond -- slow server response time hurts both SEO and user experience. (Measured from our server, not a real visitor's connection -- treat as a rough signal, not Core Web Vitals.)`);
      }
      if (ctx.responseMs > 1200) {
        return fail("low", `The server took about ${secs}s to respond -- worth a look, though this is a rough server-to-server measurement, not real-user timing.`);
      }
      return pass();
    },
  },
  {
    id: "favicon",
    category: "Technical",
    label: "Favicon present",
    run: (ctx) => {
      if (ctx.state.hasFaviconLink || ctx.faviconFallbackOk) return pass();
      return fail("info", 'No favicon found (no <link rel="icon"> in the HTML and /favicon.ico is missing) -- minor polish item for browser tabs, bookmarks and search result branding.');
    },
  },
  {
    id: "doctype",
    category: "Technical",
    label: "HTML5 doctype declared",
    run: (ctx) => (ctx.hasDoctype ? pass() : fail("low", "No <!DOCTYPE html> declaration found -- without it, browsers can fall back to quirks mode and render the page inconsistently.")),
  },
  {
    id: "unique-title",
    category: "Technical",
    label: "Only one <title> tag",
    run: (ctx) => {
      if (ctx.state.titleCount === 0) return na();
      return ctx.state.titleCount > 1
        ? fail("medium", `${ctx.state.titleCount} <title> tags found -- there should be exactly one; extras can confuse which title search engines use.`)
        : pass();
    },
  },
  {
    id: "unique-meta-description",
    category: "Technical",
    label: "Only one meta description tag",
    run: (ctx) => {
      if (ctx.state.metaDescriptionCount === 0) return na();
      return ctx.state.metaDescriptionCount > 1
        ? fail("low", `${ctx.state.metaDescriptionCount} meta description tags found -- there should be exactly one; search engines will only use one of them anyway.`)
        : pass();
    },
  },
  {
    id: "og-type",
    category: "Social",
    label: "og:type present",
    run: (ctx) => ("og:type" in ctx.state.meta ? pass() : fail("info", "Missing og:type -- helps social platforms classify this page (e.g. \"website\" or \"article\").")),
  },
  {
    id: "og-url",
    category: "Social",
    label: "og:url present",
    run: (ctx) => ("og:url" in ctx.state.meta ? pass() : fail("info", "Missing og:url -- tells social platforms the canonical URL to credit when this page is shared.")),
  },
  {
    id: "viewport-zoom",
    category: "Technical",
    label: "Viewport allows pinch-to-zoom",
    run: (ctx) => {
      if (!("viewport" in ctx.state.meta)) return na();
      const v = (ctx.state.meta.viewport || "").toLowerCase();
      return /user-scalable\s*=\s*no|maximum-scale\s*=\s*1(\.0)?\b/.test(v)
        ? fail("low", "Viewport meta tag disables pinch-to-zoom (user-scalable=no or maximum-scale=1) -- an accessibility problem for users who need to zoom in.")
        : pass();
    },
  },
  {
    id: "url-length",
    category: "Technical",
    label: "URL length is reasonable",
    run: (ctx) =>
      ctx.finalUrl.length > 115
        ? fail("low", `This URL is ${ctx.finalUrl.length} characters -- long URLs can get truncated in search results and are harder to share cleanly.`)
        : pass(),
  },
  {
    id: "cache-control",
    category: "Technical",
    label: "Cache-Control header present",
    run: (ctx) => (ctx.hasCacheControl ? pass() : fail("info", "No Cache-Control header on this page -- without one, browsers and CDNs fall back to their own heuristics for how long to cache it.")),
  },
  {
    id: "render-blocking-scripts",
    category: "Technical",
    label: "No render-blocking scripts in <head>",
    run: (ctx) =>
      ctx.state.renderBlockingScripts === 0
        ? pass()
        : fail("low", `${ctx.state.renderBlockingScripts} script(s) in <head> load without async or defer -- they block the page from rendering until each one downloads and runs.`),
  },
  {
    id: "dom-size",
    category: "Technical",
    label: "DOM size is reasonable",
    run: (ctx) =>
      ctx.state.domElementCount > 3000
        ? fail("low", `Large DOM: about ${ctx.state.domElementCount} HTML elements on this page -- very large DOMs slow down rendering and JavaScript execution.`)
        : pass(),
  },
  {
    id: "hreflang-self-reference",
    category: "Technical",
    label: "hreflang tags include a self-reference",
    run: (ctx) => {
      if (ctx.state.hreflangTags.length === 0) return na();
      const normalize = (u) => u.replace(/\/$/, "");
      const hasSelf = ctx.state.hreflangTags.some((h) => {
        try {
          return normalize(new URL(h.href, ctx.finalUrl).toString()) === normalize(ctx.finalUrl);
        } catch {
          return false;
        }
      });
      return hasSelf
        ? pass()
        : fail("low", "hreflang tags are present but none of them reference this exact page -- each language/region version should include a self-referencing hreflang entry.");
    },
  },
  {
    id: "image-dimensions",
    category: "Content",
    label: "Images specify width and height",
    run: (ctx) => {
      if (ctx.state.imgTotal === 0) return na();
      return ctx.state.imgMissingDimensions > 0
        ? fail("info", `${ctx.state.imgMissingDimensions} of ${ctx.state.imgTotal} image(s) are missing width/height attributes -- without them, the browser can't reserve space in advance and the page can jump as images load.`)
        : pass();
    },
  },
  {
    id: "descriptive-link-text",
    category: "On-Page",
    label: "Links use descriptive text",
    run: (ctx) =>
      ctx.state.genericAnchorTextCount === 0
        ? pass()
        : fail("low", `${ctx.state.genericAnchorTextCount} link(s) use generic text like "click here" or "read more" as their entire link text -- descriptive link text helps both users and search engines understand where a link goes.`),
  },
  {
    id: "hidden-links",
    category: "Security",
    label: "No hidden/cloaked links",
    run: (ctx) =>
      ctx.state.hiddenLinksCount === 0
        ? pass()
        : fail("medium", `${ctx.state.hiddenLinksCount} link(s) found styled with display:none or visibility:hidden while still containing text -- this is a common spam/cloaking pattern search engines penalize, even if done unintentionally.`),
  },
];

const SEVERITY_WEIGHT = { critical: 25, high: 15, medium: 8, low: 3, info: 0 };
const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
// Fixed set so every category always appears in the response (as a clean
// 100) even when it has zero findings -- the frontend renders one ring per
// entry here, and a category silently missing would look like a bug, not
// a compliment.
const CATEGORIES = ["Technical", "On-Page", "Content", "Structured Data", "Social", "Security"];

function computeScore(findings) {
  let score = 100;
  for (const f of findings) score -= SEVERITY_WEIGHT[f.severity] || 0;
  return Math.max(0, Math.min(100, score));
}

function computeCategoryScores(findings) {
  const scores = {};
  for (const cat of CATEGORIES) scores[cat] = 100;
  for (const f of findings) {
    const cat = f.category || "Other";
    if (!(cat in scores)) scores[cat] = 100;
    scores[cat] = Math.max(0, scores[cat] - (SEVERITY_WEIGHT[f.severity] || 0));
  }
  return scores;
}

function letterGrade(score) {
  if (score >= 97) return "A+";
  if (score >= 93) return "A";
  if (score >= 90) return "A-";
  if (score >= 87) return "B+";
  if (score >= 83) return "B";
  if (score >= 80) return "B-";
  if (score >= 77) return "C+";
  if (score >= 73) return "C";
  if (score >= 70) return "C-";
  if (score >= 60) return "D";
  return "F";
}
