# Ship Closure Log — 2026-02-07

## Scope

- Today Detail: add “What you ate today” grouped by meal
- Apple Health: auto-sync on open/foreground + settings-first permission UX
- Food logging: prepared-food serving defaults (pizza slice, etc.) + guardrails against 1g nonsense

## Automated Checks Run

- `npm run -s lint` -> PASS
- `npm run -s typecheck` -> PASS
- `npm run -s verify:rc` -> PASS
- `npm run -s verify:ship-lock` -> PASS

## Changes Shipped In This Sweep

- Today Detail now renders a stable, ordered meal breakdown with per-meal totals and per-item nutrition lines (no editing controls on this screen).
- Apple Health import now:
  - auto-syncs on app open + foreground (authorized + stale only)
  - stores `lastSuccessfulHealthSyncAt` locally for 30-minute staleness gating
  - uses an explicit “Open Health Settings” fix path when access is off (no dead-end permission modal language)
- Prepared foods (pizza/burger/sandwich/etc.) now default to serving-first units (pizza defaults to slice) to prevent “2 kcal pizza” trust breaks, with:
  - serving units shown before weight units in the picker
  - inline nudge to switch to human units when grams are implausibly low or computed calories are suspiciously low

## Verification Added

- Added deterministic verification scripts (wired into `verify:rc`):
  - Today Detail meal grouping + snapshot-style regressions
  - Health auto-sync gating + settings CTA UX guard
  - Prepared food serving defaults + pizza slice conversion sanity check

## Manual Verification Required (Not Executed Here)

- iOS device test:
  - Apple Health: deny -> settings -> enable -> confirm sync timestamp updates on foreground
  - Food logging: search “pizza” -> default unit is slice + sane calories; grams path still works by explicit user choice
  - Today Detail: confirm meal grouping matches Food logger totals and ordering

