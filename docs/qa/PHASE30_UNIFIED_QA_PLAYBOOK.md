# Phase 30 Unified QA & Full System Integration

This playbook operationalizes the Phase 30 directive for Zenith across phases 19-29.

## Commands

1. Seed fixtures:

```bash
npm run -s phase30:fixtures
```

2. Run canary auto-halt drill:

```bash
npm run -s verify:phase30-canary-halt
```

3. Run rollback drill:

```bash
npm run -s verify:phase30-canary-rollback
```

4. Run full hard pass/fail matrix:

```bash
npm run -s verify:phase30-matrix
```

5. Run full phase package:

```bash
npm run -s verify:phase30
```

Reports are written to `docs/qa/phase30/`.

## Hard Pass/Fail Matrix

| Test ID | Phase Dependencies | Scenario | Client Version | Offline/Online | Expected Result | Gate | Ownership |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T30-001 | 19,28 | Basic log write/read | latest | online | log accepted, synced | must pass | QA Lead |
| T30-002 | 19,28 | Log write offline -> sync | latest | offline -> online | synced correctly | must pass | QA |
| T30-003 | 23 | Goal-aware logging | latest | online | goal totals update correctly | must pass | Dev/QA |
| T30-004 | 21-25 | Usual foods retrieval | latest | online | top foods returned | must pass | QA |
| T30-005 | 19,28 | Old client compatibility | v2.1.0 | online | degraded mode compatible | must pass | Release Engineer |
| T30-006 | 28 | Runtime compatibility negotiation | latest | online | capability contract returned | must pass | Release Engineer |
| T30-007 | 26 | Export/import | latest | online | export complete + import reachable | must pass | QA Lead |
| T30-008 | 29 | Consent enforcement | latest | online | consent gates enforced | must pass | QA |
| T30-009 | 29 | Retention enforcement | latest | online | expired data purged by policy | must pass | Dev/QA |
| T30-010 | 27,28 | Admin replay job | latest | online | idempotent replay + audit | must pass | Release Engineer |
| T30-011 | 28 | Canary auto-halt drill | latest | online | rollout halts on breach | must pass | Release Engineer |
| T30-012 | 28 | Rollback drill | latest | online | rollback restores stable routing | must pass | Release Engineer |
| T30-013 | 26,29 | Delete user account | latest | online | privacy data removed + auth revoked | must pass | QA Lead |
| T30-014 | 19-29 | Full E2E flow | latest | offline -> online | integrated flow passes | must pass | QA Lead |

## Canary, Auto-Halt, Rollback

Use `scripts/phase30-canary-rollback-drill.js`.

- Auto-halt scenario:
  - `--scenario=halt --inject=dual_read_mismatch`
- Rollback scenario:
  - `--scenario=rollback --inject=sync_failures`

The drill produces both JSON and Markdown reports and fails CI if expectations are not met.

## Fixtures

Fixture source: `scripts/fixtures/phase30-fixtures.json`

Required users:
- regular
- legacy
- admin
- delete_candidate

Seed coverage:
- nutrition snapshots
- consent rows
- public share rows

## Release Gates

### Must Pass
- All T30 hard tests pass.
- Canary halt drill passes.
- Rollback drill passes.
- Dual-path parity checks remain within thresholds.
- Offline/online sync path is stable.

### Advisory
- Minor non-critical logging discrepancies.
- Non-blocking UI/flag visibility quirks.

