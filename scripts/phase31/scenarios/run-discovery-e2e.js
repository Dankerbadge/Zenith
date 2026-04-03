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
  const definition = loadDefinition('discovery_e2e.json');

  const e2eRun = runScriptWithEnvFallback('scripts/phase31-e2e-check.js');
  const e2e = readJson('docs/qa/phase31/e2e_report.json');

  const e2eEvidenceOk = Boolean(e2e?.ok);
  const e2eRunUsable = e2eRun.ok || e2eRun.skippedForMissingEnv;
  const discoveryCheck = findCheck(e2e, 'E31-003');
  const runtimeCheck = findCheck(e2e, 'E31-008');
  const parityCheck = findCheck(e2e, 'E31-007');

  const topFoodsCorrect = discoveryCheck?.result === 'PASS';
  const runtimeContractOk = runtimeCheck?.result === 'PASS';
  const dualReadParity = percentFromParityCheck(parityCheck);
  const hardGate = e2eRunUsable && e2eEvidenceOk && topFoodsCorrect && runtimeContractOk && dualReadParity <= 0.1;

  const { jsonTarget, mdTarget } = writeScenarioReports(definition, {
    hard_gate_passed: hardGate,
    observed: {
      top_foods_correct: topFoodsCorrect,
      runtime_contract_ok: runtimeContractOk,
      dual_read_parity: dualReadParity,
      discovery_check_notes: discoveryCheck?.notes || '',
      runtime_check_notes: runtimeCheck?.notes || '',
    },
    notes: `e2e_run=${executionDisposition(e2eRun)}`,
  });

  console.log(`Scenario ${definition.scenario_id} complete.`);
  console.log(`JSON report: ${jsonTarget}`);
  console.log(`Markdown report: ${mdTarget}`);

  if (!hardGate) {
    throw new Error('scenario_failed:discovery_e2e');
  }
}

main().catch((error) => {
  console.error(`Scenario discovery e2e failed: ${error.message}`);
  process.exit(1);
});
