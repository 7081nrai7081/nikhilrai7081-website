// functions/api/pagespeed.js
//
// Cloudflare Pages Function that calls Google's PageSpeed Insights API v5
// to get REAL Core Web Vitals + a real Lighthouse Performance score for
// the page a visitor is auditing. Deliberately a SEPARATE endpoint from
// /api/audit.js, not folded into it, for two reasons:
//   1. A full Lighthouse run through PSI can take 10-25+ seconds -- the
//      fast technical audit (usually 1-3s) should render immediately, not
//      sit blocked behind Google's slowest possible response time. The
//      frontend calls this second, after the main report is already on
//      screen, and fills in a Performance section when it resolves.
//   2. Different data provenance, different failure mode: this is real,
//      externally-measured data (or explicitly absent if PSI has no data
//      for a URL), not a heuristic check like everything in audit.js. It
//      gets its own clearly-labeled section rather than being merged into
//      the CHECKS-based score, which would conflate two different scoring
//      methodologies into one misleading number.
//
// No Turnstile check here -- the token from the main /api/audit call is
// already single-use and consumed by the time this fires a few seconds
// later, and re-rendering a second Turnstile challenge just to call our
// own second endpoint would be worse UX for little real benefit. Relies
// on the same per-IP KV rate limit instead; this endpoint is only ever
// invoked from the UI after a real audit already completed, so it isn't
// a standalone open door the way /api/audit is.

// TEMPORARY 2026-08-21: bumped 8 -> 20, same reason/revert plan as
// functions/api/audit.js.
const REQUESTS_PER_HOUR = 20;
const FETCH_TIMEOUT_MS = 25000; // PSI's own Lighthouse run can be slow
const BLOCKED_HOST_RE =
  /(^|\.)(localhost|local)$|^0\.0\.0\.0$|^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\.|^\[?::1\]?$|^\[?fc[0-9a-f]{2}:|^\[?fe80:/i;

// Same reasoning as the wrapper in functions/api/audit.js: an unhandled
// exception anywhere below would otherwise crash the Function and
// surface as an opaque platform 502 instead of a graceful JSON error.
export async function onRequestPost(context) {
  try {
    return await handlePagespeed(context);
  } catch {
    return json({ ok: false, error: "Performance check failed unexpectedly. Please try again." }, 500);
  }
}

async function handlePagespeed(context) {
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

  if (!env.PAGESPEED_API_KEY) {
    // Fails closed with a clear reason rather than a generic 500 -- lets
    // the frontend just hide the Performance section instead of showing
    // an error, since this is an enhancement, not core functionality.
    return json({ ok: false, error: "Performance check is not configured.", unconfigured: true }, 503);
  }

  const ip = request.headers.get("cf-connecting-ip") || "";
  const withinLimit = await checkRateLimit(env, ip);
  if (!withinLimit) {
    return json({ ok: false, error: "Rate limit reached for performance checks. Try again later." }, 429);
  }

  const [mobile, desktop] = await Promise.allSettled([
    runPSI(targetUrl, env.PAGESPEED_API_KEY, "mobile"),
    runPSI(targetUrl, env.PAGESPEED_API_KEY, "desktop"),
  ]);

  const mobileResult = mobile.status === "fulfilled" ? mobile.value : null;
  const desktopResult = desktop.status === "fulfilled" ? desktop.value : null;

  if (!mobileResult && !desktopResult) {
    return json({ ok: false, error: "Couldn't fetch performance data for that URL right now." }, 502);
  }

  return json({ ok: true, url: targetUrl, mobile: mobileResult, desktop: desktopResult });
}

export async function onRequestGet() {
  return json({ ok: false, error: "Use POST." }, 405);
}

// Separate KV key prefix ("psi:") from the main audit's rate limiter
// ("rl:") so the two budgets don't collide, even though they share the
// same KV namespace and per-IP philosophy.
async function checkRateLimit(env, ip) {
  if (!env.AUDIT_KV || !ip) return true;
  const bucket = Math.floor(Date.now() / 3600000);
  const key = `psi:${ip}:${bucket}`;
  let count = 0;
  try {
    const current = await env.AUDIT_KV.get(key);
    count = current ? parseInt(current, 10) || 0 : 0;
  } catch {
    return true;
  }
  if (count >= REQUESTS_PER_HOUR) return false;
  try {
    await env.AUDIT_KV.put(key, String(count + 1), { expirationTtl: 3900 });
  } catch {
    /* best-effort */
  }
  return true;
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

async function runPSI(targetUrl, apiKey, strategy) {
  const psiUrl = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  psiUrl.searchParams.set("url", targetUrl);
  psiUrl.searchParams.set("key", apiKey);
  psiUrl.searchParams.set("strategy", strategy);
  psiUrl.searchParams.set("category", "PERFORMANCE");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(psiUrl.toString(), { signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();
    return extractMetrics(data);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Pulls out just what the report needs from PSI's large response: the
// overall 0-100 Lighthouse Performance score, lab metrics from the
// simulated Lighthouse run (always present), and real-user CrUX field
// data when Google has enough traffic on this URL/origin to report it
// (frequently absent for smaller sites -- that's normal, not a failure,
// and the frontend labels each clearly by provenance rather than
// pretending lab data is real-user data or hiding the distinction).
function extractMetrics(data) {
  const lh = data.lighthouseResult;
  if (!lh) return null;
  const perfCategory = lh.categories && lh.categories.performance;
  const score = perfCategory && typeof perfCategory.score === "number" ? Math.round(perfCategory.score * 100) : null;

  const audits = lh.audits || {};
  const pick = (id) => (audits[id] ? audits[id].displayValue || null : null);
  const lab = {
    lcp: pick("largest-contentful-paint"),
    cls: pick("cumulative-layout-shift"),
    tbt: pick("total-blocking-time"),
    fcp: pick("first-contentful-paint"),
    speedIndex: pick("speed-index"),
  };

  const cruxMetrics = data.loadingExperience && data.loadingExperience.metrics;
  let field = null;
  if (cruxMetrics) {
    const m = (key, divisor) => {
      const entry = cruxMetrics[key];
      if (!entry || typeof entry.percentile !== "number") return null;
      return { value: divisor ? entry.percentile / divisor : entry.percentile, category: entry.category || null };
    };
    field = {
      lcp: m("LARGEST_CONTENTFUL_PAINT_MS"),
      cls: m("CUMULATIVE_LAYOUT_SHIFT_SCORE", 100),
      inp: m("INTERACTION_TO_NEXT_PAINT"),
    };
    if (!field.lcp && !field.cls && !field.inp) field = null;
  }

  return { score, lab, field };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
