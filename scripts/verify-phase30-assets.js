#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) throw new Error(`Missing ${rel}`);
  return fs.readFileSync(abs, 'utf8');
}

function mustInclude(source, token, label) {
  if (!source.includes(token)) {
    throw new Error(`Missing ${label}: ${token}`);
  }
}

function main() {
  const pkg = read('package.json');
  mustInclude(pkg, '"phase30:fixtures"', 'phase30 fixtures npm script');
  mustInclude(pkg, '"verify:phase30-canary-halt"', 'phase30 canary halt npm script');
  mustInclude(pkg, '"verify:phase30-canary-rollback"', 'phase30 canary rollback npm script');
  mustInclude(pkg, '"verify:phase30-matrix"', 'phase30 matrix npm script');
  mustInclude(pkg, '"verify:phase30"', 'phase30 aggregate npm script');

  const fixtures = read('scripts/fixtures/phase30-fixtures.json');
  mustInclude(fixtures, '"regular"', 'regular fixture');
  mustInclude(fixtures, '"legacy"', 'legacy fixture');
  mustInclude(fixtures, '"admin"', 'admin fixture');
  mustInclude(fixtures, '"delete_candidate"', 'delete fixture');

  const setup = read('scripts/phase30-fixtures-setup.js');
  mustInclude(setup, 'seedNutritionDaily', 'nutrition seeding');
  mustInclude(setup, 'seedConsent', 'consent seeding');
  mustInclude(setup, 'seedPublicShares', 'public shares seeding');

  const drill = read('scripts/phase30-canary-rollback-drill.js');
  mustInclude(drill, 'DEFAULT_THRESHOLDS', 'drill thresholds');
  mustInclude(drill, 'ROLLOUT_STAGES', 'drill rollout stages');
  mustInclude(drill, 'scenario', 'drill scenario parsing');

  const matrix = read('scripts/verify-phase30-integration.js');
  mustInclude(matrix, 'T30-001', 'matrix test T30-001');
  mustInclude(matrix, 'T30-014', 'matrix test T30-014');
  mustInclude(matrix, 'hard_gate_failures', 'hard gate failure enforcement');

  const playbook = read('docs/qa/PHASE30_UNIFIED_QA_PLAYBOOK.md');
  mustInclude(playbook, 'Hard Pass/Fail Matrix', 'playbook matrix section');
  mustInclude(playbook, 'Canary, Auto-Halt, Rollback', 'playbook canary section');
  mustInclude(playbook, 'Release Gates', 'playbook gates section');

  console.log('Phase 30 asset verification passed.');
}

main();

