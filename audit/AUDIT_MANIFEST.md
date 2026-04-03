# AUDIT MANIFEST (Post-Patch)

| file_path | file_type | approx_loc | reviewed | risk_level | notes |
|---|---:|---:|:---:|:---:|---|
| `.env.local` | `local` | 9 | Y | H | Reviewed L1-L9. Verified: readable. Risk indicators: SUPABASE_KEY_REF x1 (L2). |
| `.gitignore` | `noext` | 58 | Y | M | Reviewed L1-L58. Verified: readable. Risk indicators: none detected by scan. |
| `.node-version` | `noext` | 1 | Y | M | Reviewed L1-L1. Verified: readable. Risk indicators: none detected by scan. |
| `.nvmrc` | `noext` | 1 | Y | M | Reviewed L1-L1. Verified: readable. Risk indicators: none detected by scan. |
| `.vercelignore` | `noext` | 9 | Y | M | Reviewed L1-L9. Verified: readable. Risk indicators: none detected by scan. |
| `.vscode/extensions.json` | `json` | 1 | Y | M | Reviewed L1-L1. Verified: readable; JSON parse OK. Risk indicators: none detected by scan. |
| `.vscode/settings.json` | `json` | 7 | Y | M | Reviewed L1-L7. Verified: readable; JSON parse OK. Risk indicators: none detected by scan. |
| `README.md` | `md` | 166 | Y | L | Reviewed L1-L166. Verified: readable. Risk indicators: none detected by scan. |
| `app.json` | `json` | 63 | Y | M | Reviewed L1-L63. Verified: readable; JSON parse OK. Risk indicators: SUPABASE_KEY_REF x1 (L13). |
| `app/(modals)/_layout.tsx` | `tsx` | 25 | Y | M | Reviewed L1-L25. Verified: readable. Risk indicators: none detected by scan. |
| `app/(modals)/food-scan.tsx` | `tsx` | 125 | Y | M | Reviewed L1-L125. Verified: readable. Risk indicators: TS_ANY x1 (L19). |
| `app/(modals)/food.tsx` | `tsx` | 1961 | Y | M | Reviewed L1-L1961. Verified: readable. Risk indicators: TS_ANY x19 (L190,191,192,193,194,203,…(+13)). |
| `app/(modals)/rest.tsx` | `tsx` | 363 | Y | M | Reviewed L1-L363. Verified: readable. Risk indicators: CONSOLE_LOG x2 (L173,189); TS_ANY x1 (L72). |
| `app/(modals)/streak.tsx` | `tsx` | 190 | Y | M | Reviewed L1-L190. Verified: readable. Risk indicators: none detected by scan. |
| `app/(modals)/walk.tsx` | `tsx` | 334 | Y | M | Reviewed L1-L334. Verified: readable. Risk indicators: TS_ANY x4 (L68,69,70,74). |
| `app/(modals)/water.tsx` | `tsx` | 372 | Y | M | Reviewed L1-L372. Verified: readable. Risk indicators: TS_ANY x3 (L53,54,77). |
| `app/(modals)/weight.tsx` | `tsx` | 309 | Y | M | Reviewed L1-L309. Verified: readable. Risk indicators: TS_ANY x1 (L59). |
| `app/(modals)/workout-session.tsx` | `tsx` | 160 | Y | M | Reviewed L1-L160. Verified: readable. Risk indicators: TS_ANY x2 (L55,66). |
| `app/(modals)/workout.tsx` | `tsx` | 1226 | Y | M | Reviewed L1-L1226. Verified: readable. Risk indicators: TS_ANY x3 (L167,170,171). |
| `app/(tabs)/_layout.tsx` | `tsx` | 294 | Y | M | Reviewed L1-L294. Verified: readable. Risk indicators: TS_ANY x1 (L24). |
| `app/(tabs)/community/index.tsx` | `tsx` | 1371 | Y | M | Reviewed L1-L1371. Verified: readable. Risk indicators: TS_ANY x37 (L274,306,310,317,351,360,…(+31)). |
| `app/(tabs)/index.tsx` | `tsx` | 2290 | Y | M | Reviewed L1-L2290. Verified: readable. Risk indicators: TS_ANY x61 (L334,365,367,368,601,602,…(+55)). |
| `app/(tabs)/log/index.tsx` | `tsx` | 727 | Y | M | Reviewed L1-L727. Verified: readable. Risk indicators: TS_ANY x4 (L71,79,304,405). |
| `app/(tabs)/profile.tsx` | `tsx` | 1121 | Y | M | Reviewed L1-L1121. Verified: readable. Risk indicators: TS_ANY x23 (L251,277,278,320,575,608,…(+17)). |
| `app/(tabs)/stats.tsx` | `tsx` | 1497 | Y | M | Reviewed L1-L1497. Verified: readable. Risk indicators: TS_ANY x28 (L119,317,330,346,364,400,…(+22)). |
| `app/_layout.tsx` | `tsx` | 85 | Y | M | Reviewed L1-L85. Verified: readable. Risk indicators: none detected by scan. |
| `app/account/achievements.tsx` | `tsx` | 355 | Y | M | Reviewed L1-L355. Verified: readable. Risk indicators: TS_ANY x1 (L28). |
| `app/account/behavior-core.tsx` | `tsx` | 220 | Y | M | Reviewed L1-L220. Verified: readable. Risk indicators: TS_ANY x2 (L66,131). |
| `app/account/coaching.tsx` | `tsx` | 179 | Y | M | Reviewed L1-L179. Verified: readable. Risk indicators: TS_ANY x2 (L35,51). |
| `app/account/compliance.tsx` | `tsx` | 113 | Y | M | Reviewed L1-L113. Verified: readable. Risk indicators: TS_ANY x1 (L59). |
| `app/account/control-diagnostics.tsx` | `tsx` | 198 | Y | M | Reviewed L1-L198. Verified: readable. Risk indicators: none detected by scan. |
| `app/account/delete.tsx` | `tsx` | 321 | Y | M | Reviewed L1-L321. Verified: readable. Risk indicators: TS_ANY x2 (L22,257). |
| `app/account/effort-currency.tsx` | `tsx` | 148 | Y | M | Reviewed L1-L148. Verified: readable. Risk indicators: none detected by scan. |
| `app/account/goals.tsx` | `tsx` | 92 | Y | M | Reviewed L1-L92. Verified: readable. Risk indicators: none detected by scan. |
| `app/account/monetization.tsx` | `tsx` | 68 | Y | M | Reviewed L1-L68. Verified: readable. Risk indicators: none detected by scan. |
| `app/account/preferences.tsx` | `tsx` | 233 | Y | M | Reviewed L1-L233. Verified: readable. Risk indicators: TS_ANY x13 (L34,75,77,174,178,181,…(+7)). |
| `app/account/privacy-policy.tsx` | `tsx` | 110 | Y | M | Reviewed L1-L110. Verified: readable. Risk indicators: TS_ANY x1 (L68). |
| `app/account/ranks-xp.tsx` | `tsx` | 105 | Y | M | Reviewed L1-L105. Verified: readable. Risk indicators: none detected by scan. |
| `app/account/release-readiness.tsx` | `tsx` | 136 | Y | M | Reviewed L1-L136. Verified: readable. Risk indicators: SUPABASE_KEY_REF x1 (L69); TS_ANY x4 (L52,82,105,108). |
| `app/account/safety.tsx` | `tsx` | 72 | Y | M | Reviewed L1-L72. Verified: readable. Risk indicators: none detected by scan. |
| `app/account/social-privacy.tsx` | `tsx` | 125 | Y | M | Reviewed L1-L125. Verified: readable. Risk indicators: none detected by scan. |
| `app/account/streak-history.tsx` | `tsx` | 101 | Y | M | Reviewed L1-L101. Verified: readable. Risk indicators: none detected by scan. |
| `app/account/workout-loadouts.tsx` | `tsx` | 166 | Y | M | Reviewed L1-L166. Verified: readable. Risk indicators: none detected by scan. |
| `app/auth/forgot-password.tsx` | `tsx` | 193 | Y | M | Reviewed L1-L193. Verified: readable. Risk indicators: TS_ANY x2 (L80,87). |
| `app/auth/login.tsx` | `tsx` | 245 | Y | M | Reviewed L1-L245. Verified: readable. Risk indicators: TS_ANY x2 (L102,110). |
| `app/auth/reset-password.tsx` | `tsx` | 239 | Y | M | Reviewed L1-L239. Verified: readable. Risk indicators: TS_ANY x1 (L157). |
| `app/auth/signup.tsx` | `tsx` | 275 | Y | M | Reviewed L1-L275. Verified: readable. Risk indicators: TS_ANY x1 (L138). |
| `app/challenges/[id].tsx` | `tsx` | 218 | Y | M | Reviewed L1-L218. Verified: readable. Risk indicators: TS_ANY x4 (L53,67,127,183). |
| `app/challenges/index.tsx` | `tsx` | 214 | Y | M | Reviewed L1-L214. Verified: readable. Risk indicators: TS_ANY x3 (L53,67,155). |
| `app/clubs/[clubId].tsx` | `tsx` | 710 | Y | M | Reviewed L1-L710. Verified: readable. Risk indicators: TS_ANY x1 (L289). |
| `app/clubs/index.tsx` | `tsx` | 241 | Y | M | Reviewed L1-L241. Verified: readable. Risk indicators: TS_ANY x3 (L61,75,132). |
| `app/community/manage-friends.tsx` | `tsx` | 226 | Y | M | Reviewed L1-L226. Verified: readable. Risk indicators: none detected by scan. |
| `app/context/authcontext.tsx` | `tsx` | 931 | Y | M | Reviewed L1-L931. Verified: readable. Risk indicators: CONSOLE_LOG x2 (L522,893); TS_ANY x8 (L158,165,171,177,198,207,…(+2)). |
| `app/debug/keyboard-jitter.tsx` | `tsx` | 132 | Y | M | Reviewed L1-L132. Verified: readable. Risk indicators: TS_ANY x1 (L30). |
| `app/friends/find.tsx` | `tsx` | 249 | Y | M | Reviewed L1-L249. Verified: readable. Risk indicators: none detected by scan. |
| `app/friends/invite.tsx` | `tsx` | 227 | Y | M | Reviewed L1-L227. Verified: readable. Risk indicators: none detected by scan. |
| `app/groups/[groupId].tsx` | `tsx` | 415 | Y | M | Reviewed L1-L415. Verified: readable. Risk indicators: TS_ANY x8 (L41,63,65,66,86,107,…(+2)). |
| `app/groups/index.tsx` | `tsx` | 356 | Y | M | Reviewed L1-L356. Verified: readable. Risk indicators: TS_ANY x12 (L22,23,35,46,62,63,…(+6)). |
| `app/health-permissions.tsx` | `tsx` | 785 | Y | M | Reviewed L1-L785. Verified: readable. Risk indicators: TS_ANY x1 (L585). |
| `app/home/rank-details.tsx` | `tsx` | 56 | Y | M | Reviewed L1-L56. Verified: readable. Risk indicators: none detected by scan. |
| `app/home/today-detail.tsx` | `tsx` | 177 | Y | M | Reviewed L1-L177. Verified: readable. Risk indicators: TS_ANY x6 (L29,43,44,45,46,47). |
| `app/home/winning-day.tsx` | `tsx` | 95 | Y | M | Reviewed L1-L95. Verified: readable. Risk indicators: TS_ANY x5 (L74,75,76,77,78). |
| `app/live-lift.tsx` | `tsx` | 629 | Y | M | Reviewed L1-L629. Verified: readable. Risk indicators: none detected by scan. |
| `app/live-run.tsx` | `tsx` | 1888 | Y | M | Reviewed L1-L1888. Verified: readable. Risk indicators: ESLINT_DISABLE x1 (L381); TS_ANY x9 (L204,226,227,269,467,895,…(+3)). |
| `app/live-session.tsx` | `tsx` | 1096 | Y | M | Reviewed L1-L1096. Verified: readable. Risk indicators: TS_ANY x6 (L233,234,242,623,690,706). |
| `app/manual-run.tsx` | `tsx` | 186 | Y | M | Reviewed L1-L186. Verified: readable. Risk indicators: TS_ANY x1 (L71). |
| `app/messages/[threadId].tsx` | `tsx` | 232 | Y | M | Reviewed L1-L232. Verified: readable. Risk indicators: TS_ANY x7 (L41,46,60,62,65,73,…(+1)). |
| `app/messages/index.tsx` | `tsx` | 154 | Y | M | Reviewed L1-L154. Verified: readable. Risk indicators: TS_ANY x5 (L12,42,53,58,97). |
| `app/notification-settings.tsx` | `tsx` | 686 | Y | M | Reviewed L1-L686. Verified: readable. Risk indicators: none detected by scan. |
| `app/onboarding.tsx` | `tsx` | 774 | Y | M | Reviewed L1-L774. Verified: readable. Risk indicators: CONSOLE_LOG x1 (L297); TS_ANY x8 (L89,92,105,113,291,294,…(+2)). |
| `app/pack/[id].tsx` | `tsx` | 83 | Y | M | Reviewed L1-L83. Verified: readable. Risk indicators: none detected by scan. |
| `app/paywall.tsx` | `tsx` | 114 | Y | M | Reviewed L1-L114. Verified: readable. Risk indicators: TS_ANY x3 (L21,57,63). |
| `app/run-review.tsx` | `tsx` | 825 | Y | M | Reviewed L1-L825. Verified: readable. Risk indicators: TS_ANY x34 (L118,123,124,138,146,147,…(+28)). |
| `app/run-summary.tsx` | `tsx` | 1357 | Y | M | Reviewed L1-L1357. Verified: readable. Risk indicators: CONSOLE_LOG x2 (L28,253); ESLINT_DISABLE x1 (L23); TS_ANY x16 (L44,45,132,180,191,193,…(+10)). |
| `app/segments/create.tsx` | `tsx` | 332 | Y | M | Reviewed L1-L332. Verified: readable. Risk indicators: CONSOLE_LOG x1 (L71). |
| `app/segments/index.tsx` | `tsx` | 93 | Y | M | Reviewed L1-L93. Verified: readable. Risk indicators: none detected by scan. |
| `app/stats/day/[date].tsx` | `tsx` | 115 | Y | M | Reviewed L1-L115. Verified: readable. Risk indicators: TS_ANY x3 (L9,52,57). |
| `app/stats/metric/[metric].tsx` | `tsx` | 247 | Y | M | Reviewed L1-L247. Verified: readable. Risk indicators: TS_ANY x5 (L78,80,85,188,203). |
| `app/store.tsx` | `tsx` | 922 | Y | M | Reviewed L1-L922. Verified: readable. Risk indicators: TS_ANY x3 (L39,70,113). |
| `app/teams/[teamId].tsx` | `tsx` | 256 | Y | M | Reviewed L1-L256. Verified: readable. Risk indicators: TS_ANY x8 (L20,21,22,41,61,119,…(+2)). |
| `app/teams/index.tsx` | `tsx` | 301 | Y | M | Reviewed L1-L301. Verified: readable. Risk indicators: TS_ANY x9 (L17,18,19,52,72,81,…(+3)). |
| `app/wearables/garmin.tsx` | `tsx` | 762 | Y | M | Reviewed L1-L762. Verified: readable. Risk indicators: TS_ANY x1 (L355). |
| `app/wearables/index.tsx` | `tsx` | 103 | Y | M | Reviewed L1-L103. Verified: readable. Risk indicators: TS_ANY x2 (L34,47). |
| `app/weekly-recap.tsx` | `tsx` | 212 | Y | M | Reviewed L1-L212. Verified: readable. Risk indicators: TS_ANY x4 (L63,71,120,160). |
| `app/workout-analytics.tsx` | `tsx` | 696 | Y | M | Reviewed L1-L696. Verified: readable. Risk indicators: CONSOLE_LOG x1 (L85). |
| `assets/images/ZenithLogo2.png` | `binary` | 0 | Y | L | Binary file (excluded from content review). Verified: exists; size=245959 bytes; sha256=2581249f15e8… |
| `assets/images/ZenithLogo3.png` | `binary` | 0 | Y | L | Binary file (excluded from content review). Verified: exists; size=424573 bytes; sha256=f49a2ab6a315… |
| `assets/images/android-icon-background.png` | `binary` | 0 | Y | L | Binary file (excluded from content review). Verified: exists; size=70466 bytes; sha256=5a86cf7e6242… |
| `assets/images/android-icon-foreground.png` | `binary` | 0 | Y | L | Binary file (excluded from content review). Verified: exists; size=70466 bytes; sha256=5a86cf7e6242… |
| `assets/images/android-icon-monochrome.png` | `binary` | 0 | Y | L | Binary file (excluded from content review). Verified: exists; size=52200 bytes; sha256=43041dede208… |
| `assets/images/favicon.png` | `binary` | 0 | Y | L | Binary file (excluded from content review). Verified: exists; size=1335 bytes; sha256=3a11b0528df4… |
| `assets/images/icon.png` | `binary` | 0 | Y | L | Binary file (excluded from content review). Verified: exists; size=245959 bytes; sha256=2581249f15e8… |
| `assets/images/partial-react-logo.png` | `binary` | 0 | Y | L | Binary file (excluded from content review). Verified: exists; size=5075 bytes; sha256=015a72aeb24c… |
| `assets/images/react-logo.png` | `binary` | 0 | Y | L | Binary file (excluded from content review). Verified: exists; size=6341 bytes; sha256=224b7636b15e… |
| `assets/images/react-logo@2x.png` | `binary` | 0 | Y | L | Binary file (excluded from content review). Verified: exists; size=14225 bytes; sha256=fa600be9ad2f… |
| `assets/images/react-logo@3x.png` | `binary` | 0 | Y | L | Binary file (excluded from content review). Verified: exists; size=21252 bytes; sha256=cd84e02a5d54… |
| `assets/images/splash-icon.png` | `binary` | 0 | Y | L | Binary file (excluded from content review). Verified: exists; size=17547 bytes; sha256=5f4c0a732b63… |
| `audit/AUDIT_MANIFEST.csv` | `csv` | 474 | Y | M | Reviewed L1-L474. Verified: readable. Risk indicators: FIXME x8 (L99,100,107,108,173,174,…(+2)); TODO x10 (L99,100,107,108,164,173,…(+4)). |
| `audit/AUDIT_MANIFEST.md` | `md` | 477 | Y | L | Reviewed L1-L477. Verified: readable. Risk indicators: FIXME x8 (L102,103,110,111,176,177,…(+2)); TODO x10 (L102,103,110,111,167,176,…(+4)). |
| `audit/AUDIT_MANIFEST_PHASE0.csv` | `csv` | 442 | Y | M | Reviewed L1-L442. Verified: readable. Risk indicators: none detected by scan. |
| `audit/AUDIT_MANIFEST_PHASE0.md` | `md` | 445 | Y | L | Reviewed L1-L445. Verified: readable. Risk indicators: none detected by scan. |
| `audit/FINDINGS_LOG.md` | `md` | 163 | Y | L | Reviewed L1-L163. Verified: readable. Risk indicators: PRIVATE_KEY x2 (L21,24); TS_ANY x1 (L13). |
| `audit/FLOW_TRACES.md` | `md` | 186 | Y | L | Reviewed L1-L186. Verified: readable. Risk indicators: TS_ANY x1 (L38). |
| `audit/PATCH_SET.md` | `md` | 118 | Y | L | Reviewed L1-L118. Verified: readable. Risk indicators: none detected by scan. |
| `audit/PHASE0_INVENTORY.md` | `md` | 12 | Y | L | Reviewed L1-L12. Verified: readable. Risk indicators: none detected by scan. |
| `audit/PHASE1_SCAN.json` | `json` | 13631 | Y | M | Reviewed L1-L13631. Verified: readable; JSON parse OK. Risk indicators: FIXME x442 (L15,43,71,99,127,155,…(+436)); TODO x442 (L14,42,70,98,126,154,…(+436)). |
| `audit/PHASE4_SCAN.json` | `json` | 6840 | Y | M | Reviewed L1-L6840. Verified: readable; JSON parse OK. Risk indicators: FIXME x16 (L1700,1729,1739,1768,1859,1910,…(+10)); TODO x20 (L1713,1729,1752,1768,1884,1910,…(+14)). |
| `audit/proofs/codesign-dv.ios.autosign-test.txt` | `txt` | 3 | Y | L | Reviewed L1-L3. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/codesign-dvv.ios.autosign-test.txt` | `txt` | 6 | Y | L | Reviewed L1-L6. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/codesign-dvv.ios.exported-ipa.txt` | `txt` | 6 | Y | L | Reviewed L1-L6. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/codesign-entitlements.ios.autosign-test.txt` | `txt` | 9 | Y | L | Reviewed L1-L9. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/codesign-entitlements.ios.exported-ipa.txt` | `txt` | 10 | Y | L | Reviewed L1-L10. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/codesign-entitlements.watch.exported-ipa.txt` | `txt` | 9 | Y | L | Reviewed L1-L9. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/codesign-entitlements.widgets.exported-ipa.txt` | `txt` | 6 | Y | L | Reviewed L1-L6. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/lint.txt` | `txt` | 2 | Y | L | Reviewed L1-L2. Verified: readable. Risk indicators: SUPABASE_KEY_REF x1 (L2). |
| `audit/proofs/postpatch-key-artifact-sweep.txt` | `txt` | 2 | Y | L | Reviewed L1-L2. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/postpatch-lint.after-xcarchive-script.txt` | `txt` | 3 | Y | L | Reviewed L1-L3. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/postpatch-lint.build47.iconfix.txt` | `txt` | 3 | Y | L | Reviewed L1-L3. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/postpatch-lint.build47.txt` | `txt` | 3 | Y | L | Reviewed L1-L3. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/postpatch-lint.txt` | `txt` | 2 | Y | L | Reviewed L1-L2. Verified: readable. Risk indicators: SUPABASE_KEY_REF x1 (L2). |
| `audit/proofs/postpatch-repo-hygiene-v2.txt` | `txt` | 18 | Y | L | Reviewed L1-L18. Verified: readable. Risk indicators: PRIVATE_KEY x1 (L4). |
| `audit/proofs/postpatch-repo-hygiene.txt` | `txt` | 18 | Y | L | Reviewed L1-L18. Verified: readable. Risk indicators: PRIVATE_KEY x3 (L2,3,4). |
| `audit/proofs/postpatch-secret-sweep.txt` | `txt` | 2293 | Y | L | Reviewed L1-L2293. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/postpatch-typecheck.after-xcarchive-script.txt` | `txt` | 1 | Y | L | Reviewed L1-L1. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/postpatch-typecheck.build47.iconfix.txt` | `txt` | 1 | Y | L | Reviewed L1-L1. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/postpatch-typecheck.build47.txt` | `txt` | 1 | Y | L | Reviewed L1-L1. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/postpatch-typecheck.txt` | `txt` | 0 | Y | L | Reviewed L1-L0. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/postpatch-verify-garmin-readiness.txt` | `txt` | 19 | Y | L | Reviewed L1-L19. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/postpatch-verify-p0-all.txt` | `txt` | 6834 | Y | L | Reviewed L1-L6834. Verified: readable. Risk indicators: SUPABASE_KEY_REF x2 (L4373,6760); TS_ANY x1 (L1225). |
| `audit/proofs/postpatch-verify-ship-lock.build47.txt` | `txt` | 76 | Y | L | Reviewed L1-L76. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/postpatch-verify-ship-lock.txt` | `txt` | 75 | Y | L | Reviewed L1-L75. Verified: readable. Risk indicators: SUPABASE_KEY_REF x1 (L2). |
| `audit/proofs/postpatch-verify-supabase-runtime.txt` | `txt` | 8 | Y | L | Reviewed L1-L8. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/postpatch-verify-xcarchive-1.0.1-46.txt` | `txt` | 8 | Y | L | Reviewed L1-L8. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/postpatch-xcodebuild-archive-release.txt` | `txt` | 60999 | Y | L | Reviewed L1-L60999. Verified: readable. Risk indicators: SUPABASE_KEY_REF x1 (L42256); TS_ANY x3 (L24113,55406,60989). |
| `audit/proofs/project.pbxproj.pre-dist-signing.pbxproj` | `pbxproj` | 1041 | Y | L | Reviewed L1-L1041. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/provisioning-profiles-ls.txt` | `txt` | 10 | Y | L | Reviewed L1-L10. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/provisioning-profiles-summary.txt` | `txt` | 7 | Y | L | Reviewed L1-L7. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/security-find-identity-codesigning.after-export.txt` | `txt` | 2 | Y | L | Reviewed L1-L2. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/security-find-identity-codesigning.txt` | `txt` | 3 | Y | L | Reviewed L1-L3. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/typecheck.txt` | `txt` | 0 | Y | L | Reviewed L1-L0. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/verify-p0-all.txt` | `txt` | 40557 | Y | L | Reviewed L1-L40557. Verified: readable. Risk indicators: SUPABASE_KEY_REF x2 (L16394,40483); TS_ANY x2 (L36256,40471). |
| `audit/proofs/verify-ship-lock.txt` | `txt` | 75 | Y | L | Reviewed L1-L75. Verified: readable. Risk indicators: SUPABASE_KEY_REF x1 (L2). |
| `audit/proofs/verify-xcarchive-1.0.1-24.txt` | `txt` | 1 | Y | L | Reviewed L1-L1. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/verify-xcarchive-1.0.1-46.txt` | `txt` | 8 | Y | L | Reviewed L1-L8. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/verify-xcarchive-1.0.1-47.iconfix.txt` | `txt` | 13 | Y | L | Reviewed L1-L13. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/verify-xcarchive.after-export-ipa-check.txt` | `txt` | 13 | Y | L | Reviewed L1-L13. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/verify-xcarchive.txt` | `txt` | 1 | Y | L | Reviewed L1-L1. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/watch-assetscar.assetutil.build47.iconfix.txt` | `txt` | 8 | Y | L | Reviewed L1-L8. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/watch-assetscar.exported-ipa.build47.iconfix.txt` | `txt` | 1 | Y | L | Reviewed L1-L1. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/watch-infoplist.exported-ipa.build47.iconfix.txt` | `txt` | 4 | Y | L | Reviewed L1-L4. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/xcodebuild-archive-release-dist.autosign.txt` | `txt` | 1233 | Y | L | Reviewed L1-L1233. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/xcodebuild-archive-release-dist.txt` | `txt` | 1236 | Y | L | Reviewed L1-L1236. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/xcodebuild-archive-release-distribution-attempt.txt` | `txt` | 1238 | Y | L | Reviewed L1-L1238. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/xcodebuild-archive-release.autosign-test.txt` | `txt` | 61254 | Y | L | Reviewed L1-L61254. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/xcodebuild-archive-release.build47.iconfix.txt` | `txt` | 61007 | Y | L | Reviewed L1-L61007. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/xcodebuild-archive-release.txt` | `txt` | 73162 | Y | L | Reviewed L1-L73162. Verified: readable. Risk indicators: SUPABASE_KEY_REF x1 (L52955); TS_ANY x3 (L25703,66021,73152). |
| `audit/proofs/xcodebuild-exportArchive-appstore-test.txt` | `txt` | 5 | Y | L | Reviewed L1-L5. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/xcodebuild-exportArchive-appstore.build47.iconfix.txt` | `txt` | 5 | Y | L | Reviewed L1-L5. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/xcodebuild-release-buildsettings.after-dist-signing.autosign.extensions.txt` | `txt` | 57 | Y | L | Reviewed L1-L57. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/xcodebuild-release-buildsettings.after-dist-signing.autosign.txt` | `txt` | 14 | Y | L | Reviewed L1-L14. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/xcodebuild-release-buildsettings.after-dist-signing.extensions.txt` | `txt` | 61 | Y | L | Reviewed L1-L61. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/xcodebuild-release-buildsettings.after-dist-signing.txt` | `txt` | 15 | Y | L | Reviewed L1-L15. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/xcodebuild-release-buildsettings.after-remove-identity.extensions.txt` | `txt` | 57 | Y | L | Reviewed L1-L57. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/xcodebuild-release-buildsettings.after-remove-identity.txt` | `txt` | 14 | Y | L | Reviewed L1-L14. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/xcodebuild-release-buildsettings.build47.txt` | `txt` | 2 | Y | L | Reviewed L1-L2. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/xcodebuild-release-buildsettings.txt` | `txt` | 15 | Y | L | Reviewed L1-L15. Verified: readable. Risk indicators: none detected by scan. |
| `audit/proofs/xcodebuild-sim-debug-nosdk.txt` | `txt` | 67470 | Y | L | Reviewed L1-L67470. Verified: readable. Risk indicators: SUPABASE_KEY_REF x1 (L38281); TS_ANY x4 (L13483,58790,59317,67461). |
| `audit/proofs/xcodebuild-sim-debug.txt` | `txt` | 14359 | Y | L | Reviewed L1-L14359. Verified: readable. Risk indicators: TS_ANY x1 (L14347). |
| `backups/_layout.BACKUP_before_community.tsx` | `tsx` | 274 | Y | M | Reviewed L1-L274. Verified: readable. Risk indicators: TS_ANY x1 (L24). |
| `backups/_layout.OLD_before_community.tsx` | `tsx` | 274 | Y | M | Reviewed L1-L274. Verified: readable. Risk indicators: TS_ANY x1 (L24). |
| `components/AppErrorBoundary.tsx` | `tsx` | 70 | Y | M | Reviewed L1-L70. Verified: readable. Risk indicators: none detected by scan. |
| `components/ErrorBoundary.tsx` | `tsx` | 242 | Y | M | Reviewed L1-L242. Verified: readable. Risk indicators: TS_ANY x4 (L15,18,49,129). |
| `components/LoadingComponents.tsx` | `tsx` | 392 | Y | M | Reviewed L1-L392. Verified: readable. Risk indicators: TS_ANY x1 (L12). |
| `components/NotAvailable.tsx` | `tsx` | 63 | Y | M | Reviewed L1-L63. Verified: readable. Risk indicators: TS_ANY x3 (L11,22,30). |
| `components/PremiumGate.tsx` | `tsx` | 370 | Y | M | Reviewed L1-L370. Verified: readable. Risk indicators: TS_ANY x1 (L45). |
| `components/RankUpModal.tsx` | `tsx` | 163 | Y | M | Reviewed L1-L163. Verified: readable. Risk indicators: none detected by scan. |
| `components/WinningDayToast.tsx` | `tsx` | 104 | Y | M | Reviewed L1-L104. Verified: readable. Risk indicators: none detected by scan. |
| `components/external-link.tsx` | `tsx` | 25 | Y | M | Reviewed L1-L25. Verified: readable. Risk indicators: none detected by scan. |
| `components/haptic-tab.tsx` | `tsx` | 18 | Y | M | Reviewed L1-L18. Verified: readable. Risk indicators: none detected by scan. |
| `components/hello-wave.tsx` | `tsx` | 19 | Y | M | Reviewed L1-L19. Verified: readable. Risk indicators: none detected by scan. |
| `components/inputs/NumberPadTextInput.tsx` | `tsx` | 95 | Y | M | Reviewed L1-L95. Verified: readable. Risk indicators: none detected by scan. |
| `components/inputs/ZenithNumberPadAccessory.tsx` | `tsx` | 63 | Y | M | Reviewed L1-L63. Verified: readable. Risk indicators: TS_ANY x2 (L19,21). |
| `components/layout/ZenithKeyboardAvoidingView.tsx` | `tsx` | 13 | Y | M | Reviewed L1-L13. Verified: readable. Risk indicators: none detected by scan. |
| `components/layout/ZenithScrollView.tsx` | `tsx` | 22 | Y | M | Reviewed L1-L22. Verified: readable. Risk indicators: TS_ANY x1 (L8). |
| `components/parallax-scroll-view.tsx` | `tsx` | 79 | Y | M | Reviewed L1-L79. Verified: readable. Risk indicators: none detected by scan. |
| `components/themed-text.tsx` | `tsx` | 60 | Y | M | Reviewed L1-L60. Verified: readable. Risk indicators: none detected by scan. |
| `components/themed-view.tsx` | `tsx` | 14 | Y | M | Reviewed L1-L14. Verified: readable. Risk indicators: none detected by scan. |
| `components/ui/ActionCard.tsx` | `tsx` | 88 | Y | M | Reviewed L1-L88. Verified: readable. Risk indicators: none detected by scan. |
| `components/ui/Chip.tsx` | `tsx` | 46 | Y | M | Reviewed L1-L46. Verified: readable. Risk indicators: none detected by scan. |
| `components/ui/ExplainSheet.tsx` | `tsx` | 121 | Y | M | Reviewed L1-L121. Verified: readable. Risk indicators: none detected by scan. |
| `components/ui/GlassCard.tsx` | `tsx` | 42 | Y | M | Reviewed L1-L42. Verified: readable. Risk indicators: none detected by scan. |
| `components/ui/MetricCard.tsx` | `tsx` | 86 | Y | M | Reviewed L1-L86. Verified: readable. Risk indicators: none detected by scan. |
| `components/ui/MiniChartCard.tsx` | `tsx` | 100 | Y | M | Reviewed L1-L100. Verified: readable. Risk indicators: none detected by scan. |
| `components/ui/SectionHeader.tsx` | `tsx` | 42 | Y | M | Reviewed L1-L42. Verified: readable. Risk indicators: none detected by scan. |
| `components/ui/collapsible.tsx` | `tsx` | 45 | Y | M | Reviewed L1-L45. Verified: readable. Risk indicators: none detected by scan. |
| `components/ui/icon-symbol.ios.tsx` | `tsx` | 32 | Y | M | Reviewed L1-L32. Verified: readable. Risk indicators: none detected by scan. |
| `components/ui/icon-symbol.tsx` | `tsx` | 41 | Y | M | Reviewed L1-L41. Verified: readable. Risk indicators: none detected by scan. |
| `constants/ranks.ts` | `ts` | 78 | Y | M | Reviewed L1-L78. Verified: readable. Risk indicators: none detected by scan. |
| `constants/theme.ts` | `ts` | 53 | Y | M | Reviewed L1-L53. Verified: readable. Risk indicators: none detected by scan. |
| `docs/APP_STORE_LISTING.md` | `md` | 259 | Y | L | Reviewed L1-L259. Verified: readable. Risk indicators: none detected by scan. |
| `docs/CODEX_EXECUTION_HEADER.md` | `md` | 40 | Y | L | Reviewed L1-L40. Verified: readable. Risk indicators: none detected by scan. |
| `docs/FEATURES.md` | `md` | 592 | Y | L | Reviewed L1-L592. Verified: readable. Risk indicators: none detected by scan. |
| `docs/GARMIN_CONNECTIQ_NEXT_ACTIONS.md` | `md` | 46 | Y | L | Reviewed L1-L46. Verified: readable. Risk indicators: SUPABASE_KEY_REF x1 (L45). |
| `docs/LAUNCH_CHECKLIST.md` | `md` | 397 | Y | L | Reviewed L1-L397. Verified: readable. Risk indicators: CONSOLE_LOG x1 (L6); TODO x1 (L7); TS_ANY x4 (L309,320,326,327). |
| `docs/LIFT_CONTROL_QA_GAUNTLET.md` | `md` | 75 | Y | L | Reviewed L1-L75. Verified: readable. Risk indicators: none detected by scan. |
| `docs/MANUAL_QA_SESSION_SCRIPT.md` | `md` | 83 | Y | L | Reviewed L1-L83. Verified: readable. Risk indicators: none detected by scan. |
| `docs/MONETIZATION_POLICY_V1.md` | `md` | 44 | Y | L | Reviewed L1-L44. Verified: readable. Risk indicators: none detected by scan. |
| `docs/PHASE_24_0_MEANING_TRUST_LOCK.md` | `md` | 77 | Y | L | Reviewed L1-L77. Verified: readable. Risk indicators: TS_ANY x1 (L7). |
| `docs/PHASE_30_RC_GAUNTLET.md` | `md` | 65 | Y | L | Reviewed L1-L65. Verified: readable. Risk indicators: none detected by scan. |
| `docs/PRIVACY_POLICY.md` | `md` | 233 | Y | L | Reviewed L1-L233. Verified: readable. Risk indicators: none detected by scan. |
| `docs/QA_AUTOMATION.md` | `md` | 25 | Y | L | Reviewed L1-L25. Verified: readable. Risk indicators: none detected by scan. |
| `docs/RC_DASHBOARD.md` | `md` | 33 | Y | L | Reviewed L1-L33. Verified: readable. Risk indicators: none detected by scan. |
| `docs/RELEASE_LOCK_LEDGER.md` | `md` | 69 | Y | L | Reviewed L1-L69. Verified: readable. Risk indicators: FIXME x1 (L59); TODO x2 (L57,59). |
| `docs/SHIP_CLOSURE_LOG_2026-02-04.md` | `md` | 79 | Y | L | Reviewed L1-L79. Verified: readable. Risk indicators: FIXME x1 (L23); SUPABASE_KEY_REF x1 (L47); TODO x1 (L23). |
| `docs/SHIP_CLOSURE_LOG_2026-02-07.md` | `md` | 40 | Y | L | Reviewed L1-L40. Verified: readable. Risk indicators: none detected by scan. |
| `docs/SUPABASE_NEXT_ACTIONS.md` | `md` | 46 | Y | L | Reviewed L1-L46. Verified: readable. Risk indicators: SUPABASE_KEY_REF x1 (L8). |
| `docs/SUPABASE_STEP_2_DEPLOY_GARMIN.md` | `md` | 27 | Y | L | Reviewed L1-L27. Verified: readable. Risk indicators: SUPABASE_KEY_REF x2 (L18,22). |
| `docs/TERMS_OF_SERVICE.md` | `md` | 331 | Y | L | Reviewed L1-L331. Verified: readable. Risk indicators: TS_ANY x6 (L7,108,211,233,294,297). |
| `docs/TESTING_GUIDE.md` | `md` | 746 | Y | L | Reviewed L1-L746. Verified: readable. Risk indicators: none detected by scan. |
| `docs/V1_1_INSTALLATION_GUIDE.md` | `md` | 265 | Y | L | Reviewed L1-L265. Verified: readable. Risk indicators: TS_ANY x6 (L70,83,129,178,234,265). |
| `docs/WATCH_LIVE_ACTIVITY_IMPLEMENTATION_STATUS.md` | `md` | 40 | Y | L | Reviewed L1-L40. Verified: readable. Risk indicators: none detected by scan. |
| `docs/WATCH_RUN_QA_GAUNTLET.md` | `md` | 88 | Y | L | Reviewed L1-L88. Verified: readable. Risk indicators: none detected by scan. |
| `docs/WATCH_RUN_SYNC_HARDENING.md` | `md` | 18 | Y | L | Reviewed L1-L18. Verified: readable. Risk indicators: none detected by scan. |
| `docs/live-tracking-parameter-sheet.md` | `md` | 80 | Y | L | Reviewed L1-L80. Verified: readable. Risk indicators: TS_ANY x1 (L30). |
| `docs/qa/QA_SESSION_20260204_0144.md` | `md` | 76 | Y | L | Reviewed L1-L76. Verified: readable. Risk indicators: none detected by scan. |
| `docs/supabase_garmin_connectiq.sql` | `sql` | 324 | Y | M | Reviewed L1-L324. Verified: readable. Risk indicators: none detected by scan. |
| `docs/supabase_schema.sql` | `sql` | 516 | Y | M | Reviewed L1-L516. Verified: readable. Risk indicators: none detected by scan. |
| `docs/website-operations.md` | `md` | 89 | Y | L | Reviewed L1-L89. Verified: readable. Risk indicators: TS_ANY x1 (L50). |
| `eslint.config.js` | `js` | 10 | Y | M | Reviewed L1-L10. Verified: readable. Risk indicators: none detected by scan. |
| `expo-env.d.ts` | `ts` | 3 | Y | M | Reviewed L1-L3. Verified: readable. Risk indicators: none detected by scan. |
| `garmin-watch/.gitignore` | `noext` | 5 | Y | M | Reviewed L1-L5. Verified: readable. Risk indicators: none detected by scan. |
| `garmin-watch/README.md` | `md` | 25 | Y | L | Reviewed L1-L25. Verified: readable. Risk indicators: none detected by scan. |
| `garmin-watch/scripts/build-watch.sh` | `sh` | 93 | Y | M | Reviewed L1-L93. Verified: readable. Risk indicators: TS_ANY x1 (L55). |
| `garmin-watch/scripts/run-sim.sh` | `sh` | 37 | Y | M | Reviewed L1-L37. Verified: readable. Risk indicators: none detected by scan. |
| `garmin-watch/zenith-garmin-watch/manifest.xml` | `xml` | 29 | Y | M | Reviewed L1-L29. Verified: readable. Risk indicators: none detected by scan. |
| `garmin-watch/zenith-garmin-watch/monkey.jungle` | `jungle` | 4 | Y | M | Reviewed L1-L4. Verified: readable. Risk indicators: none detected by scan. |
| `garmin-watch/zenith-garmin-watch/resources/drawables/icon_small.png` | `binary` | 0 | Y | L | Binary file (excluded from content review). Verified: exists; size=79 bytes; sha256=7214592bdf12… |
| `garmin-watch/zenith-garmin-watch/resources/drawables/launcher.png` | `binary` | 0 | Y | L | Binary file (excluded from content review). Verified: exists; size=91 bytes; sha256=d4270cb3908a… |
| `garmin-watch/zenith-garmin-watch/resources/resources.xml` | `xml` | 5 | Y | M | Reviewed L1-L5. Verified: readable. Risk indicators: none detected by scan. |
| `garmin-watch/zenith-garmin-watch/resources/strings/strings.xml` | `xml` | 16 | Y | M | Reviewed L1-L16. Verified: readable. Risk indicators: none detected by scan. |
| `garmin-watch/zenith-garmin-watch/source/SessionStore.mc` | `mc` | 289 | Y | M | Reviewed L1-L289. Verified: readable. Risk indicators: none detected by scan. |
| `garmin-watch/zenith-garmin-watch/source/ZenithApp.mc` | `mc` | 22 | Y | M | Reviewed L1-L22. Verified: readable. Risk indicators: none detected by scan. |
| `garmin-watch/zenith-garmin-watch/source/ZenithSession.mc` | `mc` | 35 | Y | M | Reviewed L1-L35. Verified: readable. Risk indicators: none detected by scan. |
| `garmin-watch/zenith-garmin-watch/source/ZenithViews.mc` | `mc` | 186 | Y | M | Reviewed L1-L186. Verified: readable. Risk indicators: none detected by scan. |
| `hooks/use-color-scheme.ts` | `ts` | 1 | Y | M | Reviewed L1-L1. Verified: readable. Risk indicators: none detected by scan. |
| `hooks/use-color-scheme.web.ts` | `ts` | 21 | Y | M | Reviewed L1-L21. Verified: readable. Risk indicators: none detected by scan. |
| `hooks/use-theme-color.ts` | `ts` | 21 | Y | M | Reviewed L1-L21. Verified: readable. Risk indicators: none detected by scan. |
| `ios/.gitignore` | `noext` | 30 | Y | M | Reviewed L1-L30. Verified: readable. Risk indicators: none detected by scan. |
| `ios/.xcode.env` | `env` | 11 | Y | H | Reviewed L1-L11. Verified: readable. Risk indicators: none detected by scan. |
| `ios/.xcode.env.local` | `local` | 18 | Y | M | Reviewed L1-L18. Verified: readable. Risk indicators: none detected by scan. |
| `ios/Podfile` | `noext` | 63 | Y | M | Reviewed L1-L63. Verified: readable. Risk indicators: none detected by scan. |
| `ios/Podfile.lock` | `lock` | 2770 | Y | M | Reviewed L1-L2770. Verified: readable. Risk indicators: none detected by scan. |
| `ios/Podfile.properties.json` | `json` | 5 | Y | M | Reviewed L1-L5. Verified: readable; JSON parse OK. Risk indicators: none detected by scan. |
| `ios/Zenith.xcodeproj/project.pbxproj` | `pbxproj` | 1040 | Y | M | Reviewed L1-L1040. Verified: readable. Risk indicators: none detected by scan. |
| `ios/Zenith.xcodeproj/project.xcworkspace/contents.xcworkspacedata` | `xcworkspacedata` | 7 | Y | M | Reviewed L1-L7. Verified: readable. Risk indicators: none detected by scan. |
| `ios/Zenith.xcodeproj/project.xcworkspace/xcshareddata/IDEWorkspaceChecks.plist` | `plist` | 8 | Y | M | Reviewed L1-L8. Verified: readable. Risk indicators: none detected by scan. |
| `ios/Zenith.xcodeproj/xcshareddata/xcschemes/Zenith.xcscheme` | `xcscheme` | 88 | Y | M | Reviewed L1-L88. Verified: readable. Risk indicators: none detected by scan. |
| `ios/Zenith.xcworkspace/contents.xcworkspacedata` | `xcworkspacedata` | 10 | Y | M | Reviewed L1-L10. Verified: readable. Risk indicators: none detected by scan. |
| `ios/Zenith/AppDelegate.swift` | `swift` | 72 | Y | M | Reviewed L1-L72. Verified: readable. Risk indicators: none detected by scan. |
| `ios/Zenith/GarminCompanionEventEmitter.swift` | `swift` | 36 | Y | M | Reviewed L1-L36. Verified: readable. Risk indicators: none detected by scan. |
| `ios/Zenith/GarminCompanionManager.swift` | `swift` | 84 | Y | M | Reviewed L1-L84. Verified: readable. Risk indicators: none detected by scan. |
| `ios/Zenith/GarminCompanionNativeBridge.m` | `m` | 26 | Y | M | Reviewed L1-L26. Verified: readable. Risk indicators: none detected by scan. |
| `ios/Zenith/GarminCompanionNativeBridge.swift` | `swift` | 49 | Y | M | Reviewed L1-L49. Verified: readable. Risk indicators: none detected by scan. |
| `ios/Zenith/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png` | `binary` | 0 | Y | L | Binary file (excluded from content review). Verified: exists; size=424573 bytes; sha256=f49a2ab6a315… |
| `ios/Zenith/Images.xcassets/AppIcon.appiconset/Contents.json` | `json` | 14 | Y | M | Reviewed L1-L14. Verified: readable; JSON parse OK. Risk indicators: none detected by scan. |
| `ios/Zenith/Images.xcassets/Contents.json` | `json` | 6 | Y | M | Reviewed L1-L6. Verified: readable; JSON parse OK. Risk indicators: none detected by scan. |
| `ios/Zenith/Images.xcassets/SplashScreenBackground.colorset/Contents.json` | `json` | 38 | Y | M | Reviewed L1-L38. Verified: readable; JSON parse OK. Risk indicators: none detected by scan. |
| `ios/Zenith/Images.xcassets/SplashScreenLogo.imageset/Contents.json` | `json` | 23 | Y | M | Reviewed L1-L23. Verified: readable; JSON parse OK. Risk indicators: none detected by scan. |
| `ios/Zenith/Images.xcassets/SplashScreenLogo.imageset/image.png` | `binary` | 0 | Y | L | Binary file (excluded from content review). Verified: exists; size=14711 bytes; sha256=e7d5eef4f96a… |
| `ios/Zenith/Images.xcassets/SplashScreenLogo.imageset/image@2x.png` | `binary` | 0 | Y | L | Binary file (excluded from content review). Verified: exists; size=32766 bytes; sha256=4d2685552a55… |
| `ios/Zenith/Images.xcassets/SplashScreenLogo.imageset/image@3x.png` | `binary` | 0 | Y | L | Binary file (excluded from content review). Verified: exists; size=52602 bytes; sha256=262a5fa2d3b5… |
| `ios/Zenith/Info.plist` | `plist` | 91 | Y | M | Reviewed L1-L91. Verified: readable. Risk indicators: none detected by scan. |
| `ios/Zenith/LaunchScreen.storyboard` | `storyboard` | 32 | Y | M | Reviewed L1-L32. Verified: readable. Risk indicators: none detected by scan. |
| `ios/Zenith/LiftControlEventEmitter.swift` | `swift` | 41 | Y | M | Reviewed L1-L41. Verified: readable. Risk indicators: none detected by scan. |
| `ios/Zenith/LiftControlNativeBridge.m` | `m` | 27 | Y | M | Reviewed L1-L27. Verified: readable. Risk indicators: none detected by scan. |
| `ios/Zenith/LiftControlNativeBridge.swift` | `swift` | 46 | Y | M | Reviewed L1-L46. Verified: readable. Risk indicators: none detected by scan. |
| `ios/Zenith/PrivacyInfo.xcprivacy` | `xcprivacy` | 48 | Y | M | Reviewed L1-L48. Verified: readable. Risk indicators: none detected by scan. |
| `ios/Zenith/RunConnectivityManager.swift` | `swift` | 214 | Y | M | Reviewed L1-L214. Verified: readable. Risk indicators: none detected by scan. |
| `ios/Zenith/RunControlEventEmitter.swift` | `swift` | 41 | Y | M | Reviewed L1-L41. Verified: readable. Risk indicators: none detected by scan. |
| `ios/Zenith/RunControlNativeBridge.m` | `m` | 26 | Y | M | Reviewed L1-L26. Verified: readable. Risk indicators: none detected by scan. |
| `ios/Zenith/RunControlNativeBridge.swift` | `swift` | 92 | Y | M | Reviewed L1-L92. Verified: readable. Risk indicators: none detected by scan. |
| `ios/Zenith/RunLiveActivityManager.swift` | `swift` | 79 | Y | M | Reviewed L1-L79. Verified: readable. Risk indicators: none detected by scan. |
| `ios/Zenith/SplashScreen.storyboard` | `storyboard` | 46 | Y | M | Reviewed L1-L46. Verified: readable. Risk indicators: none detected by scan. |
| `ios/Zenith/Supporting/Expo.plist` | `plist` | 12 | Y | M | Reviewed L1-L12. Verified: readable. Risk indicators: none detected by scan. |
| `ios/Zenith/Zenith-Bridging-Header.h` | `h` | 6 | Y | M | Reviewed L1-L6. Verified: readable. Risk indicators: none detected by scan. |
| `ios/Zenith/Zenith.Release.entitlements` | `entitlements` | 13 | Y | M | Reviewed L1-L13. Verified: readable. Risk indicators: none detected by scan. |
| `ios/Zenith/Zenith.entitlements` | `entitlements` | 12 | Y | M | Reviewed L1-L12. Verified: readable. Risk indicators: none detected by scan. |
| `ios/ZenithWatch Watch App/Assets.xcassets/AccentColor.colorset/Contents.json` | `json` | 11 | Y | M | Reviewed L1-L11. Verified: readable; JSON parse OK. Risk indicators: none detected by scan. |
| `ios/ZenithWatch Watch App/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png` | `binary` | 0 | Y | L | Binary file (excluded from content review). Verified: exists; size=424573 bytes; sha256=f49a2ab6a315… |
| `ios/ZenithWatch Watch App/Assets.xcassets/AppIcon.appiconset/AppIcon24x24@2x.png` | `png` | 0 | Y | L | Reviewed L1-L0. Verified: readable. Risk indicators: none detected by scan. |
| `ios/ZenithWatch Watch App/Assets.xcassets/AppIcon.appiconset/AppIcon27.5x27.5@2x.png` | `png` | 0 | Y | L | Reviewed L1-L0. Verified: readable. Risk indicators: none detected by scan. |
| `ios/ZenithWatch Watch App/Assets.xcassets/AppIcon.appiconset/AppIcon29x29@2x.png` | `png` | 0 | Y | L | Reviewed L1-L0. Verified: readable. Risk indicators: none detected by scan. |
| `ios/ZenithWatch Watch App/Assets.xcassets/AppIcon.appiconset/AppIcon29x29@3x.png` | `png` | 0 | Y | L | Reviewed L1-L0. Verified: readable. Risk indicators: none detected by scan. |
| `ios/ZenithWatch Watch App/Assets.xcassets/AppIcon.appiconset/AppIcon40x40@2x.png` | `png` | 0 | Y | L | Reviewed L1-L0. Verified: readable. Risk indicators: none detected by scan. |
| `ios/ZenithWatch Watch App/Assets.xcassets/AppIcon.appiconset/AppIcon44x44@2x.png` | `png` | 0 | Y | L | Reviewed L1-L0. Verified: readable. Risk indicators: none detected by scan. |
| `ios/ZenithWatch Watch App/Assets.xcassets/AppIcon.appiconset/AppIcon86x86@2x.png` | `png` | 0 | Y | L | Reviewed L1-L0. Verified: readable. Risk indicators: none detected by scan. |
| `ios/ZenithWatch Watch App/Assets.xcassets/AppIcon.appiconset/AppIcon98x98@2x.png` | `png` | 0 | Y | L | Reviewed L1-L0. Verified: readable. Risk indicators: none detected by scan. |
| `ios/ZenithWatch Watch App/Assets.xcassets/AppIcon.appiconset/Contents.json` | `json` | 84 | Y | M | Reviewed L1-L84. Verified: readable; JSON parse OK. Risk indicators: none detected by scan. |
| `ios/ZenithWatch Watch App/Assets.xcassets/Contents.json` | `json` | 6 | Y | M | Reviewed L1-L6. Verified: readable; JSON parse OK. Risk indicators: none detected by scan. |
| `ios/ZenithWatch Watch App/ContentView.swift` | `swift` | 591 | Y | M | Reviewed L1-L591. Verified: readable. Risk indicators: none detected by scan. |
| `ios/ZenithWatch Watch App/Info.plist` | `plist` | 36 | Y | M | Reviewed L1-L36. Verified: readable. Risk indicators: none detected by scan. |
| `ios/ZenithWatch Watch App/WatchModels.swift` | `swift` | 51 | Y | M | Reviewed L1-L51. Verified: readable. Risk indicators: none detected by scan. |
| `ios/ZenithWatch Watch App/WatchWorkoutManager.swift` | `swift` | 1142 | Y | M | Reviewed L1-L1142. Verified: readable. Risk indicators: none detected by scan. |
| `ios/ZenithWatch Watch App/ZenithWatch.entitlements` | `entitlements` | 11 | Y | M | Reviewed L1-L11. Verified: readable. Risk indicators: none detected by scan. |
| `ios/ZenithWatch Watch App/ZenithWatchApp.swift` | `swift` | 17 | Y | M | Reviewed L1-L17. Verified: readable. Risk indicators: none detected by scan. |
| `ios/ZenithWidgets/AppIntent.swift` | `swift` | 18 | Y | M | Reviewed L1-L18. Verified: readable. Risk indicators: none detected by scan. |
| `ios/ZenithWidgets/Assets.xcassets/AccentColor.colorset/Contents.json` | `json` | 11 | Y | M | Reviewed L1-L11. Verified: readable; JSON parse OK. Risk indicators: none detected by scan. |
| `ios/ZenithWidgets/Assets.xcassets/AppIcon.appiconset/AppIcon-1024-dark.png` | `binary` | 0 | Y | L | Binary file (excluded from content review). Verified: exists; size=424573 bytes; sha256=f49a2ab6a315… |
| `ios/ZenithWidgets/Assets.xcassets/AppIcon.appiconset/AppIcon-1024-tinted.png` | `binary` | 0 | Y | L | Binary file (excluded from content review). Verified: exists; size=424573 bytes; sha256=f49a2ab6a315… |
| `ios/ZenithWidgets/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png` | `binary` | 0 | Y | L | Binary file (excluded from content review). Verified: exists; size=424573 bytes; sha256=f49a2ab6a315… |
| `ios/ZenithWidgets/Assets.xcassets/AppIcon.appiconset/Contents.json` | `json` | 38 | Y | M | Reviewed L1-L38. Verified: readable; JSON parse OK. Risk indicators: none detected by scan. |
| `ios/ZenithWidgets/Assets.xcassets/Contents.json` | `json` | 6 | Y | M | Reviewed L1-L6. Verified: readable; JSON parse OK. Risk indicators: none detected by scan. |
| `ios/ZenithWidgets/Assets.xcassets/WidgetBackground.colorset/Contents.json` | `json` | 11 | Y | M | Reviewed L1-L11. Verified: readable; JSON parse OK. Risk indicators: none detected by scan. |
| `ios/ZenithWidgets/Info.plist` | `plist` | 11 | Y | M | Reviewed L1-L11. Verified: readable. Risk indicators: none detected by scan. |
| `ios/ZenithWidgets/ZenithRunLiveActivity.swift` | `swift` | 178 | Y | M | Reviewed L1-L178. Verified: readable. Risk indicators: none detected by scan. |
| `ios/ZenithWidgets/ZenithRunLiveActivityIntents.swift` | `swift` | 189 | Y | M | Reviewed L1-L189. Verified: readable. Risk indicators: none detected by scan. |
| `ios/ZenithWidgets/ZenithWidgets.swift` | `swift` | 88 | Y | M | Reviewed L1-L88. Verified: readable. Risk indicators: none detected by scan. |
| `ios/ZenithWidgets/ZenithWidgetsBundle.swift` | `swift` | 16 | Y | M | Reviewed L1-L16. Verified: readable. Risk indicators: none detected by scan. |
| `ios/ZenithWidgets/ZenithWidgetsControl.swift` | `swift` | 85 | Y | M | Reviewed L1-L85. Verified: readable. Risk indicators: none detected by scan. |
| `legal-site/.gitignore` | `noext` | 1 | Y | M | Reviewed L1-L1. Verified: readable. Risk indicators: none detected by scan. |
| `legal-site/about/index.html` | `html` | 116 | Y | M | Reviewed L1-L116. Verified: readable. Risk indicators: none detected by scan. |
| `legal-site/api/contact.js` | `js` | 200 | Y | M | Reviewed L1-L200. Verified: readable. Risk indicators: none detected by scan. |
| `legal-site/assets/site.css` | `css` | 1612 | Y | M | Reviewed L1-L1612. Verified: readable. Risk indicators: none detected by scan. |
| `legal-site/assets/site.js` | `js` | 660 | Y | M | Reviewed L1-L660. Verified: readable. Risk indicators: none detected by scan. |
| `legal-site/contact/index.html` | `html` | 145 | Y | M | Reviewed L1-L145. Verified: readable. Risk indicators: none detected by scan. |
| `legal-site/cookies/index.html` | `html` | 67 | Y | M | Reviewed L1-L67. Verified: readable. Risk indicators: none detected by scan. |
| `legal-site/data-permissions/index.html` | `html` | 101 | Y | M | Reviewed L1-L101. Verified: readable. Risk indicators: none detected by scan. |
| `legal-site/download/index.html` | `html` | 83 | Y | M | Reviewed L1-L83. Verified: readable. Risk indicators: none detected by scan. |
| `legal-site/features/index.html` | `html` | 259 | Y | M | Reviewed L1-L259. Verified: readable. Risk indicators: none detected by scan. |
| `legal-site/index.html` | `html` | 237 | Y | M | Reviewed L1-L237. Verified: readable. Risk indicators: none detected by scan. |
| `legal-site/premium/index.html` | `html` | 89 | Y | M | Reviewed L1-L89. Verified: readable. Risk indicators: none detected by scan. |
| `legal-site/privacy-policy/index.html` | `html` | 134 | Y | M | Reviewed L1-L134. Verified: readable. Risk indicators: none detected by scan. |
| `legal-site/privacy/index.html` | `html` | 99 | Y | M | Reviewed L1-L99. Verified: readable. Risk indicators: none detected by scan. |
| `legal-site/product/index.html` | `html` | 161 | Y | M | Reviewed L1-L161. Verified: readable. Risk indicators: none detected by scan. |
| `legal-site/releases/index.html` | `html` | 95 | Y | M | Reviewed L1-L95. Verified: readable. Risk indicators: none detected by scan. |
| `legal-site/roadmap/index.html` | `html` | 106 | Y | M | Reviewed L1-L106. Verified: readable. Risk indicators: none detected by scan. |
| `legal-site/robots.txt` | `txt` | 4 | Y | L | Reviewed L1-L4. Verified: readable. Risk indicators: none detected by scan. |
| `legal-site/sitemap.xml` | `xml` | 75 | Y | M | Reviewed L1-L75. Verified: readable. Risk indicators: none detected by scan. |
| `legal-site/status/index.html` | `html` | 87 | Y | M | Reviewed L1-L87. Verified: readable. Risk indicators: none detected by scan. |
| `legal-site/support/account/index.html` | `html` | 85 | Y | M | Reviewed L1-L85. Verified: readable. Risk indicators: none detected by scan. |
| `legal-site/support/getting-started/index.html` | `html` | 93 | Y | M | Reviewed L1-L93. Verified: readable. Risk indicators: none detected by scan. |
| `legal-site/support/index.html` | `html` | 103 | Y | M | Reviewed L1-L103. Verified: readable. Risk indicators: none detected by scan. |
| `legal-site/support/subscription/index.html` | `html` | 86 | Y | M | Reviewed L1-L86. Verified: readable. Risk indicators: none detected by scan. |
| `legal-site/support/troubleshooting/index.html` | `html` | 121 | Y | M | Reviewed L1-L121. Verified: readable. Risk indicators: none detected by scan. |
| `legal-site/support/wearables/apple-watch/index.html` | `html` | 97 | Y | M | Reviewed L1-L97. Verified: readable. Risk indicators: none detected by scan. |
| `legal-site/support/wearables/garmin/index.html` | `html` | 97 | Y | M | Reviewed L1-L97. Verified: readable. Risk indicators: none detected by scan. |
| `legal-site/support/wearables/index.html` | `html` | 81 | Y | M | Reviewed L1-L81. Verified: readable. Risk indicators: none detected by scan. |
| `legal-site/terms/index.html` | `html` | 130 | Y | M | Reviewed L1-L130. Verified: readable. Risk indicators: TS_ANY x1 (L89). |
| `legal-site/vercel.json` | `json` | 3 | Y | M | Reviewed L1-L3. Verified: readable; JSON parse OK. Risk indicators: none detected by scan. |
| `legal-site/wearables/index.html` | `html` | 96 | Y | M | Reviewed L1-L96. Verified: readable. Risk indicators: none detected by scan. |
| `package-lock.json` | `json` | 14469 | Y | M | Reviewed L1-L14469. Verified: readable; JSON parse OK. Risk indicators: TS_ANY x4 (L4787,4789,10519,13326). |
| `package.json` | `json` | 98 | Y | M | Reviewed L1-L98. Verified: readable; JSON parse OK. Risk indicators: none detected by scan. |
| `scripts/build-rc-dashboard.js` | `js` | 80 | Y | M | Reviewed L1-L80. Verified: readable. Risk indicators: CONSOLE_LOG x1 (L77); ESLINT_DISABLE x1 (L2). |
| `scripts/create-qa-session.js` | `js` | 58 | Y | M | Reviewed L1-L58. Verified: readable. Risk indicators: CONSOLE_LOG x1 (L55); ESLINT_DISABLE x1 (L2). |
| `scripts/p0-status-report.js` | `js` | 24 | Y | M | Reviewed L1-L24. Verified: readable. Risk indicators: CONSOLE_LOG x2 (L10,20); ESLINT_DISABLE x1 (L2). |
| `scripts/report-incomplete-routes.js` | `js` | 232 | Y | M | Reviewed L1-L232. Verified: readable. Risk indicators: CONSOLE_LOG x8 (L203,211,215,216,221,222,…(+2)); ESLINT_DISABLE x1 (L2); FIXME x1 (L164); TODO x1 (L164). |
| `scripts/reset-project.js` | `js` | 112 | Y | M | Reviewed L1-L112. Verified: readable. Risk indicators: CONSOLE_LOG x10 (L53,63,66,69,76,81,…(+4)). |
| `scripts/verify-compliance.js` | `js` | 51 | Y | M | Reviewed L1-L51. Verified: readable. Risk indicators: CONSOLE_LOG x4 (L45,46,47,48); ESLINT_DISABLE x1 (L2). |
| `scripts/verify-doctrine.js` | `js` | 184 | Y | M | Reviewed L1-L184. Verified: readable. Risk indicators: CONSOLE_LOG x5 (L177,178,179,180,181); ESLINT_DISABLE x1 (L2). |
| `scripts/verify-food-search-basics.js` | `js` | 133 | Y | M | Reviewed L1-L133. Verified: readable. Risk indicators: CONSOLE_LOG x4 (L127,128,129,130); ESLINT_DISABLE x1 (L2). |
| `scripts/verify-garmin-readiness.js` | `js` | 91 | Y | M | Reviewed L1-L91. Verified: readable. Risk indicators: CONSOLE_LOG x2 (L14,91). |
| `scripts/verify-health-auto-sync.js` | `js` | 47 | Y | M | Reviewed L1-L47. Verified: readable. Risk indicators: CONSOLE_LOG x4 (L40,41,42,43); ESLINT_DISABLE x1 (L2). |
| `scripts/verify-legal-site.js` | `js` | 213 | Y | M | Reviewed L1-L213. Verified: readable. Risk indicators: CONSOLE_LOG x5 (L209,210,211,212,213). |
| `scripts/verify-live-tracking-calibration.js` | `js` | 102 | Y | M | Reviewed L1-L102. Verified: readable. Risk indicators: CONSOLE_LOG x5 (L95,96,97,98,99); ESLINT_DISABLE x1 (L2). |
| `scripts/verify-p0-all.js` | `js` | 104 | Y | M | Reviewed L1-L104. Verified: readable. Risk indicators: CONSOLE_LOG x3 (L36,77,101); ESLINT_DISABLE x1 (L2). |
| `scripts/verify-prepared-food-units.js` | `js` | 81 | Y | M | Reviewed L1-L81. Verified: readable. Risk indicators: CONSOLE_LOG x3 (L75,76,77); ESLINT_DISABLE x1 (L2). |
| `scripts/verify-primary-flows.js` | `js` | 86 | Y | M | Reviewed L1-L86. Verified: readable. Risk indicators: CONSOLE_LOG x2 (L82,83); ESLINT_DISABLE x1 (L2); FIXME x1 (L8); TODO x1 (L8). |
| `scripts/verify-qa-report.js` | `js` | 62 | Y | M | Reviewed L1-L62. Verified: readable. Risk indicators: CONSOLE_LOG x1 (L59); ESLINT_DISABLE x1 (L2). |
| `scripts/verify-release-ledger.js` | `js` | 49 | Y | M | Reviewed L1-L49. Verified: readable. Risk indicators: CONSOLE_LOG x2 (L45,46); ESLINT_DISABLE x1 (L2). |
| `scripts/verify-routes.js` | `js` | 185 | Y | M | Reviewed L1-L185. Verified: readable. Risk indicators: CONSOLE_LOG x2 (L184,185); ESLINT_DISABLE x1 (L2). |
| `scripts/verify-run-lifecycle.js` | `js` | 86 | Y | M | Reviewed L1-L86. Verified: readable. Risk indicators: CONSOLE_LOG x4 (L80,81,82,83); ESLINT_DISABLE x1 (L2). |
| `scripts/verify-run-time-policy.js` | `js` | 110 | Y | M | Reviewed L1-L110. Verified: readable. Risk indicators: CONSOLE_LOG x5 (L103,104,105,106,107); ESLINT_DISABLE x1 (L2); TS_ANY x1 (L72). |
| `scripts/verify-social-safety.js` | `js` | 132 | Y | M | Reviewed L1-L132. Verified: readable. Risk indicators: CONSOLE_LOG x11 (L119,120,121,122,123,124,…(+5)); ESLINT_DISABLE x1 (L2). |
| `scripts/verify-store-pack.js` | `js` | 79 | Y | M | Reviewed L1-L79. Verified: readable. Risk indicators: CONSOLE_LOG x5 (L72,73,74,75,76); ESLINT_DISABLE x1 (L2); TODO x1 (L23). |
| `scripts/verify-supabase-runtime.js` | `js` | 164 | Y | M | Reviewed L1-L164. Verified: readable. Risk indicators: CONSOLE_LOG x8 (L83,84,85,154,155,156,…(+2)); ESLINT_DISABLE x1 (L2); SUPABASE_KEY_REF x3 (L61,64,80). |
| `scripts/verify-today-detail-foods.js` | `js` | 120 | Y | M | Reviewed L1-L120. Verified: readable. Risk indicators: CONSOLE_LOG x3 (L115,116,117); ESLINT_DISABLE x1 (L2). |
| `scripts/verify-watch-plist.js` | `js` | 114 | Y | M | Reviewed L1-L114. Verified: readable. Risk indicators: CONSOLE_LOG x5 (L75,76,77,78,79). |
| `scripts/verify-workout-integrity.js` | `js` | 79 | Y | M | Reviewed L1-L79. Verified: readable. Risk indicators: CONSOLE_LOG x4 (L67,68,69,70); ESLINT_DISABLE x1 (L2). |
| `scripts/verify-xcarchive-healthkit.js` | `js` | 85 | Y | M | Reviewed L1-L85. Verified: readable. Risk indicators: CONSOLE_LOG x5 (L77,78,79,80,81); ESLINT_DISABLE x1 (L2). |
| `scripts/verify-xcarchive.js` | `js` | 240 | Y | M | Reviewed L1-L240. Verified: readable. Risk indicators: CONSOLE_LOG x9 (L9,131,132,133,134,135,…(+3)); ESLINT_DISABLE x1 (L2). |
| `supabase/config.toml` | `toml` | 9 | Y | M | Reviewed L1-L9. Verified: readable. Risk indicators: none detected by scan. |
| `supabase/functions/delete-me/index.ts` | `ts` | 135 | Y | M | Reviewed L1-L135. Verified: readable. Risk indicators: SUPABASE_KEY_REF x2 (L24,25); TS_ANY x3 (L64,65,109). |
| `supabase/functions/garmin-entitlement/index.ts` | `ts` | 51 | Y | M | Reviewed L1-L51. Verified: readable. Risk indicators: SUPABASE_KEY_REF x1 (L30). |
| `supabase/functions/garmin-link-confirm/index.ts` | `ts` | 71 | Y | M | Reviewed L1-L71. Verified: readable. Risk indicators: SUPABASE_KEY_REF x1 (L47). |
| `supabase/functions/garmin-link-token/index.ts` | `ts` | 68 | Y | M | Reviewed L1-L68. Verified: readable. Risk indicators: SUPABASE_KEY_REF x1 (L45). |
| `supabase/functions/garmin-workout-upsert/index.ts` | `ts` | 91 | Y | M | Reviewed L1-L91. Verified: readable. Risk indicators: SUPABASE_KEY_REF x1 (L63). |
| `supabase/migrations/20260209000000_social_schema.sql` | `sql` | 341 | Y | M | Reviewed L1-L341. Verified: readable. Risk indicators: none detected by scan. |
| `supabase/migrations/20260209000010_garmin_connectiq.sql` | `sql` | 108 | Y | M | Reviewed L1-L108. Verified: readable. Risk indicators: none detected by scan. |
| `supabase/migrations/20260209000020_profiles_insert_policy.sql` | `sql` | 17 | Y | M | Reviewed L1-L17. Verified: readable. Risk indicators: none detected by scan. |
| `supabase/migrations/20260209000030_social_groups_friendships_posts.sql` | `sql` | 200 | Y | M | Reviewed L1-L200. Verified: readable. Risk indicators: none detected by scan. |
| `supabase/migrations/20260209000040_social_schema_compat.sql` | `sql` | 15 | Y | M | Reviewed L1-L15. Verified: readable. Risk indicators: none detected by scan. |
| `supabase/migrations/20260209000050_fix_group_members_rls_recursion.sql` | `sql` | 89 | Y | M | Reviewed L1-L89. Verified: readable. Risk indicators: none detected by scan. |
| `tsconfig.json` | `json` | 22 | Y | M | Reviewed L1-L22. Verified: readable; JSON parse OK. Risk indicators: none detected by scan. |
| `utils/accountDeletion.ts` | `ts` | 104 | Y | M | Reviewed L1-L104. Verified: readable. Risk indicators: TS_ANY x1 (L60). |
| `utils/achievementSystem.ts` | `ts` | 402 | Y | M | Reviewed L1-L402. Verified: readable. Risk indicators: none detected by scan. |
| `utils/achievements.catalog.ts` | `ts` | 231 | Y | M | Reviewed L1-L231. Verified: readable. Risk indicators: TS_ANY x3 (L192,193,194). |
| `utils/achievementsEngine.ts` | `ts` | 533 | Y | M | Reviewed L1-L533. Verified: readable. Risk indicators: TS_ANY x30 (L150,151,152,222,226,255,…(+24)). |
| `utils/activityEventService.ts` | `ts` | 311 | Y | M | Reviewed L1-L311. Verified: readable. Risk indicators: none detected by scan. |
| `utils/activityFeedService.ts` | `ts` | 185 | Y | M | Reviewed L1-L185. Verified: readable. Risk indicators: none detected by scan. |
| `utils/adaptiveTdee.ts` | `ts` | 187 | Y | M | Reviewed L1-L187. Verified: readable. Risk indicators: TS_ANY x1 (L48). |
| `utils/aiInsightEngine.ts` | `ts` | 158 | Y | M | Reviewed L1-L158. Verified: readable. Risk indicators: none detected by scan. |
| `utils/aiInsightRules.ts` | `ts` | 233 | Y | M | Reviewed L1-L233. Verified: readable. Risk indicators: TS_ANY x1 (L103). |
| `utils/aiLanguageTemplates.ts` | `ts` | 32 | Y | M | Reviewed L1-L32. Verified: readable. Risk indicators: none detected by scan. |
| `utils/aiOverlay.ts` | `ts` | 175 | Y | M | Reviewed L1-L175. Verified: readable. Risk indicators: none detected by scan. |
| `utils/aiTruthLayer.ts` | `ts` | 73 | Y | M | Reviewed L1-L73. Verified: readable. Risk indicators: none detected by scan. |
| `utils/aiTypes.ts` | `ts` | 56 | Y | M | Reviewed L1-L56. Verified: readable. Risk indicators: none detected by scan. |
| `utils/appConfig.ts` | `ts` | 349 | Y | M | Reviewed L1-L349. Verified: readable. Risk indicators: TS_ANY x1 (L231). |
| `utils/authSecurity.ts` | `ts` | 166 | Y | M | Reviewed L1-L166. Verified: readable. Risk indicators: TS_ANY x1 (L73). |
| `utils/barcodeService.ts` | `ts` | 177 | Y | M | Reviewed L1-L177. Verified: readable. Risk indicators: CONSOLE_LOG x1 (L98); ESLINT_DISABLE x4 (L36,78,97,137); TS_ANY x1 (L120). |
| `utils/behavioralCore.ts` | `ts` | 1198 | Y | M | Reviewed L1-L1198. Verified: readable. Risk indicators: TS_ANY x58 (L166,167,168,169,170,171,…(+52)). |
| `utils/calorieBurn.ts` | `ts` | 82 | Y | M | Reviewed L1-L82. Verified: readable. Risk indicators: none detected by scan. |
| `utils/canonicalRunService.ts` | `ts` | 225 | Y | M | Reviewed L1-L225. Verified: readable. Risk indicators: none detected by scan. |
| `utils/canonicalRunningSchema.ts` | `ts` | 191 | Y | M | Reviewed L1-L191. Verified: readable. Risk indicators: TS_ANY x1 (L56). |
| `utils/challengeService.ts` | `ts` | 770 | Y | M | Reviewed L1-L770. Verified: readable. Risk indicators: TS_ANY x7 (L151,164,184,185,221,239,…(+1)). |
| `utils/clubAnalyticsService.ts` | `ts` | 113 | Y | M | Reviewed L1-L113. Verified: readable. Risk indicators: none detected by scan. |
| `utils/clubChallengesService.ts` | `ts` | 247 | Y | M | Reviewed L1-L247. Verified: readable. Risk indicators: TS_ANY x6 (L216,217,218,219,220,226). |
| `utils/clubEventsService.ts` | `ts` | 203 | Y | M | Reviewed L1-L203. Verified: readable. Risk indicators: none detected by scan. |
| `utils/clubsService.ts` | `ts` | 820 | Y | M | Reviewed L1-L820. Verified: readable. Risk indicators: none detected by scan. |
| `utils/coachAccessPolicyService.ts` | `ts` | 30 | Y | M | Reviewed L1-L30. Verified: readable. Risk indicators: none detected by scan. |
| `utils/commonFoodsCatalog.json` | `json` | 567 | Y | M | Reviewed L1-L567. Verified: readable; JSON parse OK. Risk indicators: none detected by scan. |
| `utils/communityLocalMetrics.ts` | `ts` | 154 | Y | M | Reviewed L1-L154. Verified: readable. Risk indicators: TS_ANY x10 (L33,34,35,36,37,38,…(+4)). |
| `utils/crashReporter.ts` | `ts` | 111 | Y | M | Reviewed L1-L111. Verified: readable. Risk indicators: ESLINT_DISABLE x2 (L66,91); TS_ANY x5 (L20,21,24,25,32). |
| `utils/dailyLogEvents.ts` | `ts` | 23 | Y | M | Reviewed L1-L23. Verified: readable. Risk indicators: none detected by scan. |
| `utils/dailyMetrics.ts` | `ts` | 230 | Y | M | Reviewed L1-L230. Verified: readable. Risk indicators: TS_ANY x2 (L92,138). |
| `utils/dataPortabilityService.ts` | `ts` | 286 | Y | M | Reviewed L1-L286. Verified: readable. Risk indicators: TS_ANY x7 (L63,104,123,160,189,222,…(+1)). |
| `utils/dayAssignment.ts` | `ts` | 34 | Y | M | Reviewed L1-L34. Verified: readable. Risk indicators: none detected by scan. |
| `utils/debugKeyboardJitter.ts` | `ts` | 76 | Y | M | Reviewed L1-L76. Verified: readable. Risk indicators: CONSOLE_LOG x2 (L34,37); ESLINT_DISABLE x2 (L33,36); TS_ANY x4 (L20,61,64,67). |
| `utils/effortCurrencyService.ts` | `ts` | 198 | Y | M | Reviewed L1-L198. Verified: readable. Risk indicators: TS_ANY x23 (L45,57,81,83,84,85,…(+17)). |
| `utils/effortEngine.ts` | `ts` | 301 | Y | M | Reviewed L1-L301. Verified: readable. Risk indicators: none detected by scan. |
| `utils/fatigueRecovery.ts` | `ts` | 149 | Y | M | Reviewed L1-L149. Verified: readable. Risk indicators: none detected by scan. |
| `utils/foodLogGrouping.ts` | `ts` | 215 | Y | M | Reviewed L1-L215. Verified: readable. Risk indicators: TS_ANY x1 (L51). |
| `utils/foodSearchPerf.ts` | `ts` | 37 | Y | M | Reviewed L1-L37. Verified: readable. Risk indicators: none detected by scan. |
| `utils/foodSearchService.ts` | `ts` | 1820 | Y | M | Reviewed L1-L1820. Verified: readable. Risk indicators: TS_ANY x16 (L893,940,943,981,985,991,…(+10)). |
| `utils/friendsService.ts` | `ts` | 1189 | Y | M | Reviewed L1-L1189. Verified: readable. Risk indicators: TS_ANY x7 (L198,199,240,735,736,773,…(+1)). |
| `utils/garminBackendService.ts` | `ts` | 256 | Y | M | Reviewed L1-L256. Verified: readable. Risk indicators: SUPABASE_KEY_REF x3 (L40,102,103); TS_ANY x6 (L29,30,31,33,122,123). |
| `utils/garminCompanionService.ts` | `ts` | 435 | Y | M | Reviewed L1-L435. Verified: readable. Risk indicators: TS_ANY x1 (L430). |
| `utils/garminNativeBridge.ts` | `ts` | 104 | Y | M | Reviewed L1-L104. Verified: readable. Risk indicators: none detected by scan. |
| `utils/garminProtocol.ts` | `ts` | 111 | Y | M | Reviewed L1-L111. Verified: readable. Risk indicators: none detected by scan. |
| `utils/gpsService.ts` | `ts` | 586 | Y | M | Reviewed L1-L586. Verified: readable. Risk indicators: CONSOLE_LOG x2 (L506,561); ESLINT_DISABLE x2 (L505,560). |
| `utils/healthService.ts` | `ts` | 1505 | Y | M | Reviewed L1-L1505. Verified: readable. Risk indicators: CONSOLE_LOG x5 (L611,1035,1083,1161,1431); ESLINT_DISABLE x5 (L610,1034,1082,1160,1430); TS_ANY x50 (L80,84,85,144,148,149,…(+44)). |
| `utils/historyAccessPolicy.ts` | `ts` | 47 | Y | M | Reviewed L1-L47. Verified: readable. Risk indicators: none detected by scan. |
| `utils/keyboardAvoidanceRegistry.ts` | `ts` | 56 | Y | M | Reviewed L1-L56. Verified: readable. Risk indicators: none detected by scan. |
| `utils/liftControlSync.ts` | `ts` | 143 | Y | M | Reviewed L1-L143. Verified: readable. Risk indicators: none detected by scan. |
| `utils/liftNativeBridge.ts` | `ts` | 245 | Y | M | Reviewed L1-L245. Verified: readable. Risk indicators: none detected by scan. |
| `utils/liftStateMachine.ts` | `ts` | 32 | Y | M | Reviewed L1-L32. Verified: readable. Risk indicators: none detected by scan. |
| `utils/liftTagService.ts` | `ts` | 137 | Y | M | Reviewed L1-L137. Verified: readable. Risk indicators: TS_ANY x2 (L44,46). |
| `utils/liveTrackingPreferences.ts` | `ts` | 30 | Y | M | Reviewed L1-L30. Verified: readable. Risk indicators: none detected by scan. |
| `utils/measurementEngine.ts` | `ts` | 212 | Y | M | Reviewed L1-L212. Verified: readable. Risk indicators: none detected by scan. |
| `utils/messageService.ts` | `ts` | 551 | Y | M | Reviewed L1-L551. Verified: readable. Risk indicators: none detected by scan. |
| `utils/metSystem.ts` | `ts` | 176 | Y | M | Reviewed L1-L176. Verified: readable. Risk indicators: none detected by scan. |
| `utils/metricValidity.ts` | `ts` | 75 | Y | M | Reviewed L1-L75. Verified: readable. Risk indicators: none detected by scan. |
| `utils/moderationService.ts` | `ts` | 240 | Y | M | Reviewed L1-L240. Verified: readable. Risk indicators: none detected by scan. |
| `utils/monetizationService.ts` | `ts` | 745 | Y | M | Reviewed L1-L745. Verified: readable. Risk indicators: CONSOLE_LOG x1 (L14); ESLINT_DISABLE x1 (L13). |
| `utils/notificationService.ts` | `ts` | 716 | Y | M | Reviewed L1-L716. Verified: readable. Risk indicators: CONSOLE_LOG x1 (L15); ESLINT_DISABLE x1 (L14); TS_ANY x2 (L370,371). |
| `utils/numberPadAccessory.ts` | `ts` | 44 | Y | M | Reviewed L1-L44. Verified: readable. Risk indicators: none detected by scan. |
| `utils/nutritionIntegrity.ts` | `ts` | 68 | Y | M | Reviewed L1-L68. Verified: readable. Risk indicators: none detected by scan. |
| `utils/nutritionSufficiency.ts` | `ts` | 146 | Y | M | Reviewed L1-L146. Verified: readable. Risk indicators: none detected by scan. |
| `utils/optimizationUtils.ts` | `ts` | 430 | Y | M | Reviewed L1-L430. Verified: readable. Risk indicators: CONSOLE_LOG x3 (L304,388,407); ESLINT_DISABLE x9 (L31,54,114,303,309,387,…(+3)); TS_ANY x14 (L8,13,16,43,79,94,…(+8)). |
| `utils/preparedFoodServingPolicy.ts` | `ts` | 131 | Y | M | Reviewed L1-L131. Verified: readable. Risk indicators: none detected by scan. |
| `utils/quickActionPersonalization.ts` | `ts` | 109 | Y | M | Reviewed L1-L109. Verified: readable. Risk indicators: TS_ANY x1 (L35). |
| `utils/rankSystem.ts` | `ts` | 151 | Y | M | Reviewed L1-L151. Verified: readable. Risk indicators: none detected by scan. |
| `utils/reactionService.ts` | `ts` | 130 | Y | M | Reviewed L1-L130. Verified: readable. Risk indicators: none detected by scan. |
| `utils/routeMatchingService.ts` | `ts` | 293 | Y | M | Reviewed L1-L293. Verified: readable. Risk indicators: none detected by scan. |
| `utils/routeStatsService.ts` | `ts` | 99 | Y | M | Reviewed L1-L99. Verified: readable. Risk indicators: none detected by scan. |
| `utils/routeUtils.ts` | `ts` | 96 | Y | M | Reviewed L1-L96. Verified: readable. Risk indicators: none detected by scan. |
| `utils/runConfidenceTrend.ts` | `ts` | 149 | Y | M | Reviewed L1-L149. Verified: readable. Risk indicators: none detected by scan. |
| `utils/runControlSync.ts` | `ts` | 171 | Y | M | Reviewed L1-L171. Verified: readable. Risk indicators: none detected by scan. |
| `utils/runMetricVersions.ts` | `ts` | 33 | Y | M | Reviewed L1-L33. Verified: readable. Risk indicators: none detected by scan. |
| `utils/runNativeBridge.ts` | `ts` | 317 | Y | M | Reviewed L1-L317. Verified: readable. Risk indicators: none detected by scan. |
| `utils/runReviewService.ts` | `ts` | 956 | Y | M | Reviewed L1-L956. Verified: readable. Risk indicators: TS_ANY x21 (L109,206,210,294,312,359,…(+15)). |
| `utils/runStateMachine.ts` | `ts` | 23 | Y | M | Reviewed L1-L23. Verified: readable. Risk indicators: none detected by scan. |
| `utils/segmentService.ts` | `ts` | 745 | Y | M | Reviewed L1-L745. Verified: readable. Risk indicators: none detected by scan. |
| `utils/semanticTrust.ts` | `ts` | 78 | Y | M | Reviewed L1-L78. Verified: readable. Risk indicators: TS_ANY x4 (L29,38,39,40). |
| `utils/sharingService.ts` | `ts` | 382 | Y | M | Reviewed L1-L382. Verified: readable. Risk indicators: ESLINT_DISABLE x9 (L52,96,137,178,219,255,…(+3)); TS_ANY x5 (L11,12,232,268,309). |
| `utils/socialOffline.ts` | `ts` | 154 | Y | M | Reviewed L1-L154. Verified: readable. Risk indicators: TS_ANY x5 (L6,27,118,129,151). |
| `utils/storageMigrations.ts` | `ts` | 420 | Y | M | Reviewed L1-L420. Verified: readable. Risk indicators: TS_ANY x17 (L43,44,45,47,61,90,…(+11)). |
| `utils/storageUtils.ts` | `ts` | 405 | Y | M | Reviewed L1-L405. Verified: readable. Risk indicators: TS_ANY x1 (L393). |
| `utils/supabaseClient.ts` | `ts` | 1038 | Y | M | Reviewed L1-L1038. Verified: readable. Risk indicators: SUPABASE_KEY_REF x7 (L22,24,37,49,55,63,…(+1)); TS_ANY x34 (L9,10,11,13,105,120,…(+28)). |
| `utils/trainingLoad.ts` | `ts` | 207 | Y | M | Reviewed L1-L207. Verified: readable. Risk indicators: none detected by scan. |
| `utils/treadmillCalibration.ts` | `ts` | 217 | Y | M | Reviewed L1-L217. Verified: readable. Risk indicators: none detected by scan. |
| `utils/useDebugRenderCount.ts` | `ts` | 18 | Y | M | Reviewed L1-L18. Verified: readable. Risk indicators: none detected by scan. |
| `utils/watchFinalizeImport.ts` | `ts` | 89 | Y | M | Reviewed L1-L89. Verified: readable. Risk indicators: TS_ANY x1 (L54). |
| `utils/wearableDuplicateService.ts` | `ts` | 129 | Y | M | Reviewed L1-L129. Verified: readable. Risk indicators: TS_ANY x9 (L12,16,22,26,31,84,…(+3)). |
| `utils/wearableImportService.ts` | `ts` | 397 | Y | M | Reviewed L1-L397. Verified: readable. Risk indicators: TS_ANY x11 (L78,162,164,165,169,173,…(+5)). |
| `utils/wearableMerge.ts` | `ts` | 87 | Y | M | Reviewed L1-L87. Verified: readable. Risk indicators: TS_ANY x2 (L26,31). |
| `utils/winningSystem.ts` | `ts` | 197 | Y | M | Reviewed L1-L197. Verified: readable. Risk indicators: TS_ANY x2 (L48,59). |
| `utils/winningThresholds.ts` | `ts` | 20 | Y | M | Reviewed L1-L20. Verified: readable. Risk indicators: none detected by scan. |
| `utils/workoutMetricVersions.ts` | `ts` | 25 | Y | M | Reviewed L1-L25. Verified: readable. Risk indicators: none detected by scan. |
| `utils/xpSystem.ts` | `ts` | 235 | Y | M | Reviewed L1-L235. Verified: readable. Risk indicators: none detected by scan. |
