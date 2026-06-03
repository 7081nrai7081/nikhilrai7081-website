/* =====================================================
   NIKHIL RAI — PORTFOLIO
   Interactions: theme, menu, scroll progress,
   reveal-on-scroll, active nav, header state
   ===================================================== */

(function () {
  'use strict';

  const doc = document;
  const body = doc.body;

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

  console.log('%cNikhil Rai — Portfolio', 'font-size:13px;color:#6d5dfc;font-weight:700;');
})();
