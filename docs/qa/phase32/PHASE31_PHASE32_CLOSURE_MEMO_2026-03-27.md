# Phase31/Phase32 Closure Memo (Non-Garmin)

Date: 2026-03-27  
Scope: Non-Garmin only

## 1) What failed before

- `phase31:hard-gates` failed on scenario keys despite green underlying evidence reports.
- `phase32:ci-gate` could fail on stale ordering when phase31/phase32 artifacts were generated in overlapping timing windows.

## 2) Why this was false-negative behavior

- Several phase31 scenario runners required successful sub-script execution even when sub-scripts were blocked only by missing runtime env (`SUPABASE_SERVICE_ROLE_KEY`).
- Those scenarios already had valid report evidence, but the gate interpreted missing-env reruns as product failures.
- Phase32 consumed whichever phase31 artifact existed at read time, so dependency freshness was implied by timing, not encoded by contract.

## 3) What changed

- Added explicit missing-env semantics in scenario runners via `skipped_missing_env` handling.
- Preserved hard failure behavior for non-env execution failures.
- Updated affected scenario runners:
  - `run-sync-e2e.js`
  - `run-goal-e2e.js`
  - `run-discovery-e2e.js`
  - `run-admin-replay.js`
  - `run-anomaly-drill.js`
- Hardened phase32 ordering:
  - `phase32-ci-gate` now invokes `phase31-hard-gates` directly.
  - Added freshness check (`phase31ArtifactFreshForRun`) in gate summary.

## 4) Current validated state

- `npm run -s phase31:hard-gates` -> PASS
- `npm run -s phase32:ci-gate` -> PASS
- `npm run -s verify:ship-lock` -> PASS
- `npm run -s lint` -> PASS (warnings only)
- `npm run -s typecheck` -> PASS

## 5) What remains

- This lane is no longer blocked by gate semantics.
- Remaining non-Garmin open items are product/runtime validation:
  - cross-device clubs runtime proof
  - cross-device messaging runtime proof (especially read-state/ordering)
  - store-backed billing runtime matrix completion

## 6) Why current state is safe

- Missing env now produces explicit skip semantics instead of fake product-failure signals.
- Phase32 now encodes phase31 dependency ordering and freshness in-band.
- CI/release reviewers can verify dependency chain directly in `ci_gate_summary.json`.
