# Watch + Live Activity QA Gauntlet

## Preconditions
- Apple Watch paired, app installed on phone + watch.
- iPhone has Live Activities enabled.
- Start from `idle` state (no active session).

## Sequence rules to verify in every test
- `sessionId` stays identical across watch + phone for one run.
- `seq` strictly increases; never decreases or repeats for accepted state updates.
- Duplicate command taps do not create duplicate runs or duplicate saves.

## Stopwatch script

### 1) Start / pause / resume / end (watch-local)
1. Tap `Start` on watch.
2. Wait 15s, tap `Pause`.
3. Wait 10s (paused), tap `Resume`.
4. Wait 10s, tap `End` once.
5. Tap `End` once only and wait >2.5s (must NOT end).
6. Tap `End`, then second tap within 2.5s (must end).
7. Tap `Save`.

Expected:
- Moving time excludes paused 10s.
- End never occurs on single tap.
- Exactly one saved run entry.

### 2) Live Activity remote pause/resume (app closed)
1. Start run on watch.
2. Force close iPhone app.
3. From Live Activity, tap `Pause`.
4. Wait 5s, tap `Resume`.

Expected:
- Watch transitions to paused/resumed reliably.
- No login prompt.
- Live Activity reflects state within one update window.

### 3) Live Activity remote end double-confirm (app closed)
1. While recording, on Live Activity tap `End` once.
2. Wait >2.5s (should auto-disarm, run continues).
3. Tap `End` then tap again within 2.5s.
4. Save from ended controls.

Expected:
- First attempt does not end.
- Second attempt ends exactly once.
- Save produces one run for same `sessionId`.

### 4) Disconnect behavior
1. Start run on watch.
2. Turn off Bluetooth on phone for 30s.
3. Try end from phone surface.
4. Re-enable Bluetooth.
5. End from phone or watch.

Expected:
- Phone shows disconnected/waiting state; does not fake end.
- Watch continues recording uninterrupted.
- Reconnect restores mirrored state.

### 5) Background / relaunch recovery
1. Start run on watch.
2. Lock phone for 2 minutes.
3. Unlock phone, open app.
4. Verify Home run strip state.

Expected:
- App reattaches to active session (no new session created).
- `sessionId` unchanged.

### 6) Duplicate command hardening
1. On ended screen, tap `Save` rapidly 5 times.
2. Repeat with `End` taps during active run.

Expected:
- One save only.
- No duplicate run records.
- No invalid state transition.

## Pass/Fail gate
PASS only if all tests succeed with:
- no crash,
- no duplicated entries,
- no timing drift,
- no accidental single-tap end,
- no auth requirement for controls.
