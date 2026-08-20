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
  var checklistToggleEl = document.getElementById('audit-checklist-toggle');
  var checklistToggleCountEl = document.getElementById('audit-checklist-toggle-count');
  var checklistEl = document.getElementById('audit-checklist');
  var perfEl = document.getElementById('audit-performance');
  var perfBodyEl = document.getElementById('audit-perf-body');
  var keywordReportEl = document.getElementById('audit-keyword-report');

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
    if (typeof extracted.internalLinks === 'number') {
      basicsEl.appendChild(basicRow('Internal / external links', extracted.internalLinks + ' / ' + extracted.externalLinks));
    }
  }

  var STATUS_LABEL = { pass: 'Pass', fail: 'Fail', na: 'N/A' };

  function buildChecklistItem(c) {
    var item = document.createElement('li');
    item.className = 'audit-check status-' + c.status + (c.status === 'fail' ? ' sev-' + c.severity : '');
    var badge = document.createElement('span');
    badge.className = 'audit-check-status';
    badge.textContent = STATUS_LABEL[c.status] || c.status;
    var body = document.createElement('div');
    body.className = 'audit-check-body';
    var label = document.createElement('span');
    label.className = 'audit-check-label';
    label.textContent = c.label;
    body.appendChild(label);
    if (c.status === 'fail' && c.message) {
      var msg = document.createElement('span');
      msg.className = 'audit-check-msg';
      msg.textContent = c.message;
      body.appendChild(msg);
    }
    item.appendChild(badge);
    item.appendChild(body);
    return item;
  }

  function renderChecklist(checklist) {
    if (!checklistEl || !checklistToggleEl) return;
    checklistEl.innerHTML = '';
    if (!checklist || !checklist.length) {
      checklistToggleEl.hidden = true;
      return;
    }
    checklistToggleEl.hidden = false;
    if (checklistToggleCountEl) checklistToggleCountEl.textContent = checklist.length;
    checklistEl.hidden = true;
    checklistToggleEl.setAttribute('aria-expanded', 'false');
    checklistToggleEl.classList.remove('is-open');

    var byCategory = {};
    checklist.forEach(function (c) {
      var cat = c.category || 'Other';
      (byCategory[cat] = byCategory[cat] || []).push(c);
    });
    var categories = Object.keys(byCategory).sort(function (a, b) {
      var ia = CATEGORY_ORDER.indexOf(a), ib = CATEGORY_ORDER.indexOf(b);
      if (ia === -1) ia = CATEGORY_ORDER.length;
      if (ib === -1) ib = CATEGORY_ORDER.length;
      return ia - ib;
    });
    categories.forEach(function (cat) {
      var items = byCategory[cat];
      var passCount = items.filter(function (c) { return c.status === 'pass'; }).length;
      var group = document.createElement('div');
      group.className = 'audit-category';
      var h3 = document.createElement('h3');
      h3.textContent = cat + ' (' + passCount + '/' + items.length + ' passed)';
      var list = document.createElement('ul');
      list.className = 'audit-check-list';
      items.forEach(function (c) { list.appendChild(buildChecklistItem(c)); });
      group.appendChild(h3);
      group.appendChild(list);
      checklistEl.appendChild(group);
    });
  }

  if (checklistToggleEl && checklistEl) {
    checklistToggleEl.addEventListener('click', function () {
      var open = checklistEl.hidden;
      checklistEl.hidden = !open;
      checklistToggleEl.setAttribute('aria-expanded', String(open));
      checklistToggleEl.classList.toggle('is-open', open);
      if (open) {
        track('free_audit_checklist_opened', {});
        checklistEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  }

  function buildKwItem(label, present) {
    return buildChecklistItem({ status: present ? 'pass' : 'fail', severity: 'info', label: label, message: null });
  }

  function renderKeywordReport(report) {
    if (!keywordReportEl) return;
    keywordReportEl.innerHTML = '';
    if (!report) { keywordReportEl.hidden = true; return; }
    keywordReportEl.hidden = false;

    var h3 = document.createElement('h3');
    h3.appendChild(document.createTextNode('Keyword Optimization: '));
    var term = document.createElement('span');
    term.className = 'audit-kw-term';
    term.textContent = '"' + report.keyword + '"';
    h3.appendChild(term);
    keywordReportEl.appendChild(h3);

    var list = document.createElement('ul');
    list.className = 'audit-check-list';
    list.appendChild(buildKwItem('Keyword in title tag', report.inTitle));
    list.appendChild(buildKwItem('Keyword in H1 heading', report.inH1));
    list.appendChild(buildKwItem('Keyword in meta description', report.inMetaDescription));
    list.appendChild(buildKwItem('Keyword in URL', report.inUrl));
    list.appendChild(buildKwItem('Keyword in first ~150 words', report.inFirstParagraph));
    keywordReportEl.appendChild(list);

    var note = '';
    if (report.occurrences === 0) note = ' — not found in the visible body text at all.';
    else if (report.density > 3) note = ' — that’s on the high side; over-repeating a keyword can read as stuffing to search engines.';
    var density = document.createElement('p');
    density.className = 'audit-kw-density';
    density.textContent = report.occurrences + ' occurrence(s) across ' + report.totalWords + ' words (' + report.density + '% density)' + note;
    keywordReportEl.appendChild(density);
  }

  function perfColorFor(score) {
    if (score === null || score === undefined) return 'var(--muted)';
    if (score >= 90) return '#16a34a';
    if (score >= 50) return '#ca8a04';
    return '#dc2626';
  }

  function perfMetricRow(name, labText, fieldEntry) {
    var li = document.createElement('li');
    var l = document.createElement('span');
    l.className = 'audit-perf-metric-label';
    l.textContent = name;
    var v = document.createElement('span');
    v.textContent = labText || '—';
    if (fieldEntry) {
      var badge = document.createElement('span');
      badge.className = 'audit-perf-field-badge';
      badge.textContent = 'Real users';
      v.appendChild(badge);
    }
    li.appendChild(l);
    li.appendChild(v);
    return li;
  }

  function buildPerfCol(label, result) {
    var col = document.createElement('div');
    col.className = 'audit-perf-col';

    var head = document.createElement('div');
    head.className = 'audit-perf-col-head';

    var scoreVal = result && typeof result.score === 'number' ? result.score : null;
    var scoreEl = document.createElement('div');
    scoreEl.className = 'audit-perf-score';
    scoreEl.style.setProperty('--audit-perf-score', String(scoreVal === null ? 0 : scoreVal));
    scoreEl.style.setProperty('--audit-perf-color', perfColorFor(scoreVal));
    var scoreInner = document.createElement('span');
    scoreInner.textContent = scoreVal === null ? '—' : String(scoreVal);
    scoreEl.appendChild(scoreInner);

    var labelEl = document.createElement('div');
    labelEl.className = 'audit-perf-col-label';
    labelEl.textContent = label;

    head.appendChild(scoreEl);
    head.appendChild(labelEl);
    col.appendChild(head);

    if (!result) {
      var unavailable = document.createElement('p');
      unavailable.className = 'audit-perf-error';
      unavailable.textContent = 'Not available for this page right now.';
      col.appendChild(unavailable);
      return col;
    }

    var lab = result.lab || {};
    var field = result.field || {};
    var metrics = document.createElement('ul');
    metrics.className = 'audit-perf-metrics';
    metrics.appendChild(perfMetricRow('LCP', lab.lcp, field.lcp));
    metrics.appendChild(perfMetricRow('CLS', lab.cls, field.cls));
    metrics.appendChild(perfMetricRow('Total Blocking Time', lab.tbt, null));
    metrics.appendChild(perfMetricRow('First Contentful Paint', lab.fcp, null));
    metrics.appendChild(perfMetricRow('Speed Index', lab.speedIndex, null));
    col.appendChild(metrics);
    return col;
  }

  function renderPerformance(perf) {
    if (!perfBodyEl) return;
    perfBodyEl.innerHTML = '';
    var cols = document.createElement('div');
    cols.className = 'audit-perf-cols';
    cols.appendChild(buildPerfCol('Mobile', perf.mobile));
    cols.appendChild(buildPerfCol('Desktop', perf.desktop));
    perfBodyEl.appendChild(cols);
  }

  function hidePerf() {
    if (perfEl) perfEl.hidden = true;
  }

  async function fetchPerformance(url) {
    if (!perfEl || !perfBodyEl) return;
    perfEl.hidden = false;
    perfBodyEl.innerHTML = '<p class="audit-perf-loading">Running a live PageSpeed Insights check (Google’s own Lighthouse test) — this can take up to 30 seconds…</p>';
    try {
      var res = await fetch('/api/pagespeed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url })
      });
      var data = await res.json();
      if (!data.ok) {
        if (data.unconfigured) { hidePerf(); return; }
        perfBodyEl.innerHTML = '<p class="audit-perf-error">' + (data.error || 'Performance check unavailable right now.') + '</p>';
        return;
      }
      renderPerformance(data);
    } catch (err) {
      perfBodyEl.innerHTML = '<p class="audit-perf-error">Performance check unavailable right now.</p>';
    }
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
    renderChecklist(data.checklist);
    renderKeywordReport(data.keywordReport);

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
      var keyword = formData.keyword ? String(formData.keyword).trim() : '';
      var res = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url, turnstileToken: turnstileToken, keyword: keyword || undefined })
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
      // Fire-and-forget: fills in the Performance section once Google's
      // Lighthouse run finishes, without holding up the rest of the report
      // or re-disabling the submit button.
      fetchPerformance(data.url);
    } catch (err) {
      setStatus('err', 'Network error while running the audit. Please try again.');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = label; }
    }
  });
})();
