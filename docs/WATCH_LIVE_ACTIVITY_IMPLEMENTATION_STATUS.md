# Watch + Live Activity Implementation Status

Updated: 2026-02-04

## Completed in this pass

- Generated native iOS scaffold with `expo prebuild --platform ios --no-install`.
- Added shared run sync protocol model in `utils/runControlSync.ts`:
  - Session snapshot model
  - Command request/ack model
  - Sequence-safe snapshot upsert
  - Command queue and ack persistence
- Extended `app/live-run.tsx` to:
  - Publish session snapshots on state transitions
  - Publish periodic tick snapshots (10s) while recording
  - Publish threshold snapshots on distance delta
  - Support two-step end confirmation window (2.5s)
  - Process remote commands from command queue (`pause`, `resume`, `requestEnd`, `confirmEnd`, `cancelEnd`)
- Added Home tab run control strip in `app/(tabs)/index.tsx`:
  - Mirrors active run snapshot
  - Pause/Resume control command dispatch
  - End two-step control command dispatch
  - Command ack reconciliation
- Cleared active run snapshot after save/discard in `app/run-review.tsx`.
- Enabled iOS Live Activity capability flag in `app.json` (`NSSupportsLiveActivities`).

## Still required for full Watch-first + app-closed remote control

- Native ActivityKit implementation for Live Activity actions while app is closed.
- Native WatchConnectivity bridge for reliable command delivery and acks.
- watchOS target creation and watch authoritative workout recorder integration.
- Session ownership routing (watch-first with fallback to phone-only).
- Full QA matrix for disconnect/retry/sequence behavior on real devices.

## Next recommended order

1. Add iOS native module for Live Activity action handling + event bridge to JS.
2. Add watchOS extension target and WCSession command router.
3. Move authoritative recorder to watch target.
4. Run end-to-end stopwatch QA for sequence/timing/disconnect behavior.
