# Phase 30 Canary / Rollback Drill Report

- Scenario: rollback
- Injected failure: sync_failures
- Final status: rolled_back
- Halt at: 10
- Rollback at: 10

| Test ID | Scenario | Result | Notes |
| --- | --- | --- | --- |
| stage_1 | Rollout 1% | CONTINUE | mismatch=0.0040, syncFail=0.0030, p95=190.8ms |
| stage_5 | Rollout 5% | CONTINUE | mismatch=0.0043, syncFail=0.0032, p95=194ms |
| stage_10 | Rollout 10% | ROLLBACK | mismatch=0.0045, syncFail=0.0380, p95=198ms |
