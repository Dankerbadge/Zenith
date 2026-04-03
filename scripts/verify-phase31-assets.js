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

function mustInclude(source, token, label) {
  if (!source.includes(token)) {
    throw new Error(`Missing ${label}: ${token}`);
  }
}

function main() {
  const pkg = read('package.json');
  mustInclude(pkg, '"phase31:fixtures"', 'phase31 fixtures npm script');
  mustInclude(pkg, '"phase31:check-slos"', 'phase31 slo check npm script');
  mustInclude(pkg, '"phase31:alert-sim"', 'phase31 alert sim npm script');
  mustInclude(pkg, '"phase31:anomaly-drill"', 'phase31 anomaly drill npm script');
  mustInclude(pkg, '"phase31:remediation"', 'phase31 remediation npm script');
  mustInclude(pkg, '"phase31:oncall"', 'phase31 oncall npm script');
  mustInclude(pkg, '"phase31:e2e"', 'phase31 e2e npm script');
  mustInclude(pkg, '"phase31:hard-gates"', 'phase31 hard gates npm script');
  mustInclude(pkg, '"phase31:scenario:canary"', 'phase31 scenario canary npm script');
  mustInclude(pkg, '"phase31:scenario:rollback"', 'phase31 scenario rollback npm script');
  mustInclude(pkg, '"phase31:scenario:sync-e2e"', 'phase31 scenario sync e2e npm script');
  mustInclude(pkg, '"phase31:scenario:goal-e2e"', 'phase31 scenario goal e2e npm script');
  mustInclude(pkg, '"phase31:scenario:discovery-e2e"', 'phase31 scenario discovery e2e npm script');
  mustInclude(pkg, '"phase31:scenario:export-import"', 'phase31 scenario export import npm script');
  mustInclude(pkg, '"phase31:scenario:delete-account"', 'phase31 scenario delete account npm script');
  mustInclude(pkg, '"phase31:scenario:consent-e2e"', 'phase31 scenario consent e2e npm script');
  mustInclude(pkg, '"phase31:scenario:admin-replay"', 'phase31 scenario admin replay npm script');
  mustInclude(pkg, '"phase31:scenario:anomaly"', 'phase31 scenario anomaly npm script');
  mustInclude(pkg, '"phase31:scenario:all"', 'phase31 scenario all npm script');
  mustInclude(pkg, '"verify:phase31"', 'phase31 aggregate npm script');

  const schema = read('scripts/phase31-fixtures/phase31-fixtures-schema.sql');
  mustInclude(schema, 'food_v2_slo_metrics', 'phase31 slo metrics table');
  mustInclude(schema, 'food_v2_alert_events', 'phase31 alert events table');
  mustInclude(schema, 'food_v2_remediation_jobs', 'phase31 remediation jobs table');
  mustInclude(schema, 'food_v2_oncall_shifts', 'phase31 oncall shifts table');
  mustInclude(schema, 'food_v2_incident_reports', 'phase31 incident reports table');

  const seed = read('scripts/phase31-fixtures/phase31-fixtures-seed.json');
  mustInclude(seed, '"slo_metrics"', 'phase31 seed slo metrics');
  mustInclude(seed, '"alert_events"', 'phase31 seed alert events');
  mustInclude(seed, '"oncall_shifts"', 'phase31 seed oncall shifts');

  const hardGates = read('scripts/phase31-hard-gates.js');
  mustInclude(hardGates, 'slo_compliance', 'hard gate slo compliance');
  mustInclude(hardGates, 'privacy_consent_enforcement', 'hard gate privacy consent');
  mustInclude(hardGates, 'offline_online_sync', 'hard gate offline online sync');
  mustInclude(hardGates, 'hard_gates_summary.json', 'scenario hard gate summary output');

  const e2e = read('scripts/phase31-e2e-check.js');
  mustInclude(e2e, 'E31-001', 'phase31 e2e check E31-001');
  mustInclude(e2e, 'E31-008', 'phase31 e2e check E31-008');

  const scenarioLib = read('scripts/phase31/scenarios/scenario-lib.js');
  mustInclude(scenarioLib, 'writeScenarioReports', 'scenario report writer');

  const scenarioCanaryDefinition = read('scripts/phase31/scenarios/definitions/canary_rollout.json');
  mustInclude(scenarioCanaryDefinition, '"scenario_id": "S31-001"', 'scenario canary id');

  const scenarioDelete = read('scripts/phase31/scenarios/run-delete-account.js');
  mustInclude(scenarioDelete, 'delete-me', 'scenario delete account flow');

  const scenarioAnomaly = read('scripts/phase31/scenarios/run-anomaly-drill.js');
  mustInclude(scenarioAnomaly, 'remediation_triggered', 'scenario anomaly remediation observation');

  const playbook = read('docs/qa/phase31/PHASE31_PRODUCTION_OPS_PLAYBOOK.md');
  mustInclude(playbook, 'Hard Release Gates', 'phase31 playbook hard gates section');
  mustInclude(playbook, 'Output Artifacts', 'phase31 playbook outputs section');

  console.log('Phase 31 asset verification passed.');
}

main();
