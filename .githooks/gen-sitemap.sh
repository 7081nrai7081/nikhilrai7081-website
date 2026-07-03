#!/bin/sh
# Regenerate sitemap.xml from the tracked .html files.
#   - root *.html            -> English (default) pages
#   - <lang>/*.html (2-char) -> translations, e.g. es/index.html
# Extensionless URLs (Cloudflare Pages serves /services from services.html).
# index.html -> "/", <lang>/index.html -> "/<lang>/".
# lastmod = today if the file is staged in this commit, else its last commit date.
# Multilingual pages get xhtml:link hreflang alternates + x-default (English).
set -eu

DOMAIN="https://nikhilrai7081.com"
OUT="sitemap.xml"
EXCLUDE_RE='^(404|blog-template)\.html$'   # not indexable

staged=$(git diff --cached --name-only 2>/dev/null || true)

url_for() {        # path -> full URL
  p=${1%.html}
  case $p in
    index)    echo "$DOMAIN/" ;;
    */index)  echo "$DOMAIN/${p%/index}/" ;;
    *)        echo "$DOMAIN/$p" ;;
  esac
}

lang_for() {       # path -> language code (en for root pages)
  case $1 in
    [a-z][a-z]/*) echo "${1%%/*}" ;;
    *)            echo "en" ;;
  esac
}

logical_for() {    # path -> language-independent key ("" = homepage)
  p=${1%.html}
  case $p in [a-z][a-z]/*) p=${p#*/} ;; esac
  case $p in index) p="" ;; */index) p="${p%/index}" ;; esac
  echo "$p"
}

meta_for() {       # logical key -> "priority changefreq"
  case $1 in
    "")       echo "1.0 weekly" ;;
    services) echo "0.9 monthly" ;;
    work-*)   echo "0.8 monthly" ;;
    blog)     echo "0.6 weekly" ;;
    blog-*)   echo "0.7 monthly" ;;
    topic-*)  echo "0.6 weekly" ;;
    privacy)  echo "0.3 yearly" ;;
    *)        echo "0.5 monthly" ;;
  esac
}

lastmod_for() {    # path -> YYYY-MM-DD
  if printf '%s\n' "$staged" | grep -qx "$1"; then date +%F; return; fi
  d=$(git log -1 --format=%cs -- "$1" 2>/dev/null || true)
  [ -n "$d" ] && echo "$d" || date +%F
}

TMP=$(mktemp)
trap 'rm -f "$TMP" "$OUT.tmp"' EXIT
SEP='|'   # non-whitespace separator: preserves the empty homepage key

# Row per page: logical|lang|url|lastmod
git ls-files '*.html' | while IFS= read -r f; do
  base=${f##*/}
  printf '%s\n' "$base" | grep -qE "$EXCLUDE_RE" && continue
  printf '%s|%s|%s|%s\n' \
    "$(logical_for "$f")" "$(lang_for "$f")" "$(url_for "$f")" "$(lastmod_for "$f")"
done > "$TMP"

{
  echo '<?xml version="1.0" encoding="UTF-8"?>'
  echo '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'
  echo '        xmlns:xhtml="http://www.w3.org/1999/xhtml">'

  # Homepage ("") first, then remaining logical keys alphabetically.
  cut -d"$SEP" -f1 "$TMP" | sort -u | while IFS= read -r key; do
    rows=$(awk -F"$SEP" -v k="$key" '$1==k' "$TMP")
    count=$(printf '%s\n' "$rows" | grep -c .)
    enurl=$(printf '%s\n' "$rows" | awk -F"$SEP" '$2=="en"{print $3; exit}')
    meta=$(meta_for "$key"); prio=${meta%% *}; freq=${meta##* }

    printf '%s\n' "$rows" | while IFS="$SEP" read -r _ lang url lm; do
      echo ''
      echo '  <url>'
      echo "    <loc>$url</loc>"
      echo "    <lastmod>$lm</lastmod>"
      echo "    <changefreq>$freq</changefreq>"
      echo "    <priority>$prio</priority>"
      if [ "$count" -gt 1 ]; then
        printf '%s\n' "$rows" | while IFS="$SEP" read -r _ l2 u2 _; do
          echo "    <xhtml:link rel=\"alternate\" hreflang=\"$l2\" href=\"$u2\"/>"
        done
        [ -n "$enurl" ] && echo "    <xhtml:link rel=\"alternate\" hreflang=\"x-default\" href=\"$enurl\"/>"
      fi
      echo '  </url>'
    done
  done

  echo ''
  echo '</urlset>'
} > "$OUT.tmp"

mv "$OUT.tmp" "$OUT"
