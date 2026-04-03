#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', 'legal-site');

const REQUIRED_HTML_PAGES = [
  'index.html',
  'product/index.html',
  'features/index.html',
  'support/index.html',
  'support/getting-started/index.html',
  'support/troubleshooting/index.html',
  'support/account/index.html',
  'support/subscription/index.html',
  'support/wearables/index.html',
  'support/wearables/apple-watch/index.html',
  'support/wearables/garmin/index.html',
  'wearables/index.html',
  'privacy/index.html',
  'privacy-policy/index.html',
  'terms/index.html',
  'data-permissions/index.html',
  'roadmap/index.html',
  'releases/index.html',
  'about/index.html',
  'status/index.html',
  'contact/index.html',
  'download/index.html',
  'cookies/index.html',
  'premium/index.html',
];

const REQUIRED_ASSETS = [
  'assets/site.css',
  'assets/site.js',
  'robots.txt',
  'sitemap.xml',
  'api/contact.js',
];

const CONTACT_FORM_MARKERS = [
  'data-contact-form',
  'data-contact-success',
  'data-contact-error',
];

const BANNED_COPY_PHRASES = [
  'revolutionary',
  'game-changing',
  'best-in-class',
  'unlock your potential',
  'powered by',
];

function listHtmlFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listHtmlFiles(abs));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.html')) {
      out.push(abs);
    }
  }
  return out;
}

function resolveInternalHref(href) {
  const clean = href.split('#')[0].split('?')[0];
  if (!clean || clean === '/') return path.join(root, 'index.html');
  if (!clean.startsWith('/')) return null;
  const rel = clean.replace(/^\//, '');
  const noExt = path.join(root, rel);
  if (path.extname(noExt)) return noExt;
  return path.join(noExt, 'index.html');
}

const errors = [];

for (const relPath of REQUIRED_HTML_PAGES) {
  const abs = path.join(root, relPath);
  if (!fs.existsSync(abs)) {
    errors.push(`Missing required page: ${relPath}`);
  }
}

for (const relPath of REQUIRED_ASSETS) {
  const abs = path.join(root, relPath);
  if (!fs.existsSync(abs)) {
    errors.push(`Missing required asset: ${relPath}`);
  }
}

const htmlFiles = listHtmlFiles(root);
for (const abs of htmlFiles) {
  const rel = path.relative(root, abs);
  const html = fs.readFileSync(abs, 'utf8');

  if (html.includes('<footer class="footer">') && !html.includes('class="footer-links"')) {
    errors.push(`Footer links class missing in ${rel}`);
  }

  if (!html.includes('class="skip-link"')) {
    errors.push(`Skip link missing in ${rel}`);
  }

  if (!html.includes('<main id="main-content">')) {
    errors.push(`Main landmark id missing in ${rel}`);
  }

  if (!html.includes('rel="canonical"')) {
    errors.push(`Canonical link missing in ${rel}`);
  }

  const ogUrlMatch = html.match(/<meta property="og:url" content="([^"]+)"/);
  const canonicalMatch = html.match(/<link rel="canonical" href="([^"]+)"/);
  if (ogUrlMatch && canonicalMatch && ogUrlMatch[1] !== canonicalMatch[1]) {
    errors.push(`Canonical mismatch in ${rel}: og:url != canonical`);
  }

  if (html.includes('class="footer-links"')) {
    if (!html.includes('href="/wearables"')) {
      errors.push(`Footer wearables link missing in ${rel}`);
    }
    if (!html.includes('href="/releases"')) {
      errors.push(`Footer releases link missing in ${rel}`);
    }
  }

  const lowered = html.toLowerCase();
  for (const phrase of BANNED_COPY_PHRASES) {
    if (lowered.includes(phrase)) {
      errors.push(`Banned copy phrase "${phrase}" found in ${rel}`);
    }
  }

  if (/style="margin-top:\s*\d+px;"/.test(html)) {
    errors.push(`Inline margin-top style found in ${rel}; use spacing utility classes`);
  }

  const hrefMatches = html.match(/href="[^"]+"/g) || [];
  for (const raw of hrefMatches) {
    const href = raw.slice(6, -1);
    if (
      href.startsWith('http://') ||
      href.startsWith('https://') ||
      href.startsWith('mailto:') ||
      href.startsWith('tel:') ||
      href.startsWith('#')
    ) {
      continue;
    }
    const resolved = resolveInternalHref(href);
    if (resolved && !fs.existsSync(resolved)) {
      errors.push(`Broken internal href in ${rel}: ${href}`);
    }
  }
}

const contactPage = path.join(root, 'contact', 'index.html');
if (fs.existsSync(contactPage)) {
  const contactHtml = fs.readFileSync(contactPage, 'utf8');
  for (const marker of CONTACT_FORM_MARKERS) {
    if (!contactHtml.includes(marker)) {
      errors.push(`Contact page missing marker: ${marker}`);
    }
  }
}

const troubleshootingPage = path.join(root, 'support', 'troubleshooting', 'index.html');
if (fs.existsSync(troubleshootingPage)) {
  const troubleshootingHtml = fs.readFileSync(troubleshootingPage, 'utf8');
  if (!troubleshootingHtml.includes('/contact?category=Bug&topic=gps')) {
    errors.push('Troubleshooting GPS flow should route to prefilled contact form');
  }
}

const homePage = path.join(root, 'index.html');
if (fs.existsSync(homePage)) {
  const homeHtml = fs.readFileSync(homePage, 'utf8');
  if (!homeHtml.includes('data-support-search')) {
    errors.push('Home page support search input missing');
  }
  if (!homeHtml.includes('id="support-index-json"')) {
    errors.push('Home page support search index missing');
  }
}

const supportHubPage = path.join(root, 'support', 'index.html');
if (fs.existsSync(supportHubPage)) {
  const supportHtml = fs.readFileSync(supportHubPage, 'utf8');
  if (!supportHtml.includes('data-support-search')) {
    errors.push('Support hub search input missing');
  }
  if (!supportHtml.includes('id="support-index-json"')) {
    errors.push('Support hub search index missing');
  }
}

if (errors.length) {
  console.error('Website verification failed:');
  errors.forEach((msg) => console.error(`- ${msg}`));
  process.exit(1);
}

console.log('Website verification passed.');
console.log(`- ${htmlFiles.length} HTML files checked`);
console.log('- Required routes and assets present');
console.log('- No inline margin-top styles detected');
console.log('- Internal href targets resolve');
