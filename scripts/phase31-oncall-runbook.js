#!/usr/bin/env node
/* eslint-disable no-console */

const {
  phase30,
  writeMarkdownReport,
  nowIso,
  toMarkdownTable,
} = require('./phase31-lib');

const { baseConfig, tableExists, restSelect } = phase30;

async function main() {
  const config = baseConfig();
  const shiftsTableExists = await tableExists(config, 'food_v2_oncall_shifts');

  if (!shiftsTableExists) {
    throw new Error('food_v2_oncall_shifts_missing');
  }

  const read = await restSelect(config, {
    table: 'food_v2_oncall_shifts',
    query: 'select=shift_id,owner,tier,start_time,end_time,escalations&order=start_time.asc',
  });

  if (!read.ok) {
    throw new Error(`oncall_shift_read_failed:${read.status}:${JSON.stringify(read.body)}`);
  }

  const shifts = Array.isArray(read.body) ? read.body : [];
  if (!shifts.length) {
    throw new Error('oncall_shift_empty:run_phase31:fixtures_first');
  }

  const shiftRows = shifts.map((shift) => ({
    Owner: shift.owner,
    Tier: shift.tier,
    Start: shift.start_time,
    End: shift.end_time,
    Escalations: Array.isArray(shift.escalations) ? shift.escalations.join(' -> ') : '',
  }));

  const ownershipRows = [
    { Event: 'Search latency issues', Owner: 'DevOps', Escalation: 'Phase Owner' },
    { Event: 'Logging dual-write mismatch', Owner: 'Backend Eng', Escalation: 'Phase Owner' },
    { Event: 'Offline sync failures', Owner: 'QA', Escalation: 'Backend Eng' },
    { Event: 'Export/Import failures', Owner: 'Data Eng', Escalation: 'Ops' },
    { Event: 'Privacy consent errors', Owner: 'Privacy Owner', Escalation: 'Phase Owner' },
    { Event: 'Retention purge failures', Owner: 'Backend Eng', Escalation: 'Privacy Owner' },
    { Event: 'Admin replay failures', Owner: 'Ops', Escalation: 'Phase Owner' },
  ];

  const markdown = [
    '# Phase 31 Production Operations — On-Call Runbook',
    '',
    `- Generated: ${nowIso()}`,
    '',
    '## Tiers',
    '- Tier 1: DevOps / Backend Eng — primary for Sev1/Sev2 alerts',
    '- Tier 2: Phase Owner (Privacy, Admin, Sync) — escalation if unresolved > 15-30 minutes',
    '- Tier 3: Team Lead / Engineering Manager — critical outage escalation',
    '',
    '## Escalation Windows',
    '- Sev1: escalate every 15 minutes until resolved',
    '- Sev2: escalate every 30-60 minutes until resolved',
    '',
    '## Active Shift Coverage',
    '',
    toMarkdownTable(['Owner', 'Tier', 'Start', 'End', 'Escalations'], shiftRows),
    '',
    '## Ownership Map',
    '',
    toMarkdownTable(['Event', 'Owner', 'Escalation'], ownershipRows),
    '',
    '## Audit Requirements',
    '- Log every on-call handoff with timestamp, reason, and pending actions.',
    '- Record audit events for every automated remediation or replay job.',
    '- Track incident severity, owner, auto-halt/rollback state, and closure notes.',
    '',
  ].join('\n');

  const outputPath = writeMarkdownReport('oncall_runbook.md', markdown);
  console.log('Phase 31 on-call runbook generated.');
  console.log(`Runbook: ${outputPath}`);
}

main().catch((error) => {
  console.error(`Phase 31 on-call runbook generation failed: ${error.message}`);
  process.exit(1);
});
