# Phase 32 Continuous Monitoring Playbook

## Scope

- Offline/online parity monitoring
- Dual-read/dual-write parity drift detection
- Provider freshness monitoring
- Burn-rate based anomaly drill and remediation
- CI hard gate summary

## Scripts

- `npm run -s phase32:check-parity`
- `npm run -s phase32:check-provider`
- `npm run -s phase32:drill`
- `npm run -s phase32:remediate`
- `npm run -s phase32:report`
- `npm run -s phase32:ci-gate`
- `npm run -s phase32:dashboard`
- `npm run -s phase32:dashboard:enforce`

## Strict Mode

Use strict mode in CI to disallow synthetic fallback values.

- `node scripts/phase32/phase32-monitor-parity.js --strict`
- `node scripts/phase32/phase32-monitor-provider.js --strict`
- `node scripts/phase32/phase32-remediation.js --strict`

## Output Artifacts

- `docs/qa/phase32/parity_monitor.json`
- `docs/qa/phase32/provider_monitor.json`
- `docs/qa/phase32/anomaly_drill.json`
- `docs/qa/phase32/remediation_log.json`
- `docs/qa/phase32/daily_ops_summary.json`
- `docs/qa/phase32/weekly_reliability_trends.json`
- `docs/qa/phase32/ci_gate_summary.json`
- `docs/qa/phase32/PHASE19_32_SYSTEM_READINESS_DASHBOARD.json`
- `docs/qa/phase32/PHASE19_32_SYSTEM_READINESS_DASHBOARD.md`

## Rollout Sequence

1. Run all Phase 32 scripts in staging.
2. Validate owner routing and remediation logs.
3. Promote to canary and run `phase32:ci-gate`.
4. Enable full production monitoring once ci-gate is stable.
