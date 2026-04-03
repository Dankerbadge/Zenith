# FINDINGS LOG

Severity scale:
- P0: crash/data loss/security
- P1: broken UX/major bug/release blocker
- P2: correctness/edge case/privacy risk
- P3: style/maintainability/repo hygiene

## F001 (P0) Private key material committed (Garmin developer keys)
- File: `garmin-watch/.keys/dev_build_key.pem` L1-L28
- File: `garmin-watch/.keys/developer_key.pem` L1-L28
- File: `garmin-watch/.keys/developer_key_pkcs8.pem` L1-L28
- Symptom: Repository contains plaintext private keys (signing keys). If this directory is shared or pushed to any remote, keys can be exfiltrated and abused to sign malicious builds.
- Root cause: Key material is stored under source control path `garmin-watch/.keys/`.
- Fix approach (minimal):
  1. Remove these `.pem` files from the repository.
  2. Rotate/revoke the affected keys in Garmin Connect IQ / developer tooling.
  3. Update `garmin-watch/scripts/build-watch.sh` to load key paths from local machine (env var or non-repo directory).
  4. Add ignore rules for `garmin-watch/.keys/` (and `*.pem`, `*.der`) to prevent reintroduction.
- Verification steps:
  1. `grep -RIn "BEGIN PRIVATE KEY" garmin-watch` returns no matches.
  2. Watch build script runs successfully when keys are provided via the configured local path.
- Status: FIXED (key files removed from repo tree; ignore rules already present in `.gitignore`). Remaining action: rotate/revoke the affected keys in Garmin Connect IQ (cannot be automated from this repo).
- Proof: `audit/proofs/postpatch-repo-hygiene-v2.txt` (no `BEGIN PRIVATE KEY` under `garmin-watch`; `.keys/` absent).

## F002 (P0) Binary signing key artifacts committed (Garmin `.der` keys)
- File: `garmin-watch/.keys/dev_build_key.der` (binary; line range N/A)
- File: `garmin-watch/.keys/garmin_developer_key.der` (binary; line range N/A)
- Symptom: Repository contains binary key artifacts alongside the plaintext PEM keys.
- Root cause: Key material stored under `garmin-watch/.keys/`.
- Fix approach (minimal): Same remediation as F001 (remove, rotate/revoke, ignore patterns).
- Verification steps:
  1. `ls garmin-watch/.keys` contains no key material after remediation.
  2. Watch build still works when keys are provided outside the repo.
- Status: FIXED (key artifacts removed from repo tree; `.gitignore` covers `garmin-watch/.keys/` and `*.der`).
- Proof: `audit/proofs/postpatch-repo-hygiene-v2.txt` (no `.keys/` directory).

## F003 (P1) iOS entitlements hard-coded to development APNs environment
- File: `ios/Zenith/Zenith.entitlements` L5-L6
- Symptom: Release/TestFlight builds may produce APNs tokens for the wrong environment, causing push notifications to fail or behave inconsistently in production.
- Root cause: `aps-environment` is set to `development` in the single entitlements file.
- Fix approach (minimal):
  1. Use separate entitlements for Debug vs Release (Debug: development, Release: production), or
  2. Remove the hard-coded `aps-environment` from the checked-in entitlements and set it via build configuration/provisioning as appropriate.
- Verification steps:
  1. Run `scripts/verify-xcarchive.js` (and notification-specific checks, if present) against a Release archive.
  2. Inspect the built archive entitlements to confirm `aps-environment=production` for App Store/TestFlight builds.
- Status: FIXED (Release config now points to `ios/Zenith/Zenith.Release.entitlements` with `aps-environment=production`).
- Proof:
  - `ios/Zenith/Zenith.Release.entitlements` L5-L6 sets `production`.
  - `ios/Zenith.xcodeproj/project.pbxproj` L638-L645 sets Release `CODE_SIGN_ENTITLEMENTS` to `Zenith/Zenith.Release.entitlements`.
  - `audit/proofs/postpatch-xcodebuild-archive-release.txt` shows Release archive succeeded using `Zenith.Release.entitlements`.
  - NOTE (signing pipeline): The raw `.xcarchive` may be signed with Apple Development, but `xcodebuild -exportArchive` (App Store Connect method) re-signs the IPA using Cloud Managed Apple Distribution.
    - Export proof: `audit/proofs/xcodebuild-exportArchive-appstore-test.txt` (EXPORT SUCCEEDED).
    - Distribution signing proof:
      - `audit/proofs/codesign-entitlements.ios.exported-ipa.txt` shows `aps-environment=production` and `get-task-allow=0` for the exported iOS app.
      - `audit/proofs/codesign-dvv.ios.exported-ipa.txt` shows `Authority=Apple Distribution`.
      - `ios/build/export-appstore-1.0.1-46/DistributionSummary.plist` shows certificate type `Cloud Managed Apple Distribution`.

