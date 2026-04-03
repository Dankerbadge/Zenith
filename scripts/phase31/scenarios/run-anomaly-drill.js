#!/usr/bin/env node
/* eslint-disable no-console */

const {
  loadDefinition,
  writeScenarioReports,
  runScriptWithEnvFallback,
  executionDisposition,
  readJson,
} = require('./scenario-lib');

async function main() {
  const definition = loadDefinition('anomaly_drill.json');

  const alertRun = runScriptWithEnvFallback('scripts/phase31-alert-sim.js');
  const anomalyRun = runScriptWithEnvFallback('scripts/phase31-anomaly-drill.js');
  const remediationRun = runScriptWithEnvFallback('scripts/phase31-remediation.js');

  const anomaly = readJson('docs/qa/phase31/anomaly_drill.json');
  const remediation = readJson('docs/qa/phase31/remediation_logs.json');

  const anomalyEvidenceOk = Boolean(anomaly?.ok);
  const remediationEvidenceOk = Boolean(remediation?.ok);
  const rerunsUsable =
    (alertRun.ok || alertRun.skippedForMissingEnv) &&
    (anomalyRun.ok || anomalyRun.skippedForMissingEnv) &&
    (remediationRun.ok || remediationRun.skippedForMissingEnv);
  const autoHaltTriggered = Number(anomaly?.totals?.haltCandidates || 0) > 0;
  const remediationTriggered = Number(remediation?.totals?.remediated || 0) + Number(remediation?.totals?.skipped || 0) > 0;
  const auditEventsCreated = Array.isArray(remediation?.results) && remediation.results.length > 0;

  const hardGate = rerunsUsable && anomalyEvidenceOk && remediationEvidenceOk && autoHaltTriggered && remediationTriggered;

  const { jsonTarget, mdTarget } = writeScenarioReports(definition, {
    hard_gate_passed: hardGate,
    observed: {
      auto_halt_triggered: autoHaltTriggered,
      remediation_triggered: remediationTriggered,
      audit_events_created: auditEventsCreated,
      halt_candidates: Number(anomaly?.totals?.haltCandidates || 0),
      rollback_candidates: Number(anomaly?.totals?.rollbackCandidates || 0),
      remediated_count: Number(remediation?.totals?.remediated || 0),
    },
    notes: `alert_run=${executionDisposition(alertRun)},anomaly_run=${executionDisposition(anomalyRun)},remediation_run=${executionDisposition(remediationRun)}`,
  });

  console.log(`Scenario ${definition.scenario_id} complete.`);
  console.log(`JSON report: ${jsonTarget}`);
  console.log(`Markdown report: ${mdTarget}`);

  if (!hardGate) {
    throw new Error('scenario_failed:anomaly_drill');
  }
}

main().catch((error) => {
  console.error(`Scenario anomaly drill failed: ${error.message}`);
  process.exit(1);
});
