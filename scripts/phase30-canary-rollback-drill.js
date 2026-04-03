#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const {
  baseConfig,
  writeJsonReport,
  writeMarkdownReport,
  formatMarkdownTable,
  callFunction,
} = require('./phase30-lib');

const DEFAULT_THRESHOLDS = {
  dualReadMismatchRateHalt: 0.02,
  dualReadMismatchRateRollback: 0.05,
  syncFailureRateHalt: 0.01,
  syncFailureRateRollback: 0.03,
  p95LatencyMsHalt: 350,
  p95LatencyMsRollback: 500,
};

const ROLLOUT_STAGES = [1, 5, 10, 25, 50, 100];

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    scenario: 'halt',
    inject: 'dual_read_mismatch',
    telemetry: '',
  };
  for (const arg of args) {
    if (arg.startsWith('--scenario=')) out.scenario = arg.split('=')[1] || out.scenario;
    if (arg.startsWith('--inject=')) out.inject = arg.split('=')[1] || out.inject;
    if (arg.startsWith('--telemetry=')) out.telemetry = arg.split('=')[1] || out.telemetry;
  }
  return out;
}

function readTelemetryByStage(inputPath) {
  const fallback = path.join(__dirname, '..', 'docs', 'qa', 'phase31', 'telemetry_rollout_metrics.json');
  const target = inputPath ? path.resolve(inputPath) : fallback;
  if (!fs.existsSync(target)) return new Map();
  try {
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
    const rows = Array.isArray(parsed?.timeline) ? parsed.timeline : Array.isArray(parsed) ? parsed : [];
    const out = new Map();
    for (const row of rows) {
      const stage = Number(row?.stagePct);
      if (!Number.isFinite(stage)) continue;
      const dualReadMismatchRate = Number(row?.metrics?.dualReadMismatchRate);
      const syncFailureRate = Number(row?.metrics?.syncFailureRate);
      const p95LatencyMs = Number(row?.metrics?.p95LatencyMs);
      if (!Number.isFinite(dualReadMismatchRate) || !Number.isFinite(syncFailureRate) || !Number.isFinite(p95LatencyMs)) continue;
      out.set(stage, {
        dualReadMismatchRate,
        syncFailureRate,
        p95LatencyMs,
      });
    }
    return out;
  } catch {
    return new Map();
  }
}

function metricForStage(stage, inject, telemetryByStage) {
  const fromTelemetry = telemetryByStage.get(stage);
  if (fromTelemetry) return fromTelemetry;
  const baseline = {
    dualReadMismatchRate: 0.004 + stage * 0.00005,
    syncFailureRate: 0.003 + stage * 0.00003,
    p95LatencyMs: 190 + stage * 0.8,
  };

  if (inject === 'dual_read_mismatch' && stage >= 10) baseline.dualReadMismatchRate = 0.027;
  // Rollback drill must cross rollback guardrails, not just halt guardrails.
  if (inject === 'sync_failures' && stage >= 10) baseline.syncFailureRate = 0.038;
  if (inject === 'latency_spike' && stage >= 10) baseline.p95LatencyMs = 390;
  return baseline;
}

function evaluateGuards(metrics, thresholds) {
  const haltReasons = [];
  const rollbackReasons = [];

  if (metrics.dualReadMismatchRate > thresholds.dualReadMismatchRateHalt) haltReasons.push('dual_read_mismatch_halt');
  if (metrics.syncFailureRate > thresholds.syncFailureRateHalt) haltReasons.push('sync_failure_halt');
  if (metrics.p95LatencyMs > thresholds.p95LatencyMsHalt) haltReasons.push('latency_halt');

  if (metrics.dualReadMismatchRate > thresholds.dualReadMismatchRateRollback) rollbackReasons.push('dual_read_mismatch_rollback');
  if (metrics.syncFailureRate > thresholds.syncFailureRateRollback) rollbackReasons.push('sync_failure_rollback');
  if (metrics.p95LatencyMs > thresholds.p95LatencyMsRollback) rollbackReasons.push('latency_rollback');

  return { haltReasons, rollbackReasons };
}

