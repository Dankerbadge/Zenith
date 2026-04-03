#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LEDGER_PATH = path.join(ROOT, 'docs', 'RELEASE_LOCK_LEDGER.md');
const OUT_PATH = path.join(ROOT, 'docs', 'RC_DASHBOARD.md');

function nowIsoLocal() {
  const d = new Date();
  const pad = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseLedger(source) {
  const rows = source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^- Phase\s+/i.test(line));

  const phases = rows.map((line) => {
    const m = line.match(/^-\s*(Phase\s+[0-9]+(?:\.[0-9]+)?)\s*:\s*([A-Z]+)/i);
    if (!m) return null;
    return { phase: m[1], status: m[2].toUpperCase() };
  }).filter(Boolean);

  const counts = {
    PASS: phases.filter((p) => p.status === 'PASS').length,
    PARTIAL: phases.filter((p) => p.status === 'PARTIAL').length,
    DEFER: phases.filter((p) => p.status === 'DEFER').length,
    BLOCKED: phases.filter((p) => p.status === 'BLOCKED').length,
  };

  return { phases, counts };
}

function main() {
  if (!fs.existsSync(LEDGER_PATH)) {
    throw new Error('Missing docs/RELEASE_LOCK_LEDGER.md');
  }
  const source = fs.readFileSync(LEDGER_PATH, 'utf8');
  const { phases, counts } = parseLedger(source);

  const remaining = phases.filter((p) => p.status !== 'PASS');
  const readyToShip = remaining.length === 0;

  const lines = [];
  lines.push('# RC Dashboard');
  lines.push('');
  lines.push(`Generated: ${nowIsoLocal()}`);
  lines.push('');
  lines.push('## Phase Summary');
  lines.push(`- PASS: ${counts.PASS}`);
  lines.push(`- PARTIAL: ${counts.PARTIAL}`);
  lines.push(`- DEFER: ${counts.DEFER}`);
  lines.push(`- BLOCKED: ${counts.BLOCKED}`);
  lines.push(`- Ship readiness: ${readyToShip ? 'READY' : 'NOT READY'}`);
  lines.push('');
  lines.push('## Remaining Passes');
  if (!remaining.length) {
    lines.push('- None. All phases are PASS.');
  } else {
    remaining.forEach((row) => {
      lines.push(`- ${row.phase}: ${row.status}`);
    });
  }
  lines.push('');
  lines.push('## RC Command Set');
  lines.push('- `npm run -s verify:ship-lock`');
  lines.push('- `npm run -s qa:new`');
  lines.push('- Fill generated `docs/qa/QA_SESSION_*.md`');
  lines.push('- `npm run -s verify:qa-report`');

  fs.writeFileSync(OUT_PATH, `${lines.join('\n')}\n`, 'utf8');
  console.log(`RC dashboard written: ${path.relative(ROOT, OUT_PATH)}`);
}

main();
