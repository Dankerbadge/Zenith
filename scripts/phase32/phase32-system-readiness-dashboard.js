#!/usr/bin/env node
/* eslint-disable no-console */

const path = require('path');
const {
  ROOT,
  nowIso,
  parseArgs,
  readJsonIfExists,
  writeJsonReport,
  writeMarkdownReport,
  toMarkdownTable,
} = require('./phase32-lib');

function readPackageScripts() {
  const pkg = readJsonIfExists(path.join(ROOT, 'package.json'));
  return pkg?.scripts || {};
}

function asBool(value) {
  return value === true;
}

function availability(pathRel) {
  const payload = readJsonIfExists(pathRel);
  return {
    path: pathRel,
    present: Boolean(payload),
    payload,
  };
}

function gateRow(key, title, pass, notes, owner) {
  return {
    key,
    title,
    pass: asBool(pass),
    notes: String(notes || ''),
    owner: String(owner || 'Unassigned'),
  };
}

function summarizeOwners(foodAudit, phase32Ci) {
  const map = new Map();

  const fromAudit = Array.isArray(foodAudit?.ownerSummary) ? foodAudit.ownerSummary : [];
  for (const row of fromAudit) {
    const owner = String(row.owner || 'Unassigned');
    const count = Number(row.count || 0);
    map.set(owner, (map.get(owner) || 0) + count);
  }

  const failedGates = Array.isArray(phase32Ci?.gates)
    ? phase32Ci.gates.filter((gate) => gate?.pass === false)
    : [];
  for (const gate of failedGates) {
    const owner = String(gate.owner || 'Unassigned');
    map.set(owner, (map.get(owner) || 0) + 1);
  }

  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([owner, count]) => ({ owner, count }));
}

