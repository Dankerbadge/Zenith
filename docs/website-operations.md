# Zenith Website Operations

This is the maintenance checklist for the static website in `legal-site/`.

## What Exists

- Public routes live under `legal-site/**/*.html`
- Contact endpoint: `legal-site/api/contact.js`
- Shared CSS/JS: `legal-site/assets/site.css`, `legal-site/assets/site.js`
- Indexing files: `legal-site/sitemap.xml`, `legal-site/robots.txt`

## Pre-Deploy Checks

Run these before every deploy:

1. `npm run -s verify:legal-site`
2. `node --check legal-site/assets/site.js`
3. `npm run -s verify:ship-lock`

The website check validates:
- required routes/assets
- internal links
- canonical consistency
- footer link consistency
- missing accessibility markers (skip link/main id)
- no inline top-margin drift

## Contact Form Runtime

`/api/contact` sends email through Resend when configured.

Required runtime variables:

- `RESEND_API_KEY`
- `CONTACT_TO_EMAIL` (optional, defaults to `support@zenithfit.app`)
- `CONTACT_FROM_EMAIL` (optional, defaults to `Zenith Support <onboarding@resend.dev>`)

Behavior if key is missing:
- API returns a clear fallback message telling users to email support directly.

## Routine Content Updates

### Status page

File: `legal-site/status/index.html`

Update when incidents happen:
- current system cards
- incident history card
- any temporary user guidance

### Release notes

File: `legal-site/releases/index.html`

When shipping:
1. Add a new top release card with date/version.
2. Move previous “current” entry down.
3. Keep notes short and user-visible (behavior impact, fixes, known limits).

### Roadmap

File: `legal-site/roadmap/index.html`

Rules:
- shipped items move to Features/Releases
- roadmap stays directional, not guaranteed dates

## Availability Language Rules

Use only:
- `Available now`
- `In development`
- `Planned`

Do not imply release readiness for in-development wearable paths.

## SEO/Structure Rules

Every public HTML page must include:
- `og:url`
- `rel="canonical"` matching `og:url`
- skip link + `<main id="main-content">`

If adding a route:
1. add page file
2. add sitemap entry
3. add footer linkage
4. re-run `verify:legal-site`
