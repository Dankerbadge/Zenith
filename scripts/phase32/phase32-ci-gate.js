#!/usr/bin/env node
/* eslint-disable no-console */

const {
  nowIso,
  runNodeScript,
  readJsonIfExists,
  writeJsonReport,
  writeMarkdownReport,
  toMarkdownTable,
} = require('./phase32-lib');

function gateResult(key, title, pass, notes, owner) {
  return {
    gateKey: key,
    title,
    pass: Boolean(pass),
    notes: String(notes || ''),
    owner: String(owner || 'Ops'),
  };
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const strict = !rawArgs.includes('--no-strict');
  const runArgs = strict ? ['--strict'] : [];
  const startedAt = Date.now();

  const executions = [
    runNodeScript('scripts/phase31-hard-gates.js', []),
    runNodeScript('scripts/phase32/phase32-monitor-parity.js', runArgs),
    runNodeScript('scripts/phase32/phase32-monitor-provider.js', runArgs),
    runNodeScript('scripts/phase32/phase32-anomaly-drill.js', []),
    runNodeScript('scripts/phase32/phase32-remediation.js', runArgs),
    runNodeScript('scripts/phase32/phase32-report.js', []),
  ];

  const phase31Run = executions[0];
  const parity = readJsonIfExists('docs/qa/phase32/parity_monitor.json');
  const provider = readJsonIfExists('docs/qa/phase32/provider_monitor.json');
  const remediation = readJsonIfExists('docs/qa/phase32/remediation_log.json');
  const foodAuditGate = readJsonIfExists('docs/qa/food_audit_gate_report.json');
  const phase31HardGates = readJsonIfExists('docs/qa/phase31/hard_gates.json');
  const phase31GeneratedAt = Date.parse(String(phase31HardGates?.createdAt || ''));
  const phase31FreshForRun = Number.isFinite(phase31GeneratedAt) && phase31GeneratedAt >= startedAt - 5000;

  const gates = [
    gateResult(
      'parity_monitor',
      'Offline/Online + Dual Path Parity',
      Boolean(parity?.ok),
      parity ? `failing=${parity?.totals?.failing || 0}` : 'missing_parity_report',
      'QA / Sync Eng'
    ),
    gateResult(
      'provider_freshness',
      'Provider Freshness',
      Boolean(provider?.ok),
      provider ? `failing=${provider?.totals?.failing || 0}` : 'missing_provider_report',
      'Data Eng'
    ),
    gateResult(
      'food_audit_high_critical',
      'High-Critical Audit Gaps Cleared',
      Boolean(foodAuditGate?.ok),
      foodAuditGate ? `high_blockers=${foodAuditGate?.totals?.highCriticalBlockers || 0}` : 'missing_food_audit_gate_report',
      'Release Eng'
    ),
    gateResult(
      'phase31_hard_gates',
      'Phase 31 Hard Gates',
      Boolean(phase31Run?.ok) && Boolean(phase31HardGates?.ok) && Boolean(phase31FreshForRun),
      phase31HardGates
        ? `failed=${Array.isArray(phase31HardGates.failed) ? phase31HardGates.failed.length : 0},run_ok=${Boolean(
            phase31Run?.ok
          )},fresh=${Boolean(phase31FreshForRun)}`
        : 'missing_phase31_hard_gates',
      'SRE'
    ),
    gateResult(
      'automated_remediation',
      'Automated Remediation Playbook',
      Boolean(remediation?.ok),
      remediation ? `applied=${remediation?.totals?.applied || 0}` : 'missing_remediation_report',
      'Backend Eng'
    ),
  ];

  const failed = gates.filter((gate) => !gate.pass);
  const summary = {
    ok: failed.length === 0,
    generatedAt: nowIso(),
    mode: strict ? 'strict' : 'standard',
    gateCount: gates.length,
    failedCount: failed.length,
    dependencyChain: {
      phase31InvokedByPhase32: true,
      phase31RunOk: Boolean(phase31Run?.ok),
      phase31ArtifactFreshForRun: Boolean(phase31FreshForRun),
      phase31ArtifactCreatedAt: phase31HardGates?.createdAt || null,
    },
    failed: failed.map((gate) => ({ key: gate.gateKey, notes: gate.notes })),
    gates,
    execution: executions.map((item) => ({
      script: item.script,
      args: item.args,
      ok: item.ok,
      status: item.status,
      stderr: item.stderr ? item.stderr.slice(0, 500) : '',
    })),
  };

  const jsonPath = writeJsonReport('ci_gate_summary.json', summary);
  const mdRows = gates.map((gate) => ({
    Gate: gate.title,
    Key: gate.gateKey,
    Result: gate.pass ? 'PASS' : 'FAIL',
    Notes: gate.notes,
    Owner: gate.owner,
  }));

  const markdown = [
    '# Phase 32 CI Gate Summary',
    '',
    `- Generated: ${summary.generatedAt}`,
    `- Mode: ${summary.mode}`,
    `- Overall: ${summary.ok ? 'PASS' : 'FAIL'}`,
    `- Failed gates: ${summary.failedCount}`,
    '',
    toMarkdownTable(['Gate', 'Key', 'Result', 'Notes', 'Owner'], mdRows),
    '',
  ].join('\n');

  const mdPath = writeMarkdownReport('ci_gate_summary.md', markdown);

  console.log('Phase 32 CI gate complete.');
  console.log(`JSON report: ${jsonPath}`);
  console.log(`Markdown report: ${mdPath}`);

  if (!summary.ok) {
    const ids = failed.map((gate) => gate.gateKey).join(',');
    throw new Error(`phase32_ci_gate_failed:${ids}`);
  }
}

main().catch((error) => {
  console.error(`Phase 32 CI gate failed: ${error.message}`);
  process.exit(1);
});
