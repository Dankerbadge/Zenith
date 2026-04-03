#!/usr/bin/env node
/* eslint-disable no-console */

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function run(label, cmd, args, opts = {}) {
  console.log(`\n== ${label} ==`);
  const res = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, ...opts });
  if (res.status !== 0) {
    process.exit(res.status || 1);
  }
}

function main() {
  run('P0 Gate', 'npm', ['run', '-s', 'verify:p0-all']);
  run('Incomplete Route Scan', 'node', [path.join(ROOT, 'scripts/report-incomplete-routes.js')]);
  console.log('\nP0 STATUS: GREEN (gate passed, no placeholder routes detected).');
}

main();
