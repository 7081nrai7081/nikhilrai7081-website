// ========================
// NIKHIL RAI PORTFOLIO V3
// ========================

// Theme Toggle

const themeToggle = document.getElementById('theme-toggle');

if (themeToggle) {

    themeToggle.addEventListener('click', () => {

        document.body.classList.toggle('light-mode');

        if (document.body.classList.contains('light-mode')) {
            themeToggle.innerHTML = '☀️';
            localStorage.setItem('theme', 'light');
        } else {
            themeToggle.innerHTML = '🌙';
            localStorage.setItem('theme', 'dark');
        }

    });

}

// Load Saved Theme

window.addEventListener('DOMContentLoaded', () => {

    const savedTheme = localStorage.getItem('theme');

    if (savedTheme === 'light') {
        document.body.classList.add('light-mode');

        if (themeToggle) {
            themeToggle.innerHTML = '☀️';
        }
    }

});

// ========================
// MOBILE MENU
// ========================

const menuToggle = document.getElementById('menu-toggle');
const nav = document.getElementById('nav');

if (menuToggle && nav) {

    menuToggle.addEventListener('click', () => {
        nav.classList.toggle('active');
    });

}

// Close Menu After Click

document.querySelectorAll('.nav a').forEach(link => {

    link.addEventListener('click', () => {

        if (window.innerWidth < 900) {
            nav.classList.remove('active');
        }

    });

});

// ========================
// SCROLL PROGRESS BAR
// ========================

window.addEventListener('scroll', () => {

    const scrollTop =
        document.documentElement.scrollTop;

    const scrollHeight =
        document.documentElement.scrollHeight -
        document.documentElement.clientHeight;

    const progress =
        (scrollTop / scrollHeight) * 100;

    const progressBar =
        document.querySelector('.progress-bar');

    if (progressBar) {
        progressBar.style.width = progress + '%';
    }

});

// ========================
// FADE IN ANIMATION
// ========================

const observer = new IntersectionObserver(

(entries) => {

    entries.forEach(entry => {

        if (entry.isIntersecting) {
            entry.target.classList.add('show');
        }

    });

},

{
    threshold: 0.15
}

);

document.querySelectorAll(
'.section, .card, .timeline-item, .contact-card, .stat'
)

.forEach(el => {

    el.classList.add('fade-up');

    observer.observe(el);

});

// ========================
// HERO PARALLAX EFFECT
// ========================

window.addEventListener('scroll', () => {

    const heroImage =
        document.querySelector('.hero-image');

    if (!heroImage) return;

    const scrolled = window.pageYOffset;

    heroImage.style.transform =
        `translateY(${scrolled * 0.08}px)`;

});

// ========================
// ACTIVE NAVIGATION LINK
// ========================

const sections =
document.querySelectorAll('section[id]');

window.addEventListener('scroll', () => {

    let current = '';

    sections.forEach(section => {

        const sectionTop =
            section.offsetTop - 150;

        if (window.scrollY >= sectionTop) {
            current = section.getAttribute('id');
        }

    });

    document.querySelectorAll('.nav a')
        .forEach(link => {

            link.classList.remove('active-link');

            if (
                link.getAttribute('href') ===
                `#${current}`
            ) {
                link.classList.add('active-link');
            }

        });

});

// ========================
// SMOOTH BUTTON HOVER
// ========================

document.querySelectorAll(
'.btn-primary, .btn-secondary'
)

.forEach(btn => {

    btn.addEventListener('mouseenter', () => {
        btn.style.transform = 'translateY(-3px)';
    });

    btn.addEventListener('mouseleave', () => {
        btn.style.transform = 'translateY(0)';
    });

});

// ========================
// CONSOLE SIGNATURE
// ========================

console.log(
'%cNikhil Rai Portfolio V3 Loaded 🚀',
'font-size:14px;color:#06b6d4;font-weight:bold;'
);
