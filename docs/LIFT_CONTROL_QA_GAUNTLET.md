# Lift Control QA Gauntlet

## Scope
- Validate deterministic Lift control sync across Home strip, Live Lift screen, queue/ack store, and snapshot state.
- Ensure no duplicate state transitions from retries.

## Core Pass Criteria
- End requires explicit confirm flow (requestEnd + confirmEnd).
- Commands never apply in invalid states.
- Snapshot `seq` is monotonic per session.
- Queue and ack processing is idempotent.

## Test Matrix

### 1) Live Lift Local Flow
1. Start lift from Home quick action.
2. Pause, then resume.
3. Request end, cancel end.
4. Request end, confirm end.
5. Save session.
6. Verify one saved workout entry only.

Expected:
- State transitions: `ready -> recording -> paused -> recording -> endingConfirm -> ended -> saved`
- No duplicate save.

### 2) Home Strip Remote Commands
1. Start lift.
2. Use Home strip to pause/resume.
3. Use Home strip end flow (tap end, tap again).
4. Save from Home strip ended state.

Expected:
- Queue receives commands.
- Ack consumed and cleared.
- Snapshot updates on each transition.

### 3) Timeout + Retry Safety
1. Trigger command while controller is unavailable.
2. Wait for timeout.
3. Retry once.

Expected:
- One retry max.
- No duplicate command side-effects.
- User sees non-blocking timeout alert.

### 4) Crash/Reattach
1. Start lift.
2. Force-close app.
3. Reopen app and go to Live Lift.

Expected:
- App reattaches to active snapshot.
- SessionId unchanged.
- `seq` continues monotonic.

### 5) Diagnostics Sweep
1. Open `Account -> Release Candidate -> Control Diagnostics`.
2. Verify:
   - active run/lift snapshot state
   - queue size
   - ack presence
3. Run “Clear Queues + Snapshots”.

Expected:
- All queues empty.
- active snapshots cleared.

## Regressions to Watch
- End confirmation stale armed state after snapshot transitions.
- Commands applying when state is `ended/saved/discarded`.
- Duplicate workout entry after `save`.
- Snapshot state remains active after `save`/`discard`.

