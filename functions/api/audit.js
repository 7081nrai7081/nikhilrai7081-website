// functions/api/audit.js
//
// Cloudflare Pages Function backing the free live SEO audit at
// /free-seo-audit. Runs server-side because browsers can't fetch arbitrary
// cross-origin HTML (CORS) -- a Function on this same domain can. This is
// the first server-side code added since the VYNTRA Pixel/CAPI removal
// (2026-07-02); unlike that, this makes no third-party ad-tracking calls,
// stores nothing, and only ever fetches the single URL the visitor typed.
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
//     an internal address -- classic SSRF-via-redirect).
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

const MAX_BYTES = 3 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8000;
const REQUESTS_PER_HOUR = 8;
// Keep in sync with the number of distinct checks in collectFindings() +
// applySiteLevelFindings() below -- shown to the visitor as a credibility
// signal, so it must stay an honest count, not a marketing number.
const TOTAL_CHECKS = 24;
const BLOCKED_HOST_RE =
  /(^|\.)(localhost|local)$|^0\.0\.0\.0$|^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\.|^\[?::1\]?$|^\[?fc[0-9a-f]{2}:|^\[?fe80:/i;

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

  // Cheap, parallel, best-effort checks against the same origin -- each one
  // is wrapped so a timeout/404/network hiccup on either just means "not
  // found", not a failed audit.
  const origin = new URL(finalUrl).origin;
  const [robotsOk, sitemapOk] = await Promise.all([
    checkExists(origin + "/robots.txt"),
    checkExists(origin + "/sitemap.xml"),
  ]);

  let result;
  try {
    result = await auditHtml(res);
  } catch {
    return json({ ok: false, error: "Audit failed while reading that page." }, 500);
  }

  applySiteLevelFindings(result.findings, { isHttps, hstsPresent, robotsOk, sitemapOk, responseMs });
  result.score = recomputeScore(result.findings);
  result.grade = letterGrade(result.score);
  result.categoryScores = computeCategoryScores(result.findings);

  return json({ ok: true, url: targetUrl, checksRun: TOTAL_CHECKS, ...result });
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

async function auditHtml(res) {
  const state = {
    title: "",
    meta: {},
    canonical: null,
    h1Count: 0,
    lang: null,
    imgTotal: 0,
    imgMissingAlt: 0,
    ldjsonBlocks: [],
    bodyWords: 0,
    looksLikeSPA: false,
  };
  let currentLdBuf = null;

  const rewriter = new HTMLRewriter()
    .on("html", {
      element(el) {
        state.lang = el.getAttribute("lang");
      },
    })
    .on("title", {
      text(t) {
        state.title += t.text;
      },
    })
    .on("meta", {
      element(el) {
        const key = (el.getAttribute("name") || el.getAttribute("property") || "").toLowerCase();
        if (key) state.meta[key] = el.getAttribute("content") || "";
      },
    })
    .on("link", {
      element(el) {
        if ((el.getAttribute("rel") || "").toLowerCase() === "canonical") {
          state.canonical = el.getAttribute("href");
        }
      },
    })
    .on("h1", {
      element() {
        state.h1Count++;
      },
    })
    .on("img", {
      element(el) {
        state.imgTotal++;
        if (el.getAttribute("alt") === null) state.imgMissingAlt++;
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

  return {
    findings: collectFindings(state),
    extracted: {
      title: state.title.trim(),
      description: (state.meta["description"] || "").trim(),
      h1Count: state.h1Count,
      wordCount: state.bodyWords,
      imageCount: state.imgTotal,
    },
  };
}

// Categories match the grouping convention used across most SEO audit
// tools (SEOptimer, Sitechecker, etc): Technical, On-Page, Content, Social,
// Structured Data, Security -- so this reads as a familiar audit report,
// not a flat dev-tool lint list.
function collectFindings(state) {
  const findings = [];
  const flag = (severity, category, message) => findings.push({ severity, category, message });

  if (state.looksLikeSPA && state.bodyWords < 50) {
    flag(
      "info",
      "Content",
      "This looks like a JavaScript-rendered app (React/Vue/Next/Nuxt-style root element with very little text in the raw HTML). This audit only reads the HTML as served, not what JavaScript renders afterward -- some findings below (especially thin content) may not reflect what a user or Google actually sees."
    );
  }

  const title = state.title.trim();
  if (!title) flag("critical", "On-Page", "Missing <title> tag.");
  else if (title.length > 65) flag("low", "On-Page", `Title is ${title.length} characters (keep it under ~60 so it doesn't get cut off in search results).`);

  const desc = (state.meta["description"] || "").trim();
  if (!desc) flag("high", "On-Page", "Missing meta description.");
  else if (desc.length < 70 || desc.length > 170) flag("low", "On-Page", `Meta description is ${desc.length} characters (ideal range is 70-160).`);

  const robots = (state.meta["robots"] || "").toLowerCase();
  if (robots.includes("noindex")) flag("critical", "Technical", "This page is set to noindex -- Google will not show it in search results.");

  if (!state.canonical) flag("medium", "Technical", "No canonical tag found.");

  if (state.h1Count === 0) flag("high", "On-Page", "No <h1> heading found on the page.");
  else if (state.h1Count > 1) flag("medium", "On-Page", `${state.h1Count} <h1> tags found (a page should have exactly one).`);

  if (!state.lang) flag("low", "Technical", "Missing lang attribute on <html>.");

  if (!("viewport" in state.meta)) flag("medium", "Technical", "Missing viewport meta tag -- can hurt mobile usability and rankings.");

  for (const key of ["og:title", "og:description", "og:image"]) {
    if (!(key in state.meta)) flag("low", "Social", `Missing ${key} -- affects how this page looks when shared on social media.`);
  }
  if (!("twitter:card" in state.meta)) flag("low", "Social", "Missing twitter:card tag.");

  if (state.ldjsonBlocks.length === 0) {
    flag("info", "Structured Data", "No structured data (JSON-LD / Schema.org) found -- adding it can unlock rich search results.");
  } else {
    for (const block of state.ldjsonBlocks) {
      try {
        JSON.parse(block);
      } catch {
        flag("high", "Structured Data", "Invalid JSON-LD structured data found -- Google will ignore it as written.");
      }
    }
  }

  if (state.imgTotal > 0 && state.imgMissingAlt > 0) {
    flag("medium", "Content", `${state.imgMissingAlt} of ${state.imgTotal} image(s) have no alt attribute.`);
  }

  if (state.bodyWords < 150) flag("low", "Content", `Thin content: only about ${state.bodyWords} words of visible text on the page.`);

  return findings;
}

// Checks that don't need the parsed page -- HTTPS, security headers,
// robots.txt/sitemap.xml presence, response time. Appends into the same
// findings array collectFindings() produced.
function applySiteLevelFindings(findings, { isHttps, hstsPresent, robotsOk, sitemapOk, responseMs }) {
  const flag = (severity, category, message) => findings.push({ severity, category, message });

  if (!isHttps) {
    flag("critical", "Security", "This page is served over HTTP, not HTTPS -- browsers flag it as insecure and it's a known ranking factor.");
  } else if (!hstsPresent) {
    flag("info", "Security", "No Strict-Transport-Security (HSTS) header -- a minor hardening step once HTTPS is already in place.");
  }

  if (!robotsOk) flag("medium", "Technical", "No robots.txt found at the site root -- search engines rely on it for crawl guidance.");
  if (!sitemapOk) flag("low", "Technical", "No sitemap.xml found at the site root (it may be referenced elsewhere, e.g. from robots.txt, but the common default location returned nothing).");

  if (responseMs > 2500) {
    flag("medium", "Technical", `The server took about ${(responseMs / 1000).toFixed(1)}s to respond -- slow server response time hurts both SEO and user experience. (Measured from our server, not a real visitor's connection -- treat as a rough signal, not Core Web Vitals.)`);
  } else if (responseMs > 1200) {
    flag("low", "Technical", `The server took about ${(responseMs / 1000).toFixed(1)}s to respond -- worth a look, though this is a rough server-to-server measurement, not real-user timing.`);
  }
}

const SEVERITY_WEIGHT = { critical: 25, high: 15, medium: 8, low: 3, info: 0 };
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

function recomputeScore(findings) {
  const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return computeScore(findings);
}
