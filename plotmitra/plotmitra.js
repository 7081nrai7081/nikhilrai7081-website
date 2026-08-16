// Plot Mitra — lead + partner form handling.
//
// Submissions go to the "Plot Mitra — Leads & Partners" Google Sheet via an
// Apps Script Web App (apps-script-template.gs, deployed from that Sheet's
// Extensions > Apps Script). It routes "lead" vs "partner" submissions to
// separate tabs, created automatically on first use. If we ever need
// per-campaign sheets (e.g. a paid-ads push), the UTM columns already
// captured below (utmSource/utmCampaign/etc.) are enough to filter one
// sheet rather than standing up a new one — only fork the sheet if that
// stops being sufficient.
// If the Sheet request ever fails, both forms fall back to WhatsApp —
// mailto: is unreliable on mobile since it needs a configured mail app,
// and most visitors here are on phones.

var FORM_ENDPOINT = "https://script.google.com/macros/s/AKfycbyoiO59iRzCIuulWmQd7jjQeO_NyFcwCRCn50Z4Kswk8BjEOsARclh0cP72y9MNvd4NwQ/exec";
var WHATSAPP_NUMBER = "919793082706"; // used for the fallback if the Sheet request fails

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

  function summaryText(data) {
    return Object.keys(data)
      .filter(function (k) { return k !== 'formType' && k !== 'submittedAt'; })
      .map(function (k) {
        var v = data[k];
        return k + ': ' + (Array.isArray(v) ? v.join(', ') : (v || '-'));
      })
      .join('\n');
  }

  function whatsappUrl(subjectPrefix, data) {
    var text = subjectPrefix + ' — ' + (data.name || '') + '\n\n' + summaryText(data);
    return 'https://wa.me/' + WHATSAPP_NUMBER + '?text=' + encodeURIComponent(text);
  }

  function mailtoUrl(subjectPrefix, data) {
    return 'mailto:7081nrai7081@gmail.com'
      + '?subject=' + encodeURIComponent(subjectPrefix + ' — ' + (data.name || ''))
      + '&body=' + encodeURIComponent(summaryText(data));
  }

  function showFallback(el, subjectPrefix, data) {
    var wa = whatsappUrl(subjectPrefix, data);
    var mail = mailtoUrl(subjectPrefix, data);
    el.className = 'pm-form-status pm-status-ok';
    el.innerHTML = 'Tap below to send your details directly — we’ll get them right away:'
      + '<span class="pm-fallback-actions">'
      + '<a class="pm-btn pm-btn-sm" href="' + wa + '" target="_blank" rel="noopener">Send via WhatsApp</a>'
      + '<a class="pm-btn pm-btn-outline pm-btn-sm" href="' + mail + '">Send via Email</a>'
      + '</span>';
    window.open(wa, '_blank');
  }

  // Phone OTP verification (2Factor.in via the Apps Script GET actions).
  // idPrefix is the phone <input>'s id; the OTP UI elements around it are
  // expected to follow the convention idPrefix + "-otp-send" / "-otp-row" /
  // "-otp" / "-otp-verify" / "-otp-status" / "-otp-session" (see index.html).
  function wirePhoneOtp(idPrefix) {
    var phoneInput = document.getElementById(idPrefix);
    if (!phoneInput) return null;
    var sendBtn = document.getElementById(idPrefix + '-otp-send');
    var verifyRow = document.getElementById(idPrefix + '-otp-row');
    var otpInput = document.getElementById(idPrefix + '-otp');
    var verifyBtn = document.getElementById(idPrefix + '-otp-verify');
    var statusEl = document.getElementById(idPrefix + '-otp-status');
    var sessionField = document.getElementById(idPrefix + '-otp-session');
    if (!sendBtn || !verifyRow || !otpInput || !verifyBtn || !statusEl || !sessionField) return null;

    var verified = false;
    var lastVerifiedPhone = '';

    function setOtpStatus(msg, ok) {
      statusEl.textContent = msg;
      statusEl.className = 'pm-otp-status ' + (ok ? 'pm-status-ok' : 'pm-status-err');
    }

    function otpFetch(params) {
      // Plain GET (not the no-cors POST used for the final submit) so the
      // JSON response body is actually readable — see the note in
      // apps-script-template.gs on why sendOtp/verifyOtp use doGet.
      return fetch(FORM_ENDPOINT + '?' + new URLSearchParams(params).toString())
        .then(function (r) { return r.json(); });
    }

    function invalidate() {
      verified = false;
      sessionField.value = '';
      verifyRow.hidden = true;
    }

    phoneInput.addEventListener('input', function () {
      if (verified && phoneInput.value.trim() !== lastVerifiedPhone) {
        invalidate();
        setOtpStatus('', true);
      }
    });

    sendBtn.addEventListener('click', function () {
      var phone = phoneInput.value.trim();
      if (!/^\d{10}$/.test(phone.replace(/\D/g, ''))) {
        setOtpStatus('Enter a valid 10-digit mobile number first.', false);
        return;
      }
      invalidate();
      sendBtn.disabled = true;
      otpFetch({ action: 'sendOtp', phone: phone })
        .then(function (res) {
          if (res.status !== 'ok') { setOtpStatus(res.message || 'Could not send code.', false); return; }
          sessionField.dataset.sessionId = res.sessionId;
          verifyRow.hidden = false;
          otpInput.value = '';
          otpInput.focus();
          setOtpStatus('Code sent — enter it below.', true);
        })
        .catch(function () { setOtpStatus('Could not send code. Check your connection.', false); })
        .finally(function () { sendBtn.disabled = false; });
    });

    verifyBtn.addEventListener('click', function () {
      var phone = phoneInput.value.trim();
      var sessionId = sessionField.dataset.sessionId;
      var otp = otpInput.value.trim();
      if (!sessionId) { setOtpStatus('Send a code first.', false); return; }
      if (!/^\d{4,8}$/.test(otp)) { setOtpStatus('Enter the code you received.', false); return; }
      verifyBtn.disabled = true;
      otpFetch({ action: 'verifyOtp', phone: phone, sessionId: sessionId, otp: otp })
        .then(function (res) {
          if (res.status !== 'ok') { setOtpStatus(res.message || 'Incorrect or expired code.', false); return; }
          verified = true;
          lastVerifiedPhone = phone;
          sessionField.value = sessionId;
          setOtpStatus('Phone number verified.', true);
        })
        .catch(function () { setOtpStatus('Could not verify. Check your connection.', false); })
        .finally(function () { verifyBtn.disabled = false; });
    });

    return {
      isVerified: function () { return verified && phoneInput.value.trim() === lastVerifiedPhone; }
    };
  }

  function wireForm(opts) {
    var form = opts.form;
    if (!form) return;
    var status = document.getElementById(opts.statusId);
    var otp = wirePhoneOtp(opts.phoneId);

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

      if (otp && !otp.isVerified()) {
        setStatus(status, 'Please verify your phone number before submitting.', false);
        return;
      }

      var submitBtn = form.querySelector('.pm-submit-btn');
      submitBtn.disabled = true;

      if (!FORM_ENDPOINT) {
        showFallback(status, opts.subject, data);
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
          showFallback(status, opts.subject, data);
        })
        .finally(function () {
          submitBtn.disabled = false;
        });
    });
  }

  wireForm({
    form: leadForm,
    statusId: 'pm-form-status',
    phoneId: 'pm-phone',
    required: ['name', 'phone', 'city', 'consent'],
    requiredMsg: 'Please fill in name, phone, city and accept the consent checkbox.',
    subject: 'Plot Mitra interest'
  });

  wireForm({
    form: partnerForm,
    statusId: 'pm-partner-status',
    phoneId: 'pm-p-phone',
    required: ['name', 'phone', 'businessType'],
    requiredMsg: 'Please fill in name, phone and business type.',
    subject: 'Plot Mitra partner inquiry'
  });
})();
