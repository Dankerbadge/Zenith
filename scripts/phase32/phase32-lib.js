#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const DOCS_DIR = path.join(ROOT, 'docs', 'qa', 'phase32');
const ENV_LOCAL = path.join(ROOT, '.env.local');

const THRESHOLDS = {
  offlineOnlineSuccessMin: 99.5,
  dualWriteMismatchMax: 0.1,
  dualReadMismatchMax: 0.1,
  providerFreshnessMaxHours: 24,
  offlinePackChecksumMismatchMax: 0,
  featureFlagDriftMax: 0,
};

const OWNERS = {
  offline_online_parity: 'QA / Sync Eng',
  dual_write_parity: 'Backend Eng',
  dual_read_parity: 'DevOps / QA',
  provider_freshness: 'Data Eng',
  offline_pack_integrity: 'DevOps',
  feature_flag_drift: 'DevOps',
};

function parseEnvFile(filepath) {
  if (!fs.existsSync(filepath)) return {};
  const source = fs.readFileSync(filepath, 'utf8');
  const out = {};

  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    out[key] = value;
  }

  return out;
}

const fallbackEnv = parseEnvFile(ENV_LOCAL);

function getEnv(key, defaultValue = '') {
  const value = String(process.env[key] || fallbackEnv[key] || '').trim();
  return value || defaultValue;
}

function getEnvNumber(key) {
  const raw = getEnv(key, '');
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function ensureDocsDir() {
  ensureDir(DOCS_DIR);
}

function writeJsonReport(filename, payload) {
  ensureDocsDir();
  const target = path.join(DOCS_DIR, filename.endsWith('.json') ? filename : `${filename}.json`);
  ensureDir(path.dirname(target));
  fs.writeFileSync(target, JSON.stringify(payload, null, 2), 'utf8');
  return target;
}

function writeMarkdownReport(filename, markdown) {
  ensureDocsDir();
  const target = path.join(DOCS_DIR, filename.endsWith('.md') ? filename : `${filename}.md`);
  ensureDir(path.dirname(target));
  fs.writeFileSync(target, markdown, 'utf8');
  return target;
}

function readJsonIfExists(filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
  if (!fs.existsSync(abs)) return null;
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch {
    return null;
  }
}

function toMarkdownTable(headers, rows) {
  const header = `| ${headers.join(' | ')} |`;
  const divider = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => {
    const cols = headers.map((key) => {
      const raw = row[key] == null ? '' : String(row[key]);
      return raw.replace(/\|/g, '\\|');
    });
    return `| ${cols.join(' | ')} |`;
  });

  return [header, divider, ...body].join('\n');
}

function runNodeScript(scriptRelPath, args = []) {
  const abs = path.join(ROOT, scriptRelPath);
  const res = spawnSync('node', [abs, ...args], {
    cwd: ROOT,
    stdio: 'pipe',
    encoding: 'utf8',
  });

  return {
    ok: res.status === 0,
    status: res.status,
    stdout: String(res.stdout || ''),
    stderr: String(res.stderr || ''),
    script: scriptRelPath,
    args,
  };
}

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    strict: false,
    inject: [],
  };

  for (const arg of argv) {
    if (arg === '--strict') {
      out.strict = true;
      continue;
    }

    if (arg.startsWith('--inject=')) {
      const value = arg.slice('--inject='.length).trim();
      if (value) out.inject.push(value);
      continue;
    }
  }

  return out;
}

function burnRateForSuccess(observedSuccessPct, targetSuccessPct, windowFactor = 1) {
  const observedFailure = Math.max(0, 100 - Number(observedSuccessPct || 0));
  const budget = Math.max(0.0001, 100 - Number(targetSuccessPct || 0));
  return Number(((observedFailure / budget) * Number(windowFactor || 1)).toFixed(4));
}

function burnRateForMax(observedValue, targetMax, windowFactor = 1) {
  const observed = Math.max(0, Number(observedValue || 0));
  const budget = Number(targetMax || 0) <= 0 ? 1 : Number(targetMax);
  const burn = Number(((observed / budget) * Number(windowFactor || 1)).toFixed(4));
  if (Number(targetMax || 0) <= 0 && observed > 0) {
    return Number((1000 * Number(windowFactor || 1)).toFixed(4));
  }
  return burn;
}

function severityFromBurn(fastBurnRate, slowBurnRate) {
  if (fastBurnRate > 1) return 'sev1';
  if (slowBurnRate > 1) return 'sev2';
  return 'none';
}

function resolveMetricValue(input) {
  const envValue = getEnvNumber(input.envKey);
  if (envValue != null) {
    return {
      value: envValue,
      source: `env:${input.envKey}`,
      synthetic: false,
    };
  }

  if (Number.isFinite(input.inferredValue)) {
    return {
      value: Number(input.inferredValue),
      source: input.inferredSource || 'inferred',
      synthetic: false,
    };
  }

  return {
    value: Number(input.syntheticValue),
    source: input.syntheticSource || 'synthetic_default',
    synthetic: true,
  };
}

function evaluateMetric(metricInput) {
  const hasValue = Number.isFinite(metricInput.value);
  let thresholdPass = false;
  let fastBurnRate = 0;
  let slowBurnRate = 0;

  if (hasValue) {
    if (metricInput.type === 'success_min') {
      thresholdPass = metricInput.value >= metricInput.target;
      fastBurnRate = burnRateForSuccess(metricInput.value, metricInput.target, 12);
      slowBurnRate = burnRateForSuccess(metricInput.value, metricInput.target, 1);
    } else {
      thresholdPass = metricInput.value <= metricInput.target;
      fastBurnRate = burnRateForMax(metricInput.value, metricInput.target, 12);
      slowBurnRate = burnRateForMax(metricInput.value, metricInput.target, 1);
    }
  }

  const severity = hasValue ? severityFromBurn(fastBurnRate, slowBurnRate) : 'sev1';
  const autoAction = severity === 'sev1'
    ? 'auto_halt_or_rollback'
    : severity === 'sev2'
      ? 'notify_and_schedule_remediation'
      : 'none';

  return {
    ...metricInput,
    hasValue,
    thresholdPass,
    fastBurnRate,
    slowBurnRate,
    severity,
    autoAction,
  };
}

function finalPass(metric, strict) {
  if (!metric.hasValue) return false;
  if (strict && metric.synthetic) return false;
  return Boolean(metric.thresholdPass);
}

function loadPhase31HardGates() {
  return readJsonIfExists('docs/qa/phase31/hard_gates.json');
}

function findGate(hardGates, gateKey) {
  const gates = Array.isArray(hardGates?.gates) ? hardGates.gates : [];
  return gates.find((gate) => gate?.gateKey === gateKey) || null;
}

module.exports = {
  ROOT,
  DOCS_DIR,
  THRESHOLDS,
  OWNERS,
  nowIso,
  getEnv,
  getEnvNumber,
  ensureDocsDir,
  writeJsonReport,
  writeMarkdownReport,
  readJsonIfExists,
  toMarkdownTable,
  runNodeScript,
  parseArgs,
  burnRateForSuccess,
  burnRateForMax,
  severityFromBurn,
  resolveMetricValue,
  evaluateMetric,
  finalPass,
  loadPhase31HardGates,
  findGate,
};
