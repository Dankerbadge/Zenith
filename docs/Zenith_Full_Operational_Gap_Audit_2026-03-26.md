# Zenith Full Operational Gap Audit (Non-Garmin Scope)

Generated: 2026-03-26 (America/New_York)

## Scope
- Full repo review for unfinished/unbuilt operational pathways across app UI, service layers, Supabase functions, and release gates.
- Garmin-specific backend/integration findings are intentionally excluded per updated scope.

## Validation Performed
- `npm run -s verify:routes` (passed)
- `node scripts/report-incomplete-routes.js` (no placeholder route targets)
- `npm run -s typecheck` (passed)
- `npm run -s lint` (failed)
- `npm run -s verify:p0-all` (failed)
- `npm run -s verify:supabase-runtime` (failed)
- `npm run -s phase31:hard-gates` (failed)
- `npm run -s phase32:ci-gate` (failed)
- Targeted static analysis across `app/`, `utils/`, `supabase/`, `scripts/`

## Route/Tile Wiring Baseline
- File-level route target resolution is currently intact (`verify:routes` passed; 276 route files scanned).
- No obvious placeholder route destinations were detected by `report-incomplete-routes.js`.
- Main operational gaps are in runtime behavior, identity wiring, backend availability, and release readiness gates.

## Findings

### 1) CRITICAL — Social/Club identity wiring is hard-coded to `local_user`
Impacted pathways:
- Clubs: create/join/manage/member actions
- Social privacy settings screen
- Safety center counts
- Run completion social/challenge events

Evidence:
- `app/clubs/index.tsx:17`
- `app/clubs/[clubId].tsx:43`
- `app/account/social-privacy.tsx:17`
- `app/account/safety.tsx:7`
- `app/run-review.tsx:553`
- `app/run-review.tsx:560`
- `app/run-review.tsx:613`
- `app/_layout.tsx:25`

Why this is incomplete:
- Actions are attributed to a static local identity instead of the authenticated account, so multi-user correctness and account-scoped behavior are not fully operational.

Completion target:
- Replace hard-coded `local_user` with authenticated user identity plumbing end-to-end.

### 2) CRITICAL — Clubs/Messaging backend is local-storage only (not full server-backed operation)
Impacted pathways:
- Club lifecycle, invites, moderation state, membership transitions
- DM and club chat persistence/consistency

Evidence:
- `utils/clubsService.ts:1`
- `utils/clubsService.ts:5`
- `utils/clubsService.ts:93`
- `utils/clubsService.ts:107`
- `utils/messageService.ts:1`
- `utils/messageService.ts:6`
- `utils/messageService.ts:93`
- `utils/messageService.ts:107`

Why this is incomplete:
- Data is persisted via AsyncStorage service-local records, which does not provide robust server-backed, cross-device, account-consistent operation expected for full production social pathways.

Completion target:
- Move these pathways to authenticated Supabase-backed APIs with server-authoritative writes, reconciliation, and cross-device reads.

### 3) CRITICAL — Privacy edge functions are missing from deployed runtime
Impacted pathways:
- Privacy consent enforcement
- Public share privacy controls
- Data explanation endpoint
- Retention enforcement workflows

Evidence:
- Direct runtime probe result: missing function 404s for `privacy-consent`, `privacy-data-explanation`, `privacy-public-shares`, `privacy-retention-enforce`.
- `utils/privacyService.ts:98`
- `utils/privacyService.ts:119`
- `utils/privacyService.ts:136`
- `utils/privacyService.ts:142`
- `utils/privacyService.ts:151`
- `utils/privacyService.ts:169`
- `docs/qa/phase31/hard_gates.md:12`
- `docs/qa/phase31/hard_gates.md:13`

Why this is incomplete:
- Privacy backend contracts are referenced by client and hard-gate checks but not reachable in the deployed project.

Completion target:
- Deploy missing privacy functions and validate invocation/auth/RLS behavior in runtime.

### 4) HIGH — Release hard gates are failing (Phase 31 + Phase 32)
Impacted pathways:
- Offline/online sync readiness
- Parity/dual-path verification
- Privacy/retention compliance readiness
- Export/import reliability and rollback/canary operational confidence

Evidence:
- `docs/qa/phase31/hard_gates.md:10`
- `docs/qa/phase31/hard_gates.md:18`
- `docs/qa/phase31/hard_gates.json:113` (missing `SUPABASE_SERVICE_ROLE_KEY`)
- `docs/qa/phase31/hard_gates.json:169` (missing `e2e_report.json`)
- `docs/qa/phase32/ci_gate_summary.md:10`
- `docs/qa/phase32/ci_gate_summary.md:13`
- `docs/qa/phase32/ci_gate_summary.json:70`

