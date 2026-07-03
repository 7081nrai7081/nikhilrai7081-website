#!/usr/bin/env python3
"""
Weekly auto-publisher for the blog.

Reads _queue/queue.json, takes the first entry, wraps its _drafts/<body> in the
full post template (injecting today's date), writes <slug>.html at the repo root,
and wires the post into the blog listing card grid, the blog ItemList schema, and
the RSS feed. The sitemap is regenerated separately by .githooks/gen-sitemap.sh
(the GitHub workflow runs it after this script). Finally it removes the published
entry from the queue and deletes the consumed draft.

Placeholders in the template use @@NAME@@ (not str.format) so the literal { } in
the inline analytics JS and JSON-LD are left untouched.

Env:
  PUBLISH_DRY=1   Do not mutate tracked files / queue / drafts. Write the rendered
                  post to _preview.html and print the snippets that WOULD be inserted.

Exit codes: 0 = published (or nothing to do / dry run), 1 = error.
"""
import os, re, sys, json, io, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DRY = bool(os.environ.get("PUBLISH_DRY"))
DOMAIN = "https://nikhilrai7081.com"

def p(*a): print("[publish]", *a)
def rd(path): return io.open(os.path.join(ROOT, path), encoding="utf-8").read()
def wr(path, s): io.open(os.path.join(ROOT, path), "w", encoding="utf-8", newline="\n").write(s)

# Inputs used raw inside HTML text, HTML attributes, JSON-LD and XML must not carry
# characters that would break any of those contexts. Keep the queue clean.
BAD = ['"', "<", ">", "&", "\\"]
def check(entry):
    for k in ("slug","title","description","og_title","og_desc","og_alt","tag","cat","read","summary","body"):
        if k not in entry or not str(entry[k]).strip():
            raise SystemExit(f"queue entry missing/empty field: {k}")
    for k in ("title","description","og_title","og_desc","og_alt","tag","summary"):
        for ch in BAD:
            if ch in entry[k]:
                raise SystemExit(f"field {k} contains unsupported char {ch!r} "
                                 f"(avoid \" < > & \\ ; write &amp; as the word 'and'). Value: {entry[k]}")
    if entry["cat"] not in ("partnerships","growth","leadgen","operations","automation"):
        raise SystemExit(f"cat must be one of partnerships|growth|leadgen|operations|automation, got {entry['cat']!r}")
    if not re.fullmatch(r"blog-[a-z0-9-]+", entry["slug"]):
        raise SystemExit(f"slug must match blog-[a-z0-9-]+, got {entry['slug']!r}")

ARROW = ('<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" '
 'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">'
 '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>')

