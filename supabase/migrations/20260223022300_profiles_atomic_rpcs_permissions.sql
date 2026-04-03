-- Function privilege hardening as a single statement for remote apply compatibility.
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.sync_profile_atomic(jsonb) FROM PUBLIC';
  EXECUTE 'REVOKE ALL ON FUNCTION public.complete_onboarding_atomic(jsonb) FROM PUBLIC';
  EXECUTE 'REVOKE ALL ON FUNCTION public.set_avatar_metadata(text, bigint, text) FROM PUBLIC';

  EXECUTE 'GRANT EXECUTE ON FUNCTION public.sync_profile_atomic(jsonb) TO authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.complete_onboarding_atomic(jsonb) TO authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.set_avatar_metadata(text, bigint, text) TO authenticated';
END
$$;
