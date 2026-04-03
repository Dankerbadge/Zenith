# Phase 30 RC Gauntlet

This checklist is the final release-candidate gate for Zenith.

## 1) Automation Gate

Run:

- `npm run verify:rc`

Expected:

- Lint passes
- Typecheck passes

## 2) Manual Stability Paths

Validate each path on iOS and Android where possible:

- Rapid taps on log save buttons (food, water, workout, rest, weight)
- Run lifecycle stress path: start -> pause -> resume -> end -> review -> save
- Run discard path: start -> end -> review -> discard
- Rotate device during run review, stats, community, and modals
- Background and foreground during run tracking and paused state
- Offline logging and later app relaunch

Expected:

- No duplicate saves
- No stuck modal states
- No state corruption after relaunch

## 3) GPS and Battery Safety

- Confirm GPS only active in run tracking state
- Confirm GPS is off in paused/review/ended states
- Confirm no background polling loops for social, AI, or wearable sync

Expected:

- Battery impact remains controlled
- No accidental background tracking

## 4) Data and Trust Checks

- AI remains optional and OFF by default for new users
- Stats averages use logged-day denominators by default
- Zero-denominator averages render as `—`
- Challenge outcomes remain deterministic and non-duplicated

Expected:

- No misleading averages
- No contradictory challenge outcomes

## 5) Store Readiness

- Privacy policy and support contact finalized
- Permission copy finalized (location, camera, notifications, health)
- Screenshots match shipped UI
- Compliance and safety screens reachable from Account

Expected:

- Build is ready for final App Store metadata submission
