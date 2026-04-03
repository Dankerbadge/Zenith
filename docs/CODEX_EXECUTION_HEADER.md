# Zenith Deterministic Execution Header

Use this as the default reasoning contract for all feature work.

## Core Invariants
- Physiological truth is authoritative; manual inputs never override wearable/system workout truth.
- Engines are a closed set: `endurance`, `strength`, `mixed_intensity`, `recovery`, `water`.
- Sport profiles are semantic wrappers only; they cannot alter engine math or authority rules.
- Settlement is idempotent and deterministic: same inputs produce the same outputs.
- Winning Day uses strict conditions only; no hidden fallback paths.
- Effort Debt accrues and repays by explicit formulas; no silent resets.
- Consequences are explainable in one sentence from stored evidence.

## Required Processing Order
1. Ingest session
2. Classify authority
3. Settle session effects
4. Evaluate daily winning state
5. Update debt
6. Update discipline
7. Award currency
8. Evaluate memory events
9. Lock day record

## Forbidden Behaviors
- No XP award without settled session evidence.
- No rule changes by UI labels or profile naming.
- No shaming copy in user-facing surfaces.
- No background loops for AI or social polling.
- No duplicate progression side effects from repeated saves.

## Safety Overrides
- Injury/Illness capacity overrides always suppress No Excuses mode.
- Recovery can count only within weekly caps and ceiling thresholds.
- Low-quality/repeated low-effort repayment is discounted.

## UX Guarantees
- User can always see: current debt, debt tier, payoff path, and active multipliers.
- If progress is reduced, user can tap and see the exact reason.
- AI remains opt-in, off by default, and evidence-backed only.
