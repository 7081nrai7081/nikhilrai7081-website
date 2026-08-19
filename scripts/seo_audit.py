#!/usr/bin/env python3
"""
seo_audit.py -- local, dependency-free technical SEO audit for this site.

Crawls the repo's own HTML files on disk (no live network calls, nothing
leaves the machine) and checks:
  - title / meta description: presence, length, duplicates across pages
  - canonical tag: presence and correctness vs. the page's real clean URL
  - single-H1 rule
  - <html lang> attribute
  - viewport meta
  - robots meta (flags accidental noindex/nofollow)
  - Open Graph + Twitter Card completeness
  - JSON-LD: presence + JSON validity
  - hreflang: target file exists + reciprocity between locales
  - image alt-text coverage
  - internal link integrity (best-effort broken-link check)
  - orphan pages (on disk, never linked from anywhere)
  - sitemap.xml cross-check (on disk but missing from sitemap, or vice versa)
  - approximate word count (thin-content flag)

This is static analysis only -- it doesn't know Core Web Vitals, real search
rankings, or backlinks. Pair it with Search Console / PageSpeed for that.

Usage:
    python scripts/seo_audit.py [--out PATH]

Writes a Markdown report (default: _seo-reports/report-<date>.md) and prints
a short summary to stdout.
"""
import os
import re
import sys
import json
import argparse
import datetime
from html.parser import HTMLParser
from urllib.parse import urlparse
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE_URL = "https://nikhilrai7081.com"
SITE_HOSTS = {"nikhilrai7081.com", "www.nikhilrai7081.com"}

EXCLUDE_DIRS = {
    "node_modules", ".git", ".claude", ".githooks", ".github",
    "_drafts", "_queue", "assets", "scripts", "_seo-reports",
    "screenshots",
}
EXCLUDE_FILES = {"blog-template.html", "_preview.html"}
# Pages that intentionally don't (and shouldn't) appear in sitemap.xml.
SITEMAP_EXEMPT = {"404.html"}
# 404 pages are conventionally noindex and don't need a canonical -- don't
# flag those as issues on this specific file.
NOINDEX_EXPECTED = {"404.html"}
CANONICAL_EXEMPT = {"404.html"}
# Pages with a documented, intentional noindex (see git history) -- flagged
# as info instead of critical, and not expected in sitemap.xml either.
# Re-verify these are still meant to be true before trusting them blindly.
KNOWN_INTENTIONAL_NOINDEX = {
    "plotmitra/index.html": "noindex,follow since commit 7af9f21 (2026-07-28) -- Plot Mitra soft-launch, not yet meant to be indexed",
    "plotmitra/privacy.html": "noindex,follow since commit 7af9f21 (2026-07-28) -- same as plotmitra/index.html",
}


# ---------------------------------------------------------------- parsing --

class PageParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title = ""
        self._in_title = False
        self.meta = {}
        self.canonical = None
        self.hreflang = {}
        self.h1s = []
        self._in_h1 = False
        self._h1_buf = []
        self.lang = None
        self.imgs = []  # (src, has_alt)
        self.links = []
        self.ldjson = []
        self._in_ldjson = False
        self._ldjson_buf = []
        self._skip_stack = []
        self._in_body = False
        self.word_count = 0

    def handle_starttag(self, tag, attrs):
        a = {k: v for k, v in attrs}
        if tag == "html":
            self.lang = a.get("lang")
        elif tag == "body":
            self._in_body = True
        elif tag == "title":
            self._in_title = True
        elif tag == "meta":
            key = (a.get("name") or a.get("property") or "").lower()
            if key:
                self.meta[key] = a.get("content", "")
        elif tag == "link":
            rel = (a.get("rel") or "").lower()
            if rel == "canonical":
                self.canonical = a.get("href")
            elif rel == "alternate" and a.get("hreflang"):
                self.hreflang[a["hreflang"]] = a.get("href")
        elif tag == "h1":
            self._in_h1 = True
            self._h1_buf = []
        elif tag == "img":
            src = a.get("src") or a.get("data-src") or ""
            # alt="" is a deliberate, valid "decorative image" marker (e.g. a
            # thumbnail sitting next to a text heading that already says the
            # same thing) -- only a fully MISSING alt attribute is a real bug.
            self.imgs.append((src, "alt" in a))
        elif tag == "a":
            href = a.get("href")
            if href:
                self.links.append(href)
        elif tag == "script":
            stype = (a.get("type") or "").lower()
            if stype == "application/ld+json":
                self._in_ldjson = True
                self._ldjson_buf = []
            self._skip_stack.append("script")
        elif tag == "style":
            self._skip_stack.append("style")

    def handle_endtag(self, tag):
        if tag == "body":
            self._in_body = False
        elif tag == "title":
            self._in_title = False
        elif tag == "h1":
            self._in_h1 = False
            self.h1s.append("".join(self._h1_buf).strip())
        elif tag == "script":
            if self._in_ldjson:
                self.ldjson.append("".join(self._ldjson_buf))
                self._in_ldjson = False
            if self._skip_stack and self._skip_stack[-1] == "script":
                self._skip_stack.pop()
        elif tag == "style":
            if self._skip_stack and self._skip_stack[-1] == "style":
                self._skip_stack.pop()

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        if self._in_h1:
            self._h1_buf.append(data)
        if self._in_ldjson:
            self._ldjson_buf.append(data)
            return
        if self._skip_stack:
            return
        if self._in_body:
            self.word_count += len(data.split())


