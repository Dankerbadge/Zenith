# FLOW TRACES

Each flow includes:
- Flow Trace (files/functions)
- Potential breakpoints
- Required invariants
- Failure handling

## Flow 1: Onboarding → Auth → Profile → Home

**Flow Trace**
- App entry: `app/_layout.tsx` L14-L85
  - `RootLayout()` mounts providers and stack routes.
- Auth/session bootstrap + route guard: `app/context/authcontext.tsx`
  - `AuthProvider()` `checkUser()` hydration: `app/context/authcontext.tsx` L124-L533
  - Supabase session hydration: `app/context/authcontext.tsx` L234-L279, L535-L559
  - Route guard: `app/context/authcontext.tsx` L561-L580
  - Post-auth routing: `routeAfterAuth()` `app/context/authcontext.tsx` L456-L468
- Auth UI
  - Login: `app/auth/login.tsx` L8-L119 (calls `useAuth().login()` at L12-L25)
  - Signup/Forgot/Reset: `app/auth/signup.tsx`, `app/auth/forgot-password.tsx`, `app/auth/reset-password.tsx` (entrypoints: `export default function …`)
- Onboarding writes profile + seeds log
  - `handleComplete()` builds profile + sets `onboardingCompleted: true`: `app/onboarding.tsx` L203-L303
  - Persists profile: `app/onboarding.tsx` L258-L258 via `setStorageItem(USER_PROFILE_KEY, userProfile)`
  - Seeds today daily log: `app/onboarding.tsx` L279-L292 via `saveDailyLog(today, dailyLog)`
- Storage/profile layer: `utils/storageUtils.ts`
  - `setStorageItem()` profile canonicalization: `utils/storageUtils.ts` L393-L405
  - `getUserProfileByEmail()`: `utils/storageUtils.ts` L352-L362
  - `getDailyLog()`/`saveDailyLog()`: `utils/storageUtils.ts` L364-L386
- Home screen (reads metrics from seeded log + profile): `app/(tabs)/index.tsx` L256-L429
  - `HomeScreen()` entry: `app/(tabs)/index.tsx` L256
  - `loadToday()` uses `getDailyLog/getUserProfile/getDailyMetric`: `app/(tabs)/index.tsx` L353-L429

**Potential Breakpoints**
- Local vs Supabase “half-signed-in” state:
  - `AuthProvider.ensureLocalUserFromSupabase()` can synthesize a local user from a Supabase session (`app/context/authcontext.tsx` L133-L155). If Supabase session exists but user email is missing/late, route guards and UI may oscillate.
- Onboarding writes `AsyncStorage.setItem('user', …)` (`app/onboarding.tsx` L260-L262) but does not create a secure password hash; the first real credential login path is in `AuthProvider.login()` (`app/context/authcontext.tsx` L582+). If onboarding is intended to be available without auth, that’s fine; if onboarding is intended to be tied to signup, this is a continuity risk.
- `publicGroups` includes `'(tabs)'` (`app/context/authcontext.tsx` L565-L573). This allows tabs access without `user` or Supabase session, so any “private” functionality must gate within the tab screens.

**Required Invariants**
- If `profile.onboardingCompleted === true` then `routeAfterAuth()` routes to `/(tabs)` (`app/context/authcontext.tsx` L460-L465).
- If user is not authenticated and a route is not in `publicGroups`, navigation redirects to `/auth/login` (`app/context/authcontext.tsx` L569-L573).
- Profile storage key canonicalization must always write to `userProfile:<email>` for the active user and migrate legacy keys (`utils/storageUtils.ts` L326-L350, L393-L405).

**Failure Handling**
- Auth failures throw and are surfaced via alerts in screens (e.g. `app/auth/login.tsx` L20-L25).
- AuthProvider’s async bootstrap catches and reports errors via `captureException` in prod (`app/context/authcontext.tsx` L520-L525).


## Flow 2: Food Search → Portion Selection → Logging → Today Log → Macros Totals

**Flow Trace**
- Food modal UI: `app/(modals)/food.tsx` (entry `FoodModal()` at L112)
  - Search kickoff and debounce: `app/(modals)/food.tsx` L278-L327 (local pool + remote search)
  - Barcode lookup: `app/(modals)/food.tsx` L218-L247
  - Portion preview: `convertSelectionToCanonical` + `computeMacrosForCanonical`: `app/(modals)/food.tsx` L384-L392
- Search + cache layer: `utils/foodSearchService.ts`
  - `hydratePersistentFoodSearchCache()`: `utils/foodSearchService.ts` L1177-L1186
  - `searchFoods()`: `utils/foodSearchService.ts` L1188-L1316
  - Unit/portion helpers: `utils/foodSearchService.ts` L1539-L1684
