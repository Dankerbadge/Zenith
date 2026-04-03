#!/usr/bin/env node
/* eslint-disable no-console */

const {
  loadDefinition,
  writeScenarioReports,
  runScript,
  phase30,
} = require('./scenario-lib');

const {
  baseConfig,
  ensureFixtureUser,
  signInWithPassword,
  restSelect,
  tableExists,
} = phase30;

const ROLLBACK_USER = {
  email: 'phase31_regular@zenithfit.app',
  password: 'Phase31!Regular#2026',
  displayName: 'Phase 31 Regular',
  username: 'phase31_regular',
};

async function rowCountForUser(config, userId) {
  const read = await restSelect(config, {
    table: 'nutrition_daily',
    query: `select=day&user_id=eq.${encodeURIComponent(userId)}&limit=500`,
  });
  return read.ok && Array.isArray(read.body) ? read.body.length : 0;
}

async function readAuditPresence(config) {
  const exists = await tableExists(config, 'food_v2_privacy_audit_events');
  if (!exists) return false;
  const read = await restSelect(config, {
    table: 'food_v2_privacy_audit_events',
    query: 'select=event_id&order=created_at.desc&limit=1',
  });
  return read.ok && Array.isArray(read.body) && read.body.length > 0;
}

async function main() {
  const definition = loadDefinition('rollback_drill.json');
  const config = baseConfig();

  const ensured = await ensureFixtureUser(config, {
    email: ROLLBACK_USER.email,
    password: ROLLBACK_USER.password,
    displayName: ROLLBACK_USER.displayName,
    username: ROLLBACK_USER.username,
    userMetadata: { role: 'user', phase31_fixture: true },
    appMetadata: { phase31_fixture: true },
  });

  await signInWithPassword(config, ROLLBACK_USER.email, ROLLBACK_USER.password);

  const beforeCount = await rowCountForUser(config, ensured.userId);
  const rollbackDrill = runScript('scripts/phase30-canary-rollback-drill.js', ['--scenario=rollback', '--inject=sync_failures']);
  const afterCount = await rowCountForUser(config, ensured.userId);

  const stateRestored = rollbackDrill.ok && beforeCount === afterCount;
  const offlineLogsIntact = beforeCount === afterCount;
  const auditEventsCreated = await readAuditPresence(config);

  const hardGate = rollbackDrill.ok && stateRestored && offlineLogsIntact;

  const { jsonTarget, mdTarget } = writeScenarioReports(definition, {
    hard_gate_passed: hardGate,
    observed: {
      rollback_triggered: rollbackDrill.ok,
      state_restored: stateRestored,
      offline_logs_intact: offlineLogsIntact,
      before_count: beforeCount,
      after_count: afterCount,
      audit_events_created: auditEventsCreated,
    },
    notes: rollbackDrill.ok ? 'rollback drill passed' : `rollback drill failed: ${rollbackDrill.stderr || rollbackDrill.stdout}`,
  });

  console.log(`Scenario ${definition.scenario_id} complete.`);
  console.log(`JSON report: ${jsonTarget}`);
  console.log(`Markdown report: ${mdTarget}`);

  if (!hardGate) {
    throw new Error('scenario_failed:rollback_drill');
  }
}

main().catch((error) => {
  console.error(`Scenario rollback drill failed: ${error.message}`);
  process.exit(1);
});
