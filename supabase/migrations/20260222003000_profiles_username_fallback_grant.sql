-- Allow backward-compatible username writes when clients fall back from RPC.
-- RLS policy `profiles_update_own` still constrains updates to auth.uid() = id.
-- This unblocks onboarding/profile username save for environments where
-- `public.change_username` is not yet available.

GRANT UPDATE (username) ON TABLE public.profiles TO authenticated;