TEMPLATE = r"""<!DOCTYPE html>
<html lang="en">

<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">


<!-- Warm up the analytics connection early -->
<link rel="preconnect" href="https://www.googletagmanager.com" crossorigin>
<link rel="dns-prefetch" href="https://www.googletagmanager.com">

<!-- Consent Mode defaults (must run before GTM) -->
<script>
window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',wait_for_update:500});
try{if(localStorage.getItem('cookie_consent')==='granted'){gtag('consent','update',{analytics_storage:'granted'});}}catch(e){}
</script>

<!-- Defer GTM + AdSense until first interaction / after load (perf) -->
<script>
(function(){var ld=false;function go(){if(ld)return;ld=true;(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','GTM-MB5JGJQL');var a=document.createElement('script');a.async=true;a.crossOrigin='anonymous';a.src='https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8667955384195110';document.head.appendChild(a);}var ev=['scroll','keydown','pointerdown','touchstart','mousemove'];ev.forEach(function(e){window.addEventListener(e,go,{passive:true,once:true});});if(document.readyState==='complete'){setTimeout(go,2500);}else{window.addEventListener('load',function(){setTimeout(go,2500);});}})();
</script>
<!-- End deferred third-party -->

<title>@@TITLE@@ — Nikhil Rai</title>
<meta name="description" content="@@DESC@@">
<meta name="author" content="Nikhil Rai">
<meta name="theme-color" content="#ffffff">

<meta property="og:title" content="@@OGTITLE@@">
<meta property="og:description" content="@@OGDESC@@">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Nikhil Rai">
<meta property="article:published_time" content="@@ISO@@">
<meta property="article:modified_time" content="@@ISO@@">
<meta property="article:author" content="Nikhil Rai">
<meta property="article:section" content="@@TAG@@">
<meta property="article:tag" content="@@TAG@@">
<meta property="og:url" content="@@DOMAIN@@/@@SLUG@@">
<meta property="og:image" content="@@DOMAIN@@/assets/images/og-@@SLUG@@.png">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="@@OGALT@@">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="@@DOMAIN@@/assets/images/og-@@SLUG@@.png">

<link rel="canonical" href="@@DOMAIN@@/@@SLUG@@">

<!-- Language alternates (hreflang) -->
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
  "@type":"BlogPosting",
  "headline":"@@TITLE@@",
  "description":"@@DESC@@",
  "datePublished":"@@ISO@@",
  "author":{"@type":"Person","name":"Nikhil Rai","url":"https://nikhilrai7081.com"},
  "mainEntityOfPage":"@@DOMAIN@@/@@SLUG@@",
  "image":"@@DOMAIN@@/assets/images/og-@@SLUG@@.png"
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
      Back to blog
    </a>
    <span class="cs-tag">@@TAG@@</span>
    <h1>@@TITLE@@</h1>
    <div class="cs-meta">
      <div class="m"><small>Published</small><b>@@DISP@@</b></div>
      <div class="m"><small>Read</small><b>@@READ@@</b></div>
    </div>
  </div>
</section>

<section class="cs-body">
  <div class="container">

@@BODY@@

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

def subst(tpl, **kw):
    for k, v in kw.items():
        tpl = tpl.replace("@@" + k + "@@", v)
    return tpl

def main():
    qpath = "_queue/queue.json"
    q = json.loads(rd(qpath))
    items = q.get("queue", [])
    if not items:
        p("queue empty — nothing to publish.")
        return 0
    e = items[0]
    check(e)
    slug = e["slug"]

    today = datetime.date.today()
    iso = today.strftime("%Y-%m-%d")
    disp = "%s %d, %d" % (today.strftime("%B"), today.day, today.year)
    rfc = today.strftime("%a, %d %b %Y") + " 14:00:00 +0000"

    ver_m = re.search(r"style\.css\?v=(\d+)", rd("index.html"))
    ver = ver_m.group(1) if ver_m else "1"

    body = rd("_drafts/" + e["body"])

    page = subst(TEMPLATE,
        TITLE=e["title"], DESC=e["description"], OGTITLE=e["og_title"], OGDESC=e["og_desc"],
        OGALT=e["og_alt"], TAG=e["tag"], SLUG=slug, ISO=iso, DISP=disp, READ=e["read"],
        VER=ver, DOMAIN=DOMAIN, BODY=body.rstrip("\n"))

    # --- listing card (blog.html) ---
    card = (
        f'      <a class="card reveal" data-cat="{e["cat"]}" href="/{slug}">\n'
        f'        <span class="tag">{e["tag"]}</span>\n'
        f'        <h3>{e["title"]}</h3>\n'
        f'        <p>{e["summary"]}</p>\n'
        f'        <span class="card-meta"><time datetime="{iso}">{disp}</time>'
        f'<span aria-hidden="true"> · </span>{e["read"]} read</span>\n'
        f'        <span class="card-more">Read article\n          {ARROW}\n        </span>\n'
        f'      </a>\n'
    )
    item_ld = (f'    {{"@type":"BlogPosting","headline":"{e["title"]}",'
               f'"url":"{DOMAIN}/{slug}","datePublished":"{iso}"}},\n')
    feed_item = (
        f'    <item>\n'
        f'      <title>{e["title"]}</title>\n'
        f'      <link>{DOMAIN}/{slug}</link>\n'
        f'      <guid isPermaLink="true">{DOMAIN}/{slug}</guid>\n'
        f'      <description>{e["description"]}</description>\n'
        f'      <category>{e["tag"]}</category>\n'
        f'      <pubDate>{rfc}</pubDate>\n'
        f'    </item>\n\n'
    )

    blog = rd("blog.html")
    anchor_cards = '<div class="cards" id="blog-cards">\n'
    anchor_ld = '"blogPost":[\n'
    if anchor_cards not in blog or anchor_ld not in blog:
        raise SystemExit("blog.html anchors not found (cards grid / blogPost list).")
    blog2 = blog.replace(anchor_cards, anchor_cards + card, 1)
    blog2 = blog2.replace(anchor_ld, anchor_ld + item_ld, 1)

    feed = rd("feed.xml")
    feed2 = re.sub(r"<lastBuildDate>.*?</lastBuildDate>",
                   f"<lastBuildDate>{rfc}</lastBuildDate>", feed, count=1)
    m = re.search(r"^[ \t]*<item>\n", feed2, flags=re.M)
    if not m:
        raise SystemExit("feed.xml has no <item> to insert before.")
    feed2 = feed2[:m.start()] + feed_item + feed2[m.start():]

    if DRY:
        wr("_preview.html", page)
        p("DRY RUN — no tracked files changed.")
        p(f"would publish: {slug}  ({iso}, {e['read']})")
        p("preview written to _preview.html")
        p("--- listing card ---"); print(card)
        p("--- ItemList entry ---"); print(item_ld.strip())
        p("--- feed item (head) ---"); print(feed_item.split(chr(10))[1].strip())
        return 0

    # --- commit the changes to disk ---
    wr(slug + ".html", page)
    wr("blog.html", blog2)
    wr("feed.xml", feed2)
    os.remove(os.path.join(ROOT, "_drafts", e["body"]))
    q["queue"] = items[1:]
    wr(qpath, json.dumps(q, ensure_ascii=False, indent=2) + "\n")
    p(f"published {slug} ({iso}). {len(q['queue'])} post(s) left in queue.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