def clean_url_for(relpath):
    """Map a repo-relative file path to the clean URL Cloudflare Pages serves."""
    relpath = relpath.replace("\\", "/")
    d, base = os.path.split(relpath)
    if base == "index.html":
        return ("/" + d + "/") if d else "/"
    name = base[:-5] if base.endswith(".html") else base
    return "/" + (d + "/" if d else "") + name


def discover_pages():
    pages = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
        rel_dir = os.path.relpath(dirpath, ROOT).replace("\\", "/")
        if rel_dir == ".":
            rel_dir = ""
        for fn in filenames:
            if not fn.endswith(".html") or fn in EXCLUDE_FILES:
                continue
            relpath = (rel_dir + "/" + fn) if rel_dir else fn
            pages.append(relpath)
    return sorted(pages)


def resolve_internal(href, current_rel_dir):
    """Best-effort resolve an href to a repo-relative path, or None if
    external / non-navigable (mailto, tel, javascript, anchor-only, other domain)."""
    href = href.strip()
    if not href or href.startswith("#"):
        return None
    stripped = href.split("#")[0].split("?")[0]
    if not stripped:
        return None
    parsed = urlparse(stripped)
    if parsed.scheme and parsed.scheme not in ("http", "https"):
        return None
    if parsed.netloc:
        if parsed.netloc not in SITE_HOSTS:
            return None
        path = parsed.path
    else:
        path = stripped
    if path.startswith("/"):
        fs_rel = path.lstrip("/")
    else:
        fs_rel = os.path.normpath(os.path.join(current_rel_dir, path)).replace("\\", "/")
    return fs_rel


def file_exists_for(fs_rel):
    """Does fs_rel resolve to a real file, trying the clean-URL conventions?"""
    if fs_rel == "":
        fs_rel = "index.html"
    candidates = [
        fs_rel,
        fs_rel.rstrip("/") + "/index.html" if fs_rel.endswith("/") else None,
        fs_rel + "/index.html",
        fs_rel + ".html",
    ]
    for c in candidates:
        if c and os.path.isfile(os.path.join(ROOT, c)):
            return True
    return False


