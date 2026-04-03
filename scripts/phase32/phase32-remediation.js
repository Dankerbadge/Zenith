#!/usr/bin/env node
/* eslint-disable no-console */

const {
  nowIso,
  parseArgs,
  readJsonIfExists,
  writeJsonReport,
  writeMarkdownReport,
  toMarkdownTable,
} = require('./phase32-lib');

const PLAYBOOK = {
  dual_write_parity: {
    action: 'replay_or_quarantine_logs',
    owner: 'Backend Eng',
  },
  dual_read_parity: {
    action: 'rebuild_search_cache',
    owner: 'DevOps / QA',
  },
  offline_online_parity: {
    action: 'retry_sync_queue_batches',
    owner: 'QA / Sync Eng',
  },
  provider_freshness_off: {
    action: 'force_provider_refresh_off',
    owner: 'Data Eng',
  },
  provider_freshness_usda: {
    action: 'force_provider_refresh_usda',
    owner: 'Data Eng',
  },
  provider_freshness_restaurant: {
    action: 'force_provider_refresh_restaurant',
    owner: 'Data Eng',
  },
  offline_pack_integrity: {
    action: 'rebuild_offline_pack_artifact',
    owner: 'DevOps',
  },
  feature_flag_drift: {
    action: 'reset_runtime_flag_cohort_state',
    owner: 'DevOps',
  },
};

function remediationFor(anomaly) {
  const fallback = {
    action: 'manual_triage_required',
    owner: 'Ops',
  };

  const playbook = PLAYBOOK[anomaly.metricKey] || fallback;
  const actionId = `${anomaly.metricKey}:${Date.now()}`;

  return {
    actionId,
    metricKey: anomaly.metricKey,
    scenarioKey: anomaly.scenarioKey,
    severity: anomaly.severity,
    owner: playbook.owner,
    action: playbook.action,
    status: anomaly.severity === 'none' ? 'skipped' : 'simulated_applied',
    createdAt: nowIso(),
    audit: {
      source: 'phase32-remediation',
      reason: anomaly.label,
      synthetic: true,
    },
  };
}

async function main() {
  const args = parseArgs();
  const strict = Boolean(args.strict);

  const anomaly = readJsonIfExists('docs/qa/phase32/anomaly_drill.json');
  const anomalyRows = Array.isArray(anomaly?.anomalies) ? anomaly.anomalies : [];

  const actions = anomalyRows.map(remediationFor);
  const applied = actions.filter((row) => row.status === 'simulated_applied');

  const report = {
    ok: strict ? applied.length > 0 : true,
    generatedAt: nowIso(),
    mode: strict ? 'strict' : 'standard',
    source: {
      anomalyReportPresent: Boolean(anomaly),
      anomalyCount: anomalyRows.length,
    },
    totals: {
      actions: actions.length,
      applied: applied.length,
      skipped: actions.length - applied.length,
    },
    actions,
  };

  const jsonPath = writeJsonReport('remediation_log.json', report);
  const mdRows = actions.map((action) => ({
    Metric: action.metricKey,
    Severity: action.severity,
    Action: action.action,
    Status: action.status,
    Owner: action.owner,
  }));

  const markdown = [
    '# Phase 32 Remediation Log',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Mode: ${report.mode}`,
    `- Result: ${report.ok ? 'PASS' : 'FAIL'}`,
    `- Actions: ${report.totals.actions}`,
    `- Applied: ${report.totals.applied}`,
    '',
    mdRows.length
      ? toMarkdownTable(['Metric', 'Severity', 'Action', 'Status', 'Owner'], mdRows)
      : 'No remediation actions generated.',
    '',
  ].join('\n');

  const mdPath = writeMarkdownReport('remediation_log.md', markdown);

  console.log('Phase 32 remediation run complete.');
  console.log(`JSON report: ${jsonPath}`);
  console.log(`Markdown report: ${mdPath}`);

  if (!report.ok) {
    throw new Error('phase32_remediation_no_actions_in_strict_mode');
  }
}

main().catch((error) => {
  console.error(`Phase 32 remediation failed: ${error.message}`);
  process.exit(1);
});
