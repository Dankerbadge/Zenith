#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const QA_DIR = path.join(ROOT, 'docs', 'qa');

function listQaReports() {
  if (!fs.existsSync(QA_DIR)) return [];
  return fs
    .readdirSync(QA_DIR)
    .filter((name) => /^QA_SESSION_\d{8}_\d{4}\.md$/.test(name))
    .sort();
}

function fail(message) {
  console.error(`QA report verification failed: ${message}`);
  process.exit(1);
}

function expectMetadata(source, label) {
  const re = new RegExp(`^- ${label}:\\s*(.*)$`, 'm');
  const m = source.match(re);
  if (!m) fail(`Missing metadata line: ${label}`);
  if (!m[1] || m[1].trim().length === 0) fail(`Metadata not filled: ${label}`);
}

function main() {
  const argPath = process.argv[2];
  let target;
  if (argPath) {
    target = path.isAbsolute(argPath) ? argPath : path.join(ROOT, argPath);
    if (!fs.existsSync(target)) fail(`File not found: ${argPath}`);
  } else {
    const files = listQaReports();
    if (!files.length) fail('No QA session reports found in docs/qa');
    target = path.join(QA_DIR, files[files.length - 1]);
  }

  const source = fs.readFileSync(target, 'utf8');

  expectMetadata(source, 'Date');
  expectMetadata(source, 'Device');
  expectMetadata(source, 'OS');
  expectMetadata(source, 'Build/commit');

  const hasPass = /- \[x\] PASS/i.test(source);
  const hasDefer = /- \[x\] DEFER/i.test(source);
  if (!hasPass && !hasDefer) {
    fail('Final call missing (mark PASS or DEFER).');
  }

  if (hasPass && hasDefer) {
    fail('Final call has both PASS and DEFER checked.');
  }

  console.log(`QA report check passed: ${path.relative(ROOT, target)}`);
}

main();
