# Ship Closure Log — 2026-02-04

## Environment

- Mode: CLI automation + static audit
- Device test coverage: Not executed in this run (manual required)
- OS test coverage: Not executed in this run (manual required)

## Automated Checks Run

- `npm run -s verify:rc` -> PASS
- `npx tsc --noEmit` -> PASS
- `npm run -s lint` -> PASS
- `npm run -s verify:compliance` -> PASS
- `npm run -s verify:social-safety` -> PASS
- `npm run -s verify:store-pack` -> PASS
- `npm run -s verify:ledger` -> PASS
- `npm run -s verify:primary-flows` -> PASS
- `npm run -s verify:ship-lock` -> PASS

## Static Audits Run

- Primary-flow TODO/FIXME/HACK scan -> no hits in onboarding/log/run/stats/community/account/modals core files
- AI surface usage scan -> AI calls limited to:
  - Home (`app/(tabs)/index.tsx`)
  - Stats (`app/(tabs)/stats.tsx`)
  - Post-run (`app/run-summary.tsx`)
  - Weekly recap (`app/weekly-recap.tsx`)
- AI settings scan -> toggle exists, AI optional/off by default wiring present in profile/preferences

## Code Hardening Applied In This Sweep

- Live run lifecycle hardening (start/resume/finish failure handling and transition safety)
- Run review idempotency and failure alert improvements
- Run summary storage parsing hardening
- Manual run error handling hardening
- Challenge inbox/detail duplicate-action guards and failure alerts
- Challenge evaluation quality-state correction (`invalid_data` vs `no_attempt`)
- Segment creation storage parsing hardening
- Onboarding and workout analytics storage parsing hardening
- Run control strip receives native state updates/acks in real-time (not only polling)
- Connectivity state now degrades to explicit `disconnected` snapshot for honest UX
- Ended-state controls now map to `Save`/`Discard` in Home run strip
- Compliance screens now include direct actions for privacy URL, terms URL, and support email
- Added scripted checks for compliance config and primary-flow marker sweep
- Home tab now surfaces deterministic Effort Debt status (tier, clear-path estimate, latest effort-memory headline) with direct link to Behavior Core
- Supabase client now reads runtime env vars (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`) with safe placeholder fallback in dev
- Release Candidate screen now includes backend readiness status and Supabase setup guidance
- Added `docs/SUPABASE_NEXT_ACTIONS.md` with concrete Phase 28-30 backend checklist
- Added `scripts/verify-social-safety.js` and wired `verify:ship-lock` to enforce social/comms safety guardrails (rate limits + block enforcement + community tab structure)
- Replaced club event fallback location text from placeholder (`TBD`) to user-safe copy (`Location not set`)
- Added `scripts/verify-store-pack.js` to enforce store metadata/file readiness and URL/email consistency
- Added `scripts/verify-release-ledger.js` to enforce complete Phase 0-30 status coverage with valid status values
- Added QA report automation:
  - `scripts/create-qa-session.js` (`npm run -s qa:new`)
  - `scripts/verify-qa-report.js` (`npm run -s verify:qa-report`)
- Added `docs/QA_AUTOMATION.md` with RC manual-gauntlet workflow
- Added RC status snapshot generator:
  - `scripts/build-rc-dashboard.js` (`npm run -s rc:dashboard`)
  - outputs `docs/RC_DASHBOARD.md` with current PASS/PARTIAL/BLOCKED counts and remaining phases

## Manual Verification Required (Not Executed Here)

- Phase 6 polish perception tests
- Phase 12 speed target timing tests
- Phase 17–20 chaos QA matrix
- Phase 23.7 visual/tone acceptance tests
- Phase 23.8 denominator QA table
- Phase 25 AI behavioral matrix
- Phase 28 rate-limit + block leak tests
- Phase 30.1 full manual gauntlet
- Phase 30.2 performance baseline comparison on device
- Phase 30.3 App Store asset and public-link validation

## Blocking Items Before Ship

- Manual gauntlet and performance runs are still required
- Public production Privacy Policy URL / Terms URL must be live-hosted and reachable
- Final PASS/DEFER ledger signoff required
