#!/usr/bin/env python3
"""
seo_audit.py -- portable, dependency-free static SEO audit.

Point it at any static-HTML site's repo root and it audits that site's own
HTML files on disk (no live network calls except an optional root-index
auto-detect of the canonical tag; nothing leaves the machine). Works on
this repo out of the box, or on any other repo via --root / --base-url /
--config.

Checks:
  - title / meta description: presence, length, duplicates across pages
  - canonical tag: presence and correctness vs. the page's real clean URL
  - single-H1 rule
  - <html lang> attribute
  - viewport meta
  - robots meta (flags accidental noindex/nofollow)
  - Open Graph + Twitter Card completeness
  - JSON-LD: presence + JSON validity
  - hreflang: target file exists + reciprocity between locales
  - image alt-text coverage (a fully missing alt attribute, not alt="")
  - internal link integrity (best-effort broken-link check)
  - orphan pages (on disk, never linked from anywhere)
  - sitemap.xml cross-check (on disk but missing from sitemap, or vice versa)
  - approximate word count (thin-content flag)
  - LocalBusiness-type schema (NAP consistency, required fields) -- only
    runs if such schema exists anywhere on the site; otherwise reports
    "dormant" so it's ready the moment it becomes relevant
  - Product schema (required fields per Google's rich-result rules) --
    same dormant-until-relevant behavior

This is static analysis only -- it doesn't know Core Web Vitals, real search
rankings, backlinks, or Google Business Profile / Maps data (those need live
APIs; see the "seo-maps" info line in every report for the free-tier path).

Usage:
    python scripts/seo_audit.py [--root PATH] [--base-url URL]
                                 [--config PATH] [--out PATH]

Config (optional, default: <root>/seo-audit.config.json) lets a specific
site override defaults without touching this file -- so the same script
works unmodified on a different site's repo:
    {
      "base_url": "https://example.com",
      "exclude_dirs": ["blog-drafts"],
      "exclude_files": ["template.html"],
      "sitemap_exempt": ["thank-you.html"],
      "noindex_expected": ["404.html"],
      "canonical_exempt": ["404.html"],
      "known_intentional_noindex": {"staging/page.html": "why, and since when"}
    }
All keys are optional and merge with (not replace) the built-in defaults.
If no config and no --base-url are given, the script tries to auto-detect
the base URL from the canonical tag on <root>/index.html.

Writes a Markdown report (default: <root>/_seo-reports/report-<date>.md)
and prints a short summary to stdout.
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

DEFAULT_EXCLUDE_DIRS = {
    "node_modules", ".git", ".github", ".claude", ".githooks",
    "_seo-reports", "dist", "build", ".next", ".output", "vendor",
}
DEFAULT_EXCLUDE_FILES = set()
DEFAULT_SITEMAP_EXEMPT = {"404.html"}
DEFAULT_NOINDEX_EXPECTED = {"404.html"}
DEFAULT_CANONICAL_EXEMPT = {"404.html"}

# Schema.org types that mean "this page represents a local/physical or
# service-area business" -- not exhaustive, but covers the common verticals.
LOCAL_BUSINESS_TYPES = {
    "LocalBusiness", "RealEstateAgent", "Restaurant", "Store",
    "ProfessionalService", "HomeAndConstructionBusiness", "MedicalBusiness",
    "LegalService", "AutomotiveBusiness", "Attorney", "Dentist", "Physician",
    "Plumber", "Electrician", "HairSalon", "AutoRepair", "FoodEstablishment",
    "LodgingBusiness", "GeneralContractor", "InsuranceAgency",
    "AccountingService", "Locksmith", "MovingCompany", "RoofingContractor",
}
PRODUCT_TYPES = {"Product", "IndividualProduct", "ProductGroup"}

# Runtime config -- populated by main() from CLI args + config file, then
# read by the functions below. Kept as module globals (not threaded through
# every call) to keep this a script, not a library.
ROOT = None
BASE_URL = None
SITE_HOSTS = set()
EXCLUDE_DIRS = set()
EXCLUDE_FILES = set()
SITEMAP_EXEMPT = set()
NOINDEX_EXPECTED = set()
CANONICAL_EXEMPT = set()
KNOWN_INTENTIONAL_NOINDEX = {}


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
        self.imgs = []  # (src, has_alt_attr)
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
    """Map a repo-relative file path to the clean URL Cloudflare-Pages-style
    static hosts serve (index.html -> directory URL, foo.html -> /foo)."""
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


def site_hosts_from_base(base_url):
    netloc = urlparse(base_url).netloc
    hosts = {netloc}
    if netloc.startswith("www."):
        hosts.add(netloc[4:])
    else:
        hosts.add("www." + netloc)
    return hosts


def autodetect_base_url(root):
    idx = os.path.join(root, "index.html")
    if not os.path.isfile(idx):
        return None
    with open(idx, encoding="utf-8", errors="replace") as f:
        html = f.read()
    p = PageParser()
    p.feed(html)
    if p.canonical:
        parsed = urlparse(p.canonical)
        if parsed.scheme and parsed.netloc:
            return f"{parsed.scheme}://{parsed.netloc}"
    return None


def walk_json(node):
    """Yield every dict found anywhere in a parsed JSON-LD structure,
    including nested values (offers, address, @graph, etc.)."""
    if isinstance(node, dict):
        yield node
        for v in node.values():
            yield from walk_json(v)
    elif isinstance(node, list):
        for item in node:
            yield from walk_json(item)


def find_schema_nodes(parsed, wanted_types):
    """(relpath, node) pairs for every JSON-LD node whose @type intersects
    wanted_types, across every page."""
    found = []
    for relpath, p in parsed.items():
        for block in p.ldjson:
            try:
                data = json.loads(block)
            except json.JSONDecodeError:
                continue
            for node in walk_json(data):
                t = node.get("@type")
                types = t if isinstance(t, list) else [t] if t else []
                if any(ty in wanted_types for ty in types):
                    found.append((relpath, node))
    return found


# -------------------------------------------------------------------- main --

def load_config(root, config_path):
    if config_path is None:
        config_path = os.path.join(root, "seo-audit.config.json")
    if os.path.isfile(config_path):
        with open(config_path, encoding="utf-8") as f:
            return json.load(f)
    return {}


def main():
    global ROOT, BASE_URL, SITE_HOSTS, EXCLUDE_DIRS, EXCLUDE_FILES
    global SITEMAP_EXEMPT, NOINDEX_EXPECTED, CANONICAL_EXEMPT, KNOWN_INTENTIONAL_NOINDEX

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=os.getcwd(), help="site repo root to scan (default: current directory)")
    ap.add_argument("--base-url", default=None, help="e.g. https://example.com (overrides config / auto-detect)")
    ap.add_argument("--config", default=None, help="path to a seo-audit.config.json (default: <root>/seo-audit.config.json)")
    ap.add_argument("--out", default=None, help="output markdown path")
    args = ap.parse_args()

    ROOT = os.path.abspath(args.root)
    config = load_config(ROOT, args.config)

    base_url = args.base_url or config.get("base_url") or autodetect_base_url(ROOT)
    if not base_url:
        print("ERROR: could not determine the site's base URL. Pass --base-url "
              "https://example.com, add \"base_url\" to seo-audit.config.json, or "
              "make sure --root's index.html has a <link rel=\"canonical\"> tag "
              "to auto-detect from.", file=sys.stderr)
        sys.exit(1)
    BASE_URL = base_url.rstrip("/")
    SITE_HOSTS = site_hosts_from_base(BASE_URL)

    EXCLUDE_DIRS = DEFAULT_EXCLUDE_DIRS | set(config.get("exclude_dirs", []))
    EXCLUDE_FILES = DEFAULT_EXCLUDE_FILES | set(config.get("exclude_files", []))
    SITEMAP_EXEMPT = DEFAULT_SITEMAP_EXEMPT | set(config.get("sitemap_exempt", []))
    NOINDEX_EXPECTED = DEFAULT_NOINDEX_EXPECTED | set(config.get("noindex_expected", []))
    CANONICAL_EXEMPT = DEFAULT_CANONICAL_EXEMPT | set(config.get("canonical_exempt", []))
    KNOWN_INTENTIONAL_NOINDEX = config.get("known_intentional_noindex", {})

    pages = discover_pages()
    parsed = {}
    for relpath in pages:
        with open(os.path.join(ROOT, relpath), encoding="utf-8", errors="replace") as f:
            html = f.read()
        p = PageParser()
        p.feed(html)
        parsed[relpath] = p

    issues = {k: [] for k in ("critical", "high", "medium", "low", "info")}

    def flag(sev, relpath, msg):
        issues[sev].append((relpath, msg))

    # ---- per-page checks ----
    titles = {}
    descs = {}
    for relpath, p in parsed.items():
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

    # Any index.html (root or in a subdirectory) is reachable by directory
    # browsing / nav convention even if never explicitly hyperlinked.
    entry_points = {p for p in pages if os.path.basename(p) == "index.html"} | NOINDEX_EXPECTED
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

    # ---- local business (dormant unless LocalBusiness-type schema exists) ----
    local_nodes = find_schema_nodes(parsed, LOCAL_BUSINESS_TYPES)
    if not local_nodes:
        flag("info", "(sitewide)", "seo-local: no LocalBusiness-type schema (LocalBusiness, "
             "RealEstateAgent, etc.) detected anywhere -- dormant. Add that schema to a page "
             "(e.g. if a property becomes a registered local/service-area business) and this "
             "activates automatically on the next run.")
    else:
        phones, addresses = set(), set()
        for relpath, node in local_nodes:
            t = node.get("@type")
            if not node.get("name"):
                flag("medium", relpath, f"LocalBusiness schema ({t}) missing name")
            tel = node.get("telephone")
            if not tel:
                flag("medium", relpath, f"LocalBusiness schema ({t}) missing telephone")
            else:
                phones.add(re.sub(r"[^\d+]", "", tel))
            addr, area = node.get("address"), node.get("areaServed")
            if not addr and not area:
                flag("medium", relpath, f"LocalBusiness schema ({t}) has neither address nor "
                     "areaServed -- at least one is expected (address for brick-and-mortar, "
                     "areaServed for a service-area business)")
            if isinstance(addr, dict):
                addresses.add(json.dumps(addr, sort_keys=True))
        if len(phones) > 1:
            flag("medium", "(sitewide)", f"Inconsistent phone numbers across LocalBusiness "
                 f"schema entries: {sorted(phones)} -- verify NAP (Name/Address/Phone) consistency")
        if len(addresses) > 1:
            flag("medium", "(sitewide)", f"{len(addresses)} distinct addresses found across "
                 "LocalBusiness schema entries -- verify NAP consistency")

    # ---- e-commerce (dormant unless Product schema exists) ----
    product_nodes = find_schema_nodes(parsed, PRODUCT_TYPES)
    if not product_nodes:
        flag("info", "(sitewide)", "seo-ecommerce: no Product schema detected anywhere -- "
             "dormant. Add Product/Offer JSON-LD to a page and this activates automatically "
             "on the next run.")
    else:
        for relpath, node in product_nodes:
            missing = [f for f in ("name", "image", "offers") if f not in node]
            if missing:
                flag("high", relpath, f"Product schema missing required field(s): {missing}")
            offers = node.get("offers")
            offers_list = offers if isinstance(offers, list) else [offers] if offers else []
            for offer in offers_list:
                if not isinstance(offer, dict):
                    continue
                if "price" not in offer:
                    flag("high", relpath, "Product offer missing price")
                if "priceCurrency" not in offer:
                    flag("high", relpath, "Product offer missing priceCurrency")
                avail = offer.get("availability")
                if not avail:
                    flag("high", relpath, "Product offer missing availability")
                elif not str(avail).startswith("https://schema.org/"):
                    flag("medium", relpath, f"Product availability should be a full schema.org "
                         f"URL (e.g. https://schema.org/InStock), got: \"{avail}\"")

    # ---- maps (always informational -- needs a real business+location to run) ----
    flag("info", "(sitewide)", "seo-maps (geo-grid rank tracking, Google Business Profile audit, "
         "cross-platform review intelligence) needs a real business name + location to query "
         "against, so it doesn't run automatically. A free tier exists (Nominatim geocoding, "
         "Overpass API for competitor discovery -- both keyless; Geoapify POI search -- free-tier "
         "key) and can be wired in once there's an actual Business Profile to audit.")

    write_report(args.out, pages, issues, BASE_URL)


def write_report(out_path, pages, issues, base_url):
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
    lines.append(f"Site: **{base_url}**  |  Pages scanned: **{len(pages)}**  |  Findings: **{total}**")
    lines.append("")
    lines.append("| Severity | Count |")
    lines.append("|---|---|")
    for sev in sev_order:
        lines.append(f"| {sev_labels[sev]} | {len(issues[sev])} |")
    lines.append("")
    lines.append("Static analysis of the HTML in this repo only -- no live PageSpeed/Search "
                  "Console/backlink/Maps data. Internal-link and sitemap checks are best-effort "
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

    print(f"Scanned {len(pages)} pages at {base_url}, {total} findings.")
    for sev in sev_order:
        print(f"  {sev_labels[sev]:9s}: {len(issues[sev])}")
    print(f"Report written to: {out_path}")


if __name__ == "__main__":
    main()
