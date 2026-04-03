# Wearables Health P0 QA Checklist

Use this checklist to validate P0-critical wearables/health behaviors on physical devices before release.

## Session Metadata

- Date:
- Build/commit:
- Tester:
- iOS device + version:
- Android device + version:

## Required Preflight (Automated)

1. `npm run -s typecheck`
2. `npm run -s verify:health-auto-sync`
3. `npm run -s verify:p0-all`
4. `npm run -s p0:status`

## iOS: Apple Health Session Import (Real Workouts)

- [ ] Connect Apple Health from `/health-permissions`.
- [ ] Complete a workout in Apple Health (Apple Watch or phone source), then run `Import Today's Signals`.
- [ ] Confirm imported workout label reflects workout activity type (not only `Imported wearable activity` fallback).
- [ ] Confirm workout appears even when a manual Zenith workout already exists on the same day.
- [ ] Confirm repeated import updates existing imported entries without duplicating manual entries.

## iOS: Partial Permission Behavior (No All-or-Nothing Dead End)

- [ ] In Apple Health permissions, allow only one signal (for example Steps) and deny others.
- [ ] Return to Zenith and run import.
- [ ] Confirm import succeeds partially instead of hard-failing entire sync.
- [ ] Confirm denied/missing signals do not erase previously imported values for authorized signals.
- [ ] Confirm `connected` state remains usable after partial read errors (no silent local brick).

## iOS: Sleep Stage Aggregation Correctness

- [ ] Use a night with stage samples (`CORE`/`DEEP`/`REM`) in Apple Health.
- [ ] Run import and verify sleep minutes are non-zero and plausible.
- [ ] Verify sleep minutes do not inflate from overlapping `INBED` + asleep intervals.
- [ ] Verify fallback still works when only legacy `INBED/ASLEEP` values exist.

## iOS: Freshness / Staleness

- [ ] Import once, then add new steps/activity in Health.
- [ ] Keep app foregrounded for at least one interval cycle (5 minutes).
- [ ] Confirm sync updates without needing full app relaunch.
- [ ] Background + foreground app and confirm sync still triggers.

## Android: Health Connect Diagnostics and Import

- [ ] Open `/health-permissions` on Android and run diagnostic.
- [ ] Confirm diagnostic uses Health Connect path (not HealthKit-only failure messaging).
- [ ] With permissions granted, confirm diagnostic/import returns success or clear no-data reason.
- [ ] With permissions denied, confirm CTA routes to Health Connect settings.

## Failure Resilience (Both Platforms)

- [ ] Induce one read failure (deny one signal temporarily), keep others allowed.
- [ ] Confirm import reports partial failure reason but still imports available signals/workouts.
- [ ] Confirm sync does not flip local connection off because one read failed.
- [ ] Re-enable permission and confirm next import recovers without reset.

## Pass / Block Decision

- [ ] PASS: all critical checks complete.
- [ ] BLOCK: any P0 check failed.

## Findings

- Critical:
- High:
- Medium:
- Low:
