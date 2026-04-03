# Step 2 - Deploy Garmin Supabase Backend

Run these commands from project root after `supabase login` and `supabase link --project-ref <your-ref>`:

1. Apply SQL contract:
- Open Supabase SQL Editor
- Paste contents of `docs/supabase_garmin_connectiq.sql`
- Run once

2. Deploy edge functions:
- `supabase functions deploy garmin-entitlement`
- `supabase functions deploy garmin-link-token`
- `supabase functions deploy garmin-link-confirm`
- `supabase functions deploy garmin-workout-upsert`

3. Set function secrets:
- `supabase secrets set SUPABASE_URL=https://<project-ref>.supabase.co`
- `supabase secrets set SUPABASE_ANON_KEY=<your-anon-key>`

4. App env required:
- `EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>`

5. Verify in app:
- Open `Profile -> System & Compliance -> Garmin Connect IQ`
- Backend readiness should show `configured: Yes`
- Mode should show `supabase_edge`
