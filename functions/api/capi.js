/**
 * Meta Conversions API (CAPI) — Cloudflare Pages Function
 * Route: POST /api/capi   (file path /functions/api/capi.js maps to this route)
 *
 * Sends server-side PageView + Lead events to Meta so conversions survive
 * in-app-browser / ad-blocker signal loss. Each event carries the SAME
 * event_id the browser Pixel sent, so Meta DEDUPLICATES — no double counting.
 *
 * Required environment variables (set in Cloudflare Pages → Settings →
 * Environment variables, NOT in code):
 *   META_CAPI_TOKEN        - System-User access token from Meta Events Manager
 * Optional:
 *   META_PIXEL_ID          - defaults to the page's pixel (912347764598809)
 *   META_CAPI_TEST_CODE    - Events Manager "Test Events" code, for verification
 */

const GRAPH_VERSION = 'v21.0';
const DEFAULT_PIXEL_ID = '912347764598809';
const ALLOWED_EVENTS = { PageView: 1, Lead: 1, ViewContent: 1 };

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const token = env.META_CAPI_TOKEN;

  // No token configured → no-op success so the client never errors/retries.
  if (!token) return json({ ok: false, reason: 'capi_not_configured' });

  let data;
  try { data = await request.json(); } catch (e) { return json({ ok: false, reason: 'bad_json' }, 400); }

  const eventName = ALLOWED_EVENTS[data.event_name] ? data.event_name : null;
  if (!eventName || !data.event_id) return json({ ok: false, reason: 'invalid_event' }, 400);

  const pixelId = env.META_PIXEL_ID || DEFAULT_PIXEL_ID;
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const ua = request.headers.get('User-Agent') || '';

  const userData = { client_ip_address: ip, client_user_agent: ua };
  if (data.fbp) userData.fbp = data.fbp;
  if (data.fbc) userData.fbc = data.fbc;

  const payload = {
    data: [{
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: String(data.event_id),
      event_source_url: data.event_source_url || request.headers.get('Referer') || '',
      action_source: 'website',
      user_data: userData,
      custom_data: data.custom || {}
    }]
  };
  if (env.META_CAPI_TEST_CODE) payload.test_event_code = env.META_CAPI_TEST_CODE;

  const url = 'https://graph.facebook.com/' + GRAPH_VERSION + '/' + pixelId +
              '/events?access_token=' + encodeURIComponent(token);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const out = await res.json().catch(function () { return {}; });
    return json({ ok: res.ok, status: res.status, meta: out }, res.ok ? 200 : 502);
  } catch (e) {
    // Never fail loudly — tracking must not break the user's outbound click.
    return json({ ok: false, reason: 'fetch_failed', error: String(e) });
  }
}
