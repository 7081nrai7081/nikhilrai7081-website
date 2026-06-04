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
    const light = theme === 'light';
    body.classList.toggle('light', light);
    if (iconMoon && iconSun) {
      iconMoon.style.display = light ? 'none' : 'block';
      iconSun.style.display = light ? 'block' : 'none';
    }
    if (themeToggle) {
      themeToggle.setAttribute('aria-label', light ? 'Switch to dark theme' : 'Switch to light theme');
    }
  }

  // Initial theme: saved preference, else system, else dark.
  let stored = null;
  try { stored = localStorage.getItem('theme'); } catch (e) {}
  if (!stored) {
    stored = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light' : 'dark';
  }
  applyTheme(stored);

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const next = body.classList.contains('light') ? 'dark' : 'light';
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
    const io = new IntersectionObserver((entries, obs) => {
      entries.forEach((entry, i) => {
        if (entry.isIntersecting) {
          // Slight stagger for grouped elements.
          const delay = Math.min(i * 60, 240);
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
            link.classList.toggle('active', link.getAttribute('href') === '#' + id);
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

    const banner = doc.createElement('div');
    banner.className = 'cookie-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Cookie consent');
    banner.innerHTML =
      '<p>This site uses cookies for analytics to understand how it’s used. ' +
      'See the <a href="/privacy">Privacy Policy</a>.</p>' +
      '<div class="cookie-actions">' +
      '<button type="button" class="btn btn-ghost" data-consent="denied">Decline</button>' +
      '<button type="button" class="btn btn-primary" data-consent="granted">Accept</button>' +
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
    requestAnimationFrame(function () { banner.classList.add('show'); });
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

  console.log('%cNikhil Rai — Portfolio', 'font-size:13px;color:#6366f1;font-weight:700;');
})();
