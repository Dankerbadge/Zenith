# Body Map Mesh Asset Spec (P0)

## Goal
Ship a mesh-backed SceneKit/USDA body map so the iOS renderer loads a coherent surface map instead of the primitive fallback geometry.

## Target Files
- Primary: `BodyMapModel.scn`
- Alternate accepted by current loader: `BodyMap.scn`, `BodyMapModel.usdz`, `BodyMap.usdz`, `body_map.scn`
- Bundle location: app target resources (Xcode target: `Zenith`)

## Required Node Naming Contract
Each overlay node must map exactly to one of these keys (case-sensitive):

1. `CHEST_L`
2. `CHEST_R`
3. `DELTS_FRONT_L`
4. `DELTS_FRONT_R`
5. `DELTS_SIDE_L`
6. `DELTS_SIDE_R`
7. `DELTS_REAR_L`
8. `DELTS_REAR_R`
9. `BICEPS_L`
10. `BICEPS_R`
11. `TRICEPS_L`
12. `TRICEPS_R`
13. `FOREARMS_L`
14. `FOREARMS_R`
15. `UPPER_BACK_L`
16. `UPPER_BACK_R`
17. `LATS_L`
18. `LATS_R`
19. `TRAPS_L`
20. `TRAPS_R`
21. `ABS`
22. `OBLIQUES_L`
23. `OBLIQUES_R`
24. `LOWER_BACK`
25. `GLUTES_L`
26. `GLUTES_R`
27. `HIP_FLEXORS_L`
28. `HIP_FLEXORS_R`
29. `ADDUCTORS_L`
30. `ADDUCTORS_R`
31. `QUADS_L`
32. `QUADS_R`
33. `HAMSTRINGS_L`
34. `HAMSTRINGS_R`
35. `CALVES_L`
36. `CALVES_R`
37. `TIBIALIS_L`
38. `TIBIALIS_R`
39. `NECK`

Current renderer also accepts:
- `region:<id>:<KEY>`
- `region_<KEY>`

## Mesh Structure
- One neutral base body mesh node (not region-prefixed).
- 39 thin overlay shell meshes that sit on top of the base surface.
- Symmetric left/right topology and mirrored UV orientation where possible.
- Keep overlays surface-conforming (no floating islands, no volumetric marker blobs).

## Authoring Requirements
- Coordinate system: Y-up.
- Front-facing default orientation should align with camera preset `FRONT`.
- Pivot/origin near pelvis center so camera presets frame consistently.
- Reasonable poly budget for mobile:
  - Base mesh target: 6k-20k tris.
  - Overlay total target: <= 20k tris.
- Avoid self-intersection between overlay shells and base.

## Material/Look Expectations
- Base mesh: dark matte neutral, low emissive contribution.
- Region overlays: flat/clean surfaces intended for runtime tinting in SceneKit.
- No baked neon gradients in texture maps; runtime coloring controls intensity.

## Export Checklist (Blender -> SceneKit)
1. Freeze transforms.
2. Apply scale/rotation.
3. Ensure all overlay nodes keep exact names above.
4. Remove hidden helper nodes and unapplied modifiers that break exports.
5. Export to `*.scn` (preferred) or `*.usdz`.
6. Add to Xcode target resources and verify it is copied into app bundle.

## Runtime Verification Checklist
1. On app launch, `loadBundledSceneIfAvailable()` must return true.
2. `regionNodes.count` should be 39 after scene bind.
3. Tap interaction returns correct region id/key for all major muscle groups.
4. `FRONT`, `BACK`, and `ORBIT` camera presets frame the mesh cleanly.
5. ORBIT drag rotates body while parent `ScrollView` remains locked during interaction.
6. If asset missing, fallback primitive renderer still functions as non-blocking safety.

## Patch List (Code Integration)
1. Add the asset to iOS project resources (`ios/Zenith.xcodeproj/project.pbxproj`).
2. Keep `ios/Zenith/BodyMap3DView.swift` loader candidates aligned with actual filename.
3. Keep region key taxonomy in sync with `utils/bodyMapProgress.ts` and UI labels.
4. If naming diverges, update `resolveRegionMapping()` in `BodyMap3DView.swift`.
