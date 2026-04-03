#!/usr/bin/env node
/* eslint-disable no-console */

const {
  loadDefinition,
  writeScenarioReports,
  runScriptWithEnvFallback,
  executionDisposition,
  readJson,
  findCheck,
  percentFromParityCheck,
} = require('./scenario-lib');

async function main() {
  const definition = loadDefinition('sync_e2e.json');

  const e2eRun = runScriptWithEnvFallback('scripts/phase31-e2e-check.js');
  const e2e = readJson('docs/qa/phase31/e2e_report.json');

  const syncCheck = findCheck(e2e, 'E31-001');
  const parityCheck = findCheck(e2e, 'E31-009') || findCheck(e2e, 'E31-007');

  const e2eEvidenceOk = Boolean(e2e?.ok);
  const e2eRunUsable = e2eRun.ok || e2eRun.skippedForMissingEnv;
  const logsSynced = syncCheck?.result === 'PASS';
  const dualWriteParity = percentFromParityCheck(parityCheck);
  const hardGate = e2eRunUsable && e2eEvidenceOk && logsSynced && dualWriteParity <= 0.1;

  const { jsonTarget, mdTarget } = writeScenarioReports(definition, {
    hard_gate_passed: hardGate,
    observed: {
      logs_synced: logsSynced,
      dual_write_parity: dualWriteParity,
      sync_check_notes: syncCheck?.notes || '',
      parity_check_notes: parityCheck?.notes || '',
    },
    notes: `e2e_run=${executionDisposition(e2eRun)}`,
  });

  console.log(`Scenario ${definition.scenario_id} complete.`);
  console.log(`JSON report: ${jsonTarget}`);
  console.log(`Markdown report: ${mdTarget}`);

  if (!hardGate) {
    throw new Error('scenario_failed:sync_e2e');
  }
}

main().catch((error) => {
  console.error(`Scenario sync e2e failed: ${error.message}`);
  process.exit(1);
});
