-- Atomic avatar metadata RPC: writes canonical path/version/url together.
CREATE OR REPLACE FUNCTION public.set_avatar_metadata(
  avatar_path text DEFAULT NULL,
  avatar_version bigint DEFAULT NULL,
  avatar_url text DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  auth_email text;
  normalized_path text := NULLIF(TRIM(COALESCE(avatar_path, '')), '');
  normalized_url text := NULLIF(TRIM(COALESCE(avatar_url, '')), '');
  normalized_version bigint := COALESCE(avatar_version, FLOOR(EXTRACT(EPOCH FROM NOW()) * 1000)::bigint);
  row_out public.profiles;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT u.email INTO auth_email FROM auth.users u WHERE u.id = uid;

  INSERT INTO public.profiles (id, email)
  VALUES (uid, auth_email)
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.profiles p
  SET
    avatar_path = normalized_path,
    avatar_version = normalized_version,
    avatar_url = normalized_url,
    updated_at = NOW()
  WHERE p.id = uid
  RETURNING p.* INTO row_out;

  RETURN row_out;
END;
$$;
