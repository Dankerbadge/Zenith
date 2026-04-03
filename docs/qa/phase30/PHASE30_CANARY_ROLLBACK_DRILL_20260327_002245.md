# Phase 30 Canary / Rollback Drill Report

- Scenario: rollback
- Injected failure: sync_failures
- Final status: completed_without_rollback
- Halt at: 10
- Rollback at: n/a

| Test ID | Scenario | Result | Notes |
| --- | --- | --- | --- |
| stage_1 | Rollout 1% | CONTINUE | mismatch=0.0040, syncFail=0.0030, p95=190.8ms |
| stage_5 | Rollout 5% | CONTINUE | mismatch=0.0043, syncFail=0.0032, p95=194ms |
| stage_10 | Rollout 10% | HALT | mismatch=0.0045, syncFail=0.0180, p95=198ms |