Why this is incomplete:
- Operational validation suite is not passing, leaving high-risk backend/runtime paths unverified for production operation.

Completion target:
- Provide required envs/artifacts, execute full scenario suite, and close all failing gates.

### 5) HIGH — Lint/quality gate is blocked by AppleDouble (`._*`) artifact contamination
Impacted pathways:
- CI quality gates
- Static analysis reliability
- Release engineering hygiene

Evidence:
- `npm run -s lint` fails with parse errors on `._*` files.
- `find app components src utils supabase scripts -name '._*' -type f | wc -l` => 531 artifacts.
- Example parse target: `app/(modals)/._food.tsx`.
- `docs/qa/FOOD_SYSTEM_PROD_AUDIT.json:308` (repo hygiene finding includes AppleDouble artifacts)

Why this is incomplete:
- Tooling gates fail before meaningful linting due non-source binary metadata artifacts tracked in source tree.

Completion target:
- Remove `._*` files, enforce ignore/cleanup guard, and re-run lint gates.

### 6) HIGH — Watch app icon asset set is incomplete (build/store blocker)
Impacted pathways:
- Watch app packaging and App Store validation
- P0 verification chain

Evidence:
- `scripts/verify-watch-plist.js:87`
- `scripts/verify-watch-plist.js:102`
- `ios/ZenithWatch Watch App/Assets.xcassets/AppIcon.appiconset` currently contains only `Contents.json` (missing required PNG icon assets)
- `npm run -s verify:p0-all` fails via `Missing Watch App icon file: AppIcon-1024.png`

Why this is incomplete:
- Required watch icon files are absent, so release packaging cannot be considered fully operational.

Completion target:
- Add required icon files referenced in `verify-watch-plist.js` and validate watch asset catalog.

### 7) MEDIUM — Supabase runtime verifier has false-positive logic (`_shared` treated as deployable function)
Impacted pathways:
- Backend readiness signal quality
- CI/runtime diagnostics trustworthiness

Evidence:
- `scripts/verify-supabase-runtime.js:202` through `scripts/verify-supabase-runtime.js:207` includes all non-dot directories as function names.
- `_shared` exists as helper directory under `supabase/functions/_shared` and returns 404 when probed as edge function.
- Script failure observed: `edge function "_shared" not found (404)`.

Why this is incomplete:
- Validation script currently mixes helper folders with deployable functions, producing false failures that can obscure real failures.

Completion target:
- Exclude helper directories like `_shared` from deployment reachability probes.

### 8) MEDIUM — Messaging pathway has MVP-era functional restriction (links blocked)
Impacted pathways:
- DM text message behavior for URL-containing messages

Evidence:
- `utils/messageService.ts:481`
- `utils/messageService.ts:483` returns `Links are disabled in MVP messaging.`

Why this is incomplete:
- URL sharing behavior is intentionally blocked, so user intent to send links does not execute as a fully built messaging capability.

Completion target:
- Implement link-safe messaging policy (allowlist/preview/moderation enforcement) instead of blanket rejection.

### 9) HIGH — Food production audit reports unresolved high-critical blockers
Impacted pathways:
- Food logging architecture
- Offline pack integrity
- Export/import portability
- Admin operations and runtime compatibility

Evidence:
- `docs/qa/food_audit_gate_report.md:5`
- `docs/qa/food_audit_gate_report.md:10`
- `docs/qa/food_audit_gate_report.md:18`
- `docs/qa/food_audit_gate_report.md:29`
- `docs/qa/food_audit_gate_report.md:45`
- `docs/qa/food_audit_gate_report.md:49`

Why this is incomplete:
- Internal production audit remains failed with documented high-critical missing/partial capabilities.

Completion target:
- Close listed high-critical blockers and re-run the food audit gate until green.

## Consolidated Readiness Status (Non-Garmin)
- Route references: PASS
- Type safety: PASS
- Lint hygiene: FAIL
- P0 verification: FAIL
- Supabase runtime verification: FAIL
- Phase31 hard gates: FAIL
- Phase32 CI gate: FAIL
- Food production audit gate: FAIL

## Summary
The app has broad UI surface coverage and route wiring, but it is not at full operational functionality due to identity hard-coding, local-only social/club service paths, missing privacy runtime functions, failing hard-gate suites, release-blocking asset/hygiene issues, and unresolved high-critical food-system gaps.
