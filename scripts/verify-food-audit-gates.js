#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const AUDIT_JSON_PATH = path.join(ROOT, 'docs', 'qa', 'FOOD_SYSTEM_PROD_AUDIT.json');
const REPORT_JSON_PATH = path.join(ROOT, 'docs', 'qa', 'food_audit_gate_report.json');
const REPORT_MD_PATH = path.join(ROOT, 'docs', 'qa', 'food_audit_gate_report.md');

function nowIso() {
  return new Date().toISOString();
}

function readJson(absPath) {
  if (!fs.existsSync(absPath)) {
    throw new Error(`missing_file:${absPath}`);
  }

  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (error) {
    throw new Error(`invalid_json:${absPath}:${error.message}`);
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

function normalizeText(value, fallback = '') {
  if (value == null) return fallback;
  return String(value).trim();
}

function normalizeStatus(status) {
  const value = normalizeText(status).toLowerCase();
  if (value === 'verified') return 'verified';
  if (value === 'partial') return 'partial';
  if (value === 'missing') return 'missing';
  return 'unknown';
}

function normalizeCriticality(criticality) {
  const value = normalizeText(criticality).toLowerCase();
  if (value === 'high' || value === 'medium' || value === 'low') return value;
  return 'unknown';
}

function ensureReportsDir() {
  fs.mkdirSync(path.dirname(REPORT_JSON_PATH), { recursive: true });
}

function extractFeatureRows(audit) {
  const sections = Array.isArray(audit.sections) ? audit.sections : [];
  const rows = [];

  for (const section of sections) {
    const sectionKey = normalizeText(section?.key, 'unknown');
    const sectionStatus = normalizeStatus(section?.status);
    const features = Array.isArray(section?.features) ? section.features : [];

    for (const feature of features) {
      rows.push({
        sectionKey,
        sectionStatus,
        name: normalizeText(feature?.name, 'unnamed_feature'),
        status: normalizeStatus(feature?.status),
        criticality: normalizeCriticality(feature?.criticality),
        owner: normalizeText(feature?.owner, 'unassigned'),
        nextSteps: Array.isArray(feature?.nextSteps) ? feature.nextSteps.map((step) => normalizeText(step)).filter(Boolean) : [],
        evidence: Array.isArray(feature?.evidence) ? feature.evidence.map((item) => normalizeText(item)).filter(Boolean) : [],
      });
    }
  }

  return rows;
}

function ownerCounts(rows) {
  const counts = new Map();
  for (const row of rows) {
    counts.set(row.owner, (counts.get(row.owner) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([owner, count]) => ({ owner, count }));
}

function writeReports(report) {
  ensureReportsDir();
  fs.writeFileSync(REPORT_JSON_PATH, JSON.stringify(report, null, 2), 'utf8');

  const highRows = report.highCriticalBlockers.map((item) => ({
    Section: item.sectionKey,
    Feature: item.name,
    Status: item.status.toUpperCase(),
    Criticality: item.criticality.toUpperCase(),
    Owner: item.owner,
    NextStep: item.nextStepPreview || '',
  }));

  const ownerRows = report.ownerSummary.map((item) => ({
    Owner: item.owner,
    Blockers: item.count,
  }));

  const markdown = [
    '# Food Audit Gate Report',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Audit source: ${path.relative(ROOT, AUDIT_JSON_PATH)}`,
    `- Gate result: ${report.ok ? 'PASS' : 'FAIL'}`,
    '',
    '## Summary',
    '',
    `- Total features: ${report.totals.features}`,
    `- High-critical blockers: ${report.totals.highCriticalBlockers}`,
    `- High-critical missing: ${report.totals.highCriticalMissing}`,
    `- High-critical partial: ${report.totals.highCriticalPartial}`,
    '',
    '## High-Critical Blockers',
    '',
    highRows.length
      ? toMarkdownTable(['Section', 'Feature', 'Status', 'Criticality', 'Owner', 'NextStep'], highRows)
      : 'No high-critical blockers found.',
    '',
    '## Owner Summary',
    '',
    ownerRows.length
      ? toMarkdownTable(['Owner', 'Blockers'], ownerRows)
      : 'No owner assignments found.',
    '',
    '## Blocking Gaps',
    '',
    ...(report.blockingGaps.length ? report.blockingGaps.map((gap, idx) => `${idx + 1}. ${gap}`) : ['None']),
    '',
  ].join('\n');

  fs.writeFileSync(REPORT_MD_PATH, markdown, 'utf8');
}

function main() {
  const audit = readJson(AUDIT_JSON_PATH);
  const features = extractFeatureRows(audit);
  const highBlockers = features.filter((feature) => feature.criticality === 'high' && feature.status !== 'verified');
  const highMissing = highBlockers.filter((feature) => feature.status === 'missing');
  const highPartial = highBlockers.filter((feature) => feature.status === 'partial');

  const report = {
    ok: highBlockers.length === 0,
    generatedAt: nowIso(),
    auditSource: path.relative(ROOT, AUDIT_JSON_PATH),
    totals: {
      features: features.length,
      highCriticalBlockers: highBlockers.length,
      highCriticalMissing: highMissing.length,
      highCriticalPartial: highPartial.length,
    },
    highCriticalBlockers: highBlockers.map((feature) => ({
      sectionKey: feature.sectionKey,
      name: feature.name,
      status: feature.status,
      criticality: feature.criticality,
      owner: feature.owner,
      nextSteps: feature.nextSteps,
      nextStepPreview: feature.nextSteps[0] || '',
      evidence: feature.evidence,
    })),
    ownerSummary: ownerCounts(highBlockers),
    blockingGaps: Array.isArray(audit.blockingGaps) ? audit.blockingGaps.map((gap) => normalizeText(gap)).filter(Boolean) : [],
  };

  writeReports(report);

  console.log('Food audit gate verification completed.');
  console.log(`JSON report: ${REPORT_JSON_PATH}`);
  console.log(`Markdown report: ${REPORT_MD_PATH}`);
  console.log(`High-critical blockers: ${report.totals.highCriticalBlockers}`);

  if (!report.ok) {
    const sample = report.highCriticalBlockers
      .slice(0, 8)
      .map((item) => `${item.sectionKey}:${item.name}(${item.status})`)
      .join(', ');
    throw new Error(`food_audit_gate_failed:blockers=${report.totals.highCriticalBlockers}:${sample}`);
  }
}

main();