## F004 (P2) Vercel linking metadata committed (`legal-site/.vercel`)
- File: `legal-site/.vercel/README.txt` L1-L11
- File: `legal-site/.vercel/project.json` L1-L1
- Symptom: Repository includes Vercel project linkage metadata. The bundled README explicitly states this folder should not be committed.
- Root cause: Local Vercel CLI linking directory was added to the repo.
- Fix approach (minimal):
  1. Remove `legal-site/.vercel/` from the repository.
  2. Add `.vercel/` to the appropriate `.gitignore` (root and/or `legal-site/.gitignore`).
- Verification steps:
  1. `test ! -d legal-site/.vercel`.
  2. `grep -RIn "\\.vercel" .gitignore legal-site/.gitignore` includes an ignore rule.
- Status: FIXED (directory removed; `.gitignore` ignores `.vercel/`).
- Proof: `audit/proofs/postpatch-repo-hygiene-v2.txt` (directory missing); `.gitignore` L51-L53.

## F005 (P2) Supabase CLI state directories committed (`supabase/.temp`, `ios/supabase/.temp`)
- File: `supabase/.temp/cli-latest` L1-L1 (single line; no trailing newline)
- File: `supabase/.temp/gotrue-version` L1-L1 (single line; no trailing newline)
- File: `supabase/.temp/pooler-url` L1-L1 (single line; no trailing newline)
- File: `supabase/.temp/postgres-version` L1-L1 (single line; no trailing newline)
- File: `supabase/.temp/project-ref` L1-L1 (single line; no trailing newline)
- File: `supabase/.temp/rest-version` L1-L1 (single line; no trailing newline)
- File: `supabase/.temp/storage-migration` L1-L1 (single line; no trailing newline)
- File: `supabase/.temp/storage-version` L1-L1 (single line; no trailing newline)
- File: `ios/supabase/.temp/cli-latest` L1-L1 (single line; no trailing newline)
- File: `ios/supabase/.temp/gotrue-version` L1-L1 (single line; no trailing newline)
- File: `ios/supabase/.temp/pooler-url` L1-L1 (single line; no trailing newline)
- File: `ios/supabase/.temp/postgres-version` L1-L1 (single line; no trailing newline)
- File: `ios/supabase/.temp/project-ref` L1-L1 (single line; no trailing newline)
- File: `ios/supabase/.temp/rest-version` L1-L1 (single line; no trailing newline)
- File: `ios/supabase/.temp/storage-migration` L1-L1 (single line; no trailing newline)
- File: `ios/supabase/.temp/storage-version` L1-L1 (single line; no trailing newline)
- Symptom: Repository includes generated Supabase CLI runtime metadata (versions, project ref, pooler URL).
- Root cause: Supabase CLI state folder `.temp/` was committed.
- Fix approach (minimal):
  1. Remove both `.temp/` directories from the repository.
  2. Add `.temp/` to `.gitignore` (root and/or relevant subprojects).
- Verification steps:
  1. `test ! -d supabase/.temp && test ! -d ios/supabase/.temp`.
  2. Supabase CLI still works and recreates `.temp/` locally without being committed.
- Status: FIXED (directories removed; `.gitignore` ignores `**/.temp/`).
- Proof: `audit/proofs/postpatch-repo-hygiene-v2.txt` (both directories missing); `.gitignore` L54-L56.

## F006 (P3) Xcode per-user workspace state committed (`xcuserdata`)
- File: `ios/Zenith.xcodeproj/xcuserdata/dankerbadge.xcuserdatad/xcschemes/xcschememanagement.plist` L1-L24
- File: `ios/Zenith.xcworkspace/xcuserdata/dankerbadge.xcuserdatad/IDEFindNavigatorScopes.plist` L1-L5
- File: `ios/Zenith.xcworkspace/xcuserdata/dankerbadge.xcuserdatad/UserInterfaceState.xcuserstate` L1-L33
- Symptom: Per-user Xcode state is checked in, causing noisy diffs and potential team friction.
- Root cause: `xcuserdata/` was not ignored and was committed.
- Fix approach (minimal):
  1. Remove `xcuserdata/` from the repository.
  2. Add ignore rules for `**/xcuserdata/`.
