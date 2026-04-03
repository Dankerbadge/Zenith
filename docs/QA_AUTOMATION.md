# QA Automation Helpers

Last updated: 2026-02-04

## Create a New Manual QA Session Report
- Run: `npm run -s qa:new`
- Output: `docs/qa/QA_SESSION_YYYYMMDD_HHMM.md`
- Fill in metadata and checkboxes during testing.

## Validate a QA Report
- Validate latest report: `npm run -s verify:qa-report`
- Validate a specific file: `node scripts/verify-qa-report.js docs/qa/QA_SESSION_YYYYMMDD_HHMM.md`

Validation checks:
- Date / Device / OS / Build fields are filled
- Final call has exactly one of:
  - `[x] PASS`
  - `[x] DEFER`

## Recommended RC Workflow
1. `npm run -s verify:ship-lock`
2. `npm run -s qa:new`
3. Execute manual gauntlet and fill report
4. `npm run -s verify:qa-report`
5. Update `docs/RELEASE_LOCK_LEDGER.md` and ship decision
