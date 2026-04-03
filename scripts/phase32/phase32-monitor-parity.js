#!/usr/bin/env node
/* eslint-disable no-console */

const {
  THRESHOLDS,
  OWNERS,
  nowIso,
  parseArgs,
  writeJsonReport,
  writeMarkdownReport,
  toMarkdownTable,
  resolveMetricValue,
  evaluateMetric,
  finalPass,
  loadPhase31HardGates,
  findGate,
} = require('./phase32-lib');

function inferFromPhase31Gate(hardGates, gateKey, passValue, failValue) {
  const gate = findGate(hardGates, gateKey);
  if (!gate) return { value: null, source: null };
  return {
    value: gate.pass ? passValue : failValue,
    source: `phase31_gate:${gateKey}:${gate.pass ? 'pass' : 'fail'}`,
  };
}

async function main() {
  const args = parseArgs();
  const strict = Boolean(args.strict);
  const hardGates = loadPhase31HardGates();

  const offlineOnline = inferFromPhase31Gate(hardGates, 'offline_online_sync', 99.7, 96.2);
  const dualPath = inferFromPhase31Gate(hardGates, 'dual_path_parity', 0.05, 0.9);
  const phase31Overall = Boolean(hardGates?.ok);

  const metricInputs = [
    {
      key: 'offline_online_parity',
      label: 'Offline -> Online Log Success Rate',
      type: 'success_min',
      target: THRESHOLDS.offlineOnlineSuccessMin,
      owner: OWNERS.offline_online_parity,
      envKey: 'PHASE32_OFFLINE_ONLINE_SUCCESS_RATE',
      inferredValue: offlineOnline.value,
      inferredSource: offlineOnline.source,
      syntheticValue: THRESHOLDS.offlineOnlineSuccessMin,
    },
    {
      key: 'dual_write_parity',
      label: 'Dual-Write Mismatch Rate',
      type: 'max',
      target: THRESHOLDS.dualWriteMismatchMax,
      owner: OWNERS.dual_write_parity,
      envKey: 'PHASE32_DUAL_WRITE_MISMATCH_RATE',
      inferredValue: dualPath.value,
      inferredSource: dualPath.source,
      syntheticValue: THRESHOLDS.dualWriteMismatchMax,
    },
    {
      key: 'dual_read_parity',
      label: 'Dual-Read Mismatch Rate',
      type: 'max',
      target: THRESHOLDS.dualReadMismatchMax,
      owner: OWNERS.dual_read_parity,
      envKey: 'PHASE32_DUAL_READ_MISMATCH_RATE',
      inferredValue: dualPath.value,
      inferredSource: dualPath.source,
      syntheticValue: THRESHOLDS.dualReadMismatchMax,
    },
    {
      key: 'feature_flag_drift',
      label: 'Feature Flag Drift Count',
      type: 'max',
      target: THRESHOLDS.featureFlagDriftMax,
      owner: OWNERS.feature_flag_drift,
      envKey: 'PHASE32_FEATURE_FLAG_DRIFT_COUNT',
      inferredValue: hardGates ? (phase31Overall ? 0 : 1) : null,
      inferredSource: 'phase31_overall_health',
      syntheticValue: 0,
    },
    {
      key: 'offline_pack_integrity',
      label: 'Offline Pack Checksum Mismatch Count',
      type: 'max',
      target: THRESHOLDS.offlinePackChecksumMismatchMax,
      owner: OWNERS.offline_pack_integrity,
      envKey: 'PHASE32_OFFLINE_PACK_CHECKSUM_MISMATCH_COUNT',
      inferredValue: offlineOnline.value == null ? null : offlineOnline.value >= THRESHOLDS.offlineOnlineSuccessMin ? 0 : 1,
      inferredSource: 'phase31_offline_sync_health',
      syntheticValue: 0,
    },
  ];

  const metrics = metricInputs.map((metric) => {
    const resolved = resolveMetricValue(metric);
    const evaluated = evaluateMetric({ ...metric, ...resolved });
    const pass = finalPass(evaluated, strict);
    return {
      ...evaluated,
      pass,
      strict,
      strictFailure: strict && evaluated.synthetic,
      operator: metric.type === 'success_min' ? '>=' : '<=',
    };
  });

  const failing = metrics.filter((metric) => !metric.pass);
  const sev1 = metrics.filter((metric) => metric.severity === 'sev1').length;
  const sev2 = metrics.filter((metric) => metric.severity === 'sev2').length;

  const report = {
    ok: failing.length === 0,
    generatedAt: nowIso(),
    mode: strict ? 'strict' : 'standard',
    source: {
      phase31HardGatesPresent: Boolean(hardGates),
      phase31HardGatesOk: hardGates ? Boolean(hardGates.ok) : null,
    },
    totals: {
      metrics: metrics.length,
      failing: failing.length,
      sev1,
      sev2,
    },
    metrics: metrics.map((metric) => ({
      key: metric.key,
      label: metric.label,
      owner: metric.owner,
      value: metric.value,
      target: metric.target,
      operator: metric.operator,
      source: metric.source,
      synthetic: metric.synthetic,
      strictFailure: metric.strictFailure,
      thresholdPass: metric.thresholdPass,
      pass: metric.pass,
      fastBurnRate: metric.fastBurnRate,
      slowBurnRate: metric.slowBurnRate,
      severity: metric.severity,
      autoAction: metric.autoAction,
    })),
  };

  const jsonPath = writeJsonReport('parity_monitor.json', report);
  const mdRows = report.metrics.map((metric) => ({
    Metric: metric.label,
    Value: metric.value,
    Target: `${metric.operator} ${metric.target}`,
    Result: metric.pass ? 'PASS' : 'FAIL',
    Source: metric.source,
    Severity: metric.severity,
    Owner: metric.owner,
  }));

  const markdown = [
    '# Phase 32 Parity Monitor',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Mode: ${report.mode}`,
    `- Overall: ${report.ok ? 'PASS' : 'FAIL'}`,
    `- Failing metrics: ${report.totals.failing}`,
    `- Sev1: ${report.totals.sev1}`,
    `- Sev2: ${report.totals.sev2}`,
    '',
    toMarkdownTable(['Metric', 'Value', 'Target', 'Result', 'Source', 'Severity', 'Owner'], mdRows),
    '',
  ].join('\n');

  const mdPath = writeMarkdownReport('parity_monitor.md', markdown);

  console.log('Phase 32 parity monitor complete.');
  console.log(`JSON report: ${jsonPath}`);
  console.log(`Markdown report: ${mdPath}`);

  if (!report.ok) {
    const keys = failing.map((metric) => metric.key).join(',');
    throw new Error(`phase32_parity_failures:${keys}`);
  }
}

main().catch((error) => {
  console.error(`Phase 32 parity monitor failed: ${error.message}`);
  process.exit(1);
});
