#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function assert(condition, message, failures) {
  if (!condition) failures.push(message);
}

function main() {
  const failures = [];

  const rootLayout = read('app/_layout.tsx');
  const wearable = read('utils/wearableImportService.ts');
  const healthUi = read('app/health-permissions.tsx');

  assert(/AppState\.addEventListener\(/.test(rootLayout), 'Root layout must listen for AppState active to trigger auto sync', failures);
  assert(/syncWearableSignalsIfEnabled\(/.test(rootLayout), 'Root layout must call syncWearableSignalsIfEnabled(...) on open/foreground', failures);

  assert(!/requestHealthPermissions/.test(wearable), 'wearableImportService must not call requestHealthPermissions (no silent prompts)', failures);
  assert(/getTodaySignalsAuthorizationState/.test(wearable), 'wearableImportService must gate on getTodaySignalsAuthorizationState', failures);
  assert(/LAST_SUCCESSFUL_HEALTH_SYNC_AT_KEY/.test(wearable), 'wearableImportService must persist lastSuccessfulHealthSyncAt key', failures);

  assert(/Open Health Settings/.test(healthUi), 'Connect screen must include "Open Health Settings" CTA', failures);
  assert(!/Permission not granted/.test(healthUi), 'Connect screen must not show a dead-end permission modal copy', failures);

  if (failures.length > 0) {
    console.error('Health auto-sync verification failed.\n');
    failures.forEach((f) => console.error(`- ${f}`));
    process.exit(1);
  }

  console.log('Health auto-sync verification passed.');
  console.log('- Foreground + open triggers present');
  console.log('- Auto sync gated on authorization + staleness');
  console.log('- Permission UX uses Settings CTA (no dead-end modal copy)');
}

main();

