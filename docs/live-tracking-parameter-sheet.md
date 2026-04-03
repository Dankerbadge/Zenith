# Zenith Live Tracking Parameter Sheet

This is the deterministic calibration sheet for live workout tracking.

## Global
- `REFINEMENT_DELTA_THRESHOLD_RATIO`: `0.025`
  - If post-session refinement changes a metric more than 2.5%, show a transparency note.

## Run (Live + Refinement)

### Confidence thresholds (GPS accuracy in meters)
- High confidence: `<= 12`
- Medium confidence: `<= 28`
- Low confidence: `> 28` or invalid

### Outlier rejection
- Teleport segment max distance: `0.18 mi`
- Teleport window: `< 5 sec`
- Absolute max speed: `11.2 m/s`
- Low-confidence max speed: `7.2 m/s`
- Speed ratio spike max: `2.6x`
- Speed ratio spike window: `< 6 sec`

### Route inclusion
- Point included in route only if accuracy `<= 70 m` and not outlier.

### Live integration guards
- Treat GPS stream as "lost" after: `25 sec`
  - Do not integrate distance across a stalled stream to avoid distance spikes on catch-up.
- Maximum gap considered for any estimation: `600 sec`
  - Beyond this, treat samples as stale and ignore for live integration.
- Hard reject live samples with accuracy over: `45 m`
  - Prevents very poor fixes from contaminating live pace/distance.

### Pace smoothing
- Accuracy priority window: `7` samples
- Responsiveness priority window: `4` samples
- Accuracy priority alpha: `0.26`
- Responsiveness priority alpha: `0.44`
- Minimum speed for current pace: `0.25 m/s`
- Acquiring minimum active time: `10 sec`
- Acquiring minimum samples: `3`

### Sampling profiles
- Precision: `800 ms`, `3 m`
- Balanced: `1400 ms`, `6 m`
- Eco: `2200 ms`, `12 m`

### Post-session refinement clamps
- Max refined speed: `8.8 m/s`
- Reject points with accuracy over: `45 m`
- Distance clamp low ratio: `0.92`
- Distance clamp high ratio: `1.08`

## HIIT
- Work interval: `45 sec`
- Rest interval: `15 sec`

## Mobility
- Max calories per hour cap: `380 kcal/h`

## Swim

### Refinement thresholds
- Max refined speed: `4.5 m/s`
- Reject points with accuracy over: `60 m`
- Stationary max movement: `0.003 mi`
- Stationary minimum duration: `8 sec`
- Distance clamp low ratio: `0.85`
- Distance clamp high ratio: `1.15`

## Display-state contract
For each live metric (pace, HR, distance-derived):
- `live_confident`
- `live_estimated`
- `acquiring`
- `unavailable`
- `paused`

UI must always expose metric state honestly and never fabricate values.
