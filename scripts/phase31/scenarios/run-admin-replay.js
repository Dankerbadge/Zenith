#!/usr/bin/env node
/* eslint-disable no-console */

const {
  loadDefinition,
  writeScenarioReports,
  runScriptWithEnvFallback,
  executionDisposition,
  readJson,
  findCheck,
} = require('./scenario-lib');

async function main() {
  const definition = loadDefinition('admin_replay.json');

  const remediationRun = runScriptWithEnvFallback('scripts/phase31-remediation.js');
  const e2eRun = runScriptWithEnvFallback('scripts/phase31-e2e-check.js');

  const remediation = readJson('docs/qa/phase31/remediation_logs.json');
  const e2e = readJson('docs/qa/phase31/e2e_report.json');

  const replayCheck = findCheck(e2e, 'E31-007');
  const replayIdempotent = replayCheck?.result === 'PASS';
  const remediationOk = Boolean(remediation?.ok);
  const auditEventsCreated = Array.isArray(remediation?.results) && remediation.results.length > 0;
  const rerunsUsable =
    (remediationRun.ok || remediationRun.skippedForMissingEnv) &&
    (e2eRun.ok || e2eRun.skippedForMissingEnv);

  const hardGate = rerunsUsable && remediationOk && replayIdempotent;

  const { jsonTarget, mdTarget } = writeScenarioReports(definition, {
    hard_gate_passed: hardGate,
    observed: {
      replay_idempotent: replayIdempotent,
      remediation_ok: remediationOk,
      remediation_results: Number(remediation?.results?.length || 0),
      audit_events_created: auditEventsCreated,
      replay_check_notes: replayCheck?.notes || '',
    },
    notes: `remediation_run=${executionDisposition(remediationRun)},e2e_run=${executionDisposition(e2eRun)}`,
  });

  console.log(`Scenario ${definition.scenario_id} complete.`);
  console.log(`JSON report: ${jsonTarget}`);
  console.log(`Markdown report: ${mdTarget}`);

  if (!hardGate) {
    throw new Error('scenario_failed:admin_replay');
  }
}

main().catch((error) => {
  console.error(`Scenario admin replay failed: ${error.message}`);
  process.exit(1);
});
