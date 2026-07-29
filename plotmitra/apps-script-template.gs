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

function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  var isPartner = data.formType === 'partner';
  var sheet = getOrCreateSheet(isPartner ? 'Partners' : 'Leads', isPartner ? PARTNER_HEADERS : LEAD_HEADERS);

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  sheet.appendRow(headers.map(function (h) {
    var v = data[headerToKey(h)];
    if (Array.isArray(v)) return v.join(', ');
    return v || '';
  }));

  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}

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
