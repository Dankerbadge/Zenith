# Human Body Base Mesh Male (Source Donor Asset)

- Source file: `Human_Body_Base_Mesh_Male.usdz`
- Source URL: <https://sketchfab.com/3d-models/human-body-base-mesh-male-3678451d8ccb435e833f8a10729c09f5>
- Retrieved: 2026-04-04
- Intended use in Zenith: donor base-body reference for sculpting and retopology workflow.
- Runtime policy: **do not** use this file as `ios/Zenith/BodyMapModel.usdz` directly.

## Licensing

The source page marks this model as Creative Commons Attribution (CC BY).
Maintain attribution with this source asset in-repo and in release notes as needed.

## Integration Guardrail

Zenith runtime expects one `BaseBody` plus 39 exact region meshes (`CHEST_L` ... `NECK`) in `BodyMapModel.usdz`.
This donor file is not treated as a drop-in runtime body-map asset.