- Logging into daily log: `utils/foodSearchService.ts`
  - `addFoodToDailyLog()`: `utils/foodSearchService.ts` L1686-L1803
    - Converts unit to canonical: L1694-L1698
    - Writes entry + updates `DailyLog.calories` and `DailyLog.macros`: L1760-L1780
- Daily log persistence: `utils/storageUtils.ts`
  - `getDailyLog()`/`saveDailyLog()`: `utils/storageUtils.ts` L364-L386
- Metric computation (macros totals): `utils/dailyMetrics.ts`
  - `buildDailyMetric()`: `utils/dailyMetrics.ts` L130-L181
  - `getDailyMetric()`: `utils/dailyMetrics.ts` L183-L195
- Home totals surface: `app/(tabs)/index.tsx`
  - `loadToday()` reads `DailyMetric` and stores macros totals into screen state: `app/(tabs)/index.tsx` L353-L428

**Potential Breakpoints**
- Unit conversion failure throws hard error in `addFoodToDailyLog()` (`utils/foodSearchService.ts` L1696-L1698). UI must catch and show a controlled error.
- Daily totals drift risk:
  - `addFoodToDailyLog()` increments `log.calories` and `log.macros` in-place. If entries are later deleted/edited, deletions must decrement totals or totals will drift from sum(entries).
- Search race conditions:
  - The debounce uses `AbortController` and request id checks (`app/(modals)/food.tsx` L278-L327). Any state updates after unmount would be a crash risk; this effect does not use an `alive` flag, so correctness depends on `requestId` gating.

**Required Invariants**
- After logging, `DailyLog.foodEntries` includes the entry and `DailyLog.macros`/`DailyLog.calories` reflect the change (`utils/foodSearchService.ts` L1760-L1780).
- `FoodEntry.meal` values remain within `breakfast|lunch|dinner|snack` (`utils/storageUtils.ts` `FoodEntry` type L4-L28; `app/(modals)/food.tsx` `MealType` L60-L68).

**Failure Handling**
- Search failures from remote sources are tolerated via `Promise.allSettled()` and local fallback (`utils/foodSearchService.ts` L1261-L1273).


## Flow 3: Apple Health Connect → Permission Flow → Sync → Error States

**Flow Trace**
- Permissions UI: `app/health-permissions.tsx` (entry `HealthPermissionsScreen()` at L34)
  - State refresh on focus/foreground: `app/health-permissions.tsx` L61-L100
  - Proof-of-life diagnostic: `app/health-permissions.tsx` L148-L199
- Health service API (authorization/read/write): `utils/healthService.ts` (called by the screen)
- Wearable import preferences + sync: `utils/wearableImportService.ts`
  - Preferences read/write: `getWearableImportPreferences()` L76-L89, `setWearableImportPreferences()` L91-L103
  - Manual import: `importWearableDailySignals()` L188-L341
  - Auto-sync gate: `syncWearableSignalsIfEnabled()` L343-L397
- Auto-sync triggers:
  - On app open + foreground: `app/_layout.tsx` L25-L51 (calls `syncWearableSignalsIfEnabled()`)
  - On Home refresh: `app/(tabs)/index.tsx` L353-L356 (calls `syncWearableSignalsIfEnabled(date)`)

**Potential Breakpoints**
- Android path returns “not wired” snapshot (explicitly) and does not import (`utils/wearableImportService.ts` L196-L208). If Android support is required, this is a continuity gap.
- Auto-sync stale gate uses only `lastSuccessfulHealthSyncAt` and a 30-minute window (`utils/wearableImportService.ts` L48-L74, L346-L354). If a user expects immediate sync after toggling permissions, this may skip until stale.
- Import writes an “imported workout” derived from active energy (`utils/wearableImportService.ts` L110-L160) and merges into workouts list (`utils/wearableImportService.ts` L162-L186). This must never overwrite user-logged workouts.

**Required Invariants**
- Auto-sync runs only when `prefs.connected && prefs.autoSync` (`utils/wearableImportService.ts` L344-L345).
- If not authorized, sync returns `null` (auto) or a snapshot with `imported=false` and a reason (manual) (`utils/wearableImportService.ts` L218-L235, L364-L373).

**Failure Handling**
- Wearable sync catches runtime errors and returns a failure snapshot (`utils/wearableImportService.ts` L375-L396).
- Permissions screen surfaces actionable banners guiding the user to Health settings (`app/health-permissions.tsx` L156-L199).


## Flow 4: Apple Watch Workout Start → Live Session → Pause/Resume/End → Recovery → Phone Remote Controls

**Flow Trace**
- Watch session manager: `ios/ZenithWatch Watch App/WatchWorkoutManager.swift`
  - Start: `startRun()` L132-L134, `startLift()` L140-L142
  - Pause/resume: `pause()` L144-L158, `resume()` L160-L175
  - End flow: `armEnd()` L177-L197, `confirmEnd()` L199-L206
  - Sends state to phone: `sendSnapshotToPhone()` L839-L877
  - Sends finalize payload: `sendFinalizeToPhone()` L879-L928
  - Receives phone commands: `handleInboundMessage()` (COMMAND_REQUEST) L1041-L1064
