# Watch Run Sync Hardening (Interim)

## What was hardened
- Added dev-only sync telemetry logs for snapshot publish and command lifecycle.
- Added command timeout handling in Home run control strip:
  - retry once after 3s (except `confirmEnd`),
  - fail-safe clear after 10s with user feedback.
- Added stale sync hint to Home run strip:
  - shows `Last synced Xs ago` when snapshot age exceeds 15s.
- Added explicit pending state text (`Updating…`) while command ack is pending.

## UX safety behavior now
- Commands are blocked while a prior command is pending.
- End confirmation remains two-step with 2.5s arm window.
- Disconnected state still prevents fake end and keeps messaging clear.

## Remaining native dependency
- Full end-to-end validation still requires `pod install` success and iOS build run.
