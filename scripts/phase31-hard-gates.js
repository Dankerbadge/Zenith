#!/usr/bin/env node
/* eslint-disable no-console */

const path = require('path');
const fs = require('fs');
const {
  ROOT,
  runNodeScript,
  readReport,
  writeJsonReport,
  writeMarkdownReport,
  toMarkdownTable,
  nowIso,
  HARD_GATES,
} = require('./phase31-lib');

const SCENARIO_DEFS = [
  { id: 'S31-001', key: 'canary', title: 'Canary Rollout 1%-10%', report: 'docs/qa/phase31/scenarios/canary_rollout_001.json', script: 'scripts/phase31/scenarios/run-canary-rollout.js' },
  { id: 'S31-002', key: 'rollback', title: 'Rollback Drill', report: 'docs/qa/phase31/scenarios/rollback_drill_001.json', script: 'scripts/phase31/scenarios/run-rollback-drill.js' },
  { id: 'S31-003', key: 'sync_e2e', title: 'Offline -> Online Sync E2E', report: 'docs/qa/phase31/scenarios/sync_e2e_001.json', script: 'scripts/phase31/scenarios/run-sync-e2e.js' },
  { id: 'S31-004', key: 'goal_e2e', title: 'Goal-Aware Logging', report: 'docs/qa/phase31/scenarios/goal_e2e_001.json', script: 'scripts/phase31/scenarios/run-goal-e2e.js' },
  { id: 'S31-005', key: 'discovery_e2e', title: 'Discovery / Usual Foods', report: 'docs/qa/phase31/scenarios/discovery_e2e_001.json', script: 'scripts/phase31/scenarios/run-discovery-e2e.js' },
  { id: 'S31-006', key: 'export_import', title: 'Export / Import', report: 'docs/qa/phase31/scenarios/export_import_001.json', script: 'scripts/phase31/scenarios/run-export-import.js' },
  { id: 'S31-007', key: 'delete_account', title: 'Account Deletion', report: 'docs/qa/phase31/scenarios/delete_account_001.json', script: 'scripts/phase31/scenarios/run-delete-account.js' },
  { id: 'S31-008', key: 'consent_e2e', title: 'Privacy / Consent Enforcement', report: 'docs/qa/phase31/scenarios/consent_e2e_001.json', script: 'scripts/phase31/scenarios/run-consent-e2e.js' },
  { id: 'S31-009', key: 'admin_replay', title: 'Admin Replay / Repair', report: 'docs/qa/phase31/scenarios/admin_replay_001.json', script: 'scripts/phase31/scenarios/run-admin-replay.js' },
  { id: 'S31-010', key: 'anomaly', title: 'Anomaly Injection', report: 'docs/qa/phase31/scenarios/anomaly_drill_001.json', script: 'scripts/phase31/scenarios/run-anomaly-drill.js' },
];

function mapChecksById(checks) {
  const out = {};
  for (const check of Array.isArray(checks) ? checks : []) {
    out[check.id] = check;
  }
  return out;
}

function gateResult(key, title, pass, notes) {
  return {
    gateKey: key,
    title,
    pass: Boolean(pass),
    notes: String(notes || ''),
  };
}

function run(scriptRelPath, args = []) {
  const abs = path.join(ROOT, scriptRelPath);
  return runNodeScript(abs, args);
}

function safeReadReport(name) {
  try {
    return readReport(name);
  } catch {
    return null;
  }
}

