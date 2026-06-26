/* =====================================================
   NIKHIL RAI — PORTFOLIO
   Interactions: theme, menu, scroll progress,
   reveal-on-scroll, active nav, header state
   ===================================================== */

(function () {
  'use strict';

  const doc = document;
  const body = doc.body;

  /* ---------- Analytics helper (pushes to GTM dataLayer) ---------- */
  function track(event, params) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(Object.assign({ event: event }, params || {}));
  }

  /* ---------- Theme toggle ---------- */
  const themeToggle = doc.getElementById('theme-toggle');
  const iconMoon = doc.querySelector('.icon-moon');
  const iconSun = doc.querySelector('.icon-sun');

  function applyTheme(theme) {
    const dark = theme === 'dark';
    body.classList.toggle('dark', dark);
    // Light is default: show the moon (click → go dark); dark shows the sun.
    if (iconMoon && iconSun) {
      iconMoon.style.display = dark ? 'none' : 'block';
      iconSun.style.display = dark ? 'block' : 'none';
    }
    if (themeToggle) {
      themeToggle.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    }
  }

  // Initial theme: saved preference, else always the light agency look.
  // (Don't auto-follow the OS — the brand design is light by default.)
  let stored = null;
  try { stored = localStorage.getItem('theme'); } catch (e) {}
  if (stored !== 'dark' && stored !== 'light') stored = 'light';
  applyTheme(stored);

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const next = body.classList.contains('dark') ? 'light' : 'dark';
      applyTheme(next);
      try { localStorage.setItem('theme', next); } catch (e) {}
    });
  }

  /* ---------- Mobile menu ---------- */
  const menuToggle = doc.getElementById('menu-toggle');
  const nav = doc.getElementById('nav');

  function closeMenu() {
    if (!nav || !menuToggle) return;
    nav.classList.remove('open');
    menuToggle.classList.remove('open');
    menuToggle.setAttribute('aria-expanded', 'false');
  }

  if (menuToggle && nav) {
    menuToggle.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      menuToggle.classList.toggle('open', open);
      menuToggle.setAttribute('aria-expanded', String(open));
    });
    nav.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', closeMenu);
    });
    doc.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeMenu();
    });
  }

  /* ---------- Landmark labels + current-page state (a11y) ---------- */
  // Distinguish the multiple <nav> landmarks so screen-reader landmark
  // navigation isn't a list of identical "navigation" entries.
  if (nav && !nav.hasAttribute('aria-label')) nav.setAttribute('aria-label', 'Primary');
  const footerNav = doc.querySelector('.footer-nav');
  if (footerNav && !footerNav.hasAttribute('aria-label')) footerNav.setAttribute('aria-label', 'Footer');
  // Expose the static active link (subpages) as the current page, not colour-only.
  doc.querySelectorAll('.nav a.active').forEach((a) => a.setAttribute('aria-current', 'page'));

  /* ---------- Header shadow + scroll progress ---------- */
  const header = doc.getElementById('header');
  const progress = doc.getElementById('progress');
  let ticking = false;

  function onScroll() {
    const scrollTop = window.scrollY || doc.documentElement.scrollTop;

    if (header) header.classList.toggle('scrolled', scrollTop > 8);

    if (progress) {
      const docEl = doc.documentElement;
      const height = docEl.scrollHeight - docEl.clientHeight;
      const pct = height > 0 ? (scrollTop / height) * 100 : 0;
      progress.style.width = pct + '%';
    }
    ticking = false;
  }

  window.addEventListener('scroll', () => {
    if (!ticking) {
      window.requestAnimationFrame(onScroll);
      ticking = true;
    }
  }, { passive: true });
  onScroll();

  /* ---------- Reveal on scroll ---------- */
  const revealEls = doc.querySelectorAll('.reveal');

  if ('IntersectionObserver' in window) {
    // Precompute each element's position among its .reveal siblings so grouped
    // items (e.g. a row of cards) stagger in document order, not in the order
    // the observer happens to batch them.
    revealEls.forEach((el) => {
      const peers = Array.from(el.parentNode.children).filter((c) => c.classList.contains('reveal'));
      el.dataset.stagger = peers.indexOf(el);
    });

    const io = new IntersectionObserver((entries, obs) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          // Slight stagger for grouped elements.
          const idx = Number(entry.target.dataset.stagger) || 0;
          const delay = Math.min(idx * 60, 240);
          entry.target.style.transitionDelay = delay + 'ms';
          entry.target.classList.add('show');
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add('show'));
  }

  /* ---------- Active nav link (scroll spy) ---------- */
  const sections = Array.from(doc.querySelectorAll('section[id]'));
  const navLinks = Array.from(doc.querySelectorAll('.nav a[href^="#"]'));

  if (sections.length && navLinks.length && 'IntersectionObserver' in window) {
    const spy = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const id = entry.target.getAttribute('id');
          navLinks.forEach((link) => {
            const isCurrent = link.getAttribute('href') === '#' + id;
            link.classList.toggle('active', isCurrent);
            // Convey the active section to assistive tech, not just visually.
            if (isCurrent) link.setAttribute('aria-current', 'true');
            else link.removeAttribute('aria-current');
          });
        }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });

    sections.forEach((s) => spy.observe(s));
  }

  /* ---------- Contact form (Web3Forms) ---------- */
  const form = doc.getElementById('contact-form');
  if (form) {
    const status = doc.getElementById('form-status');
    const keyField = form.querySelector('input[name="access_key"]');

    function setStatus(kind, msg) {
      if (!status) return;
      status.className = 'form-status' + (kind ? ' ' + kind : '');
      status.textContent = msg;
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const key = keyField ? keyField.value.trim() : '';
      if (!key || key === 'YOUR_ACCESS_KEY_HERE') {
        setStatus('err', 'Form isn’t configured yet — add your free Web3Forms access key in the HTML.');
        return;
      }

      const btn = form.querySelector('button[type="submit"]');
      const label = btn ? btn.innerHTML : '';
      if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
      setStatus('', 'Sending your message…');

      try {
        const res = await fetch('https://api.web3forms.com/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(Object.fromEntries(new FormData(form)))
        });
        const data = await res.json();
        if (data.success) {
          form.reset();
          track('contact_form_submit', { form_location: 'contact_section' });
          setStatus('ok', 'Thanks — your message has been sent. I’ll be in touch soon.');
        } else {
          setStatus('err', data.message || 'Something went wrong. Please email me directly instead.');
        }
      } catch (err) {
        setStatus('err', 'Network error. Please try again or email me directly.');
      } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = label; }
      }
    });
  }

  /* ---------- Newsletter signup (Web3Forms) ---------- */
  doc.querySelectorAll('.newsletter-form').forEach(function (nf) {
    const status = nf.querySelector('.form-status');
    const keyField = nf.querySelector('input[name="access_key"]');
    function set(kind, msg) {
      if (!status) return;
      status.className = 'form-status' + (kind ? ' ' + kind : '');
      status.textContent = msg;
    }
    nf.addEventListener('submit', async function (e) {
      e.preventDefault();
      const key = keyField ? keyField.value.trim() : '';
      if (!key || key === 'YOUR_ACCESS_KEY_HERE') { set('err', 'Newsletter isn’t configured yet.'); return; }
      const btn = nf.querySelector('button[type="submit"]');
      const lbl = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = 'Subscribing…'; }
      set('', 'Subscribing…');
      try {
        const res = await fetch('https://api.web3forms.com/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(Object.fromEntries(new FormData(nf)))
        });
        const data = await res.json();
        if (data.success) { nf.reset(); set('ok', 'You’re on the list — thank you!'); track('newsletter_signup', {}); }
        else set('err', data.message || 'Something went wrong. Please try again.');
      } catch (err) {
        set('err', 'Network error. Please try again.');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = lbl; }
      }
    });
  });

  /* ---------- Cookie consent (Google Consent Mode v2) ---------- */
  (function () {
    let choice = null;
    try { choice = localStorage.getItem('cookie_consent'); } catch (e) {}
    if (choice === 'granted' || choice === 'denied') return; // already decided

    // Localized copy keyed off <html lang>. Falls back to English.
    const COOKIE_I18N = {
      en: { body: 'This site uses cookies for analytics to understand how it’s used. See the ', link: 'Privacy Policy', decline: 'Decline', accept: 'Accept', label: 'Cookie consent' },
      es: { body: 'Este sitio usa cookies de analítica para entender cómo se utiliza. Consulta la ', link: 'Política de Privacidad', decline: 'Rechazar', accept: 'Aceptar', label: 'Consentimiento de cookies' },
      hi: { body: 'यह साइट यह समझने के लिए एनालिटिक्स कुकीज़ का उपयोग करती है कि इसका उपयोग कैसे होता है। देखें ', link: 'गोपनीयता नीति', decline: 'अस्वीकार करें', accept: 'स्वीकार करें', label: 'कुकी सहमति' }
    };
    const lang = (doc.documentElement.getAttribute('lang') || 'en').slice(0, 2).toLowerCase();
    const t = COOKIE_I18N[lang] || COOKIE_I18N.en;

    const banner = doc.createElement('div');
    banner.className = 'cookie-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', t.label);
    banner.setAttribute('tabindex', '-1');
    banner.innerHTML =
      '<p>' + t.body +
      '<a href="/privacy">' + t.link + '</a>.</p>' +
      '<div class="cookie-actions">' +
      '<button type="button" class="btn btn-ghost" data-consent="denied">' + t.decline + '</button>' +
      '<button type="button" class="btn btn-primary" data-consent="granted">' + t.accept + '</button>' +
      '</div>';

    function choose(value) {
      try { localStorage.setItem('cookie_consent', value); } catch (e) {}
      if (value === 'granted' && typeof window.gtag === 'function') {
        window.gtag('consent', 'update', { analytics_storage: 'granted' });
      }
      track('cookie_consent', { consent: value });
      banner.classList.remove('show');
      setTimeout(function () { if (banner.parentNode) banner.parentNode.removeChild(banner); }, 300);
    }

    banner.addEventListener('click', function (e) {
      const b = e.target.closest('button[data-consent]');
      if (b) choose(b.getAttribute('data-consent'));
    });

    body.appendChild(banner);
    requestAnimationFrame(function () {
      banner.classList.add('show');
      // Direct focus to the newly added consent dialog (it's a fixed banner,
      // so this announces it to AT without scrolling the page).
      try { banner.focus({ preventScroll: true }); } catch (e) { banner.focus(); }
    });
  })();

  /* ---------- Click tracking (contact methods + CTAs) ---------- */
  doc.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    const href = a.getAttribute('href') || '';

    let method = null;
    if (href.indexOf('mailto:') === 0) method = 'email';
    else if (href.indexOf('wa.me') > -1 || href.indexOf('whatsapp') > -1) method = 'whatsapp';
    else if (href.indexOf('linkedin.com') > -1) method = 'linkedin';
    else if (href.indexOf('instagram.com') > -1) method = 'instagram';

    if (method) {
      track('contact_click', { contact_method: method, link_url: href });
    } else if (a.classList.contains('btn')) {
      track('cta_click', { cta_label: (a.textContent || '').trim(), link_url: href });
    }
  });

  /* ---------- VYNTRA community floating banner (site-wide) ---------- */
  (function () {
    // Persisted dismissal — stays hidden for this visitor across pages/visits.
    let dismissed = null;
    try { dismissed = localStorage.getItem('vyntra_cta_dismissed'); } catch (e) {}
    if (dismissed === '1') return;

    const WA_URL = 'https://chat.whatsapp.com/HnHOqXxM3YxKIjBvOphTsT';

    const cta = doc.createElement('aside');
    cta.className = 'vyntra-cta';
    cta.setAttribute('role', 'complementary');
    cta.setAttribute('aria-label', 'Join the VYNTRA community on WhatsApp');
    cta.innerHTML =
      '<a class="vyntra-cta__link" href="' + WA_URL + '" target="_blank" rel="noopener noreferrer">' +
        '<img class="vyntra-cta__img" src="/assets/images/vyntra_jamming_night_lucknow.png" ' +
          'alt="VYNTRA Jamming Night, Lucknow — a Saturday of live music, voices and conversations. Tap to join the community." ' +
          'width="1448" height="1086" loading="lazy" decoding="async">' +
        '<span class="vyntra-cta__label">Tap to join the community &rarr;</span>' +
      '</a>' +
      '<button type="button" class="vyntra-cta__close" aria-label="Dismiss banner">&times;</button>';

    function dismiss() {
      try { localStorage.setItem('vyntra_cta_dismissed', '1'); } catch (e) {}
      cta.classList.remove('show');
      doc.removeEventListener('keydown', onKey);
      setTimeout(function () { if (cta.parentNode) cta.parentNode.removeChild(cta); }, 350);
    }

    function onKey(e) {
      if (e.key === 'Escape') dismiss();
    }

    // × dismisses without ever triggering the surrounding WhatsApp link.
    cta.querySelector('.vyntra-cta__close').addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      dismiss();
    });
    doc.addEventListener('keydown', onKey);

    // The WhatsApp click is tracked by the global contact-click handler above
    // (href contains "whatsapp"), so no extra tracking is wired here.
    body.appendChild(cta);

    // Reveal ~1.2s after load with a fade + slide-up. The site-wide
    // prefers-reduced-motion rule neutralises the transition automatically.
    setTimeout(function () {
      requestAnimationFrame(function () { cta.classList.add('show'); });
    }, 1200);
  })();

  console.log('%cNikhil Rai — Portfolio', 'font-size:13px;color:#e23a5e;font-weight:700;');
})();
