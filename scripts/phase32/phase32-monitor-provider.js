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
} = require('./phase32-lib');

async function main() {
  const args = parseArgs();
  const strict = Boolean(args.strict);
  const hardGates = loadPhase31HardGates();

  const inferredFreshHours = hardGates?.ok === true ? 6 : hardGates ? 48 : null;

  const metricInputs = [
    {
      key: 'provider_freshness_usda',
      label: 'USDA Freshness (hours stale)',
      type: 'max',
      target: THRESHOLDS.providerFreshnessMaxHours,
      owner: OWNERS.provider_freshness,
      envKey: 'PHASE32_PROVIDER_USDA_HOURS_STALE',
      inferredValue: inferredFreshHours,
      inferredSource: 'phase31_hard_gates_overall',
      syntheticValue: 6,
    },
    {
      key: 'provider_freshness_off',
      label: 'OFF Freshness (hours stale)',
      type: 'max',
      target: THRESHOLDS.providerFreshnessMaxHours,
      owner: OWNERS.provider_freshness,
      envKey: 'PHASE32_PROVIDER_OFF_HOURS_STALE',
      inferredValue: inferredFreshHours,
      inferredSource: 'phase31_hard_gates_overall',
      syntheticValue: 8,
    },
    {
      key: 'provider_freshness_restaurant',
      label: 'Restaurant Freshness (hours stale)',
      type: 'max',
      target: THRESHOLDS.providerFreshnessMaxHours,
      owner: OWNERS.provider_freshness,
      envKey: 'PHASE32_PROVIDER_RESTAURANT_HOURS_STALE',
      inferredValue: inferredFreshHours,
      inferredSource: 'phase31_hard_gates_overall',
      syntheticValue: 10,
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
      operator: '<=',
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

  const jsonPath = writeJsonReport('provider_monitor.json', report);
  const mdRows = report.metrics.map((metric) => ({
    Provider: metric.label,
    Value: metric.value,
    Target: `${metric.operator} ${metric.target}h`,
    Result: metric.pass ? 'PASS' : 'FAIL',
    Source: metric.source,
    Severity: metric.severity,
    Owner: metric.owner,
  }));

  const markdown = [
    '# Phase 32 Provider Freshness Monitor',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Mode: ${report.mode}`,
    `- Overall: ${report.ok ? 'PASS' : 'FAIL'}`,
    `- Failing metrics: ${report.totals.failing}`,
    `- Sev1: ${report.totals.sev1}`,
    `- Sev2: ${report.totals.sev2}`,
    '',
    toMarkdownTable(['Provider', 'Value', 'Target', 'Result', 'Source', 'Severity', 'Owner'], mdRows),
    '',
  ].join('\n');

  const mdPath = writeMarkdownReport('provider_monitor.md', markdown);

  console.log('Phase 32 provider freshness monitor complete.');
  console.log(`JSON report: ${jsonPath}`);
  console.log(`Markdown report: ${mdPath}`);

  if (!report.ok) {
    const keys = failing.map((metric) => metric.key).join(',');
    throw new Error(`phase32_provider_failures:${keys}`);
  }
}

main().catch((error) => {
  console.error(`Phase 32 provider freshness monitor failed: ${error.message}`);
  process.exit(1);
});
