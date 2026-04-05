# Body-Map Donor Integration Checklist

This checklist governs integration of donor meshes such as `Human_Body_Base_Mesh_Male.usdz`.

## Rules

1. Keep donor files under `docs/bodymap/source-assets/` (or another source-assets path).
2. Do not overwrite `ios/Zenith/BodyMapModel.usdz` until runtime contract is satisfied.
3. Donor files are source references, not production runtime assets.

## DCC Build Steps

1. Import donor mesh as base-body starting point.
2. Normalize to Zenith expectations before export:
- Y-up.
- FRONT alignment matches app FRONT preset.
- Origin/pivot near pelvis.
- Frozen/applied transforms.
3. Name the base mesh exactly `BaseBody`.
4. Build 39 thin region shells on top with exact names:
- `CHEST_L`, `CHEST_R`, `DELTS_FRONT_L`, `DELTS_FRONT_R`, `DELTS_SIDE_L`, `DELTS_SIDE_R`, `DELTS_REAR_L`, `DELTS_REAR_R`, `BICEPS_L`, `BICEPS_R`, `TRICEPS_L`, `TRICEPS_R`, `FOREARMS_L`, `FOREARMS_R`, `UPPER_BACK_L`, `UPPER_BACK_R`, `LATS_L`, `LATS_R`, `TRAPS_L`, `TRAPS_R`, `ABS`, `OBLIQUES_L`, `OBLIQUES_R`, `LOWER_BACK`, `GLUTES_L`, `GLUTES_R`, `HIP_FLEXORS_L`, `HIP_FLEXORS_R`, `ADDUCTORS_L`, `ADDUCTORS_R`, `QUADS_L`, `QUADS_R`, `HAMSTRINGS_L`, `HAMSTRINGS_R`, `CALVES_L`, `CALVES_R`, `TIBIALIS_L`, `TIBIALIS_R`, `NECK`.
5. Remove non-runtime scene junk:
- Hidden duplicates.
- Helper empties.
- Non-render utility nodes.
6. Keep runtime geometry set to only `BaseBody` + 39 required shells.
7. Ensure clean normals and no baked glow/emission.
8. Export final runtime asset to `ios/Zenith/BodyMapModel.usdz` only after all checks pass.

## Verification

1. Run `npm run -s verify:body-map-assets`.
2. Build app and capture review set:
- FRONT
- BACK
- strict 90° side-profile
- ORBIT
- base-only
- selected-region check
3. Score in this order:
- Base-only silhouette
- FRONT/BACK readability
- Side-profile anatomy
- Shell discipline
- Selected-region behavior
