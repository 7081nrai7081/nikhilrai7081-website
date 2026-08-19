/* Free SEO Audit tool (/free-seo-audit).
 * Two independent calls on submit:
 *   1. Lead capture -> Web3Forms (same JSON-fetch pattern as #contact-form
 *      in main.js), so a lead is recorded even if the live audit itself
 *      fails for some reason (bad URL, target site down, etc).
 *   2. The actual audit -> this site's own /api/audit Function, which does
 *      the live server-side fetch (browsers can't fetch arbitrary
 *      cross-origin HTML directly -- that's why this needs a backend call
 *      at all instead of running fully client-side).
 * Both must be attempted; results only render once the audit call returns.
 */
(function () {
  'use strict';

  function track(event, params) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(Object.assign({ event: event }, params || {}));
  }

  var form = document.getElementById('audit-form');
  if (!form) return;

  var status = document.getElementById('audit-status');
  var resultsEl = document.getElementById('audit-results');
  var ringEl = document.getElementById('audit-score-ring');
  var scoreNumEl = document.getElementById('audit-score-num');
  var scoreUrlEl = document.getElementById('audit-score-url');
  var findingsEl = document.getElementById('audit-findings');

  function setStatus(kind, msg) {
    if (!status) return;
    status.className = 'form-status' + (kind ? ' ' + kind : '');
    status.textContent = msg;
  }

  function ringColorFor(score) {
    if (score >= 80) return '#16a34a';
    if (score >= 50) return '#ca8a04';
    return '#dc2626';
  }

  function renderResults(data) {
    scoreNumEl.textContent = data.score;
    scoreUrlEl.textContent = data.url;
    ringEl.style.setProperty('--audit-score', data.score);
    ringEl.style.setProperty('--audit-ring-color', ringColorFor(data.score));

    findingsEl.innerHTML = '';
    if (!data.findings.length) {
      var li = document.createElement('li');
      li.className = 'audit-finding sev-info';
      li.innerHTML = '<span class="sev">Nice</span><span>No issues found by this check set. That still doesn’t cover Core Web Vitals, backlinks, or content strategy — book a call for the full picture.</span>';
      findingsEl.appendChild(li);
    } else {
      data.findings.forEach(function (f) {
        var item = document.createElement('li');
        item.className = 'audit-finding sev-' + f.severity;
        var sev = document.createElement('span');
        sev.className = 'sev';
        sev.textContent = f.severity;
        var msg = document.createElement('span');
        msg.textContent = f.message;
        item.appendChild(sev);
        item.appendChild(msg);
        findingsEl.appendChild(item);
      });
    }

    resultsEl.hidden = false;
    resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();

    var honeypot = form.querySelector('input[name="botcheck"]');
    if (honeypot && honeypot.checked) return; // silently drop bot submissions

    var urlField = form.querySelector('#au-url');
    var url = urlField ? urlField.value.trim() : '';
    if (!/^https?:\/\//i.test(url)) {
      setStatus('err', 'Enter a full URL starting with http:// or https://');
      return;
    }

    var btn = form.querySelector('button[type="submit"]');
    var label = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Auditing…'; }
    setStatus('', 'Capturing your details and running the audit — this takes a few seconds…');
    resultsEl.hidden = true;

    var formData = Object.fromEntries(new FormData(form));

    // 1. Lead capture (best-effort -- don't block the audit on this).
    fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(formData)
    }).then(function () {
      track('free_audit_lead_captured', { audit_url: url });
    }).catch(function () { /* lead capture is best-effort; the audit still runs */ });

    // 2. The actual audit.
    try {
      var res = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url })
      });
      var data = await res.json();
      if (!data.ok) {
        setStatus('err', data.error || 'Something went wrong running that audit.');
        return;
      }
      setStatus('ok', 'Done — here’s what I found.');
      track('free_audit_completed', { audit_url: url, audit_score: data.score });
      renderResults(data);
    } catch (err) {
      setStatus('err', 'Network error while running the audit. Please try again.');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = label; }
    }
  });
})();
