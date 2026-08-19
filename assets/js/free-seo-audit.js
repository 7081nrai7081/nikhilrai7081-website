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
  var gradeEl = document.getElementById('audit-score-grade');
  var scoreNumEl = document.getElementById('audit-score-num');
  var scoreLabelEl = document.getElementById('audit-score-label');
  var scoreUrlEl = document.getElementById('audit-score-url');
  var checksRunEl = document.getElementById('audit-checks-run');
  var categoryScoresEl = document.getElementById('audit-category-scores');
  var radarEl = document.getElementById('audit-radar');
  var basicsEl = document.getElementById('audit-basics');
  var prioritiesEl = document.getElementById('audit-priorities');
  var findingsEl = document.getElementById('audit-findings');

  // Display order for category groups -- most-actionable-first, matching
  // how most SEO audit tools sequence a report.
  var CATEGORY_ORDER = ['Technical', 'On-Page', 'Content', 'Structured Data', 'Social', 'Security'];
  var CATEGORY_SHORT = { 'Technical': 'Technical', 'On-Page': 'On-Page', 'Content': 'Content', 'Structured Data': 'Schema', 'Social': 'Social', 'Security': 'Security' };

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

  function scoreLabelFor(score) {
    if (score >= 90) return 'Excellent — this page is in great shape';
    if (score >= 80) return 'This page is good';
    if (score >= 70) return 'This page is okay, but could be better';
    if (score >= 50) return 'This page needs work';
    return 'This page needs significant work';
  }

  function buildFindingItem(f) {
    var item = document.createElement('li');
    item.className = 'audit-finding sev-' + f.severity;
    var sev = document.createElement('span');
    sev.className = 'sev';
    sev.textContent = f.severity;
    var msg = document.createElement('span');
    msg.textContent = f.message;
    item.appendChild(sev);
    item.appendChild(msg);
    return item;
  }

  function renderCategoryScores(categoryScores) {
    categoryScoresEl.innerHTML = '';
    CATEGORY_ORDER.forEach(function (cat) {
      var score = categoryScores && (cat in categoryScores) ? categoryScores[cat] : 100;
      var item = document.createElement('div');
      item.className = 'audit-cat-score';
      var ring = document.createElement('div');
      ring.className = 'audit-cat-ring';
      ring.style.setProperty('--audit-score', score);
      ring.style.setProperty('--audit-ring-color', ringColorFor(score));
      var grade = document.createElement('span');
      grade.textContent = letterGrade(score);
      ring.appendChild(grade);
      var label = document.createElement('span');
      label.className = 'audit-cat-label';
      label.textContent = cat;
      item.appendChild(ring);
      item.appendChild(label);
      categoryScoresEl.appendChild(item);
    });
  }

  function letterGrade(score) {
    if (score >= 97) return 'A+';
    if (score >= 93) return 'A';
    if (score >= 90) return 'A-';
    if (score >= 87) return 'B+';
    if (score >= 83) return 'B';
    if (score >= 80) return 'B-';
    if (score >= 77) return 'C+';
    if (score >= 73) return 'C';
    if (score >= 70) return 'C-';
    if (score >= 60) return 'D';
    return 'F';
  }

  function renderRadar(categoryScores) {
    var cx = 140, cy = 120, maxR = 88;
    var n = CATEGORY_ORDER.length;
    var angleFor = function (i) { return -Math.PI / 2 + i * (2 * Math.PI / n); };
    var pointAt = function (i, r) {
      var a = angleFor(i);
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    };
    var svg = '';
    // Background grid rings at 25/50/75/100%.
    [0.25, 0.5, 0.75, 1].forEach(function (pct) {
      var pts = [];
      for (var i = 0; i < n; i++) pts.push(pointAt(i, maxR * pct).join(','));
      svg += '<polygon points="' + pts.join(' ') + '" fill="none" stroke="var(--border)" stroke-width="1"/>';
    });
    // Axis lines.
    for (var i = 0; i < n; i++) {
      var p = pointAt(i, maxR);
      svg += '<line x1="' + cx + '" y1="' + cy + '" x2="' + p[0] + '" y2="' + p[1] + '" stroke="var(--border)" stroke-width="1"/>';
    }
    // Data polygon.
    var dataPts = CATEGORY_ORDER.map(function (cat, i) {
      var score = categoryScores && (cat in categoryScores) ? categoryScores[cat] : 100;
      return pointAt(i, maxR * (score / 100));
    });
    svg += '<polygon points="' + dataPts.map(function (p) { return p.join(','); }).join(' ') + '" fill="rgba(201,162,39,.28)" stroke="#c9a227" stroke-width="2"/>';
    dataPts.forEach(function (p) {
      svg += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="3" fill="#c9a227"/>';
    });
    // Labels, nudged outward from each axis point.
    CATEGORY_ORDER.forEach(function (cat, i) {
      var p = pointAt(i, maxR + 22);
      var anchor = Math.abs(p[0] - cx) < 4 ? 'middle' : (p[0] > cx ? 'start' : 'end');
      svg += '<text x="' + p[0] + '" y="' + p[1] + '" text-anchor="' + anchor + '" dominant-baseline="middle" font-size="11" fill="var(--muted)" font-family="Inter, sans-serif">' + CATEGORY_SHORT[cat] + '</text>';
    });
    radarEl.innerHTML = svg;
  }

  function basicRow(label, value) {
    var row = document.createElement('div');
    row.className = 'audit-basic-row';
    var l = document.createElement('span');
    l.className = 'audit-basic-label';
    l.textContent = label;
    var v = document.createElement('span');
    v.className = 'audit-basic-value';
    v.textContent = value;
    row.appendChild(l);
    row.appendChild(v);
    return row;
  }

  function renderBasics(extracted) {
    basicsEl.innerHTML = '<h3>What we found on the page</h3>';
    if (!extracted) { basicsEl.hidden = true; return; }
    basicsEl.hidden = false;
    basicsEl.appendChild(basicRow('Title tag', extracted.title ? '"' + extracted.title + '" (' + extracted.title.length + ' chars)' : 'Not found'));
    basicsEl.appendChild(basicRow('Meta description', extracted.description ? '"' + extracted.description + '" (' + extracted.description.length + ' chars)' : 'Not found'));
    basicsEl.appendChild(basicRow('Word count', String(extracted.wordCount)));
    basicsEl.appendChild(basicRow('Images found', String(extracted.imageCount)));
    basicsEl.appendChild(basicRow('H1 headings', String(extracted.h1Count)));
  }

  function renderResults(data) {
    gradeEl.textContent = data.grade || letterGrade(data.score);
    scoreNumEl.textContent = data.score + '/100';
    scoreLabelEl.textContent = scoreLabelFor(data.score);
    scoreUrlEl.textContent = data.url;
    ringEl.style.setProperty('--audit-score', data.score);
    ringEl.style.setProperty('--audit-ring-color', ringColorFor(data.score));
    if (checksRunEl && data.checksRun) {
      checksRunEl.textContent = data.checksRun + ' checks run across Technical, On-Page, Content, Structured Data, Social & Security';
    }
    renderCategoryScores(data.categoryScores);
    renderRadar(data.categoryScores);
    renderBasics(data.extracted);

    var topPriorities = data.findings.filter(function (f) {
      return f.severity === 'critical' || f.severity === 'high';
    }).slice(0, 3);
    if (topPriorities.length) {
      prioritiesEl.innerHTML = '<h3>Fix these first</h3>';
      var pList = document.createElement('ol');
      topPriorities.forEach(function (f) {
        var li = document.createElement('li');
        li.textContent = f.message;
        pList.appendChild(li);
      });
      prioritiesEl.appendChild(pList);
      prioritiesEl.hidden = false;
    } else {
      prioritiesEl.hidden = true;
      prioritiesEl.innerHTML = '';
    }

    findingsEl.innerHTML = '';
    if (!data.findings.length) {
      var group = document.createElement('div');
      group.className = 'audit-category';
      var list = document.createElement('ul');
      list.className = 'audit-category-list';
      list.appendChild(buildFindingItem({ severity: 'info', message: 'No issues found by this check set. That still doesn’t cover Core Web Vitals, backlinks, or content strategy — book a call for the full picture.' }));
      group.appendChild(list);
      findingsEl.appendChild(group);
    } else {
      var byCategory = {};
      data.findings.forEach(function (f) {
        var cat = f.category || 'Other';
        (byCategory[cat] = byCategory[cat] || []).push(f);
      });
      var categories = Object.keys(byCategory).sort(function (a, b) {
        var ia = CATEGORY_ORDER.indexOf(a), ib = CATEGORY_ORDER.indexOf(b);
        if (ia === -1) ia = CATEGORY_ORDER.length;
        if (ib === -1) ib = CATEGORY_ORDER.length;
        return ia - ib;
      });
      categories.forEach(function (cat) {
        var group = document.createElement('div');
        group.className = 'audit-category';
        var h3 = document.createElement('h3');
        h3.textContent = cat + ' (' + byCategory[cat].length + ')';
        var list = document.createElement('ul');
        list.className = 'audit-category-list';
        byCategory[cat].forEach(function (f) { list.appendChild(buildFindingItem(f)); });
        group.appendChild(h3);
        group.appendChild(list);
        findingsEl.appendChild(group);
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

    var formData = Object.fromEntries(new FormData(form));
    // Turnstile auto-injects this hidden input once its check completes
    // (the widget lives inside this <form>, see free-seo-audit.html).
    var turnstileToken = formData['cf-turnstile-response'];
    if (!turnstileToken) {
      setStatus('err', 'Verifying you’re human — give it a second and try again.');
      return;
    }

    var btn = form.querySelector('button[type="submit"]');
    var label = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Auditing…'; }
    setStatus('', 'Capturing your details and running the audit — this takes a few seconds…');
    resultsEl.hidden = true;

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
        body: JSON.stringify({ url: url, turnstileToken: turnstileToken })
      });
      var data = await res.json();
      if (!data.ok) {
        setStatus('err', data.error || 'Something went wrong running that audit.');
        if (window.turnstile) { try { window.turnstile.reset(); } catch (e) { /* widget not ready */ } }
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
