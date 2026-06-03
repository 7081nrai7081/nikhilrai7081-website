# nikhilrai7081-website

Personal portfolio for **Nikhil Rai** — Growth · Partnerships · Execution.
Static HTML/CSS/JS, no build step. Live at **https://nikhilrai7081.com**.

## Structure

```
index.html                 Home (Hero, Stats, About, Expertise, Journey, Projects, Contact)
work-lead-generation.html  Case study — Lead Generation Systems
work-automation.html       Case study — Business Automation
work-seo.html              Case study — SEO & Visibility
work-operations.html       Case study — Digital Operations
blog.html                  Blog index (/blog) — ready to list posts
blog-template.html         Copy-to-create article template (noindex)
privacy.html               Privacy Policy (/privacy)
404.html                   Styled not-found page (root-absolute asset paths)

assets/css/style.css       Styles — dark/light theme, glassmorphism, @font-face
assets/js/main.js          Theme, nav, scroll progress, reveal, contact form,
                           cookie consent, click/conversion tracking
assets/fonts/              Self-hosted Inter (variable woff2)
assets/images/             profile.jpg/.webp (portrait) + og-image.svg/.png (social card)

favicon.svg                Site icon (icon / shortcut / apple-touch on every page)
sitemap.xml / robots.txt   SEO
_headers                   Long-cache rules (Cloudflare Pages / Netlify)
.githooks/pre-commit       Auto-bumps ?v=N cache-busting on CSS/JS commits
f3dd7b…871b6.txt           IndexNow key (Bing/Yandex instant indexing)
```

Clean URLs: the host serves `/work-seo` etc. (the `.html` versions 308-redirect).
Canonical tags, `og:url`, sitemap and internal links all use the clean URLs.

## Analytics & consent

| What | ID | Notes |
|------|----|-------|
| Google Tag Manager | `GTM-MB5JGJQL` | Snippet in `<head>` + `<noscript>` on every page |
| Google Analytics 4 | `G-MYX7TJMGPH` | Fired **by** the GTM container — managed in GTM/GA4, not in this repo |

- **Consent Mode v2:** analytics defaults to **denied**; a cookie banner sets
  `analytics_storage: granted` only after the visitor clicks **Accept**. The
  default is declared inline before GTM on every page.
- **Custom events** pushed to `dataLayer` from `main.js`: `contact_form_submit`,
  `contact_click`, `cta_click`, `cookie_consent`. Create matching Custom Event
  triggers + GA4 Event tags in GTM to forward them (and mark form submits as a
  key event/conversion in GA4).
- The GA4 ID does not appear in this repo — to change the destination property,
  edit the Google tag inside GTM, not these files.

## Contact form

`index.html` has a contact form wired to [Web3Forms](https://web3forms.com)
(client-side, no backend). The access key lives in the `access_key` hidden
input and is active. Web3Forms only accepts submissions from a real browser, so
test from the deployed site (not curl).

## SEO

- `sitemap.xml` + `robots.txt`; submitted to Google Search Console and IndexNow.
- Structured data: `Person` + `WebSite` + `Service` on the home page,
  `BreadcrumbList` on each case study, `BlogPosting` on blog posts.
- Per-page `title`/`description`, Open Graph + Twitter tags, PNG social card.

## Assets & caching

- **Fonts** are self-hosted (`assets/fonts/inter-variable.woff2`) via `@font-face` — no Google Fonts dependency.
- **Cache-busting:** CSS/JS are referenced as `?v=N`. A pre-commit hook bumps `N`
  automatically whenever `style.css` or `main.js` changes. Activate once per clone:

  ```bash
  git config core.hooksPath .githooks
  ```

## Adding a blog post

1. Copy `blog-template.html` → `blog-<slug>.html` and fill in the `{{PLACEHOLDERS}}`.
2. Add a card linking to it on `blog.html`.
3. Add the post URL to `sitemap.xml`.
4. Commit & push.

## Local preview

Open `index.html` directly in a browser, **or** serve the folder (needed for the
pages that use root-absolute `/assets/...` paths — 404, privacy, blog):

```bash
python -m http.server 8000   # then visit http://localhost:8000
```
