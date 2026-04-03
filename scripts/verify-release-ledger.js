#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LEDGER = path.join(ROOT, 'docs', 'RELEASE_LOCK_LEDGER.md');

const REQUIRED_PHASES = [
  'Phase 0','Phase 1','Phase 2','Phase 3','Phase 4','Phase 5','Phase 6','Phase 7','Phase 8','Phase 9','Phase 10','Phase 11','Phase 12','Phase 12.9','Phase 13','Phase 14','Phase 15','Phase 16','Phase 17','Phase 18','Phase 19','Phase 20','Phase 21','Phase 22','Phase 23','Phase 23.6','Phase 23.7','Phase 23.8','Phase 23.9','Phase 24','Phase 25','Phase 26','Phase 27','Phase 28','Phase 29','Phase 30'
];
const ALLOWED_STATUS = new Set(['PASS', 'PARTIAL', 'DEFER', 'BLOCKED']);

function main() {
  if (!fs.existsSync(LEDGER)) {
    throw new Error('Missing docs/RELEASE_LOCK_LEDGER.md');
  }
  const source = fs.readFileSync(LEDGER, 'utf8');

  const lines = source.split('\n').filter((line) => /^- Phase\s+/i.test(line.trim()));
  if (!lines.length) {
    throw new Error('Release ledger has no phase lines.');
  }

  const seen = new Map();
  for (const line of lines) {
    const m = line.match(/^-\s*(Phase\s+[0-9]+(?:\.[0-9]+)?)\s*:\s*([A-Z]+)/i);
    if (!m) {
      throw new Error(`Malformed phase line: ${line}`);
    }
    const phase = m[1];
    const status = m[2].toUpperCase();
    if (!ALLOWED_STATUS.has(status)) {
      throw new Error(`Invalid status for ${phase}: ${status}`);
    }
    seen.set(phase, status);
  }

  const missing = REQUIRED_PHASES.filter((phase) => !seen.has(phase));
  if (missing.length) {
    throw new Error(`Missing phase entries: ${missing.join(', ')}`);
  }

  console.log('Release ledger check passed.');
  console.log(`- Phase lines: ${lines.length}`);
}

main();
