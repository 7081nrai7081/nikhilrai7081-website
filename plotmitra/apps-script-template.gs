// Plot Mitra — Google Apps Script Web App template.
// Kept here for reference/version control only; the live copy is deployed
// as "Plot Mitra Form Handler" inside the "Plot Mitra — Leads & Partners"
// Google Sheet (Extensions > Apps Script), whose Web App URL is
// FORM_ENDPOINT in plotmitra.js. If you change the logic here, paste the
// update into that Sheet's Apps Script editor too and redeploy (Deploy >
// Manage deployments > edit > new version) — editing this file alone does
// not affect the live endpoint.
//
// Routes buyer-interest submissions to a "Leads" tab and partner
// inquiries to a "Partners" tab (created automatically on first use). If
// per-campaign sheets are ever needed, prefer filtering this sheet by the
// UTM columns first — only add a new sheet if that's not enough.
//
// Phone OTP verification (2Factor.in): doGet handles ?action=sendOtp and
// ?action=verifyOtp (called via plain GET from the page so the JSON
// response is actually readable — Apps Script doPost responses are opaque
// cross-origin in this setup, see the no-cors note in plotmitra.js, but
// doGet responses are not). doPost's submitForm() then re-checks that the
// submitted phone has a verified session in cache before writing the row,
// so verification can't be bypassed by editing the page's hidden field.
//
// Setup: sign up at https://2factor.in, grab your API key, then in this
// Script's editor go to Project Settings > Script Properties and add
// OTP_API_KEY = <your key>. Never paste the key directly into this file —
// it's version-controlled in a public repo.

var OTP_SESSION_TTL_SECONDS = 10 * 60; // how long a verified phone stays usable for submit
var OTP_SEND_COOLDOWN_SECONDS = 45;    // min gap between OTP sends to the same number
var OTP_SEND_MAX_PER_HOUR = 5;         // per-number cap to limit SMS cost/abuse

function doGet(e) {
  var action = e.parameter.action;
  if (action === 'sendOtp') return sendOtp(e.parameter.phone);
  if (action === 'verifyOtp') return verifyOtp(e.parameter.phone, e.parameter.sessionId, e.parameter.otp);
  return jsonOut({ status: 'error', message: 'Unknown action' });
}

function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  return submitForm(data);
}

function submitForm(data) {
  var digits = normalizePhone(data.phone);
  var verifiedSession = digits ? CacheService.getScriptCache().get('otp_verified_' + digits) : null;
  if (!verifiedSession || verifiedSession !== data.otpSessionId) {
    return jsonOut({ status: 'error', message: 'Phone number not verified' });
  }

  var isPartner = data.formType === 'partner';
  var sheet = getOrCreateSheet(isPartner ? 'Partners' : 'Leads', isPartner ? PARTNER_HEADERS : LEAD_HEADERS);

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  sheet.appendRow(headers.map(function (h) {
    var v = data[headerToKey(h)];
    if (Array.isArray(v)) return v.join(', ');
    return v || '';
  }));

  return jsonOut({ status: 'ok' });
}

// --- OTP verification (2Factor.in) --------------------------------------

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function normalizePhone(phone) {
  var digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.indexOf('91') === 0) digits = digits.slice(2);
  return digits.length === 10 ? digits : '';
}

function sendOtp(phone) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('OTP_API_KEY');
  if (!apiKey) return jsonOut({ status: 'error', message: 'OTP is not configured yet' });

  var digits = normalizePhone(phone);
  if (!digits) return jsonOut({ status: 'error', message: 'Enter a valid 10-digit mobile number' });

  var cache = CacheService.getScriptCache();
  if (cache.get('otp_cd_' + digits)) {
    return jsonOut({ status: 'error', message: 'Please wait a moment before requesting another code' });
  }
  var hourKey = 'otp_hr_' + digits;
  var hourCount = Number(cache.get(hourKey) || 0);
  if (hourCount >= OTP_SEND_MAX_PER_HOUR) {
    return jsonOut({ status: 'error', message: 'Too many attempts for this number. Try again later.' });
  }

  var url = 'https://2factor.in/API/V1/' + apiKey + '/SMS/' + digits + '/AUTOGEN';
  var res;
  try {
    res = JSON.parse(UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText());
  } catch (err) {
    return jsonOut({ status: 'error', message: 'Could not reach the SMS provider' });
  }
  if (res.Status !== 'Success') {
    return jsonOut({ status: 'error', message: 'Could not send code. Check the number and try again.' });
  }

  cache.put('otp_cd_' + digits, '1', OTP_SEND_COOLDOWN_SECONDS);
  cache.put(hourKey, String(hourCount + 1), 3600);

  return jsonOut({ status: 'ok', sessionId: res.Details });
}

function verifyOtp(phone, sessionId, otp) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('OTP_API_KEY');
  var digits = normalizePhone(phone);
  if (!apiKey || !digits || !sessionId || !otp) return jsonOut({ status: 'error', message: 'Missing code' });

  var url = 'https://2factor.in/API/V1/' + apiKey + '/SMS/VERIFY/' + sessionId + '/' + otp;
  var res;
  try {
    res = JSON.parse(UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText());
  } catch (err) {
    return jsonOut({ status: 'error', message: 'Could not reach the SMS provider' });
  }
  if (res.Status !== 'Success') {
    return jsonOut({ status: 'error', message: 'Incorrect or expired code' });
  }

  CacheService.getScriptCache().put('otp_verified_' + digits, sessionId, OTP_SESSION_TTL_SECONDS);
  return jsonOut({ status: 'ok' });
}

// --- Sheet helpers --------------------------------------------------------

var ATTRIBUTION_HEADERS = [
  'utmSource', 'utmMedium', 'utmCampaign', 'utmTerm', 'utmContent', 'referrer', 'landingPage'
];

var LEAD_HEADERS = [
  'submittedAt', 'name', 'phone', 'email', 'intent',
  'city', 'plotType', 'budget', 'plotOfInterest', 'message', 'consent'
].concat(ATTRIBUTION_HEADERS);

var PARTNER_HEADERS = [
  'submittedAt', 'name', 'phone', 'email', 'businessType',
  'areas', 'propertyTypes', 'volume', 'message'
].concat(ATTRIBUTION_HEADERS);

function headerToKey(h) { return h; }

function getOrCreateSheet(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
  }
  return sheet;
}
