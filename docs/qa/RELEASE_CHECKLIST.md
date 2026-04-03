# Release Checklist (Phases 19-32)

## Purpose

This checklist is the release-control reference for food logging/search readiness across Phases 19-32.

## Required Inputs

- Supabase secrets in CI:
  `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- Optional Phase 32 telemetry vars in CI:
  `PHASE32_*`

## Required Commands (Local/Staging)

1. `npm run -s verify:food-audit-gates`
2. `npm run -s phase31:fixtures`
3. `npm run -s phase31:hard-gates`
4. `npm run -s verify:phase32`
5. `npm run -s phase32:dashboard:enforce`
6. `npm run -s verify:ship-lock`

## CI Workflow

- Workflow file: `/Users/dankerbadge/Desktop/Zenith/.github/workflows/phase19_32_readiness.yml`
- Trigger: pull requests to `main`, pushes to `main`, and manual dispatch.
- Enforced steps:
  `verify:food-audit-gates`, `verify:phase32`, `phase32:dashboard:enforce`
- Artifact upload path:
  `docs/qa/FOOD_SYSTEM_PROD_AUDIT.*`, `docs/qa/food_audit_gate_report.*`, `docs/qa/phase31/**`, `docs/qa/phase32/**`

## Branch Protection (Recommended)

Apply this to branch `main` in GitHub branch protection rules.

GitHub UI click path:

1. Open repository on GitHub.
2. Go to `Settings` -> `Branches`.
3. Under `Branch protection rules`, click `Add rule` (or `Add classic branch protection rule`).
4. In `Branch name pattern`, enter `main`.
5. Enable settings listed below and save.

1. Enable `Require a pull request before merging`.
2. Enable `Require status checks to pass before merging`.
3. Add required check:
   `Phase19-32 Readiness / readiness`
4. Enable `Require branches to be up to date before merging`.
5. Enable `Do not allow bypassing the above settings`.

Optional hardening:

- Enable `Require review from Code Owners`.
- Enable `Require conversation resolution before merging`.
- Enable `Require signed commits` if your org policy requires it.

## Pass Criteria

1. `/Users/dankerbadge/Desktop/Zenith/docs/qa/food_audit_gate_report.json` has `"ok": true`
2. `/Users/dankerbadge/Desktop/Zenith/docs/qa/phase31/hard_gates.json` has `"ok": true`
3. `/Users/dankerbadge/Desktop/Zenith/docs/qa/phase32/ci_gate_summary.json` has `"ok": true`
4. `/Users/dankerbadge/Desktop/Zenith/docs/qa/phase32/PHASE19_32_SYSTEM_READINESS_DASHBOARD.json` has `"releaseReady": true`

## Blocker Ownership

- `food_audit_high_critical_clear`: Release Engineering
- `phase31_hard_gates`: SRE
- `phase32_ci_gate`: QA / DevOps
- Feature-specific owners are listed in:
  `/Users/dankerbadge/Desktop/Zenith/docs/qa/phase32/PHASE19_32_SYSTEM_READINESS_DASHBOARD.md`

## Release Decision

1. If all pass criteria are true, approve release.
2. If any criterion fails, block release and assign blockers by owner.
3. Re-run the required commands after remediation and only proceed on green.
