# Supabase Next Actions (Phase 28-30)

Last updated: 2026-02-04

## 1) Set Runtime Env Vars (Required)
- Add to `.env` (or EAS secrets):
  - `EXPO_PUBLIC_SUPABASE_URL=...`
  - `EXPO_PUBLIC_SUPABASE_ANON_KEY=...`
- Restart Metro after adding values.

## 2) Host Legal Pages (Required Before Store)
- Ensure these URLs are publicly reachable:
  - `https://zenithfit.app/privacy`
  - `https://zenithfit.app/terms`
- Confirm support email is live: `support@zenithfit.app`.
- Status (2026-02-04): legal URLs are live and returning HTTP 200.

## 3) Apply DB Schema (Recommended if moving social from local to Supabase)
- Current app social/comms is local-first (AsyncStorage).
- If you want backend parity next, run `docs/supabase_schema.sql` (or your updated migration set) in Supabase SQL editor.
- After applying, enforce RLS and test:
  - blocked users hidden from search/feed/messages
  - invite/request rate limits
  - moderation report insertion

## 4) Enable Auth Providers (If Needed)
- Supabase Auth -> Providers:
  - Email (required)
  - Apple/Google (optional)
- Configure redirect URLs for Expo deep links.

## 5) Storage + Policies
- Create buckets only if needed for avatars/uploads.
- Add RLS policies so users can only write own assets.

## 6) Go/No-Go Checks
- [ ] Env vars injected and app boot clean
- [ ] `npm run verify:supabase-runtime` passes (URL/key + RLS probe)
- [ ] Privacy/Terms URLs open from in-app compliance screen
- [ ] Block/report/mute behavior verified
- [ ] Request/message rate limits verified
- [ ] No anonymous write path bypasses RLS

## Notes
- Core logging/run/stats works without Supabase.
- Supabase is currently optional for ship; required only for backend social sync and auth-linked multi-device persistence.
