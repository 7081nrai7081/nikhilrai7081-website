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
assets/css/style.css       Styles (dark/light theme, glassmorphism)
assets/js/main.js          Theme toggle, nav, scroll progress, reveal, contact form
assets/images/             profile.jpg (portrait) + og-image.svg (social card)
favicon.svg                Site icon
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

`index.html` has a contact form wired to [Web3Forms](https://web3forms.com).
It is inactive until configured: replace `YOUR_ACCESS_KEY_HERE` in `index.html`
with a free Web3Forms access key.

## Local preview

Open `index.html` directly in a browser, or serve the folder:

```bash
python -m http.server 8000   # then visit http://localhost:8000
```
