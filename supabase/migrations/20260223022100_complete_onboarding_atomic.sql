-- Atomic onboarding completion RPC: profile patch + auth metadata update in one call.
CREATE OR REPLACE FUNCTION public.complete_onboarding_atomic(profile_patch jsonb DEFAULT '{}'::jsonb)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  patch jsonb := COALESCE(profile_patch, '{}'::jsonb);
  display_name_text text := NULLIF(TRIM(COALESCE(patch->>'display_name', '')), '');
  completed_at_text text := to_char((NOW() AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  row_out public.profiles;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT public.sync_profile_atomic(patch) INTO row_out;

  UPDATE auth.users u
  SET raw_user_meta_data =
    COALESCE(u.raw_user_meta_data, '{}'::jsonb)
    || jsonb_build_object(
      'onboarding_completed', true,
      'onboarding_completed_at', COALESCE(u.raw_user_meta_data->>'onboarding_completed_at', completed_at_text)
    )
    || CASE
      WHEN display_name_text IS NOT NULL THEN jsonb_build_object('first_name', display_name_text)
      ELSE '{}'::jsonb
    END
  WHERE u.id = uid;

  RETURN row_out;
END;
$$;;