- Phone WatchConnectivity router: `ios/Zenith/RunConnectivityManager.swift`
  - Sends commands to watch: `sendCommand()` L35-L67
  - Routes inbound STATE_UPDATE / FINALIZE to JS event emitters: `handleInboundMessage()` L146-L213
  - Persists FINALIZE while JS listeners are detached: L10-L33, L191-L206
- React Native bridges:
  - Native module send command: `ios/Zenith/RunControlNativeBridge.swift` L63-L71
  - Events: `ios/Zenith/RunControlEventEmitter.swift` L18-L40
  - Lift equivalents: `ios/Zenith/LiftControlNativeBridge.swift` L34-L45, `ios/Zenith/LiftControlEventEmitter.swift` L18-L40
- JS native-bridge adapters:
  - Run: `utils/runNativeBridge.ts`
    - Native listener wiring: `utils/runNativeBridge.ts` L75-L83, L191-L229
    - Snapshot normalization + persistence: `utils/runNativeBridge.ts` L107-L158, L209-L215
  - Run snapshot storage + command queue: `utils/runControlSync.ts` L104-L171
- UI surfaces:
  - Home “run control strip” + sync: `app/(tabs)/index.tsx` `syncRunControl()` L431-L440 and related callers.
  - Live run screen: `app/live-run.tsx` (entry at L202)
  - Live session wrapper: `app/live-session.tsx` (entry at L203)
  - Live lift: `app/live-lift.tsx` (entry at L39)

**Potential Breakpoints**
- Command/session mismatch is rejected on watch (`WatchWorkoutManager.handleInboundMessage()` L1046-L1051). Phone must always send the correct `sessionId`.
- Recovery safety:
  - Watch disallows controls when `needsRecovery==true` or `recoveryIsVerified==false` (`canControlWorkout` L126-L128).
  - Phone UI must reflect and respect `needsRecovery/recoveryVerified` to avoid phantom sessions.
- Event timing:
  - `RunConnectivityManager` persists FINALIZE events until JS attaches (`ios/Zenith/RunConnectivityManager.swift` L10-L33, L191-L206). JS must call `startObserving` by mounting listeners early enough.

**Required Invariants**
- Watch state updates carry monotonically increasing `seq` per session; JS storage rejects stale seq (`utils/runControlSync.ts` L109-L116).
- Commands include `kind` and `sessionId`.

**Failure Handling**
- Phone emits connectivity events on command send failure (`ios/Zenith/RunConnectivityManager.swift` L53-L65).
- Watch returns `accepted=false` + `reasonCode` for unsupported commands or recovery-unverified state (`WatchWorkoutManager.swift` L1055-L1064).


## Flow 5: Community Tab Open → Auth/Session Validity → Navigation → Data Fetch

**Flow Trace**
- Entry screen: `app/(tabs)/community/index.tsx` (entry `CommunityScreen()` at L256)
  - Auth context: `useAuth()` is read at `app/(tabs)/community/index.tsx` L259-L260
  - Feed load is gated on `viewerUserId` and `isSupabaseConfigured`: `loadFriendsFeed()` L386-L412
  - Leaderboards/groups/teams gated similarly: `app/(tabs)/community/index.tsx` L414-L495
- Auth session/provider: `app/context/authcontext.tsx`
  - Supplies `hasSupabaseSession`, `supabaseUserId`, and token getter (`app/context/authcontext.tsx` L33-L52, L234-L279)
  - Route guard allows entering tabs without auth; Community must self-gate (`app/context/authcontext.tsx` L565-L573)
- Supabase client + social API:
  - `utils/supabaseClient.ts` exports `socialApi` gated by flags + config (`utils/supabaseClient.ts` L1035-L1038)
  - `CommunityScreen` calls `socialApi.getFriendsFeed/getMyGroups/getMyTeams/...` (`app/(tabs)/community/index.tsx` L392+).

**Potential Breakpoints**
- `socialApi` is a throwing proxy when social features are disabled (or Supabase not configured). Any call without appropriate gating must be wrapped in try/catch.
- Supabase session may exist while `supabaseUserId` is still null (during hydration). Feed loaders correctly short-circuit when `viewerUserId` is falsy (`app/(tabs)/community/index.tsx` L386-L388), but UI must provide a “connecting” state.

**Required Invariants**
- Community data fetch functions must never run with `viewerUserId=null`.
- When `hasSupabaseSession==false` and Supabase is configured, user must be directed to connect/sign in rather than encountering a crash.

**Failure Handling**
- Feed loader treats “offline-like” errors specially and falls back to cached feed (`app/(tabs)/community/index.tsx` L399-L405).
