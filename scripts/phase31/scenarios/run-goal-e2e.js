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
  const definition = loadDefinition('goal_e2e.json');

  const e2eRun = runScriptWithEnvFallback('scripts/phase31-e2e-check.js');
  const e2e = readJson('docs/qa/phase31/e2e_report.json');

  const goalCheck = findCheck(e2e, 'E31-002');
  const discoveryReflectionCheck = findCheck(e2e, 'E31-003');

  const e2eEvidenceOk = Boolean(e2e?.ok);
  const e2eRunUsable = e2eRun.ok || e2eRun.skippedForMissingEnv;
  const goalTotalsUpdated = goalCheck?.result === 'PASS';
  const goalReflectionInDiscovery = discoveryReflectionCheck?.result === 'PASS';
  const hardGate = e2eRunUsable && e2eEvidenceOk && goalTotalsUpdated && goalReflectionInDiscovery;

  const { jsonTarget, mdTarget } = writeScenarioReports(definition, {
    hard_gate_passed: hardGate,
    observed: {
      goal_totals_updated: goalTotalsUpdated,
      goal_reflection_in_discovery: goalReflectionInDiscovery,
      goal_check_notes: goalCheck?.notes || '',
      discovery_check_notes: discoveryReflectionCheck?.notes || '',
    },
    notes: `e2e_run=${executionDisposition(e2eRun)}`,
  });

  console.log(`Scenario ${definition.scenario_id} complete.`);
  console.log(`JSON report: ${jsonTarget}`);
  console.log(`Markdown report: ${mdTarget}`);

  if (!hardGate) {
    throw new Error('scenario_failed:goal_e2e');
  }
}

main().catch((error) => {
  console.error(`Scenario goal e2e failed: ${error.message}`);
  process.exit(1);
});
