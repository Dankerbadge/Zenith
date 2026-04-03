-- Ensure authenticated users can persist all pertinent profile fields from onboarding/settings.
-- Existing RLS policy `profiles_update_own` still constrains writes to auth.uid() = id.

GRANT SELECT ON TABLE public.profiles TO authenticated;
DO $$
DECLARE
  v_col text;
  update_columns text[] := ARRAY[
    'username',
    'display_name',
    'avatar_url',
    'bio',
    'height_cm',
    'weight_kg',
    'sex_at_birth',
    'birthdate',
    'activity_level',
    'onboarding_goals',
    'unit_system',
    'water_target_ml',
    'food_region',
    'food_language',
    'is_private_account',
    'profile_visibility',
    'activity_visibility',
    'allow_friend_requests_from',
    'discoverable_by_username',
    'allow_public_discovery_feed',
    'allow_dms_from_non_friends'
  ];
BEGIN
  FOREACH v_col IN ARRAY update_columns LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'profiles'
        AND column_name = v_col
    ) THEN
      EXECUTE format('GRANT UPDATE (%I) ON TABLE public.profiles TO authenticated', v_col);
    END IF;
  END LOOP;
END
$$;
