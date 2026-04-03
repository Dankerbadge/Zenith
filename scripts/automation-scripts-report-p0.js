#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const downloadsDir = path.join(os.homedir(), 'Downloads');
const stateDir = path.join(repoRoot, 'audit', 'automation');
const statePath = path.join(stateDir, 'scripts-report-p0-state.json');
const extractDir = path.join(repoRoot, 'audit', 'diagnostics', 'scripts');

function log(msg) {
  process.stdout.write(`[scripts-report-p0] ${msg}\n`);
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    cwd: repoRoot,
    stdio: 'pipe',
    encoding: 'utf8',
    ...opts,
  });
}

function readJsonSafe(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function findLatestScriptsReport() {
  if (!fs.existsSync(downloadsDir)) return null;
  const entries = fs.readdirSync(downloadsDir, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /zenith.*scripts.*diagnostic.*report\.(docx|md|txt)$/i.test(name))
    .map((name) => {
      const fullPath = path.join(downloadsDir, name);
      const stat = fs.statSync(fullPath);
      return { name, fullPath, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0] || null;
}

function extractReport(report) {
  ensureDir(extractDir);
  const outName = `${path.basename(report.name, path.extname(report.name))}.txt`;
  const outPath = path.join(extractDir, outName);

  if (/\.docx$/i.test(report.name)) {
    const textutil = run('textutil', ['-convert', 'txt', '-stdout', report.fullPath]);
    if (textutil.status !== 0) {
      throw new Error(`textutil failed: ${textutil.stderr || 'unknown error'}`);
    }
    fs.writeFileSync(outPath, textutil.stdout || '', 'utf8');
    return outPath;
  }

  fs.copyFileSync(report.fullPath, outPath);
  return outPath;
}

function runP0Proof() {
  ensureDir(path.join(repoRoot, 'audit', 'proofs'));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const proofPath = path.join(repoRoot, 'audit', 'proofs', `scripts-report-p0-${stamp}.txt`);

  const shellCmd = `npm run -s verify:p0-all > "${proofPath}" 2>&1`;
  const res = run('zsh', ['-lc', shellCmd], { stdio: 'pipe' });
  return { status: res.status || 0, proofPath };
}

function main() {
  ensureDir(stateDir);
  const state = readJsonSafe(statePath, {
    lastProcessedPath: '',
    lastProcessedMtimeMs: 0,
    lastProcessedAt: '',
    lastProofPath: '',
  });

  const latest = findLatestScriptsReport();
  if (!latest) {
    log('No matching scripts diagnostic report found in Downloads.');
    process.exit(0);
  }

  const isNew =
    latest.mtimeMs > Number(state.lastProcessedMtimeMs || 0) ||
    path.resolve(latest.fullPath) !== path.resolve(String(state.lastProcessedPath || ''));

  if (!isNew) {
    log(`No new report. Latest already processed: ${latest.name}`);
    process.exit(0);
  }

  log(`New report detected: ${latest.name}`);
  const extractedPath = extractReport(latest);
  log(`Extracted report text: ${path.relative(repoRoot, extractedPath)}`);

  log('Running full P0 gate...');
  const proof = runP0Proof();
  if (proof.status !== 0) {
    log(`P0 failed. See proof: ${proof.proofPath}`);
    process.exit(proof.status);
  }

  const nextState = {
    lastProcessedPath: latest.fullPath,
    lastProcessedMtimeMs: latest.mtimeMs,
    lastProcessedAt: new Date().toISOString(),
    lastProofPath: proof.proofPath,
  };
  fs.writeFileSync(statePath, JSON.stringify(nextState, null, 2), 'utf8');
  log(`P0 passed. Proof: ${path.relative(repoRoot, proof.proofPath)}`);
}

main();
