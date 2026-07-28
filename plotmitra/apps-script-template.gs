// Plot Mitra — Google Apps Script Web App template.
// Not used by the live site directly; copy this into a Sheet's
// Extensions > Apps Script editor, deploy as a Web App, and paste the
// deployment URL into FORM_ENDPOINT in plotmitra.js.

function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = JSON.parse(e.postData.contents);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'Submitted At', 'Name', 'Phone', 'Email', 'Intent',
      'City', 'Plot Type', 'Budget', 'Plot of Interest', 'Message', 'Consent'
    ]);
  }

  sheet.appendRow([
    data.submittedAt || new Date().toISOString(),
    data.name || '',
    data.phone || '',
    data.email || '',
    data.intent || '',
    data.city || '',
    data.plotType || '',
    data.budget || '',
    data.plotOfInterest || '',
    data.message || '',
    data.consent ? 'Yes' : 'No'
  ]);

  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}
