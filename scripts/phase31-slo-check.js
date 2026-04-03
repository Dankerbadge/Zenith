#!/usr/bin/env node
/* eslint-disable no-console */

const {
  phase30,
  evaluateSliMetric,
  asNumber,
  writeJsonReport,
  writeMarkdownReport,
  toMarkdownTable,
  nowIso,
} = require('./phase31-lib');

const { baseConfig, tableExists, restSelect } = phase30;

async function main() {
  const config = baseConfig();
  const exists = await tableExists(config, 'food_v2_slo_metrics');
  if (!exists) {
    throw new Error('food_v2_slo_metrics_missing');
  }

  const read = await restSelect(config, {
    table: 'food_v2_slo_metrics',
    query: 'select=metric_id,critical_path,sli_metric,slo_target,measurement_interval,current_value,updated_at&order=critical_path.asc,sli_metric.asc',
  });

  if (!read.ok) {
    throw new Error(`slo_read_failed:${read.status}:${JSON.stringify(read.body)}`);
  }

  const rows = Array.isArray(read.body) ? read.body : [];
  if (!rows.length) {
    throw new Error('slo_metrics_empty:seed_phase31_fixtures_first');
  }

  const zeroValueMetrics = rows.filter((row) => asNumber(row.current_value, 0) === 0).map((row) => ({
    criticalPath: row.critical_path,
    metric: row.sli_metric,
    interval: row.measurement_interval,
  }));
  const evaluated = rows.map(evaluateSliMetric);
  const failed = evaluated.filter((metric) => !metric.pass || asNumber(metric.currentValue, 0) === 0);

  const summary = {
    ok: failed.length === 0,
    createdAt: nowIso(),
    totals: {
      total: evaluated.length,
      passed: evaluated.length - failed.length,
      failed: failed.length,
    },
    zeroValueMetrics,
    metrics: evaluated.map((metric) => ({
      criticalPath: metric.critical_path,
      sliMetric: metric.sli_metric,
      interval: metric.measurement_interval,
      direction: metric.direction,
      comparator: metric.comparator,
      currentValue: metric.currentValue,
      targetValue: metric.targetValue,
      pass: metric.pass,
      delta: metric.delta,
      updatedAt: metric.updated_at,
    })),
  };

  const jsonPath = writeJsonReport('slo_summary.json', summary);
  const mdRows = summary.metrics.map((metric) => ({
    Path: metric.criticalPath,
    SLI: metric.sliMetric,
    Interval: metric.interval,
    Direction: metric.direction,
    Current: metric.currentValue,
    Target: `${metric.comparator} ${metric.targetValue}`,
    Result: metric.pass ? 'PASS' : 'FAIL',
  }));

  const md = [
    '# Phase 31 SLO Summary',
    '',
    `- Generated: ${summary.createdAt}`,
    `- Total: ${summary.totals.total}`,
    `- Passed: ${summary.totals.passed}`,
    `- Failed: ${summary.totals.failed}`,
    `- Zero-value metrics: ${summary.zeroValueMetrics.length}`,
    '',
    toMarkdownTable(['Path', 'SLI', 'Interval', 'Direction', 'Current', 'Target', 'Result'], mdRows),
    '',
  ].join('\n');

  const mdPath = writeMarkdownReport('slo_summary.md', md);

  console.log('Phase 31 SLO check complete.');
  console.log(`JSON report: ${jsonPath}`);
  console.log(`Markdown report: ${mdPath}`);

  if (!summary.ok) {
    const ids = failed.map((f) => `${f.critical_path}:${f.sli_metric}`).join(',');
    throw new Error(`slo_failures:${ids}`);
  }
}

main().catch((error) => {
  console.error(`Phase 31 SLO check failed: ${error.message}`);
  process.exit(1);
});