function safeReadAbsoluteJson(relativePath) {
  try {
    const abs = path.join(ROOT, relativePath);
    if (!fs.existsSync(abs)) return null;
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  const executions = [];

  const preRuns = [
    { key: 'phase31_check_slos', script: 'scripts/phase31-slo-check.js' },
    { key: 'phase31_alert_sim', script: 'scripts/phase31-alert-sim.js' },
    { key: 'phase31_anomaly_drill', script: 'scripts/phase31-anomaly-drill.js' },
    { key: 'phase31_remediation', script: 'scripts/phase31-remediation.js' },
    { key: 'phase31_e2e', script: 'scripts/phase31-e2e-check.js' },
  ];

  for (const runSpec of preRuns) {
    const res = run(runSpec.script, runSpec.args || []);
    executions.push({
      key: runSpec.key,
      script: runSpec.script,
      args: runSpec.args || [],
      ok: res.ok,
      status: res.status,
      stderr: res.stderr,
      stdout: res.stdout,
    });
  }

  for (const scenario of SCENARIO_DEFS) {
    const res = run(scenario.script);
    executions.push({
      key: `scenario_${scenario.key}`,
      script: scenario.script,
      args: [],
      ok: res.ok,
      status: res.status,
      stderr: res.stderr,
      stdout: res.stdout,
    });
  }

  const slo = safeReadReport('slo_summary.json');
  const e2e = safeReadReport('e2e_report.json');
  const checksById = mapChecksById(e2e?.checks || []);

  const scenarioResults = SCENARIO_DEFS.map((scenario) => {
    const parsed = safeReadAbsoluteJson(scenario.report);
    return {
      ...scenario,
      exists: Boolean(parsed),
      status: parsed?.status || 'missing',
      hard_gate_passed: Boolean(parsed?.hard_gate_passed),
      observed: parsed?.observed || {},
      executed_at: parsed?.executed_at || null,
    };
  });

  const scenarioById = new Map(scenarioResults.map((s) => [s.id, s]));
  const scenarioFailures = scenarioResults.filter((s) => !s.exists || !s.hard_gate_passed);

  const scenarioSummary = {
    ok: scenarioFailures.length === 0,
    createdAt: nowIso(),
    total: scenarioResults.length,
    failed: scenarioFailures.map((s) => ({ id: s.id, key: s.key, status: s.status })),
    scenarios: scenarioResults,
  };

  const scenarioJsonPath = writeJsonReport('scenarios/hard_gates_summary.json', scenarioSummary);
  const scenarioMdRows = scenarioResults.map((s) => ({
    ID: s.id,
    Scenario: s.title,
    Result: s.hard_gate_passed ? 'PASS' : 'FAIL',
    Status: s.status,
    Owner: s.owner,
  }));
  const scenarioMd = [
    '# Phase 31 Scenario Hard Gate Summary',
    '',
    `- Generated: ${scenarioSummary.createdAt}`,
    `- Total scenarios: ${scenarioSummary.total}`,
    `- Failed scenarios: ${scenarioFailures.length}`,
    '',
    toMarkdownTable(['ID', 'Scenario', 'Result', 'Status', 'Owner'], scenarioMdRows),
    '',
  ].join('\n');
  const scenarioMdPath = writeMarkdownReport('scenarios/hard_gates_summary.md', scenarioMd);

  const gates = [
    gateResult(
      'slo_compliance',
      'SLO Compliance',
      Boolean(slo?.ok),
      slo ? `failed=${slo?.totals?.failed || 0}` : 'missing_slo_summary.json'
    ),
    gateResult(
      'dual_path_parity',
      'Dual-Read / Dual-Write Parity',
      scenarioById.get('S31-003')?.hard_gate_passed && scenarioById.get('S31-005')?.hard_gate_passed,
      `sync=${scenarioById.get('S31-003')?.status || 'missing'},discovery=${scenarioById.get('S31-005')?.status || 'missing'}`
    ),
    gateResult(
      'privacy_consent_enforcement',
      'Privacy / Consent Enforcement',
      scenarioById.get('S31-008')?.hard_gate_passed,
      scenarioById.get('S31-008')?.status || 'missing'
    ),
    gateResult(
      'retention_purge',
      'Retention Purge',
      checksById['E31-006']?.result === 'PASS',
      checksById['E31-006'] ? checksById['E31-006'].notes : 'missing_E31-006'
    ),
    gateResult(
      'export_import_success',
      'Export / Import Success',
      scenarioById.get('S31-006')?.hard_gate_passed,
      scenarioById.get('S31-006')?.status || 'missing'
    ),
    gateResult(
      'canary_auto_halt',
      'Canary + Auto-Halt Simulation',
      scenarioById.get('S31-001')?.hard_gate_passed,
      scenarioById.get('S31-001')?.status || 'missing'
    ),
    gateResult(
      'rollback_restore',
      'Rollback Drill',
      scenarioById.get('S31-002')?.hard_gate_passed,
      scenarioById.get('S31-002')?.status || 'missing'
    ),
    gateResult(
      'admin_replay_idempotent',
      'Admin Replay Idempotency',
      scenarioById.get('S31-009')?.hard_gate_passed,
      scenarioById.get('S31-009')?.status || 'missing'
    ),
    gateResult(
      'offline_online_sync',
      'Offline / Online Flow',
      scenarioById.get('S31-003')?.hard_gate_passed,
      scenarioById.get('S31-003')?.status || 'missing'
    ),
  ];

  const unknownGateKeys = HARD_GATES.filter((gateKey) => !gates.find((g) => g.gateKey === gateKey));
  const failed = gates.filter((gate) => !gate.pass);

  const summary = {
    ok: failed.length === 0 && unknownGateKeys.length === 0 && scenarioSummary.ok,
    createdAt: nowIso(),
    gateCount: gates.length,
    unknownGateKeys,
    failed: failed.map((gate) => ({ gateKey: gate.gateKey, notes: gate.notes })),
    gates,
    scenarios: {
      summaryPath: path.relative(ROOT, scenarioJsonPath),
      markdownPath: path.relative(ROOT, scenarioMdPath),
      total: scenarioSummary.total,
      failed: scenarioFailures.length,
    },
    execution: executions.map((item) => ({
      key: item.key,
      script: item.script,
      args: item.args,
      ok: item.ok,
      status: item.status,
      stderr: item.stderr ? item.stderr.slice(0, 500) : '',
    })),
  };

  const jsonPath = writeJsonReport('hard_gates.json', summary);
  const markdownRows = gates.map((gate) => ({
    Gate: gate.title,
    Key: gate.gateKey,
    Result: gate.pass ? 'PASS' : 'FAIL',
    Notes: gate.notes,
  }));

  const md = [
    '# Phase 31 Hard Gate Validation',
    '',
    `- Generated: ${summary.createdAt}`,
    `- Gates evaluated: ${summary.gateCount}`,
    `- Failed gates: ${failed.length}`,
    `- Failed scenarios: ${scenarioFailures.length}`,
    '',
    toMarkdownTable(['Gate', 'Key', 'Result', 'Notes'], markdownRows),
    '',
  ].join('\n');

  const mdPath = writeMarkdownReport('hard_gates.md', md);

  console.log('Phase 31 hard gate validation complete.');
  console.log(`JSON report: ${jsonPath}`);
  console.log(`Markdown report: ${mdPath}`);
  console.log(`Scenario summary JSON: ${scenarioJsonPath}`);
  console.log(`Scenario summary Markdown: ${scenarioMdPath}`);

  if (!summary.ok) {
    throw new Error(`phase31_hard_gate_failures:${failed.map((gate) => gate.gateKey).join(',')}`);
  }
}

main().catch((error) => {
  console.error(`Phase 31 hard gate validation failed: ${error.message}`);
  process.exit(1);
});