function main() {
  const args = parseArgs();
  const enforce = process.argv.slice(2).includes('--enforce') || args.strict;

  const artifacts = {
    foodSystemAudit: availability('docs/qa/FOOD_SYSTEM_PROD_AUDIT.json'),
    foodAuditGate: availability('docs/qa/food_audit_gate_report.json'),
    phase31HardGates: availability('docs/qa/phase31/hard_gates.json'),
    phase32CiGate: availability('docs/qa/phase32/ci_gate_summary.json'),
    phase32DailyOps: availability('docs/qa/phase32/daily_ops_summary.json'),
    phase32WeeklyTrends: availability('docs/qa/phase32/weekly_reliability_trends.json'),
  };

  const scripts = readPackageScripts();
  const shipLock = String(scripts['verify:ship-lock'] || '');

  const foodAuditGate = artifacts.foodAuditGate.payload;
  const phase31HardGates = artifacts.phase31HardGates.payload;
  const phase32CiGate = artifacts.phase32CiGate.payload;
  const systemAudit = artifacts.foodSystemAudit.payload;

  const gates = [
    gateRow(
      'food_audit_high_critical_clear',
      'Food Audit High-Critical Clear',
      foodAuditGate?.ok,
      foodAuditGate
        ? `high_blockers=${foodAuditGate?.totals?.highCriticalBlockers || 0}`
        : 'missing_food_audit_gate_report',
      'Release Eng'
    ),
    gateRow(
      'phase31_hard_gates',
      'Phase 31 Hard Gates',
      phase31HardGates?.ok,
      phase31HardGates
        ? `failed=${Array.isArray(phase31HardGates.failed) ? phase31HardGates.failed.length : 0}`
        : 'missing_phase31_hard_gates',
      'SRE'
    ),
    gateRow(
      'phase32_ci_gate',
      'Phase 32 CI Gate',
      phase32CiGate?.ok,
      phase32CiGate
        ? `failed=${phase32CiGate?.failedCount || 0}`
        : 'missing_phase32_ci_gate_summary',
      'QA / DevOps'
    ),
    gateRow(
      'ship_lock_contains_food_audit_gate',
      'Ship Lock Includes Food Audit Gate',
      shipLock.includes('verify:food-audit-gates'),
      shipLock.includes('verify:food-audit-gates') ? 'present' : 'missing_verify:food-audit-gates_in_verify:ship-lock',
      'Release Eng'
    ),
    gateRow(
      'phase32_scripts_wired',
      'Phase 32 Script Wiring',
      ['phase32:check-parity', 'phase32:check-provider', 'phase32:drill', 'phase32:remediate', 'phase32:report', 'phase32:ci-gate', 'verify:phase32']
        .every((key) => typeof scripts[key] === 'string' && scripts[key].length > 0),
      'phase32 npm scripts present',
      'Release Eng'
    ),
  ];

  const failedGates = gates.filter((gate) => !gate.pass);

  const blockers = [];
  if (Array.isArray(foodAuditGate?.highCriticalBlockers)) {
    for (const blocker of foodAuditGate.highCriticalBlockers) {
      blockers.push({
        source: 'food_audit_gate',
        key: blocker.name,
        owner: blocker.owner,
        notes: `${blocker.sectionKey}:${blocker.status}`,
      });
    }
  }

  if (Array.isArray(phase32CiGate?.failed)) {
    for (const gate of phase32CiGate.failed) {
      blockers.push({
        source: 'phase32_ci_gate',
        key: gate.key,
        owner: 'See gate owner mapping',
        notes: gate.notes,
      });
    }
  }

  const ownerSummary = summarizeOwners(foodAuditGate, phase32CiGate);

  const artifactRows = Object.values(artifacts).map((entry) => ({
    artifact: entry.path,
    present: entry.present,
  }));

  const summary = {
    generatedAt: nowIso(),
    scope: 'Phases 19-32',
    enforceMode: enforce,
    releaseReady: failedGates.length === 0,
    gateCount: gates.length,
    failedGateCount: failedGates.length,
    gates,
    auditSummary: systemAudit?.summary || {},
    ownerSummary,
    blockers,
    artifacts: artifactRows,
  };

  const jsonPath = writeJsonReport('PHASE19_32_SYSTEM_READINESS_DASHBOARD.json', summary);

  const gateRows = gates.map((gate) => ({
    Gate: gate.title,
    Key: gate.key,
    Result: gate.pass ? 'PASS' : 'FAIL',
    Notes: gate.notes,
    Owner: gate.owner,
  }));

  const ownerRows = ownerSummary.map((row) => ({ Owner: row.owner, OpenItems: row.count }));
  const blockerRows = blockers.map((row) => ({ Source: row.source, Blocker: row.key, Owner: row.owner, Notes: row.notes }));
  const artifactMdRows = artifactRows.map((row) => ({ Artifact: row.artifact, Present: row.present ? 'yes' : 'no' }));

  const markdown = [
    '# Phase 19-32 System Readiness Dashboard',
    '',
    `- Generated: ${summary.generatedAt}`,
    `- Scope: ${summary.scope}`,
    `- Release Ready: ${summary.releaseReady ? 'YES' : 'NO'}`,
    `- Failed Gates: ${summary.failedGateCount}`,
    '',
    '## Gate Status',
    '',
    toMarkdownTable(['Gate', 'Key', 'Result', 'Notes', 'Owner'], gateRows),
    '',
    '## Owner Workload',
    '',
    ownerRows.length ? toMarkdownTable(['Owner', 'OpenItems'], ownerRows) : 'No open ownership items.',
    '',
    '## Blockers',
    '',
    blockerRows.length
      ? toMarkdownTable(['Source', 'Blocker', 'Owner', 'Notes'], blockerRows)
      : 'No blockers detected.',
    '',
    '## Artifact Availability',
    '',
    toMarkdownTable(['Artifact', 'Present'], artifactMdRows),
    '',
  ].join('\n');

  const mdPath = writeMarkdownReport('PHASE19_32_SYSTEM_READINESS_DASHBOARD.md', markdown);

  console.log('Phase 19-32 system readiness dashboard generated.');
  console.log(`JSON dashboard: ${jsonPath}`);
  console.log(`Markdown dashboard: ${mdPath}`);

  if (enforce && !summary.releaseReady) {
    const keys = failedGates.map((gate) => gate.key).join(',');
    throw new Error(`phase19_32_dashboard_release_blocked:${keys}`);
  }
}

try {
  main();
} catch (error) {
  console.error(`Phase 19-32 dashboard failed: ${error.message}`);
  process.exit(1);
}
