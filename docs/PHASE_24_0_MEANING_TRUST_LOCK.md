# Phase 24.0 - Meaning & Trust Lock

## Purpose
This lock defines the data semantics and trust constraints that all AI and insight features must follow.

## Canonical active day definition
A day is an **active day** if any of these were logged:
- food
- workout or run
- water
- active rest
- weight

Source of truth: `utils/semanticTrust.ts` (`isActiveDay`, `getActiveDaySignals`).

## Metric intent definitions
- Calories: energy intake on days food is logged.
- Workouts: intentional training sessions.
- Runs: tracked endurance efforts.
- Water: hydration events, not compliance.
- Weight: measurement points, not a daily obligation.

Source of truth: `utils/semanticTrust.ts` (`METRIC_INTENT`).

## Day confidence grading
Every day has confidence graded by available logging evidence:
- `none`: no meaningful logging
- `partial`: single signal
- `good`: at least two meaningful signals
- `strong`: food + activity, or activity bundle indicating high completeness

Source of truth: `utils/semanticTrust.ts` (`getDayConfidence`).

## AI trust contract
Zenith AI must never invent user intent.

AI may:
- summarize logged patterns
- propose hypotheses
- suggest low-pressure next steps

AI may not:
- assume motivation
- assume emotion
- assume failure
- infer goals that are not logged

## AI-safe future surfaces
Allowed surfaces (opt-in, non-interruptive):
- Home insight card
- Stats contextual explainers
- Post-run summary
- Weekly recap

Not allowed surfaces:
- active tracking
- logging modals
- error states
- empty states

## Default AI state
AI overlay must default to OFF and require explicit user opt-in.

Stored preference: `userProfile.preferences.aiOverlayEnabled`.

## Tone rules for streak and adherence messaging
Use supportive language only.

Avoid:
- "lost"
- "failed"
- "broken"

Prefer:
- "paused"
- "restarted"
- "new run begins"
