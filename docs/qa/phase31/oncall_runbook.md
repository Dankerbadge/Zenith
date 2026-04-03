# Phase 31 Production Operations — On-Call Runbook

Tiers:
- Tier 1: DevOps / Backend Eng — primary for Sev1/Sev2 alerts
- Tier 2: Phase Owner (Privacy, Admin, Sync) — escalated if unresolved > 15-30 minutes
- Tier 3: Team Lead / Engineering Manager — final escalation for critical outages

Escalation Windows:
- Sev1: every 15 minutes until resolved
- Sev2: every 30-60 minutes until resolved

Ownership Map:
- Search latency issues: DevOps -> Phase Owner
- Logging dual-write mismatch: Backend Eng -> Phase Owner
- Offline sync failure: QA -> Backend Eng
- Export/Import failures: Data Eng -> Ops
- Privacy/Consent enforcement errors: Privacy Owner -> Phase Owner
- Retention purge failures: Backend Eng -> Privacy Owner
- Admin replay failures: Ops -> Phase Owner

Audit Requirements:
- Every on-call handoff logged with timestamp, reason, and pending actions
- All automated remediation or replay jobs must record audit events

Incident Reporting:
- Severity, timestamp, owner, description, auto-halt/rollback status