async function maybeWriteAudit(config, eventType, payload) {
  try {
    await callFunction(config, {
      name: 'privacy-retention-enforce',
      method: 'POST',
      headers: {
        'x-ops-key': config.opsAutomationKey || '',
        'x-phase30-audit-event': eventType,
      },
      body: {
        dryRun: true,
        auditOnly: true,
        payload,
      },
    });
  } catch {
    // Optional best-effort path. The drill report remains the source of truth.
  }
}

async function main() {
  const args = parseArgs();
  const config = baseConfig();
  const thresholds = { ...DEFAULT_THRESHOLDS };
  const telemetryByStage = readTelemetryByStage(args.telemetry);
  const usingTelemetry = telemetryByStage.size > 0;

  const timeline = [];
  let status = 'running';
  let haltAt = null;
  let rollbackAt = null;
  let haltReasons = [];
  let rollbackReasons = [];

  for (const stage of ROLLOUT_STAGES) {
    const metrics = metricForStage(stage, args.inject, telemetryByStage);
    const guardEval = evaluateGuards(metrics, thresholds);

    const step = {
      stagePct: stage,
      metrics,
      haltReasons: guardEval.haltReasons,
      rollbackReasons: guardEval.rollbackReasons,
      decision: 'continue',
    };

    if (guardEval.haltReasons.length && !haltAt) {
      status = 'halted';
      haltAt = stage;
      haltReasons = guardEval.haltReasons.slice();
      step.decision = 'halt';
    }

    if (args.scenario === 'rollback' && guardEval.rollbackReasons.length && !rollbackAt) {
      status = 'rolled_back';
      rollbackAt = stage;
      rollbackReasons = guardEval.rollbackReasons.slice();
      step.decision = 'rollback';
      timeline.push(step);
      break;
    }

    timeline.push(step);
    if (status === 'halted') break;
  }

  if (args.scenario === 'rollback' && status !== 'rolled_back') {
    status = 'completed_without_rollback';
  } else if (args.scenario === 'halt' && status !== 'halted') {
    status = 'completed_without_halt';
  }

  const report = {
    ok: true,
    scenario: args.scenario,
    inject: args.inject,
    status,
    haltAt,
    haltReasons,
    rollbackAt,
    rollbackReasons,
    thresholds,
    usingTelemetry,
    timeline,
    createdAt: new Date().toISOString(),
  };

  const jsonPath = writeJsonReport('PHASE30_CANARY_ROLLBACK_DRILL', report);
  const markdownRows = timeline.map((row) => ({
    testId: `stage_${row.stagePct}`,
    scenario: `Rollout ${row.stagePct}%`,
    result: row.decision.toUpperCase(),
    notes: `mismatch=${row.metrics.dualReadMismatchRate.toFixed(4)}, syncFail=${row.metrics.syncFailureRate.toFixed(4)}, p95=${row.metrics.p95LatencyMs}ms`,
  }));

  const md = [
    '# Phase 30 Canary / Rollback Drill Report',
    '',
    `- Scenario: ${args.scenario}`,
    `- Injected failure: ${args.inject}`,
    `- Final status: ${status}`,
    `- Halt at: ${haltAt ?? 'n/a'}`,
    `- Rollback at: ${rollbackAt ?? 'n/a'}`,
    '',
    formatMarkdownTable(markdownRows),
    '',
  ].join('\n');
  const mdPath = writeMarkdownReport('PHASE30_CANARY_ROLLBACK_DRILL', md);

  await maybeWriteAudit(config, 'phase30_canary_rollback_drill', {
    scenario: args.scenario,
    inject: args.inject,
    status,
    haltAt,
    rollbackAt,
  });

  const expectedHalt = args.scenario === 'halt';
  const expectedRollback = args.scenario === 'rollback';
  const pass = (expectedHalt && status === 'halted') || (expectedRollback && status === 'rolled_back');

  console.log(`Phase 30 canary/rollback drill completed: ${status}`);
  console.log(`JSON report: ${jsonPath}`);
  console.log(`Markdown report: ${mdPath}`);

  if (!pass) {
    throw new Error(`drill_expectation_failed:scenario=${args.scenario}:status=${status}`);
  }
}

main().catch((error) => {
  console.error(`Phase 30 canary/rollback drill failed: ${error.message}`);
  process.exit(1);
});
