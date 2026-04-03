#!/usr/bin/env node
/* eslint-disable no-console */

const {
  loadDefinition,
  writeScenarioReports,
  runScript,
  readJson,
  findCheck,
  phase30,
} = require('./scenario-lib');

const {
  baseConfig,
  ensureFixtureUser,
  signInWithPassword,
  callFunction,
} = phase30;

const REGULAR_USER = {
  email: 'phase31_regular@zenithfit.app',
  password: 'Phase31!Regular#2026',
  displayName: 'Phase 31 Regular',
  username: 'phase31_regular',
};

async function main() {
  const definition = loadDefinition('consent_e2e.json');
  const config = baseConfig();

  await ensureFixtureUser(config, {
    email: REGULAR_USER.email,
    password: REGULAR_USER.password,
    displayName: REGULAR_USER.displayName,
    username: REGULAR_USER.username,
    userMetadata: { role: 'user', phase31_fixture: true },
    appMetadata: { phase31_fixture: true },
  });

  const session = await signInWithPassword(config, REGULAR_USER.email, REGULAR_USER.password);

  const e2eRun = runScript('scripts/phase31-e2e-check.js');
  const e2e = readJson('docs/qa/phase31/e2e_report.json');

  const consentCheck = findCheck(e2e, 'E31-005');
  const retentionCheck = findCheck(e2e, 'E31-006');

  const consentRead = await callFunction(config, {
    name: 'privacy-consent',
    method: 'GET',
    apiKey: config.anonKey,
    bearerToken: session.accessToken,
  });

  const notificationsEnabled = Boolean(consentRead.body?.consent?.notifications);
  const consentGatedActions = consentCheck?.result === 'PASS';
  const retentionEnforced = retentionCheck?.result === 'PASS';

  const hardGate = e2eRun.ok && consentGatedActions && retentionEnforced;

  const { jsonTarget, mdTarget } = writeScenarioReports(definition, {
    hard_gate_passed: hardGate,
    observed: {
      consent_gated_actions: consentGatedActions,
      retention_enforced: retentionEnforced,
      notifications_enabled: notificationsEnabled,
      consent_check_notes: consentCheck?.notes || '',
      retention_check_notes: retentionCheck?.notes || '',
    },
    notes: `e2e_run=${e2eRun.ok}`,
  });

  console.log(`Scenario ${definition.scenario_id} complete.`);
  console.log(`JSON report: ${jsonTarget}`);
  console.log(`Markdown report: ${mdTarget}`);

  if (!hardGate) {
    throw new Error('scenario_failed:consent_e2e');
  }
}

main().catch((error) => {
  console.error(`Scenario consent e2e failed: ${error.message}`);
  process.exit(1);
});
