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
  evaluateMetric,
} = require('./phase32-lib');

const DRILL_SCENARIOS = [
  {
    key: 'dual_write_mismatch_spike',
    label: 'Dual-write mismatch spike',
    metricKey: 'dual_write_parity',
    type: 'max',
    target: THRESHOLDS.dualWriteMismatchMax,
    observed: 1.2,
    owner: OWNERS.dual_write_parity,
  },
  {
    key: 'offline_online_success_drop',
    label: 'Offline -> online parity drop',
    metricKey: 'offline_online_parity',
    type: 'success_min',
    target: THRESHOLDS.offlineOnlineSuccessMin,
    observed: 95.8,
    owner: OWNERS.offline_online_parity,
  },
  {
    key: 'provider_freshness_off_stale',
    label: 'OFF provider stale',
    metricKey: 'provider_freshness_off',
    type: 'max',
    target: THRESHOLDS.providerFreshnessMaxHours,
    observed: 72,
    owner: OWNERS.provider_freshness,
  },
  {
    key: 'offline_pack_checksum_mismatch',
    label: 'Offline pack checksum mismatch',
    metricKey: 'offline_pack_integrity',
    type: 'max',
    target: THRESHOLDS.offlinePackChecksumMismatchMax,
    observed: 3,
    owner: OWNERS.offline_pack_integrity,
  },
];

function chooseScenarios(inject) {
  if (!inject.length) return DRILL_SCENARIOS;
  const wanted = new Set(inject);
  return DRILL_SCENARIOS.filter((scenario) => wanted.has(scenario.key));
}

async function main() {
  const args = parseArgs();
  const selected = chooseScenarios(args.inject);

  if (!selected.length) {
    throw new Error('phase32_anomaly_no_matching_scenarios');
  }

  const anomalies = selected.map((scenario) => {
    const evaluated = evaluateMetric({
      key: scenario.metricKey,
      label: scenario.label,
      type: scenario.type,
      target: scenario.target,
      value: scenario.observed,
      synthetic: true,
      source: 'phase32_anomaly_drill',
    });

    return {
      scenarioKey: scenario.key,
      metricKey: scenario.metricKey,
      label: scenario.label,
      owner: scenario.owner,
      observed: scenario.observed,
      target: scenario.target,
      severity: evaluated.severity,
      autoAction: evaluated.autoAction,
      fastBurnRate: evaluated.fastBurnRate,
      slowBurnRate: evaluated.slowBurnRate,
      thresholdPass: evaluated.thresholdPass,
      triggered: evaluated.severity !== 'none',
    };
  });

  const sev1 = anomalies.filter((item) => item.severity === 'sev1').length;
  const sev2 = anomalies.filter((item) => item.severity === 'sev2').length;
  const untriggered = anomalies.filter((item) => !item.triggered);

  const report = {
    ok: untriggered.length === 0,
    generatedAt: nowIso(),
    injectedScenarios: args.inject,
    totals: {
      scenarios: anomalies.length,
      sev1,
      sev2,
      untriggered: untriggered.length,
    },
    anomalies,
  };

  const jsonPath = writeJsonReport('anomaly_drill.json', report);
  const mdRows = anomalies.map((item) => ({
    Scenario: item.label,
    Observed: item.observed,
    Target: item.target,
    Severity: item.severity,
    Action: item.autoAction,
    Triggered: item.triggered ? 'yes' : 'no',
    Owner: item.owner,
  }));

  const markdown = [
    '# Phase 32 Anomaly Drill',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Result: ${report.ok ? 'PASS' : 'FAIL'}`,
    `- Scenarios: ${report.totals.scenarios}`,
    `- Sev1: ${report.totals.sev1}`,
    `- Sev2: ${report.totals.sev2}`,
    '',
    toMarkdownTable(['Scenario', 'Observed', 'Target', 'Severity', 'Action', 'Triggered', 'Owner'], mdRows),
    '',
  ].join('\n');

  const mdPath = writeMarkdownReport('anomaly_drill.md', markdown);

  console.log('Phase 32 anomaly drill complete.');
  console.log(`JSON report: ${jsonPath}`);
  console.log(`Markdown report: ${mdPath}`);

  if (!report.ok) {
    const keys = untriggered.map((item) => item.scenarioKey).join(',');
    throw new Error(`phase32_anomaly_untriggered:${keys}`);
  }
}

main().catch((error) => {
  console.error(`Phase 32 anomaly drill failed: ${error.message}`);
  process.exit(1);
});