- Verification steps:
  1. `find ios -path "*xcuserdata*" -type f` returns no files after cleanup.
- Status: FIXED (xcuserdata removed; `.gitignore` ignores `**/xcuserdata/`).
- Proof: `audit/proofs/postpatch-repo-hygiene-v2.txt` (no `xcuserdata` files outside `ios/Pods`); `.gitignore` L57-L58.

## F007 (P3) macOS Finder metadata committed (`.DS_Store`)
- File: `.DS_Store` (binary; line range N/A)
- File: `supabase/.DS_Store` (binary; line range N/A)
- Symptom: Finder metadata files add noise and can cause pointless merge conflicts.
- Root cause: `.DS_Store` not ignored.
- Fix approach (minimal):
  1. Remove `.DS_Store` files.
  2. Add `.DS_Store` to `.gitignore`.
- Verification steps:
  1. `find . -name .DS_Store -not -path './node_modules/*'` returns no files.
- Status: FIXED (Finder files removed; `.gitignore` ignores `.DS_Store`).
- Proof: `audit/proofs/postpatch-repo-hygiene-v2.txt` (no `.DS_Store` files); `.gitignore` L29-L33.

## F008 (P3) Legacy local progress engine + loggers are inconsistent with current DailyLog schema
- File: `utils/progressEngine.ts` L19-L219
- File: `components/FoodLogger.tsx` L1-L216
- File: `components/WorkoutLogger.tsx` L1-L204
- File: `components/WeightLogger.tsx` L1-L173
- Symptom: These modules write/read `DailyLog.foods` and `DailyLog.xpEarned` fields that are not part of the current `utils/storageUtils.ts` `DailyLog` model (which uses `foodEntries`, `workouts`, `dailyXP`, etc.). If reintroduced into a route or modal, they will silently create divergent state and incorrect aggregates.
- Root cause: Older implementation path left in the repo while the app migrated to the canonical log schema.
- Fix approach (minimal):
  1. Confirm they are unused in routing/import graph.
  2. Either delete them, or explicitly mark as legacy (and keep fully isolated) to prevent accidental reintroduction.
- Verification steps:
  1. `grep -RIn "recordEvent(" app components` has no callsites except (if retained) explicitly-legacy screens.
  2. Manual flow test: food logging updates `DailyLog.foodEntries` and macros totals on the Today/Log screens.
- Status: FIXED (legacy modules removed to prevent schema divergence).
- Proof: `audit/proofs/postpatch-typecheck.txt` (tsc clean) and `audit/proofs/postpatch-verify-ship-lock.txt` (flow-gate scripts pass).

## F009 (P1) App Store Connect validation fails: Watch app missing icon set + CFBundleIconName
- File: `ios/ZenithWatch Watch App/Info.plist` L1-L45
- File: `ios/ZenithWatch Watch App/Assets.xcassets/AppIcon.appiconset/Contents.json` L1-L95
- Symptom: App Store Connect upload validation errors:
  - Missing Icons. No icons found for watch application bundle.
  - Missing Info.plist value for `CFBundleIconName` in watch bundle.
- Root cause: Watch bundle did not declare the icon set name in `Info.plist`, and the watch asset catalog contained only the marketing icon (no `idiom=watch` role icons).
- Fix approach (minimal):
  1. Add `CFBundleIconName=AppIcon` to the watch `Info.plist`.
  2. Add watch role icon entries + resized PNGs to `AppIcon.appiconset` so `Assets.car` contains real watch icons.
  3. Add verifier checks to prevent regression.
- Verification steps:
  1. `node scripts/verify-watch-plist.js` passes.
  2. Exported IPA contains `CFBundleIconName=AppIcon` in the watch app plist and `Assets.car` includes AppIcon records.
- Status: FIXED.
- Proof:
  - `audit/proofs/watch-infoplist.exported-ipa.build47.iconfix.txt` (`CFBundleIconName=AppIcon`, `CFBundleVersion=47`).
  - `audit/proofs/watch-assetscar.assetutil.build47.iconfix.txt` (AppIcon records present).
  - `audit/proofs/verify-xcarchive-1.0.1-47.iconfix.txt` (export sanity checks pass).
