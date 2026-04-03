# Zenith Garmin QA Device Tiers (P0)

This matrix defines release-gating test depth for the current manifest product set.

## Tier 1 (Required Manual + Simulator QA)

Run full workflow on these devices before every Garmin upload:
- `fr255` (Forerunner MIP baseline)
- `fr965` (Forerunner AMOLED high-res)
- `fenix7` (Fenix MIP button-first baseline)
- `fenix8pro47mm` (Fenix next-gen profile)
- `venu3` (touch + AMOLED mainstream)
- `epix2pro47mm` (high-density AMOLED endurance class)
- `vivoactive5` (consumer touch profile)
- `instinct3solar45mm` (low-color/solar style constraints)

Full workflow:
1. Start run
2. Pause/resume
3. End confirm
4. Save and discard paths
5. Verify metrics render (time, distance, pace, HR, calories)
6. Verify no clipped footer hints / no off-screen text
7. Verify status screen delivery timestamp path

## Tier 2 (Compile + Smoke)

Compile must pass and quick launch/screen smoke check:
- `fr165`
- `fr165m`
- `fr255s`
- `fr255m`
- `fr255sm`
- `fr265`
- `fr265s`
- `fr945`
- `fr955`
- `fenix7s`
- `fenix7x`
- `fenix7pro`
- `fenix7spro`
- `fenix7xpro`
- `fenix843mm`
- `fenix847mm`
- `fenix8solar47mm`
- `fenix8solar51mm`
- `venu2`
- `venu2s`
- `venu2plus`
- `venu3s`
- `venu441mm`
- `venu445mm`
- `venusq2`
- `vivoactive6`
- `epix2`
- `epix2pro42mm`
- `epix2pro51mm`
- `enduro3`
- `instinct3amoled45mm`
- `instinct3amoled50mm`
- `instincte40mm`
- `instincte45mm`

## Tier 3 (Optional Regression Sweep)

Run when changing:
- rendering/layout logic
- fonts/strings/resources
- session timing math
- outbox delivery behavior

Suggested expanded spot checks:
- smallest round model in manifest (`fr165`)
- largest high-density model (`fenix8solar51mm` or `epix2pro51mm`)
- touch-first model (`venu3`)
- button-first model (`fenix7`)

## Release Gate

A Garmin upload is release-ready when:
1. `BUILD SUCCESSFUL` for `.iq` export.
2. Tier 1 devices pass full workflow without clipping or control ambiguity.
3. Tier 2 compile + smoke passes.
4. App Store listing assets/text match current UX and metrics.

## Resource Qualifier Coverage (P0)

Explicit qualifier folders currently shipped:
- `resources-round-208x208` (small round)
- `resources-round-218x218` (small round legacy)
- `resources-round-240x240` (legacy mainstream round)
- `resources-round-260x260` (Forerunner/Fenix baseline)
- `resources-round-280x280` (large MIP round)
- `resources-round-360x360` (mid AMOLED small)
- `resources-round-390x390` (mid AMOLED)
- `resources-round-416x416` (mid AMOLED large)
- `resources-round-454x454` (high-density AMOLED)
- `resources-rectangle-240x240` (square/rect class)
- `resources-rectangle-320x360` (tall rectangular class)

These qualifiers are mandatory and validated by `npm run -s verify:garmin-readiness`.
