# Zenith RC Signoff Template — Non-Garmin

**Release Candidate:**
**Commit SHA:**
**Build Number:**
**Date:**
**Scope:** Non-Garmin only
**Release Owner:**
**QA Owner:**
**Engineering Owner:**

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

**Owner:**
**Timestamp:**
**Result:** PASS / FAIL
**Evidence links:**
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

**Owner:**
**Timestamp:**
**Result:** PASS / FAIL
**Evidence links:**
**Notes:**

---

## 3) iOS TestFlight purchase — per SKU

**SKU tested:**

**Steps**

- Start real sandbox purchase
- Complete checkout
- Wait for backend verification and entitlement refresh

**Expected**

- Client shows `success`
- `iap_events` contains verify event
- `iap_entitlements` shows active entitlement
- UI unlock happens only after backend-confirmed refresh

**Owner:**
**Timestamp:**
**Result:** PASS / FAIL
**Evidence links:**
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

**Owner:**
**Timestamp:**
**Result:** PASS / FAIL
**Evidence links:**
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

**Owner:**
**Timestamp:**
**Result:** PASS / FAIL / NOT TESTABLE
**Evidence links:**
**Notes:**

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

**Owner:**
**Timestamp:**
**Result:** PASS / FAIL
**Evidence links:**
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

**Owner:**
**Timestamp:**
**Result:** PASS / FAIL
**Evidence links:**
**Notes:**

---

## 8) Android validation

**In active scope now?** YES / NO

If **YES**, repeat sections 3–7 for Play test purchases.

**Expected**

- Purchase token path works end to end
- Backend verification succeeds
- Entitlement remains backend-canonical

**Owner:**
**Timestamp:**
**Result:** PASS / FAIL / OUT OF SCOPE
**Evidence links:**
**Notes:**

---

## 9) Evidence package completeness

**Must include**

- Screenshots or video for each scenario
- Redacted client logs
- Supabase evidence for `iap_events`
- Supabase evidence for `iap_entitlements`
- Scenario matrix with pass/fail outcome

**Owner:**
**Timestamp:**
**Result:** PASS / FAIL
**Evidence links:**
**Notes:**

---

## 10) Final regression against original audit

**Check**

- Re-run original non-Garmin audit checklist on RC
- Compare results against the prior 11 blockers
- Confirm which blockers are closed
- Identify any remaining open item with severity

**Owner:**
**Timestamp:**
**Result:** PASS / FAIL
**Evidence links:**
**Notes:**

---

# Scenario Matrix

| Scenario                      | Platform | SKU | Expected                                  | Actual | Result           | Evidence |
|------------------------------|----------|-----|--------------------------------------------|--------|------------------|----------|
| Purchase success             | iOS      |     | Success, verify event, entitlement active  |        | PASS/FAIL        |          |
| Purchase cancel              | iOS      |     | Cancelled, no entitlement                  |        | PASS/FAIL        |          |
| Pending / lag                | iOS      |     | Pending, no local unlock                   |        | PASS/FAIL/NT     |          |
| Duplicate purchase protection| iOS      |     | No duplicate grants                        |        | PASS/FAIL        |          |
| Restore                      | iOS      |     | Restore path + backend refresh             |        | PASS/FAIL        |          |
| Purchase success             | Android  |     | Success, token verify, entitlement active  |        | PASS/FAIL/OOS    |          |
| Purchase cancel              | Android  |     | Cancelled, no entitlement                  |        | PASS/FAIL/OOS    |          |
| Pending / lag                | Android  |     | Pending, no local unlock                   |        | PASS/FAIL/NT/OOS |          |
| Duplicate purchase protection| Android  |     | No duplicate grants                        |        | PASS/FAIL/OOS    |          |
| Restore                      | Android  |     | Restore path + backend refresh             |        | PASS/FAIL/OOS    |          |

---

# Final Release Decision

**Repo gates**

- Lint: PASS / FAIL
- Typecheck: PASS / FAIL
- Ship-lock: PASS / FAIL

**Runtime validation**

- iOS purchase path: PASS / FAIL
- iOS cancel path: PASS / FAIL
- iOS restore path: PASS / FAIL
- Android path: PASS / FAIL / OUT OF SCOPE

**Audit comparison**

- Original blockers closed:
- Remaining blockers:

**Decision:** GO / NO-GO

**Approved by Release Owner:**
**Timestamp:**

**Approved by QA Owner:**
**Timestamp:**

**Approved by Engineering Owner:**
**Timestamp:**
