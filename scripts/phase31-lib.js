#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const phase30 = require('./phase30-lib');

const ROOT = phase30.ROOT;
const DOCS_DIR = path.join(ROOT, 'docs', 'qa', 'phase31');
const FIXTURE_SEED_PATH = path.join(ROOT, 'scripts', 'phase31-fixtures', 'phase31-fixtures-seed.json');
const FIXTURE_SCHEMA_PATH = path.join(ROOT, 'scripts', 'phase31-fixtures', 'phase31-fixtures-schema.sql');

const HARD_GATES = [
  'slo_compliance',
  'dual_path_parity',
  'privacy_consent_enforcement',
  'retention_purge',
  'export_import_success',
  'canary_auto_halt',
  'rollback_restore',
  'admin_replay_idempotent',
  'offline_online_sync',
];

function ensureDocsDir() {
  fs.mkdirSync(DOCS_DIR, { recursive: true });
}

function writeJsonReport(filename, payload) {
  ensureDocsDir();
  const target = path.join(DOCS_DIR, filename.endsWith('.json') ? filename : `${filename}.json`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(payload, null, 2), 'utf8');
  return target;
}

function writeMarkdownReport(filename, markdown) {
  ensureDocsDir();
  const target = path.join(DOCS_DIR, filename.endsWith('.md') ? filename : `${filename}.md`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, markdown, 'utf8');
  return target;
}

function readJson(filepath) {
  if (!fs.existsSync(filepath)) {
    throw new Error(`missing_json_file:${filepath}`);
  }
  return JSON.parse(fs.readFileSync(filepath, 'utf8'));
}

function readPhase31Seed() {
  return readJson(FIXTURE_SEED_PATH);
}

function readReport(filename) {
  const abs = path.join(DOCS_DIR, filename);
  return readJson(abs);
}

function nowIso() {
  return new Date().toISOString();
}

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function lowerIsBetter(metricName) {
  const key = String(metricName || '').toLowerCase();
  return (
    key.includes('latency') ||
    key.includes('error') ||
    key.includes('mismatch') ||
    key.includes('backlog') ||
    key.includes('queue_depth') ||
    key.includes('failure')
  );
}

function evaluateSliMetric(metric) {
  const current = asNumber(metric.current_value, 0);
  const target = asNumber(metric.slo_target, 0);
  const isLowerBetter = lowerIsBetter(metric.sli_metric);
  const pass = isLowerBetter ? current <= target : current >= target;
  const comparator = isLowerBetter ? '<=' : '>=';

  return {
    ...metric,
    currentValue: current,
    targetValue: target,
    comparator,
    direction: isLowerBetter ? 'lower_is_better' : 'higher_is_better',
    pass,
    delta: Number((current - target).toFixed(4)),
  };
}

function baselineMetricValue(metric) {
  const target = asNumber(metric.slo_target, 0);
  if (lowerIsBetter(metric.sli_metric)) {
    const adjusted = target * 0.85;
    return Number(adjusted.toFixed(4));
  }
  const adjusted = Math.min(100, target + 0.4);
  return Number(adjusted.toFixed(4));
}

function metricForAlertSimulation(event) {
  const pathKey = String(event.critical_path || '').toLowerCase();
  if (pathKey === 'search') return Number((asNumber(event.threshold, 0) + 55).toFixed(3));
  if (pathKey === 'logging') return Number((asNumber(event.threshold, 0) + 0.22).toFixed(3));
  if (pathKey === 'sync') return Number((asNumber(event.threshold, 0) + 1.4).toFixed(3));
  return Number((asNumber(event.threshold, 0) + 1).toFixed(3));
}

function evaluateAlertBreach(event, actualValue) {
  const severity = String(event.severity || '').toLowerCase();
  const threshold = asNumber(event.threshold, 0);
  const isBreached = asNumber(actualValue, 0) > threshold;

  let autoAction = 'alert_only';
  if (!isBreached) autoAction = 'none';
  else if (severity === 'sev1') autoAction = 'automatic_rollback';
  else if (severity === 'sev2') autoAction = 'canary_halt';

  return { isBreached, autoAction };
}

function runNodeScript(scriptPath, args = []) {
  const res = spawnSync('node', [scriptPath, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  return {
    ok: res.status === 0,
    status: res.status,
    stdout: String(res.stdout || ''),
    stderr: String(res.stderr || ''),
  };
}

function toMarkdownTable(headers, rows) {
  const normalizedHeaders = Array.isArray(headers) ? headers : [];
  const header = `| ${normalizedHeaders.join(' | ')} |`;
  const divider = `| ${normalizedHeaders.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => {
    const cols = normalizedHeaders.map((key) => {
      const raw = row[key] == null ? '' : String(row[key]);
      return raw.replace(/\|/g, '\\|');
    });
    return `| ${cols.join(' | ')} |`;
  });
  return [header, divider, ...body].join('\n');
}

function extractFirstArrayRow(body) {
  return Array.isArray(body) && body.length ? body[0] : null;
}

module.exports = {
  ROOT,
  DOCS_DIR,
  FIXTURE_SEED_PATH,
  FIXTURE_SCHEMA_PATH,
  HARD_GATES,
  phase30,
  writeJsonReport,
  writeMarkdownReport,
  readPhase31Seed,
  readReport,
  nowIso,
  asNumber,
  lowerIsBetter,
  evaluateSliMetric,
  baselineMetricValue,
  metricForAlertSimulation,
  evaluateAlertBreach,
  runNodeScript,
  toMarkdownTable,
  extractFirstArrayRow,
};
