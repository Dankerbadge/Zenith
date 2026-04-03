#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const {
  ROOT,
  phase30,
  runNodeScript,
  nowIso,
} = require('../../phase31-lib');

const DEFINITIONS_DIR = path.join(__dirname, 'definitions');

function definitionPath(fileName) {
  return path.join(DEFINITIONS_DIR, fileName);
}

function loadDefinition(fileName) {
  const abs = definitionPath(fileName);
  if (!fs.existsSync(abs)) {
    throw new Error(`scenario_definition_missing:${fileName}`);
  }
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
}

function absPath(relativeOrAbsolutePath) {
  if (path.isAbsolute(relativeOrAbsolutePath)) return relativeOrAbsolutePath;
  return path.join(ROOT, relativeOrAbsolutePath);
}

function writeScenarioReports(definition, payload) {
  const jsonTarget = absPath(definition.report_paths.json);
  const mdTarget = absPath(definition.report_paths.md);

  fs.mkdirSync(path.dirname(jsonTarget), { recursive: true });
  fs.mkdirSync(path.dirname(mdTarget), { recursive: true });

  const scenarioResult = {
    scenario_id: definition.scenario_id,
    description: definition.description,
    status: payload.hard_gate_passed ? 'pass' : 'fail',
    observed: payload.observed,
    expected_outcomes: definition.expected_outcomes,
    hard_gate_passed: Boolean(payload.hard_gate_passed),
    owner: definition.owner,
    notes: payload.notes || '',
    executed_at: nowIso(),
  };

  fs.writeFileSync(jsonTarget, JSON.stringify(scenarioResult, null, 2), 'utf8');

  const metricsLines = Object.entries(payload.observed || {}).map(([key, value]) => `- ${key}: ${value}`);
  const markdown = [
    `# Scenario ${definition.scenario_id} — ${definition.description}`,
    '',
    `**Result:** ${scenarioResult.hard_gate_passed ? 'PASS' : 'FAIL'}`,
    '',
    '**Observed Metrics:**',
    ...(metricsLines.length ? metricsLines : ['- none']),
    '',
    `**Hard Gate:** ${scenarioResult.hard_gate_passed ? 'PASS' : 'FAIL'}`,
    `**Owner:** ${definition.owner}`,
    `**Executed At:** ${scenarioResult.executed_at}`,
    '',
    payload.notes ? `**Notes:** ${payload.notes}` : '',
  ].filter(Boolean).join('\n');

  fs.writeFileSync(mdTarget, markdown, 'utf8');

  return {
    jsonTarget,
    mdTarget,
    scenarioResult,
  };
}

function runScript(relativeScriptPath, args = []) {
  const scriptAbs = absPath(relativeScriptPath);
  return runNodeScript(scriptAbs, args);
}

function isMissingRequiredEnvFailure(runResult) {
  if (!runResult || runResult.ok) return false;
  const combined = `${runResult.stderr || ''}\n${runResult.stdout || ''}`;
  return /Missing required env:/i.test(combined);
}

function runScriptWithEnvFallback(relativeScriptPath, args = []) {
  const run = runScript(relativeScriptPath, args);
  return {
    ...run,
    skippedForMissingEnv: isMissingRequiredEnvFailure(run),
  };
}

function executionDisposition(runResult) {
  if (!runResult) return 'unknown';
  if (runResult.ok) return 'executed';
  if (runResult.skippedForMissingEnv) return 'skipped_missing_env';
  return 'failed';
}

function readJson(relativePath) {
  const abs = absPath(relativePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`report_missing:${relativePath}`);
  }
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
}

function findCheck(report, checkId) {
  const checks = Array.isArray(report?.checks) ? report.checks : [];
  return checks.find((c) => c.id === checkId) || null;
}

function percentFromParityCheck(check) {
  if (!check || check.result !== 'PASS') return 100;
  return 0;
}

module.exports = {
  ROOT,
  phase30,
  loadDefinition,
  writeScenarioReports,
  runScript,
  runScriptWithEnvFallback,
  isMissingRequiredEnvFailure,
  executionDisposition,
  readJson,
  findCheck,
  percentFromParityCheck,
  absPath,
};
