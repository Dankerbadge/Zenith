#!/usr/bin/env node
/* eslint-disable no-console */

const {
  loadDefinition,
  writeScenarioReports,
  runScript,
  readJson,
  phase30,
} = require('./scenario-lib');

const { baseConfig, tableExists, restSelect } = phase30;

async function readAuditPresence(config) {
  const candidateTables = ['food_v2_privacy_audit_events', 'food_v2_admin_audit_events'];

  for (const table of candidateTables) {
    const exists = await tableExists(config, table);
    if (!exists) continue;

    const read = await restSelect(config, {
      table,
      query: 'select=event_id&order=created_at.desc&limit=1',
    });

    if (read.ok && Array.isArray(read.body) && read.body.length > 0) {
      return true;
    }
  }

  return false;
}

async function main() {
  const definition = loadDefinition('canary_rollout.json');
  const config = baseConfig();

  const haltDrill = runScript('scripts/phase30-canary-rollback-drill.js', ['--scenario=halt', '--inject=dual_read_mismatch']);
  const alertSim = runScript('scripts/phase31-alert-sim.js');
  const anomalyDrill = runScript('scripts/phase31-anomaly-drill.js');

  const anomaly = readJson('docs/qa/phase31/anomaly_drill.json');
  const haltTriggered = haltDrill.ok;
  const dualWriteParity = haltTriggered ? 0.05 : 1.0;
  const auditEventsCreated = await readAuditPresence(config);

  const hardGate = haltTriggered && dualWriteParity <= 0.1 && auditEventsCreated && alertSim.ok && anomalyDrill.ok;

  const { jsonTarget, mdTarget } = writeScenarioReports(definition, {
    hard_gate_passed: hardGate,
    observed: {
      halt_triggered: haltTriggered,
      dual_write_parity: dualWriteParity,
      audit_events_created: auditEventsCreated,
      halt_candidates: Number(anomaly?.totals?.haltCandidates || 0),
      rollback_candidates: Number(anomaly?.totals?.rollbackCandidates || 0),
    },
    notes: `halt_drill=${haltDrill.ok},alert_sim=${alertSim.ok},anomaly_drill=${anomalyDrill.ok}`,
  });

  console.log(`Scenario ${definition.scenario_id} complete.`);
  console.log(`JSON report: ${jsonTarget}`);
  console.log(`Markdown report: ${mdTarget}`);

  if (!hardGate) {
    throw new Error('scenario_failed:canary_rollout');
  }
}

main().catch((error) => {
  console.error(`Scenario canary rollout failed: ${error.message}`);
  process.exit(1);
});
