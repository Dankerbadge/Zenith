# Zenith Runtime Proof Matrix (Non-Garmin)

Date: 2026-03-27
Scope: Non-Garmin only
Purpose: Runtime evidence campaign to close remaining `Partially complete` items.

## Campaign Status Buckets

- `Not started`
- `Ready`
- `In execution`
- `Passed`
- `Failed`
- `Blocked`
- `Retest required`

## Readiness Values

- `Ready`
- `Waiting on devices/accounts`
- `Waiting on env`
- `Waiting on build`

## Closure Decision Values

- `Complete`
- `Partial`
- `Fail`
- `Retest required`

## Closure Rule (applies to every row)

A row can move to `Complete` only when all are true:
- `Observed outcome` is filled.
- Scenario evidence files are present in the row's evidence folder.
- `Blocker` is `none` or names a concrete defect.
- Pass/fail decision is recorded in `Closure decision`.
- If failed, remediation owner and defect reference are recorded in `Observed outcome` and `Blocker`.

## First-Pass Execution Schedule

| Order | Scenario ID | Scenario | Owner | Support tester | Required accounts/devices | Required env/dependencies | Target date | Fallback date | Execution window (ET) | Result due date | Evidence expected | Evidence path | Readiness | Campaign status | Closure decision | Blocker | Expected outcome | Observed outcome |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `clubs_create_sync` | Clubs create/sync propagation | Alex | Alex (Device B tester role) | Device A + Device B, same signed-in user | Latest non-Garmin RC build, Supabase reachable, social feature enabled | 2026-03-30 | 2026-03-31 | 10:00-11:00 | 2026-03-30 | `summary.md`, screenshots/video of create on A + visibility on B, redacted logs | `docs/qa/runtime-proof/evidence/social/clubs_create_sync/` | Waiting on devices/accounts | Not started | Partial | none | Club created on A appears on B with matching metadata/ownership |  |
| 2 | `clubs_membership_sync` | Clubs membership change propagation | Alex | Alex (Device B member-account tester role) | Device A (owner/admin), Device B (member account) | Existing club from row 1, invite/request flow enabled, network stable | 2026-03-30 | 2026-03-31 | 11:15-12:15 | 2026-03-30 | `summary.md`, screenshots/video for invite/join/leave propagation, membership-state logs | `docs/qa/runtime-proof/evidence/social/clubs_membership_sync/` | Waiting on devices/accounts | Not started | Partial | none | Membership changes converge across devices without local-only divergence |  |
| 3 | `messages_send_hydrate` | Messages send/hydrate cross-device | Alex | Alex (Device B user-B tester role) | Device A (user A), Device B (user B) | DM thread bootstrap available, Supabase posts/groups access healthy | 2026-03-30 | 2026-03-31 | 13:15-14:00 | 2026-03-30 | `summary.md`, screenshots/video of send on A + hydrate on B, thread payload logs | `docs/qa/runtime-proof/evidence/social/messages_send_hydrate/` | Waiting on devices/accounts | Not started | Partial | none | Message from A persists and hydrates on B from backend truth |  |
| 4 | `messages_ordering_readstate` | Messages ordering/read-state integrity | Alex | Alex (Device B tester role) | Device A + Device B, active thread | Same RC build on both devices, synchronized clocks, stable network | 2026-03-30 | 2026-03-31 | 14:15-15:00 | 2026-03-30 | `summary.md`, ordered message capture, read-state snapshots, redacted logs | `docs/qa/runtime-proof/evidence/social/messages_ordering_readstate/` | Waiting on devices/accounts | Not started | Partial | none | Ordering is deterministic and read-state behavior matches backend model |  |
| 5 | `clubs_auth_offline` | Clubs auth boundary + degraded offline honesty | Alex | Alex (Device C non-member tester role) | Device A (member/admin), Device C (non-member), optional offline toggle | Non-member account prepared, ability to toggle offline mode, same RC build | 2026-03-31 | 2026-04-01 | 10:00-10:45 | 2026-03-31 | `summary.md`, authorization denial evidence, offline/degraded UX capture | `docs/qa/runtime-proof/evidence/social/clubs_auth_offline/` | Waiting on devices/accounts | Not started | Partial | none | Unauthorized actions denied and offline behavior is explicit (no fake success) |  |
| 6 | `messages_duplicate_auth` | Messages duplicate + auth enforcement | Alex | Alex (Device B unauthorized-path tester role) | Device A/B active thread, optional unauthorized account | Duplicate tap test harness/manual rapid taps, auth boundary account available | 2026-03-31 | 2026-04-01 | 11:00-11:45 | 2026-03-31 | `summary.md`, duplicate-attempt logs, unauthorized access denial evidence | `docs/qa/runtime-proof/evidence/social/messages_duplicate_auth/` | Waiting on devices/accounts | Not started | Partial | none | No harmful duplicate writes; unauthorized thread access denied |  |
| 7 | `purchase_restore_cancel` | Store purchase success/restore/cancel | Alex | Alex (clean sandbox device/account tester role) | iOS TestFlight sandbox device/account (Android test device if in active scope) | RC build uploaded, sandbox account prepared, SKU configured, backend verify endpoints healthy | 2026-03-31 | 2026-04-01 | 13:00-14:30 | 2026-03-31 | `summary.md`, success/cancel/restore video, redacted store + client logs, backend event snapshots | `docs/qa/runtime-proof/evidence/store/purchase_restore_cancel/` | Waiting on build | Not started | Partial | waiting on TestFlight build confirmation | Purchase/restore/cancel states are accurate with no local entitlement grant before backend verify |  |
| 8 | `entitlement_reconciliation` | Entitlement propagation + backend truth reconciliation | Alex | Alex (clean sandbox device/account tester role) | iOS sandbox account; Android test account if active scope | Completed row 7 artifacts, backend access for `iap_events` and `iap_entitlements`, entitlement refresh path available | 2026-04-01 | 2026-04-02 | 10:00-11:30 | 2026-04-01 | `summary.md`, entitlement refresh timing evidence, backend table snapshots, UI state capture | `docs/qa/runtime-proof/evidence/store/entitlement_reconciliation/` | Waiting on env | Not started | Partial | depends on row 7 completion | UI unlock occurs only after backend-confirmed entitlement; stale optimistic unlock does not occur |  |

## Notes

- Single-owner roster acknowledged: Alex is primary owner and separately accountable as support tester on second device/account roles.
- Do not reopen repo remediation lanes unless a runtime defect is found and linked to a specific row.
