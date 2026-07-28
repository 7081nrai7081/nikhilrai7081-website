// Plot Mitra — Google Apps Script Web App template.
// Not used by the live site directly; copy this into a Sheet's
// Extensions > Apps Script editor, deploy as a Web App, and paste the
// deployment URL into FORM_ENDPOINT in plotmitra.js.
//
// Routes buyer-interest submissions to a "Leads" tab and partner
// inquiries to a "Partners" tab (created automatically on first use).

function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  var isPartner = data.formType === 'partner';
  var sheet = getOrCreateSheet(isPartner ? 'Partners' : 'Leads', isPartner ? PARTNER_HEADERS : LEAD_HEADERS);

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  sheet.appendRow(headers.map(function (h) {
    return data[headerToKey(h)] || '';
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
