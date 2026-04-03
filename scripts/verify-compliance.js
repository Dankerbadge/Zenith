#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const appConfigPath = path.join(__dirname, '..', 'utils', 'appConfig.ts');
const source = fs.readFileSync(appConfigPath, 'utf8');

function pick(pattern, label) {
  const match = source.match(pattern);
  if (!match || !match[1]) {
    throw new Error(`Missing ${label} in appConfig.ts`);
  }
  return match[1];
}

function assertHttpUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} is not a valid URL: ${value}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`${label} must use https: ${value}`);
  }
}

function assertEmail(value, label) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error(`${label} is not a valid email: ${value}`);
  }
}

function main() {
  const privacyUrl = pick(/PRIVACY_URL:\s*'([^']+)'/, 'PRIVACY_URL');
  const termsUrl = pick(/TERMS_URL:\s*'([^']+)'/, 'TERMS_URL');
  const supportEmail = pick(/SUPPORT_EMAIL:\s*'([^']+)'/, 'SUPPORT_EMAIL');

  assertHttpUrl(privacyUrl, 'PRIVACY_URL');
  assertHttpUrl(termsUrl, 'TERMS_URL');
  assertEmail(supportEmail, 'SUPPORT_EMAIL');

  console.log('Compliance config check passed.');
  console.log(`- Privacy: ${privacyUrl}`);
  console.log(`- Terms: ${termsUrl}`);
  console.log(`- Support: ${supportEmail}`);
}

main();
