# Phase 31 Production Operations, SLOs, and Automated Reliability

This playbook operationalizes Phase 31 for Zenith and extends the Phase 30 validation stack with production-focused SLO checks, alert simulation, anomaly drills, remediation, and hard release gates.

## Commands

1. Seed Phase 31 fixture data:

```bash
npm run -s phase31:fixtures
```

2. Run SLO checks:

```bash
npm run -s phase31:check-slos
```

3. Run alert simulation:

```bash
npm run -s phase31:alert-sim
```

4. Run anomaly drill:

```bash
npm run -s phase31:anomaly-drill
```

5. Execute remediation automation:

```bash
npm run -s phase31:remediation
```

6. Generate on-call runbook:

```bash
npm run -s phase31:oncall
```

7. Run cross-phase E2E checks:

```bash
npm run -s phase31:e2e
```

8. Enforce hard release gates:

```bash
npm run -s phase31:hard-gates
```

9. Run staged scenario packs:

```bash
npm run -s phase31:scenario:all
```

10. Full verification package:

```bash
npm run -s verify:phase31
```

Reports are written to `docs/qa/phase31/`.

## Output Artifacts

- `docs/qa/phase31/slo_summary.json`
- `docs/qa/phase31/slo_summary.md`
- `docs/qa/phase31/alert_simulation.json`
- `docs/qa/phase31/anomaly_drill.json`
- `docs/qa/phase31/remediation_logs.json`
- `docs/qa/phase31/e2e_report.json`
- `docs/qa/phase31/e2e_report.md`
- `docs/qa/phase31/hard_gates.json`
- `docs/qa/phase31/hard_gates.md`
- `docs/qa/phase31/oncall_runbook.md`
- `docs/qa/phase31/scenarios/hard_gates_summary.json`
- `docs/qa/phase31/scenarios/hard_gates_summary.md`

## Hard Release Gates

| Gate | Pass Criteria | Source |
| --- | --- | --- |
| SLO Compliance | All critical-path SLI checks pass | `slo_summary.json` |
| Dual-Read / Dual-Write Parity | Replay/idempotency parity check passes | `e2e_report.json` (`E31-007`) |
| Privacy / Consent Enforcement | Consent guard path passes | `e2e_report.json` (`E31-005`) |
| Retention Purge | Expired snapshot rows are purged | `e2e_report.json` (`E31-006`) |
| Export / Import Success | Export passes and import endpoint is reachable | `e2e_report.json` (`E31-004`) |
| Canary + Auto-Halt | Sev2 breach path halts canary simulation | `alert_simulation.json`, `anomaly_drill.json`, Phase 30 halt drill |
| Rollback Drill | Rollback simulation succeeds | Phase 30 rollback drill |
| Admin Replay | Remediation and replay checks are idempotent | `remediation_logs.json`, `e2e_report.json` (`E31-007`) |
| Offline / Online Flow | Offline-to-online aggregation check passes | `e2e_report.json` (`E31-001`) |

Any hard-gate failure blocks rollout.

## Scenario Packs

Scenario scripts live under `scripts/phase31/scenarios/` and write per-scenario reports to `docs/qa/phase31/scenarios/`.

Available scenarios:

- `phase31:scenario:canary` (S31-001)
- `phase31:scenario:rollback` (S31-002)
- `phase31:scenario:sync-e2e` (S31-003)
- `phase31:scenario:goal-e2e` (S31-004)
- `phase31:scenario:discovery-e2e` (S31-005)
- `phase31:scenario:export-import` (S31-006)
- `phase31:scenario:delete-account` (S31-007)
- `phase31:scenario:consent-e2e` (S31-008)
- `phase31:scenario:admin-replay` (S31-009)
- `phase31:scenario:anomaly` (S31-010)

## On-Call Ownership

- Tier 1: DevOps / Backend Engineering
- Tier 2: Phase Owner (Privacy, Admin, Sync)
- Tier 3: Team Lead / Engineering Manager

Escalation windows:

- Sev1 every 15 minutes
- Sev2 every 30-60 minutes

Use `phase31:oncall` to refresh the generated runbook from fixture-backed shift coverage.
