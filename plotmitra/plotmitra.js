// Plot Mitra — lead + partner form handling.
//
// To wire either form up to a Google Sheet:
//   1. Open the target Google Sheet -> Extensions -> Apps Script.
//   2. Paste the contents of apps-script-template.gs into Code.gs
//      (it already routes "lead" vs "partner" submissions to separate tabs).
//   3. Deploy -> New deployment -> type "Web app" -> execute as "Me",
//      access "Anyone" -> copy the deployment URL.
//   4. Paste that URL into FORM_ENDPOINT below.
// Until FORM_ENDPOINT is set, both forms fall back to opening a
// pre-filled email instead, so they stay usable in the meantime.

var FORM_ENDPOINT = ""; // TODO: paste your Google Apps Script Web App URL here

(function () {
  var leadForm = document.getElementById('pm-lead-form');
  var partnerForm = document.getElementById('pm-partner-form');

  if (leadForm) {
    document.querySelectorAll('.pm-interest-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var plotSelect = document.getElementById('pm-plot');
        if (plotSelect) plotSelect.value = btn.getAttribute('data-plot');
        document.getElementById('interest-form').scrollIntoView({ behavior: 'smooth' });
        document.getElementById('pm-name').focus({ preventScroll: true });
      });
    });
  }

  function setStatus(el, msg, ok) {
    el.textContent = msg;
    el.className = 'pm-form-status ' + (ok ? 'pm-status-ok' : 'pm-status-err');
  }

  function collect(form) {
    var fd = new FormData(form);
    var data = {};
    fd.forEach(function (value, key) {
      if (data.hasOwnProperty(key)) {
        data[key] = [].concat(data[key], value);
      } else {
        data[key] = value;
      }
    });
    data.submittedAt = new Date().toISOString();
    return data;
  }

  function mailtoFallback(subjectPrefix, data) {
    var lines = Object.keys(data)
      .filter(function (k) { return k !== 'formType' && k !== 'submittedAt'; })
      .map(function (k) {
        var v = data[k];
        return k + ': ' + (Array.isArray(v) ? v.join(', ') : (v || '-'));
      });
    var url = 'mailto:7081nrai7081@gmail.com'
      + '?subject=' + encodeURIComponent(subjectPrefix + ' — ' + (data.name || ''))
      + '&body=' + encodeURIComponent(lines.join('\n'));
    window.location.href = url;
  }

  function wireForm(opts) {
    var form = opts.form;
    if (!form) return;
    var status = document.getElementById(opts.statusId);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var data = collect(form);

      for (var i = 0; i < opts.required.length; i++) {
        var field = opts.required[i];
        if (!data[field] || (field === 'consent' && data.consent !== 'on')) {
          setStatus(status, opts.requiredMsg, false);
          return;
        }
      }

      var submitBtn = form.querySelector('.pm-submit-btn');
      submitBtn.disabled = true;

      if (!FORM_ENDPOINT) {
        mailtoFallback(opts.subject, data);
        setStatus(status, 'Opening your email app to send this in — form isn’t connected to Sheets yet.', true);
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
          setStatus(status, 'Thanks! We’ve got your details and will be in touch.', true);
          form.reset();
        })
        .catch(function () {
          setStatus(status, 'Something went wrong sending that — try the email option instead.', false);
          mailtoFallback(opts.subject, data);
        })
        .finally(function () {
          submitBtn.disabled = false;
        });
    });
  }

  wireForm({
    form: leadForm,
    statusId: 'pm-form-status',
    required: ['name', 'phone', 'city', 'consent'],
    requiredMsg: 'Please fill in name, phone, city and accept the consent checkbox.',
    subject: 'Plot Mitra interest'
  });

  wireForm({
    form: partnerForm,
    statusId: 'pm-partner-status',
    required: ['name', 'phone', 'businessType'],
    requiredMsg: 'Please fill in name, phone and business type.',
    subject: 'Plot Mitra partner inquiry'
  });
})();