# -------------------------------------------------------------------- main --

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=None, help="output markdown path")
    args = ap.parse_args()

    pages = discover_pages()
    parsed = {}
    for relpath in pages:
        with open(os.path.join(ROOT, relpath), encoding="utf-8", errors="replace") as f:
            html = f.read()
        p = PageParser()
        p.feed(html)
        parsed[relpath] = p

    issues = {k: [] for k in (
        "critical", "high", "medium", "low", "info"
    )}

    def flag(sev, relpath, msg):
        issues[sev].append((relpath, msg))

    # ---- per-page checks ----
    titles = {}
    descs = {}
    for relpath, p in parsed.items():
        url = BASE_URL + clean_url_for(relpath)
        title = p.title.strip()
        desc = (p.meta.get("description") or "").strip()

        if not title:
            flag("critical", relpath, "Missing <title>")
        else:
            titles.setdefault(title.lower(), []).append(relpath)
            if len(title) > 65:
                flag("low", relpath, f"Title is {len(title)} chars (recommend <=60): \"{title}\"")

        if not desc:
            flag("high", relpath, "Missing meta description")
        else:
            descs.setdefault(desc.lower(), []).append(relpath)
            if len(desc) < 70 or len(desc) > 170:
                flag("low", relpath, f"Meta description is {len(desc)} chars (ideal 70-160): \"{desc[:80]}...\"")

        robots = (p.meta.get("robots") or "").lower()
        if "noindex" in robots and relpath not in NOINDEX_EXPECTED:
            if relpath in KNOWN_INTENTIONAL_NOINDEX:
                flag("info", relpath, f"Intentional noindex -- {KNOWN_INTENTIONAL_NOINDEX[relpath]}. Re-confirm this is still wanted.")
            else:
                flag("critical", relpath, f"robots meta contains noindex: \"{robots}\"")

        if relpath in CANONICAL_EXEMPT:
            pass
        elif not p.canonical:
            flag("high", relpath, "Missing canonical tag")
        else:
            expected = BASE_URL + clean_url_for(relpath)
            got = p.canonical.rstrip("/") if not p.canonical.endswith("//") else p.canonical
            # allow root "/" to keep its trailing slash
            exp_cmp = expected if expected == BASE_URL + "/" else expected.rstrip("/")
            got_cmp = p.canonical if p.canonical == BASE_URL + "/" else p.canonical.rstrip("/")
            if got_cmp != exp_cmp:
                flag("medium", relpath, f"Canonical \"{p.canonical}\" != expected \"{expected}\"")

        if len(p.h1s) == 0:
            flag("high", relpath, "No <h1> found")
        elif len(p.h1s) > 1:
            flag("medium", relpath, f"{len(p.h1s)} <h1> tags found (expected 1): {p.h1s}")

        if not p.lang:
            flag("medium", relpath, "Missing lang attribute on <html>")

        if "viewport" not in p.meta:
            flag("medium", relpath, "Missing viewport meta tag")

        for og_key in ("og:title", "og:description", "og:image", "og:url"):
            if og_key not in p.meta:
                flag("low", relpath, f"Missing {og_key}")
        if "twitter:card" not in p.meta:
            flag("low", relpath, "Missing twitter:card")

        if not p.ldjson:
            flag("info", relpath, "No JSON-LD structured data on this page")
        else:
            for i, block in enumerate(p.ldjson):
                try:
                    json.loads(block)
                except json.JSONDecodeError as e:
                    flag("high", relpath, f"Invalid JSON-LD block #{i+1}: {e}")

        missing_alt = [src for src, has_alt_attr in p.imgs if not has_alt_attr]
        if missing_alt:
            flag("medium", relpath, f"{len(missing_alt)} image(s) with no alt attribute at all: {missing_alt[:5]}")

        if p.word_count < 150:
            flag("low", relpath, f"Thin content: ~{p.word_count} words in <body>")

    for title, plist in titles.items():
        if len(plist) > 1:
            flag("high", ", ".join(plist), f"Duplicate <title> across {len(plist)} pages: \"{title}\"")
    for desc, plist in descs.items():
        if len(plist) > 1:
            flag("medium", ", ".join(plist), f"Duplicate meta description across {len(plist)} pages")

    # ---- hreflang reciprocity ----
    for relpath, p in parsed.items():
        if not p.hreflang:
            continue
        for lang, href in p.hreflang.items():
            if lang == "x-default":
                continue
            target_rel = resolve_internal(href, os.path.dirname(relpath))
            if target_rel is None:
                continue
            if not file_exists_for(target_rel):
                flag("high", relpath, f"hreflang \"{lang}\" points to missing page: {href}")
                continue
            # reciprocity: does the target declare a hreflang back to this page?
            # find the parsed target by matching resolved file
            target_key = None
            for cand in (target_rel, target_rel + ".html", target_rel.rstrip("/") + "/index.html", target_rel + "/index.html"):
                if cand in parsed:
                    target_key = cand
                    break
            if target_key:
                back = parsed[target_key].hreflang
                this_url = BASE_URL + clean_url_for(relpath)
                if not any(v.rstrip("/") == this_url.rstrip("/") for v in back.values()):
                    flag("medium", relpath, f"hreflang to {href} isn't reciprocated back to this page")

    # ---- internal link integrity + orphan graph ----
    link_targets = set()
    for relpath, p in parsed.items():
        cur_dir = os.path.dirname(relpath)
        for href in p.links:
            fs_rel = resolve_internal(href, cur_dir)
            if fs_rel is None:
                continue
            if not file_exists_for(fs_rel):
                flag("high", relpath, f"Broken internal link: {href}")
            else:
                link_targets.add(fs_rel.rstrip("/"))
                link_targets.add(fs_rel.rstrip("/") + "/index.html")
                link_targets.add(fs_rel + ".html")
                link_targets.add(fs_rel)

    entry_points = {"index.html", "es/index.html", "hi/index.html", "plotmitra/index.html", "404.html"}
    for relpath in pages:
        if relpath in entry_points:
            continue
        candidates = {relpath, relpath[:-5] if relpath.endswith(".html") else relpath}
        if not (candidates & link_targets):
            flag("medium", relpath, "Orphan page: not linked from any other page on the site")

    # ---- sitemap cross-check ----
    sitemap_path = os.path.join(ROOT, "sitemap.xml")
    if os.path.isfile(sitemap_path):
        try:
            tree = ET.parse(sitemap_path)
            ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
            locs = [el.text.strip() for el in tree.findall(".//sm:loc", ns) if el.text]
            sitemap_relpaths = set()
            for loc in locs:
                path = urlparse(loc).path
                fs_rel = path.lstrip("/")
                sitemap_relpaths.add(fs_rel)
                if not file_exists_for(fs_rel):
                    flag("critical", "sitemap.xml", f"Listed but missing on disk: {loc}")

            for relpath in pages:
                if relpath in SITEMAP_EXEMPT or relpath in KNOWN_INTENTIONAL_NOINDEX:
                    continue
                clean = clean_url_for(relpath).lstrip("/")
                variants = {clean, clean.rstrip("/"), relpath}
                if not (variants & sitemap_relpaths):
                    flag("medium", relpath, "On disk but missing from sitemap.xml")
        except ET.ParseError as e:
            flag("critical", "sitemap.xml", f"Failed to parse: {e}")
    else:
        flag("critical", "sitemap.xml", "sitemap.xml not found at repo root")

    write_report(args.out, pages, issues)


