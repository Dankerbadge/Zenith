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
  tableExists,
  restSelect,
} = phase30;

async function auditEventPresence(config) {
  const table = 'food_v2_privacy_audit_events';
  const exists = await tableExists(config, table);
  if (!exists) return false;

  const read = await restSelect(config, {
    table,
    query: 'select=event_id&order=created_at.desc&limit=1',
  });
  return read.ok && Array.isArray(read.body) && read.body.length > 0;
}

async function main() {
  const definition = loadDefinition('export_import.json');
  const config = baseConfig();

  const e2eRun = runScript('scripts/phase31-e2e-check.js');
  const e2e = readJson('docs/qa/phase31/e2e_report.json');

  const exportImportCheck = findCheck(e2e, 'E31-004');
  const exportSnapshotComplete = exportImportCheck?.result === 'PASS';
  const importRestoreSuccess = exportImportCheck?.result === 'PASS';
  const auditEventsCreated = await auditEventPresence(config);

  const hardGate = e2eRun.ok && exportSnapshotComplete && importRestoreSuccess;

  const { jsonTarget, mdTarget } = writeScenarioReports(definition, {
    hard_gate_passed: hardGate,
    observed: {
      export_snapshot_complete: exportSnapshotComplete,
      import_restore_success: importRestoreSuccess,
      audit_events_created: auditEventsCreated,
      export_import_notes: exportImportCheck?.notes || '',
    },
    notes: `e2e_run=${e2eRun.ok}`,
  });

  console.log(`Scenario ${definition.scenario_id} complete.`);
  console.log(`JSON report: ${jsonTarget}`);
  console.log(`Markdown report: ${mdTarget}`);

  if (!hardGate) {
    throw new Error('scenario_failed:export_import');
  }
}

main().catch((error) => {
  console.error(`Scenario export/import failed: ${error.message}`);
  process.exit(1);
});
