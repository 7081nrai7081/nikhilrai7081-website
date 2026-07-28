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
  // First-touch attribution: capture UTM params (and landing page/referrer)
  // once per visitor, on whichever page they first land on, and carry it
  // through to wherever they eventually submit a form.
  var ATTR_KEY = 'pmAttribution';
  try {
    if (!localStorage.getItem(ATTR_KEY)) {
      var params = new URLSearchParams(window.location.search);
      var attribution = {
        utmSource: params.get('utm_source') || '',
        utmMedium: params.get('utm_medium') || '',
        utmCampaign: params.get('utm_campaign') || '',
        utmTerm: params.get('utm_term') || '',
        utmContent: params.get('utm_content') || '',
        referrer: document.referrer || '',
        landingPage: window.location.pathname
      };
      localStorage.setItem(ATTR_KEY, JSON.stringify(attribution));
    }
  } catch (e) { /* localStorage unavailable (private mode etc.) — attribution just won't be captured */ }

  function getAttribution() {
    try {
      return JSON.parse(localStorage.getItem(ATTR_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  var navToggle = document.getElementById('pm-nav-toggle');
  var nav = document.getElementById('pm-nav');
  if (navToggle && nav) {
    navToggle.addEventListener('click', function () {
      var open = nav.classList.toggle('pm-nav-open');
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    nav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        nav.classList.remove('pm-nav-open');
        navToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

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
    var attribution = getAttribution();
    for (var key in attribution) {
      if (attribution[key]) data[key] = attribution[key];
    }
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
