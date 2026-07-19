#!/usr/bin/env python3
"""
Generate topic (category) pages from the blog listing.

Single source of truth = the card grid in blog.html (#blog-cards). This reads
every card, groups by its data-cat, and writes one SEO-complete page per topic:
  topic-<slug>.html  ->  /topic-<slug>

Run after any change to the blog listing (the weekly publisher calls it). The
sitemap picks the pages up automatically (they're tracked *.html).
"""
import io, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOMAIN = "https://nikhilrai7081.com"

# cat key -> (url slug, display name, meta description)
CATS = {
    "partnerships": ("topic-partnerships", "Partnerships",
        "Articles on strategic partnerships, business development and building alliances that actually drive growth — by Nikhil Rai."),
    "growth": ("topic-growth", "Growth",
        "Articles on growth strategy, positioning, retention, distribution and go-to-market — practical growth systems by Nikhil Rai."),
    "leadgen": ("topic-lead-generation", "Lead Generation",
        "Articles on B2B lead generation strategy, cold outreach, demand generation and building predictable pipeline — by Nikhil Rai."),
    "operations": ("topic-operations", "Operations",
        "Articles on business and growth operations — the systems, process and reporting behind teams that execute predictably. By Nikhil Rai."),
    "automation": ("topic-automation", "Automation",
        "Articles on business automation — what to automate first, how much to spend, and building systems that buy back time. By Nikhil Rai."),
}

def rd(p): return io.open(os.path.join(ROOT, p), encoding="utf-8").read()
def wr(p, s): io.open(os.path.join(ROOT, p), "w", encoding="utf-8", newline="\n").write(s)

def parse_cards(blog):
    m = re.search(r'<div class="cards" id="blog-cards">(.*?)</div>\s*\n\s*<p class="blog-empty"', blog, re.S)
    if not m:
        raise SystemExit("could not find #blog-cards grid in blog.html")
    grid = m.group(1)
    cards = re.findall(r'(<a class="card reveal" data-cat="[^"]*"[\s\S]*?</a>)', grid)
    out = []
    for c in cards:
        cat = re.search(r'data-cat="([^"]+)"', c).group(1)
        out.append((cat, c.strip()))
    return out

def ver(index):
    m = re.search(r"style\.css\?v=(\d+)", index)
    return m.group(1) if m else "1"

