# Zenith RC Signoff Template — Non-Garmin (Prefilled)

**Release Candidate:** Zenith RC (non-Garmin remediation chain complete; runtime validation pending)
**Commit SHA:** N/A in this workspace (git metadata unavailable at execution time)
**Build Number:** TBD
**Date:** 2026-03-26
**Scope:** Non-Garmin only
**Release Owner:** TBD
**QA Owner:** TBD
**Engineering Owner:** TBD

## Current Remediation Status (Prefilled)

- P0.1 hygiene: complete
- Watch asset completeness: complete
- Food critical blockers: complete
- P0.2 identity integrity: complete for non-Garmin scope
- P0.3 runtime privacy readiness: complete
- P1.2 operational hard gates: complete
- P1.3b native billing completion: implemented
- Baseline repo gates: `lint` PASS, `typecheck` PASS, `verify:ship-lock` PASS
- Remaining item: runtime store-environment transactional validation (not additional planned repo remediation)

---

## 1) RC freeze and config

**Check**

- Single RC build selected
- Scope confirmed as non-Garmin
- Test environment keys configured
- RevenueCat test keys present and correct

**Required evidence**

- RC commit SHA
- Build number / TestFlight build reference
- Config snapshot or redacted env confirmation

**Owner:** TBD
**Timestamp:** TBD
**Result:** PENDING
**Evidence links:** TBD
**Notes:**

---

## 2) Baseline repo gates

**Commands**

```bash
npm run -s lint
npm run -s typecheck
npm run -s verify:ship-lock
```

**Expected**

- All pass on the exact RC commit

**Owner:** Engineering
**Timestamp:** 2026-03-26
**Result:** PASS
**Evidence links:** CLI run log in remediation thread (2026-03-26)
**Notes:**

- `npm run -s lint`: PASS (warnings only; no errors)
- `npm run -s typecheck`: PASS
- `npm run -s verify:ship-lock`: PASS

---

## 3) iOS TestFlight purchase — per SKU

**SKU tested:** TBD

**Steps**

- Start real sandbox purchase
- Complete checkout
- Wait for backend verification and entitlement refresh

**Expected**

- Client shows `success`
- `iap_events` contains verify event
- `iap_entitlements` shows active entitlement
- UI unlock happens only after backend-confirmed refresh

**Owner:** QA
**Timestamp:** TBD
**Result:** PENDING
**Evidence links:** TBD
**Notes:**

Repeat this block for each SKU.

---

## 4) iOS cancelled purchase flow

**Steps**

- Start checkout
- Cancel before completion

**Expected**

- Client shows `cancelled`
- No entitlement granted
- No false success state
- No unlock in store UI

**Owner:** QA
**Timestamp:** TBD
**Result:** PENDING
**Evidence links:** TBD
**Notes:**

---

## 5) iOS pending / verification-lag flow

**Steps**

- Trigger delayed verification if possible
- Observe UI and entitlement state before backend completion

**Expected**

- Client shows `pending`
- No local entitlement grant
- Entitlement activates only after backend confirmation

**Owner:** QA
**Timestamp:** TBD
**Result:** PENDING
**Evidence links:** TBD
**Notes:** If not reproducible in sandbox timing, mark NOT TESTABLE with rationale.

---

## 6) Duplicate purchase / restore protection

**Steps**

- Tap purchase repeatedly during in-flight processing
- Tap restore repeatedly during in-flight processing

**Expected**

- Client shows duplicate/in-progress behavior
- No duplicate entitlement grants
- No harmful duplicate verification side effects
- No inconsistent UI state

**Owner:** QA
**Timestamp:** TBD
**Result:** PENDING
**Evidence links:** TBD
**Notes:**

---

## 7) Restore flow

**Prerequisite**

- Existing prior purchase in sandbox account

**Steps**

- Run restore
- Observe backend restore invocation and entitlement refresh

**Expected**

- Restore path executes
- Correct success or pending state shown
- Backend truth refreshes entitlement
- No local simulated unlock

**Owner:** QA
**Timestamp:** TBD
**Result:** PENDING
**Evidence links:** TBD
**Notes:**

---

## 8) Android validation

**In active scope now?** TBD (YES / NO)

If **YES**, repeat sections 3–7 for Play test purchases.

**Expected**

- Purchase token path works end to end
- Backend verification succeeds
- Entitlement remains backend-canonical

**Owner:** QA / Android
**Timestamp:** TBD
**Result:** PENDING
**Evidence links:** TBD
**Notes:** Mark OUT OF SCOPE only if Android is not part of current RC lane.

---

## 9) Evidence package completeness

**Must include**

- Screenshots or video for each scenario
- Redacted client logs
- Supabase evidence for `iap_events`
- Supabase evidence for `iap_entitlements`
- Scenario matrix with pass/fail outcome

**Owner:** QA
**Timestamp:** TBD
**Result:** PENDING
**Evidence links:** TBD
**Notes:**

---

## 10) Final regression against original audit

**Check**

- Re-run original non-Garmin audit checklist on RC
- Compare results against the prior 11 blockers
- Confirm which blockers are closed
- Identify any remaining open item with severity

**Owner:** QA + Engineering
**Timestamp:** TBD
**Result:** PENDING
**Evidence links:** TBD
**Notes:**

---

# Scenario Matrix

| Scenario                       | Platform | SKU | Expected                                  | Actual | Result           | Evidence |
|-------------------------------|----------|-----|--------------------------------------------|--------|------------------|----------|
| Purchase success              | iOS      |     | Success, verify event, entitlement active  |        | PENDING          |          |
| Purchase cancel               | iOS      |     | Cancelled, no entitlement                  |        | PENDING          |          |
| Pending / lag                 | iOS      |     | Pending, no local unlock                   |        | PENDING / NT     |          |
| Duplicate purchase protection | iOS      |     | No duplicate grants                        |        | PENDING          |          |
| Restore                       | iOS      |     | Restore path + backend refresh             |        | PENDING          |          |
| Purchase success              | Android  |     | Success, token verify, entitlement active  |        | PENDING / OOS    |          |
| Purchase cancel               | Android  |     | Cancelled, no entitlement                  |        | PENDING / OOS    |          |
| Pending / lag                 | Android  |     | Pending, no local unlock                   |        | PENDING / NT/OOS |          |
| Duplicate purchase protection | Android  |     | No duplicate grants                        |        | PENDING / OOS    |          |
| Restore                       | Android  |     | Restore path + backend refresh             |        | PENDING / OOS    |          |

---

# Final Release Decision

**Repo gates**

- Lint: PASS
- Typecheck: PASS
- Ship-lock: PASS

**Runtime validation**

- iOS purchase path: PENDING
- iOS cancel path: PENDING
- iOS restore path: PENDING
- Android path: PENDING / OUT OF SCOPE

**Audit comparison**

- Original blockers closed: P0.1 hygiene; watch asset completeness; food critical blockers; P0.2 identity (non-Garmin); P0.3 runtime privacy readiness; P1.2 hard gates; P1.3b billing implementation
- Remaining blockers: Runtime store-environment transactional validation evidence and any defects found there

**Decision:** PENDING (set GO/NO-GO after runtime evidence review)

**Approved by Release Owner:** TBD
**Timestamp:** TBD

**Approved by QA Owner:** TBD
**Timestamp:** TBD

**Approved by Engineering Owner:** TBD
**Timestamp:** TBD
