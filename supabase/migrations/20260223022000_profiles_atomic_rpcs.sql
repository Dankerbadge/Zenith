-- Atomic profile mutation RPC: upsert and patch profile fields in one call.
CREATE OR REPLACE FUNCTION public.sync_profile_atomic(profile_patch jsonb DEFAULT '{}'::jsonb)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  auth_email text;
  patch jsonb := COALESCE(profile_patch, '{}'::jsonb);
  row_out public.profiles;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT u.email INTO auth_email FROM auth.users u WHERE u.id = uid;

  INSERT INTO public.profiles (id, email, display_name)
  VALUES (
    uid,
    auth_email,
    NULLIF(TRIM(COALESCE(patch->>'display_name', '')), '')
  )
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.profiles p
  SET
    email = COALESCE(NULLIF(TRIM(COALESCE(patch->>'email', '')), ''), p.email, auth_email),
    display_name = CASE
      WHEN patch ? 'display_name' THEN NULLIF(TRIM(COALESCE(patch->>'display_name', '')), '')
      ELSE p.display_name
    END,
    bio = CASE
      WHEN patch ? 'bio' THEN NULLIF(TRIM(COALESCE(patch->>'bio', '')), '')
      ELSE p.bio
    END,
    avatar_url = CASE
      WHEN patch ? 'avatar_url' THEN NULLIF(TRIM(COALESCE(patch->>'avatar_url', '')), '')
      ELSE p.avatar_url
    END,
    avatar_path = CASE
      WHEN patch ? 'avatar_path' THEN NULLIF(TRIM(COALESCE(patch->>'avatar_path', '')), '')
      ELSE p.avatar_path
    END,
    avatar_version = CASE
      WHEN patch ? 'avatar_version' THEN NULLIF(TRIM(COALESCE(patch->>'avatar_version', '')), '')::bigint
      ELSE p.avatar_version
    END,
    height_cm = CASE
      WHEN patch ? 'height_cm' THEN NULLIF(TRIM(COALESCE(patch->>'height_cm', '')), '')::numeric
      ELSE p.height_cm
    END,
    weight_kg = CASE
      WHEN patch ? 'weight_kg' THEN NULLIF(TRIM(COALESCE(patch->>'weight_kg', '')), '')::numeric
      ELSE p.weight_kg
    END,
    sex_at_birth = CASE
      WHEN patch ? 'sex_at_birth' AND LOWER(TRIM(COALESCE(patch->>'sex_at_birth', ''))) IN ('male', 'female', 'unknown')
        THEN LOWER(TRIM(COALESCE(patch->>'sex_at_birth', '')))
      ELSE p.sex_at_birth
    END,
    birthdate = CASE
      WHEN patch ? 'birthdate' THEN NULLIF(TRIM(COALESCE(patch->>'birthdate', '')), '')::date
      ELSE p.birthdate
    END,
    activity_level = CASE
      WHEN patch ? 'activity_level'
        AND LOWER(TRIM(COALESCE(patch->>'activity_level', ''))) IN ('sedentary', 'light', 'moderate', 'very', 'extra', 'active', 'very_active')
        THEN LOWER(TRIM(COALESCE(patch->>'activity_level', '')))
      ELSE p.activity_level
    END,
    onboarding_goals = CASE
      WHEN patch ? 'onboarding_goals' AND jsonb_typeof(patch->'onboarding_goals') = 'array'
        THEN patch->'onboarding_goals'
      ELSE p.onboarding_goals
    END,
    unit_system = CASE
      WHEN patch ? 'unit_system' AND LOWER(TRIM(COALESCE(patch->>'unit_system', ''))) IN ('imperial', 'metric')
        THEN LOWER(TRIM(COALESCE(patch->>'unit_system', '')))
      ELSE p.unit_system
    END,
    water_target_ml = CASE
      WHEN patch ? 'water_target_ml' THEN NULLIF(TRIM(COALESCE(patch->>'water_target_ml', '')), '')::numeric
      ELSE p.water_target_ml
    END,
    food_region = CASE
      WHEN patch ? 'food_region' THEN NULLIF(UPPER(regexp_replace(COALESCE(patch->>'food_region', ''), '[^A-Za-z]', '', 'g')), '')
      ELSE p.food_region
    END,
    food_language = CASE
      WHEN patch ? 'food_language' THEN NULLIF(LOWER(regexp_replace(COALESCE(patch->>'food_language', ''), '[^A-Za-z0-9-]', '', 'g')), '')
      ELSE p.food_language
    END,
    is_private_account = CASE
      WHEN patch ? 'is_private_account' THEN COALESCE(NULLIF(TRIM(COALESCE(patch->>'is_private_account', '')), '')::boolean, p.is_private_account)
      ELSE p.is_private_account
    END,
    profile_visibility = CASE
      WHEN patch ? 'profile_visibility' THEN NULLIF(TRIM(COALESCE(patch->>'profile_visibility', '')), '')
      ELSE p.profile_visibility
    END,
    activity_visibility = CASE
      WHEN patch ? 'activity_visibility' THEN NULLIF(TRIM(COALESCE(patch->>'activity_visibility', '')), '')
      ELSE p.activity_visibility
    END,
    allow_friend_requests_from = CASE
      WHEN patch ? 'allow_friend_requests_from' THEN NULLIF(TRIM(COALESCE(patch->>'allow_friend_requests_from', '')), '')
      ELSE p.allow_friend_requests_from
    END,
    discoverable_by_username = CASE
      WHEN patch ? 'discoverable_by_username' THEN COALESCE(NULLIF(TRIM(COALESCE(patch->>'discoverable_by_username', '')), '')::boolean, p.discoverable_by_username)
      ELSE p.discoverable_by_username
    END,
    allow_public_discovery_feed = CASE
      WHEN patch ? 'allow_public_discovery_feed' THEN COALESCE(NULLIF(TRIM(COALESCE(patch->>'allow_public_discovery_feed', '')), '')::boolean, p.allow_public_discovery_feed)
      ELSE p.allow_public_discovery_feed
    END,
    allow_dms_from_non_friends = CASE
      WHEN patch ? 'allow_dms_from_non_friends' THEN COALESCE(NULLIF(TRIM(COALESCE(patch->>'allow_dms_from_non_friends', '')), '')::boolean, p.allow_dms_from_non_friends)
      ELSE p.allow_dms_from_non_friends
    END,
    updated_at = NOW()
  WHERE p.id = uid
  RETURNING p.* INTO row_out;

  IF row_out.id IS NULL THEN
    RAISE EXCEPTION 'Profile sync failed';
  END IF;

  RETURN row_out;
END;
$$;;
