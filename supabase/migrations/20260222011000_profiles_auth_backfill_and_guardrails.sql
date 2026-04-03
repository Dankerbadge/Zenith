-- Backfill profiles auth guardrails for environments that applied historical
-- placeholder migrations instead of the named auth/profile migrations.
--
-- Goals:
-- - Keep RLS enabled.
-- - Ensure authenticated users can read and mutate only their own profile row.
-- - Ensure first-time profile inserts are allowed for auth.uid() = id.
-- - Ensure username RPC exists and is callable.
-- - Ensure signup trigger creates a profile row.

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  CREATE POLICY "Users can insert own profile"
    ON public.profiles
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;
DO $$
BEGIN
  CREATE POLICY "profiles_update_own"
    ON public.profiles
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;
DO $$
BEGIN
  CREATE POLICY "profiles_read_authenticated"
    ON public.profiles
    FOR SELECT
    TO authenticated
    USING (true);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;
GRANT SELECT ON TABLE public.profiles TO authenticated;
GRANT INSERT (id, email, username, display_name, avatar_url, bio) ON TABLE public.profiles TO authenticated;
GRANT UPDATE (username, display_name, avatar_url, bio) ON TABLE public.profiles TO authenticated;
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

  IF current_username IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  IF lower(current_username) = cleaned THEN
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
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF new.email IS NULL OR length(trim(new.email)) = 0 THEN
    RETURN new;
  END IF;

  BEGIN
    INSERT INTO public.profiles (id, email, display_name)
    VALUES (
      new.id,
      new.email,
      NULLIF(trim(coalesce(new.raw_user_meta_data->>'first_name', '')), '')
    )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;

  RETURN new;
END;
$$;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