def write_report(out_path, pages, issues):
    if out_path is None:
        os.makedirs(os.path.join(ROOT, "_seo-reports"), exist_ok=True)
        out_path = os.path.join(ROOT, "_seo-reports", f"report-{datetime.date.today().isoformat()}.md")

    sev_order = ["critical", "high", "medium", "low", "info"]
    sev_labels = {
        "critical": "Critical",
        "high": "High",
        "medium": "Medium",
        "low": "Low",
        "info": "Info",
    }
    total = sum(len(v) for v in issues.values())

    lines = []
    lines.append(f"# SEO Audit -- {datetime.date.today().isoformat()}")
    lines.append("")
    lines.append(f"Pages scanned: **{len(pages)}**  |  Findings: **{total}**")
    lines.append("")
    lines.append("| Severity | Count |")
    lines.append("|---|---|")
    for sev in sev_order:
        lines.append(f"| {sev_labels[sev]} | {len(issues[sev])} |")
    lines.append("")
    lines.append("Static analysis of the HTML in this repo only -- no live PageSpeed/Search "
                  "Console/backlink data. Internal-link and sitemap checks are best-effort "
                  "path resolution, not a live crawl.")
    lines.append("")

    for sev in sev_order:
        items = issues[sev]
        if not items:
            continue
        lines.append(f"## {sev_labels[sev]} ({len(items)})")
        lines.append("")
        for relpath, msg in items:
            lines.append(f"- `{relpath}` -- {msg}")
        lines.append("")

    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print(f"Scanned {len(pages)} pages, {total} findings.")
    for sev in sev_order:
        print(f"  {sev_labels[sev]:9s}: {len(issues[sev])}")
    print(f"Report written to: {os.path.relpath(out_path, ROOT)}")


if __name__ == "__main__":
    main()
