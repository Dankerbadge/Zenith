# Phase 32 Anomaly Drill

- Generated: 2026-03-27T02:48:57.476Z
- Result: PASS
- Scenarios: 4
- Sev1: 4
- Sev2: 0

| Scenario | Observed | Target | Severity | Action | Triggered | Owner |
| --- | --- | --- | --- | --- | --- | --- |
| Dual-write mismatch spike | 1.2 | 0.1 | sev1 | auto_halt_or_rollback | yes | Backend Eng |
| Offline -> online parity drop | 95.8 | 99.5 | sev1 | auto_halt_or_rollback | yes | QA / Sync Eng |
| OFF provider stale | 72 | 24 | sev1 | auto_halt_or_rollback | yes | Data Eng |
| Offline pack checksum mismatch | 3 | 0 | sev1 | auto_halt_or_rollback | yes | DevOps |
