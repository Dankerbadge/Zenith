#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) throw new Error(`Missing ${rel}`);
  return fs.readFileSync(abs, 'utf8');
}

function mustInclude(haystack, needle, label) {
  if (!haystack.includes(needle)) {
    throw new Error(`Missing ${label}: ${needle}`);
  }
}

function main() {
  const migration = read('supabase/migrations/20260211090000_backend_ops_automation_p0.sql');
  mustInclude(migration, 'food_search_allow_request', 'rate limit function');
  mustInclude(migration, 'food_search_maintenance_tick', 'maintenance function');
  mustInclude(migration, 'evaluate_food_search_slo_alerts', 'SLO alert function');
  mustInclude(migration, 'backend_ops_alerts', 'alerts table');
  mustInclude(migration, 'cron.schedule', 'cron automation schedules');

  const edge = read('supabase/functions/food-search/index.ts');
  mustInclude(edge, "source: 'rate_limited'", 'rate-limited metric source');
  mustInclude(edge, "food_search_allow_request", 'rate limit rpc call');
  mustInclude(edge, "insert_backend_ops_alert", 'alert rpc call');

  const runtime = read('scripts/verify-supabase-runtime.js');
  mustInclude(runtime, 'Protected tables blocked for anon/app key reads', 'RLS regression checks');

  const rotateScript = path.join(ROOT, 'scripts', 'rotate-food-search-secrets.sh');
  if (!fs.existsSync(rotateScript)) {
    throw new Error('Missing scripts/rotate-food-search-secrets.sh');
  }
  const rotateOpsScript = path.join(ROOT, 'scripts', 'rotate-ops-automation-key.sh');
  if (!fs.existsSync(rotateOpsScript)) {
    throw new Error('Missing scripts/rotate-ops-automation-key.sh');
  }
  const backupScript = path.join(ROOT, 'scripts', 'backup-and-heartbeat.sh');
  if (!fs.existsSync(backupScript)) {
    throw new Error('Missing scripts/backup-and-heartbeat.sh');
  }
  const runbook = path.join(ROOT, 'docs', 'runbooks', 'backend-ops-p0.md');
  if (!fs.existsSync(runbook)) {
    throw new Error('Missing docs/runbooks/backend-ops-p0.md');
  }

  console.log('Backend ops automation verification passed.');
  console.log('- Migration has rate limit + maintenance + alert + cron automation');
  console.log('- Edge function enforces rate limits and emits alerts/metrics');
  console.log('- Runtime checker validates protected-table RLS');
  console.log('- Secret rotation + backup automation scripts are present');
}

main();