HEAD = """<!DOCTYPE html>
<html lang="en">

<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="google-adsense-account" content="ca-pub-8667955384195110">
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8667955384195110" crossorigin="anonymous"></script>


<!-- Warm up the analytics connection early -->
<link rel="preconnect" href="https://www.googletagmanager.com" crossorigin>
<link rel="dns-prefetch" href="https://www.googletagmanager.com">

<!-- Consent Mode defaults (must run before GTM) -->
<script>
window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',wait_for_update:500});
try{if(localStorage.getItem('cookie_consent')==='granted'){gtag('consent','update',{analytics_storage:'granted'});}}catch(e){}
</script>

<!-- Defer GTM until first interaction / after load (perf) -->
<script>
(function(){var ld=false;function go(){if(ld)return;ld=true;(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','GTM-MB5JGJQL');}var ev=['scroll','keydown','pointerdown','touchstart','mousemove'];ev.forEach(function(e){window.addEventListener(e,go,{passive:true,once:true});});if(document.readyState==='complete'){setTimeout(go,2500);}else{window.addEventListener('load',function(){setTimeout(go,2500);});}})();
</script>
<!-- End deferred third-party -->

<title>@@NAME@@ Articles — Nikhil Rai</title>
<meta name="description" content="@@DESC@@">
<meta name="theme-color" content="#ffffff">

<meta property="og:title" content="@@NAME@@ Articles — Nikhil Rai">
<meta property="og:description" content="@@DESC@@">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Nikhil Rai">
<meta property="og:url" content="@@DOMAIN@@/@@SLUG@@">
<meta property="og:image" content="@@DOMAIN@@/assets/images/og-image.png">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="@@DOMAIN@@/assets/images/og-image.png">

<link rel="canonical" href="@@DOMAIN@@/@@SLUG@@">
<link rel="alternate" type="application/rss+xml" title="Nikhil Rai — Blog" href="@@DOMAIN@@/feed.xml">
<link rel="alternate" hreflang="en" href="@@DOMAIN@@/@@SLUG@@">
<link rel="alternate" hreflang="x-default" href="@@DOMAIN@@/@@SLUG@@">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="shortcut icon" href="/favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/assets/icons/favicon-32.png">
<link rel="apple-touch-icon" href="/assets/icons/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="preload" href="/assets/fonts/inter-variable.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/css/style.css?v=@@VER@@">
<noscript><style>.reveal{opacity:1;transform:none}</style></noscript>

<script type="application/ld+json">
{
  "@context":"https://schema.org",
  "@type":"CollectionPage",
  "name":"@@NAME@@ Articles",
  "url":"@@DOMAIN@@/@@SLUG@@",
  "description":"@@DESC@@",
  "isPartOf":{"@type":"Blog","name":"Nikhil Rai — Blog","url":"@@DOMAIN@@/blog"},
  "author":{"@type":"Person","name":"Nikhil Rai","url":"@@DOMAIN@@"}
}
</script>

<script type="application/ld+json">
{
  "@context":"https://schema.org",
  "@type":"BreadcrumbList",
  "itemListElement":[
    {"@type":"ListItem","position":1,"name":"Home","item":"@@DOMAIN@@/"},
    {"@type":"ListItem","position":2,"name":"Blog","item":"@@DOMAIN@@/blog"},
    {"@type":"ListItem","position":3,"name":"@@NAME@@","item":"@@DOMAIN@@/@@SLUG@@"}
  ]
}
</script>
</head>

<body>

<a class="skip-link" href="#main">Skip to content</a>

<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-MB5JGJQL"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<!-- End Google Tag Manager (noscript) -->

<div class="backdrop" aria-hidden="true"></div>
<div class="progress-bar" id="progress"></div>

<header class="header" id="header">
  <div class="container">
    <a href="/" class="logo">Nikhil<span>Rai</span></a>
    <nav class="nav" id="nav">
      <a href="/#about">About</a>
      <a href="/#expertise">Expertise</a>
      <a href="/services">Services</a>
      <a href="/#journey">Journey</a>
      <a href="/#projects">Projects</a>
      <a href="/blog" class="active">Blog</a>
      <a href="/#contact">Contact</a>
      <button class="theme-btn" id="theme-toggle" aria-label="Toggle color theme">
        <svg class="icon-moon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
        <svg class="icon-sun" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
      </button>
    </nav>
    <button class="menu-toggle" id="menu-toggle" aria-label="Open menu" aria-expanded="false" aria-controls="nav">
      <span></span><span></span><span></span>
    </button>
  </div>
</header>

<main id="main">
<section class="cs-hero">
  <div class="container">
    <a href="/blog" class="cs-back">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
      All articles
    </a>
    <span class="cs-tag">Topic</span>
    <h1>@@NAME@@</h1>
    <p class="cs-lead">@@DESC@@</p>
  </div>
</section>

<section class="cs-body">
  <div class="container">

    <nav class="topic-nav" aria-label="Browse topics">
@@TOPICNAV@@    </nav>

    <div class="cards">
@@CARDS@@    </div>

  </div>
</section>
</main>

<footer class="footer">
  <div class="container">
    <div class="footer-grid">
      <a href="/" class="logo">Nikhil<span>Rai</span></a>
      <nav class="footer-nav">
        <a href="/#about">About</a>
        <a href="/#projects">Projects</a>
        <a href="/#contact">Contact</a>
        <a href="/blog">Blog</a>
        <a href="/privacy">Privacy</a>
      </nav>
    </div>
    <div class="footer-bottom">
      <span>© 2026 Nikhil Rai</span>
      <span>Growth · Partnerships · Execution</span>
    </div>
  </div>
</footer>

<script src="/assets/js/main.js?v=@@VER@@"></script>

</body>
</html>
"""

def subst(t, **kw):
    for k, v in kw.items():
        t = t.replace("@@" + k + "@@", v)
    return t

def main():
    blog = rd("blog.html")
    v = ver(rd("index.html"))
    cards = parse_cards(blog)
    by_cat = {}
    for cat, html in cards:
        by_cat.setdefault(cat, []).append(html)

    for cat, (slug, name, desc) in CATS.items():
        items = by_cat.get(cat, [])
        # topic nav: current topic is active
        nav_links = ['      <a href="/blog">All</a>\n']
        for c2, (s2, n2, _d) in CATS.items():
            cls = ' class="is-active"' if c2 == cat else ''
            nav_links.append(f'      <a href="/{s2}"{cls}>{n2}</a>\n')
        cards_html = "".join("      " + c.replace("\n", "\n") + "\n" for c in items) if items else \
            '      <p class="blog-empty">No posts in this topic yet.</p>\n'
        page = subst(HEAD, NAME=name, DESC=desc, SLUG=slug, VER=v, DOMAIN=DOMAIN,
                     TOPICNAV="".join(nav_links), CARDS=cards_html)
        wr(slug + ".html", page)
        print(f"wrote {slug}.html  ({len(items)} posts)")
    return 0

if __name__ == "__main__":
    sys.exit(main())
