-- Fix username change RPC for fresh profiles where username is NULL.
-- Previous logic treated NULL username as "profile missing".

CREATE OR REPLACE FUNCTION public.change_username(new_username text)
RETURNS TABLE (
  changed boolean,
  username text,
  next_allowed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  last_changed timestamptz;
  cleaned text;
  current_username text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  cleaned := lower(trim(coalesce(new_username, '')));
  cleaned := regexp_replace(cleaned, '^@+', '', 'g');
  cleaned := regexp_replace(cleaned, '\s+', '_', 'g');
  cleaned := regexp_replace(cleaned, '[^a-z0-9._]+', '', 'g');
  cleaned := regexp_replace(cleaned, '_+', '_', 'g');
  cleaned := regexp_replace(cleaned, '^[._]+', '', 'g');
  cleaned := regexp_replace(cleaned, '[._]+$', '', 'g');

  IF cleaned !~ '^[a-z0-9._]{3,20}$' THEN
    RAISE EXCEPTION 'Invalid username. Use 3-20 chars: a-z, 0-9, period, underscore.';
  END IF;

  SELECT p.username, p.username_changed_at
    INTO current_username, last_changed
  FROM public.profiles p
  WHERE p.id = uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  IF current_username IS NOT NULL AND lower(current_username) = cleaned THEN
    RETURN QUERY
      SELECT true, current_username, (CASE WHEN last_changed IS NULL THEN now() ELSE last_changed + interval '14 days' END);
    RETURN;
  END IF;

  IF last_changed IS NOT NULL AND last_changed > now() - interval '14 days' THEN
    RETURN QUERY
      SELECT false, current_username, (last_changed + interval '14 days');
    RETURN;
  END IF;

  BEGIN
    UPDATE public.profiles
    SET username = cleaned,
        username_changed_at = now(),
        updated_at = now()
    WHERE id = uid;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'Username already taken';
  END;

  RETURN QUERY
    SELECT true, cleaned, now() + interval '14 days';
END;
$$;
GRANT EXECUTE ON FUNCTION public.change_username(text) TO authenticated;
