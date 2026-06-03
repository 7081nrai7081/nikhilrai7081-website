# nikhilrai7081-website

Personal portfolio site for **Nikhil Rai** — Growth · Partnerships · Execution.
Static HTML/CSS/JS, no build step.

## Structure

```
index.html                 Home (Hero, Stats, About, Expertise, Journey, Projects, Contact)
work-lead-generation.html  Case study — Lead Generation Systems
work-automation.html       Case study — Business Automation
work-seo.html              Case study — SEO & Visibility
work-operations.html       Case study — Digital Operations
404.html                   Styled not-found page (root-absolute asset paths)
assets/css/style.css       Styles (dark/light theme, glassmorphism, self-hosted font)
assets/js/main.js          Theme toggle, nav, scroll progress, reveal, contact form
assets/fonts/              Self-hosted Inter (variable woff2)
assets/images/             profile.jpg (portrait) + og-image.svg/.png (social card)
favicon.svg                Site icon
.githooks/pre-commit       Auto-bumps ?v=N cache-busting on CSS/JS commits
robots.txt / sitemap.xml   SEO
```

## Analytics

The site uses **Google Tag Manager**; analytics tags are configured inside the
container (not in this repo).

| What | ID | Where it lives |
|------|----|----------------|
| Google Tag Manager container | `GTM-MB5JGJQL` | Snippet in `<head>` + `<noscript>` after `<body>` on all 5 pages |
| Google Analytics 4 property | `G-MYX7TJMGPH` | Fired **by the GTM container** — managed in GTM/GA4, not in the code |

Note: the GA4 ID does not appear anywhere in this repository. It is loaded at
runtime by the GTM container. To change which GA4 property receives data, edit
the Google tag inside GTM (container `GTM-MB5JGJQL`) — not these files.

## Contact form

`index.html` has a contact form wired to [Web3Forms](https://web3forms.com)
(submits client-side, no backend). The access key lives in the `access_key`
hidden input. Web3Forms only accepts submissions from a real browser, so test
from the deployed site, not via curl.

## Assets & caching

- **Fonts** are self-hosted (`assets/fonts/inter-variable.woff2`) via `@font-face`
  in `style.css` — no Google Fonts dependency.
- **Cache-busting:** CSS/JS are referenced with `?v=N`. A pre-commit hook bumps
  `N` automatically whenever `style.css` or `main.js` is committed. Activate it
  once per clone:

  ```bash
  git config core.hooksPath .githooks
  ```

## Local preview

Open `index.html` directly in a browser, or serve the folder:

```bash
python -m http.server 8000   # then visit http://localhost:8000
```

Open `index.html` directly in a browser, or serve the folder:

```bash
python -m http.server 8000   # then visit http://localhost:8000
```
