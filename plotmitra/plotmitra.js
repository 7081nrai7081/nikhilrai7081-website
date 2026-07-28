// Plot Mitra — lead form handling.
//
// To wire this up to a Google Sheet:
//   1. Open the target Google Sheet -> Extensions -> Apps Script.
//   2. Paste the contents of apps-script-template.gs into Code.gs.
//   3. Deploy -> New deployment -> type "Web app" -> execute as "Me",
//      access "Anyone" -> copy the deployment URL.
//   4. Paste that URL into FORM_ENDPOINT below.
// Until FORM_ENDPOINT is set, submissions fall back to opening a
// pre-filled email instead, so the form stays usable in the meantime.

var FORM_ENDPOINT = ""; // TODO: paste your Google Apps Script Web App URL here

(function () {
  var form = document.getElementById('pm-lead-form');
  var status = document.getElementById('pm-form-status');
  if (!form) return;

  document.querySelectorAll('.pm-interest-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var plotSelect = document.getElementById('pm-plot');
      if (plotSelect) plotSelect.value = btn.getAttribute('data-plot');
      document.getElementById('interest-form').scrollIntoView({ behavior: 'smooth' });
      document.getElementById('pm-name').focus({ preventScroll: true });
    });
  });

  function setStatus(msg, ok) {
    status.textContent = msg;
    status.className = 'pm-form-status ' + (ok ? 'pm-status-ok' : 'pm-status-err');
  }

  function mailtoFallback(data) {
    var body = [
      'Name: ' + data.name,
      'Phone: ' + data.phone,
      'Email: ' + (data.email || '-'),
      'Looking to: ' + data.intent,
      'City: ' + data.city,
      'Plot type: ' + (data.plotType || '-'),
      'Budget: ' + (data.budget || '-'),
      'Plot of interest: ' + (data.plotOfInterest || '-'),
      'Message: ' + (data.message || '-')
    ].join('\n');
    var url = 'mailto:7081nrai7081@gmail.com'
      + '?subject=' + encodeURIComponent('Plot Mitra interest — ' + data.name)
      + '&body=' + encodeURIComponent(body);
    window.location.href = url;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    var data = {
      name: form.name.value.trim(),
      phone: form.phone.value.trim(),
      email: form.email.value.trim(),
      intent: form.intent.value,
      city: form.city.value,
      plotType: form.plotType.value,
      budget: form.budget.value,
      plotOfInterest: form.plotOfInterest.value,
      message: form.message.value.trim(),
      consent: form.consent.checked,
      submittedAt: new Date().toISOString()
    };

    if (!data.name || !data.phone || !data.city || !data.consent) {
      setStatus('Please fill in name, phone, city and accept the consent checkbox.', false);
      return;
    }

    var submitBtn = form.querySelector('.pm-submit-btn');
    submitBtn.disabled = true;

    if (!FORM_ENDPOINT) {
      mailtoFallback(data);
      setStatus('Opening your email app to send this in — form isn’t connected to Sheets yet.', true);
      submitBtn.disabled = false;
      return;
    }

    fetch(FORM_ENDPOINT, {
      method: 'POST',
      mode: 'no-cors', // Apps Script web apps don't return CORS headers; response body is opaque.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(data)
    })
      .then(function () {
        setStatus('Thanks! We’ve got your details and will be in touch.', true);
        form.reset();
      })
      .catch(function () {
        setStatus('Something went wrong sending that — try the email option instead.', false);
        mailtoFallback(data);
      })
      .finally(function () {
        submitBtn.disabled = false;
      });
  });
})();
