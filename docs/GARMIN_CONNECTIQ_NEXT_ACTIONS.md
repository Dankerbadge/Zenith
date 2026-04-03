# Garmin Connect IQ - Next Actions

## Implemented in app (this pass)
- Garmin feature flags and companion diagnostics surface.
- Free vs premium split locked:
  - Free on watch: start/pause/resume/end/save + basic live metrics + summary sync.
  - Premium via mobile entitlement: advanced analytics/trends/coaching/config profiles.
- Garmin protocol/types, outbound queue, event log, entitlement cache, link code flow.
- Backend contract client added with dual-mode routing:
  - REST mode:
    - `/wearables/garmin/entitlement`
    - `/wearables/garmin/link-token`
    - `/wearables/garmin/link-confirm`
    - `/wearables/garmin/workouts/upsert`
  - Supabase Edge mode:
    - `/functions/v1/garmin-entitlement`
    - `/functions/v1/garmin-link-token`
    - `/functions/v1/garmin-link-confirm`
    - `/functions/v1/garmin-workout-upsert`
- UI routes added:
  - `/wearables`
  - `/wearables/garmin`
- Profile/compliance/health screens now expose Garmin surfaces behind feature flags.
- iOS native bridge scaffolding added and linked in Xcode target:
  - `GarminCompanionManager.swift`
  - `GarminCompanionEventEmitter.swift`
  - `GarminCompanionNativeBridge.swift`
  - `GarminCompanionNativeBridge.m`
- Supabase edge function templates added:
  - `supabase/functions/garmin-entitlement/index.ts`
  - `supabase/functions/garmin-link-token/index.ts`
  - `supabase/functions/garmin-link-confirm/index.ts`
  - `supabase/functions/garmin-workout-upsert/index.ts`

## Still required to reach real device parity
1. Build and publish the actual Garmin Connect IQ watch app (Monkey C).
2. Replace iOS bridge placeholders with Garmin Mobile SDK runtime wiring and real callbacks.
3. Deploy backend endpoints above with auth + idempotency enabled (Supabase functions or REST API).
4. Device test matrix on at least two Garmin models.

## External items needed from product owner
- Garmin Connect IQ developer account + app ID.
- Backend mode decision:
  - custom REST via `EXPO_PUBLIC_GARMIN_API_BASE_URL`, or
  - Supabase Edge via `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
- Decision on initial Garmin-supported sports list for v1.
