# Phase 32 Parity Monitor

- Generated: 2026-04-03T02:15:44.228Z
- Mode: standard
- Overall: PASS
- Failing metrics: 0
- Sev1: 3
- Sev2: 0

| Metric | Value | Target | Result | Source | Severity | Owner |
| --- | --- | --- | --- | --- | --- | --- |
| Offline -> Online Log Success Rate | 99.7 | >= 99.5 | PASS | phase31_gate:offline_online_sync:pass | sev1 | QA / Sync Eng |
| Dual-Write Mismatch Rate | 0.05 | <= 0.1 | PASS | phase31_gate:dual_path_parity:pass | sev1 | Backend Eng |
| Dual-Read Mismatch Rate | 0.05 | <= 0.1 | PASS | phase31_gate:dual_path_parity:pass | sev1 | DevOps / QA |
| Feature Flag Drift Count | 0 | <= 0 | PASS | phase31_overall_health | none | DevOps |
| Offline Pack Checksum Mismatch Count | 0 | <= 0 | PASS | phase31_offline_sync_health | none | DevOps |
