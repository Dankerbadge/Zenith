#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TEMPLATE_PATH = path.join(ROOT, 'docs', 'MANUAL_QA_SESSION_SCRIPT.md');
const OUT_DIR = path.join(ROOT, 'docs', 'qa');

function pad(v) {
  return String(v).padStart(2, '0');
}

function timestampParts(date) {
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  return {
    dateKey: `${y}-${m}-${d}`,
    fileKey: `${y}${m}${d}_${hh}${mm}`,
    localIso: `${y}-${m}-${d} ${hh}:${mm}`,
  };
}

function main() {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error('Missing docs/MANUAL_QA_SESSION_SCRIPT.md');
  }
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  const now = new Date();
  const parts = timestampParts(now);
  const outPath = path.join(OUT_DIR, `QA_SESSION_${parts.fileKey}.md`);

  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const header = [
    `# QA Session Report (${parts.localIso})`,
    '',
    '> Generated from `docs/MANUAL_QA_SESSION_SCRIPT.md`',
    '',
  ].join('\n');

  const content = `${header}${template}`
    .replace('- Date:', `- Date: ${parts.dateKey}`)
    .replace('- Device:', '- Device:')
    .replace('- OS:', '- OS:')
    .replace('- Build/commit:', '- Build/commit:');

  fs.writeFileSync(outPath, content, 'utf8');
  console.log(`Created QA session: ${path.relative(ROOT, outPath)}`);
}

main();
