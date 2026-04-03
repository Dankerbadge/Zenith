#!/usr/bin/env node
/* eslint-disable no-console */

const path = require('path');
const {
  nowIso,
  DOCS_DIR,
  readJsonIfExists,
  writeJsonReport,
  writeMarkdownReport,
  toMarkdownTable,
} = require('./phase32-lib');

function safeMetricsCount(report) {
  return Array.isArray(report?.metrics) ? report.metrics.length : 0;
}

function safeFailingCount(report) {
  if (report?.totals && Number.isFinite(report.totals.failing)) return Number(report.totals.failing);
  const metrics = Array.isArray(report?.metrics) ? report.metrics : [];
  return metrics.filter((row) => row?.pass === false).length;
}

function loadHistory(historyPath) {
  const existing = readJsonIfExists(historyPath);
  if (!existing || !Array.isArray(existing.history)) {
    return [];
  }
  return existing.history;
}

async function main() {
  const generatedAt = nowIso();

  const parity = readJsonIfExists(path.join(DOCS_DIR, 'parity_monitor.json'));
  const provider = readJsonIfExists(path.join(DOCS_DIR, 'provider_monitor.json'));
  const anomaly = readJsonIfExists(path.join(DOCS_DIR, 'anomaly_drill.json'));
  const remediation = readJsonIfExists(path.join(DOCS_DIR, 'remediation_log.json'));
  const ciGate = readJsonIfExists(path.join(DOCS_DIR, 'ci_gate_summary.json'));

  const daily = {
    generatedAt,
    sources: {
      parityPresent: Boolean(parity),
      providerPresent: Boolean(provider),
      anomalyPresent: Boolean(anomaly),
      remediationPresent: Boolean(remediation),
      ciGatePresent: Boolean(ciGate),
    },
    status: {
      parityOk: Boolean(parity?.ok),
      providerOk: Boolean(provider?.ok),
      remediationOk: Boolean(remediation?.ok),
      ciGateOk: ciGate == null ? null : Boolean(ciGate.ok),
    },
    totals: {
      parityMetrics: safeMetricsCount(parity),
      providerMetrics: safeMetricsCount(provider),
      parityFailing: safeFailingCount(parity),
      providerFailing: safeFailingCount(provider),
      anomalyScenarios: Number(anomaly?.totals?.scenarios || 0),
      anomalySev1: Number(anomaly?.totals?.sev1 || 0),
      anomalySev2: Number(anomaly?.totals?.sev2 || 0),
      remediationActions: Number(remediation?.totals?.actions || 0),
      remediationApplied: Number(remediation?.totals?.applied || 0),
    },
  };

  const ciGateReady = daily.status.ciGateOk !== false;
  daily.ok = daily.status.parityOk && daily.status.providerOk && ciGateReady;

  const dailyJsonPath = writeJsonReport('daily_ops_summary.json', daily);
  const dailyRows = [
    { Metric: 'Parity Monitor', Value: daily.status.parityOk ? 'PASS' : 'FAIL' },
    { Metric: 'Provider Monitor', Value: daily.status.providerOk ? 'PASS' : 'FAIL' },
    { Metric: 'CI Gate', Value: daily.status.ciGateOk == null ? 'N/A' : daily.status.ciGateOk ? 'PASS' : 'FAIL' },
    { Metric: 'Remediation', Value: daily.status.remediationOk ? 'PASS' : 'FAIL' },
    { Metric: 'Parity Failing Metrics', Value: daily.totals.parityFailing },
    { Metric: 'Provider Failing Metrics', Value: daily.totals.providerFailing },
    { Metric: 'Anomaly Sev1', Value: daily.totals.anomalySev1 },
    { Metric: 'Anomaly Sev2', Value: daily.totals.anomalySev2 },
  ];

  const dailyMd = [
    '# Phase 32 Daily Ops Summary',
    '',
    `- Generated: ${generatedAt}`,
    `- Overall: ${daily.ok ? 'PASS' : 'FAIL'}`,
    '',
    toMarkdownTable(['Metric', 'Value'], dailyRows),
    '',
  ].join('\n');
  const dailyMdPath = writeMarkdownReport('daily_ops_summary.md', dailyMd);

  const weeklyPath = path.join(DOCS_DIR, 'weekly_reliability_trends.json');
  const history = loadHistory(weeklyPath);

  const entry = {
    generatedAt,
    parityOk: daily.status.parityOk,
    providerOk: daily.status.providerOk,
    parityFailing: daily.totals.parityFailing,
    providerFailing: daily.totals.providerFailing,
    sev1: daily.totals.anomalySev1,
    sev2: daily.totals.anomalySev2,
    remediationApplied: daily.totals.remediationApplied,
  };

  history.push(entry);
  const trimmed = history.slice(-28);

  const healthyDays = trimmed.filter((row) => row.parityOk && row.providerOk).length;
  const trend = {
    generatedAt,
    summary: {
      samples: trimmed.length,
      healthySamples: healthyDays,
      reliabilityPct: trimmed.length ? Number(((healthyDays / trimmed.length) * 100).toFixed(2)) : 0,
      avgParityFailures: trimmed.length
        ? Number((trimmed.reduce((sum, row) => sum + Number(row.parityFailing || 0), 0) / trimmed.length).toFixed(2))
        : 0,
      avgProviderFailures: trimmed.length
        ? Number((trimmed.reduce((sum, row) => sum + Number(row.providerFailing || 0), 0) / trimmed.length).toFixed(2))
        : 0,
    },
    history: trimmed,
  };

  const weeklyJsonPath = writeJsonReport('weekly_reliability_trends.json', trend);
  const weeklyRows = trimmed.map((row) => ({
    Timestamp: row.generatedAt,
    Parity: row.parityOk ? 'PASS' : 'FAIL',
    Provider: row.providerOk ? 'PASS' : 'FAIL',
    ParityFailing: row.parityFailing,
    ProviderFailing: row.providerFailing,
    Sev1: row.sev1,
    Sev2: row.sev2,
  }));

  const weeklyMd = [
    '# Phase 32 Weekly Reliability Trends',
    '',
    `- Generated: ${generatedAt}`,
    `- Samples: ${trend.summary.samples}`,
    `- Reliability: ${trend.summary.reliabilityPct}%`,
    '',
    weeklyRows.length
      ? toMarkdownTable(['Timestamp', 'Parity', 'Provider', 'ParityFailing', 'ProviderFailing', 'Sev1', 'Sev2'], weeklyRows)
      : 'No trend samples available.',
    '',
  ].join('\n');
  const weeklyMdPath = writeMarkdownReport('weekly_reliability_trends.md', weeklyMd);

  console.log('Phase 32 report generation complete.');
  console.log(`Daily JSON: ${dailyJsonPath}`);
  console.log(`Daily Markdown: ${dailyMdPath}`);
  console.log(`Weekly JSON: ${weeklyJsonPath}`);
  console.log(`Weekly Markdown: ${weeklyMdPath}`);
}

main().catch((error) => {
  console.error(`Phase 32 report failed: ${error.message}`);
  process.exit(1);
});
