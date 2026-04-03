#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const REQUIRED_FILES = [
  'docs/APP_STORE_LISTING.md',
  'docs/PRIVACY_POLICY.md',
  'docs/TERMS_OF_SERVICE.md',
  'assets/images/icon.png',
  'assets/images/android-icon-foreground.png',
  'assets/images/android-icon-background.png',
  'assets/images/android-icon-monochrome.png',
  'assets/images/splash-icon.png',
  'assets/images/favicon.png',
  'app.json',
  'utils/appConfig.ts',
];

const BANNED_PATTERNS = [/\bTODO\b/i, /\bTBD\b/i, /\bLorem\b/i, /\bXXX\b/i, /\bPLACEHOLDER\b/i];

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function mustExist(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Missing required file: ${relPath}`);
  }
}

function pick(pattern, source, label) {
  const m = source.match(pattern);
  if (!m || !m[1]) throw new Error(`Missing ${label}`);
  return m[1];
}

function main() {
  REQUIRED_FILES.forEach(mustExist);

  const listing = read('docs/APP_STORE_LISTING.md');
  BANNED_PATTERNS.forEach((pattern) => {
    if (pattern.test(listing)) {
      throw new Error(`APP_STORE_LISTING contains banned token: ${pattern}`);
    }
  });

  const appConfig = read('utils/appConfig.ts');
  const privacyUrl = pick(/PRIVACY_URL:\s*'([^']+)'/, appConfig, 'PRIVACY_URL');
  const termsUrl = pick(/TERMS_URL:\s*'([^']+)'/, appConfig, 'TERMS_URL');
  const supportEmail = pick(/SUPPORT_EMAIL:\s*'([^']+)'/, appConfig, 'SUPPORT_EMAIL');

  if (!listing.includes(privacyUrl)) {
    throw new Error(`APP_STORE_LISTING missing privacy URL: ${privacyUrl}`);
  }
  if (!listing.includes(termsUrl)) {
    throw new Error(`APP_STORE_LISTING missing terms URL: ${termsUrl}`);
  }
  if (!listing.includes(supportEmail)) {
    throw new Error(`APP_STORE_LISTING missing support email: ${supportEmail}`);
  }

  const appJson = JSON.parse(read('app.json'));
  if (!appJson?.expo?.ios?.bundleIdentifier) {
    throw new Error('app.json missing expo.ios.bundleIdentifier');
  }

  console.log('Store pack check passed.');
  console.log(`- Bundle ID: ${appJson.expo.ios.bundleIdentifier}`);
  console.log(`- Privacy URL found: ${privacyUrl}`);
  console.log(`- Terms URL found: ${termsUrl}`);
  console.log(`- Support email found: ${supportEmail}`);
}

main();
