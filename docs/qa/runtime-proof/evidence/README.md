# Runtime Proof Evidence Layout

Store artifacts under the scenario folder named in the matrix.

Recommended per-scenario contents:

- `summary.md` with: preconditions, actions, expected, observed, PASS/FAIL, caveats
- `screenshots/` and/or `video/`
- `logs/` (redacted)
- `backend/` snapshots (for example `iap_events`, `iap_entitlements` queries)

Do not include secrets or raw payment tokens in artifacts.
