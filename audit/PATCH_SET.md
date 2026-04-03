# PATCH SET (Post-Audit)

This patch set applies only the minimal changes required to address Findings F001–F008. No refactors or feature work were introduced.

## F001 / F002 (P0) Garmin private keys and key artifacts committed
Before:
- `garmin-watch/.keys/` contained private key material (`*.pem`) and signing artifacts (`*.der`).

After:
- Removed `garmin-watch/.keys/` from the repo tree.
- Hardened ignore rules to reduce recurrence.

Files changed:
- Deleted: `garmin-watch/.keys/` (directory; contained the key material)
- Modified: `.gitignore` L29-L58 (added `*.der`, `.vercel/`, `**/.temp/`, `**/xcuserdata/`)

Proof:
- `audit/proofs/postpatch-repo-hygiene-v2.txt`

Manual follow-up (required):
- Rotate/revoke the affected Garmin developer keys in your Connect IQ developer account. This cannot be performed from this repository.

## F003 (P1) APNs entitlements hard-coded to development
Before:
- `ios/Zenith/Zenith.entitlements` hard-coded `aps-environment=development` and was used for both Debug and Release.

After:
- Added a Release entitlements file with `aps-environment=production`.
- Updated the Xcode project Release build settings to use the Release entitlements file.

Files changed:
- Added: `ios/Zenith/Zenith.Release.entitlements` L1-L13
- Modified: `ios/Zenith.xcodeproj/project.pbxproj` L638-L645 (Release `CODE_SIGN_ENTITLEMENTS`)

Proof:
- `audit/proofs/postpatch-xcodebuild-archive-release.txt` (Release archive succeeded)
- `audit/proofs/postpatch-verify-xcarchive-1.0.1-46.txt` (archive sanity checks passed)

Environment note:
- The archive produced on this machine still shows `aps-environment=development` and `get-task-allow=true` because Xcode signed using a development Team Provisioning Profile. For store/TestFlight, produce a distribution-signed archive and re-check entitlements via `codesign -d --entitlements :-`.

## F004 (P2) Vercel `.vercel/` metadata committed
Before:
- `legal-site/.vercel/` present.

After:
- Removed `legal-site/.vercel/`.
- Ignored `.vercel/`.

Files changed:
- Deleted: `legal-site/.vercel/`
- Modified: `.gitignore` L51-L53

Proof:
- `audit/proofs/postpatch-repo-hygiene-v2.txt`

## F005 (P2) Supabase CLI `.temp/` state committed
Before:
- `supabase/.temp/` and `ios/supabase/.temp/` present.

After:
- Removed both `.temp/` directories.
- Ignored `**/.temp/`.

Files changed:
- Deleted: `supabase/.temp/`, `ios/supabase/.temp/`
- Modified: `.gitignore` L54-L56

Proof:
- `audit/proofs/postpatch-repo-hygiene-v2.txt`
- `audit/proofs/postpatch-verify-supabase-runtime.txt` (runtime preflight still passes)

## F006 (P3) Xcode `xcuserdata/` committed
Before:
- Per-user Xcode workspace state present under `ios/Zenith.xcodeproj/xcuserdata/` and `ios/Zenith.xcworkspace/xcuserdata/`.

After:
- Removed the `xcuserdata/` directories.
- Ignored `**/xcuserdata/`.

Files changed:
- Deleted: `ios/Zenith.xcodeproj/xcuserdata/`, `ios/Zenith.xcworkspace/xcuserdata/`
- Modified: `.gitignore` L57-L58

Proof:
- `audit/proofs/postpatch-repo-hygiene-v2.txt`

## F007 (P3) `.DS_Store` committed
Before:
- `.DS_Store` files present.

After:
- Removed `.DS_Store` files.
- `.gitignore` already ignored `.DS_Store`.

Files changed:
- Deleted: `.DS_Store`, `supabase/.DS_Store`

Proof:
- `audit/proofs/postpatch-repo-hygiene-v2.txt`

## F008 (P3) Legacy progress engine + loggers inconsistent with canonical DailyLog schema
Before:
- Legacy modules existed and could be accidentally reintroduced, writing divergent DailyLog fields.

After:
- Removed the legacy modules to prevent accidental use.

Files changed:
- Deleted: `utils/progressEngine.ts`
- Deleted: `components/FoodLogger.tsx`
- Deleted: `components/WorkoutLogger.tsx`
- Deleted: `components/WeightLogger.tsx`

Proof:
- `audit/proofs/postpatch-typecheck.txt`
- `audit/proofs/postpatch-verify-ship-lock.txt`

