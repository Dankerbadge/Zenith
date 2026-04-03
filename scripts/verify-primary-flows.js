#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MARKER_RE = /\b(TODO|FIXME|HACK|XXX)\b/i;

const TARGETS = [
  'app/onboarding.tsx',
  'app/live-run.tsx',
  'app/manual-run.tsx',
  'app/run-review.tsx',
  'app/run-summary.tsx',
  'app/weekly-recap.tsx',
  'app/(tabs)/index.tsx',
  'app/(tabs)/stats.tsx',
  'app/(tabs)/log',
  'app/(tabs)/community',
  'app/account',
  'utils/storageUtils.ts',
  'utils/dailyMetrics.ts',
  'utils/challengeService.ts',
  'utils/segmentService.ts',
  'utils/aiInsightEngine.ts',
];

function isCodeFile(filePath) {
  return /\.(ts|tsx|js|jsx|m|mm|swift)$/.test(filePath);
}

function collectFiles(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return [];
  const stat = fs.statSync(abs);
  if (stat.isFile()) return [abs];

  const out = [];
  const stack = [abs];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(next);
      } else if (entry.isFile() && isCodeFile(next)) {
        out.push(next);
      }
    }
  }
  return out;
}

function main() {
  const files = TARGETS.flatMap(collectFiles);
  const hits = [];

  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    const lines = raw.split('\n');
    lines.forEach((line, idx) => {
      if (MARKER_RE.test(line)) {
        hits.push({
          file: path.relative(ROOT, file),
          line: idx + 1,
          text: line.trim(),
        });
      }
    });
  }

  if (hits.length > 0) {
    console.error('Primary flow marker check failed.\n');
    hits.forEach((hit) => {
      console.error(`${hit.file}:${hit.line} -> ${hit.text}`);
    });
    process.exit(1);
  }

  console.log('Primary flow marker check passed.');
  console.log(`Scanned ${files.length} file(s).`);
}

main();
