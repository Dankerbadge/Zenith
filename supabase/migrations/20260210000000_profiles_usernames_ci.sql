-- Enforce per-account unique usernames (case-insensitive) and ensure profiles always have a username.
-- This fixes the "everyone is @zenith-athlete" class of bugs by making the DB the source of truth.

-- Keep updated_at fresh.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;
CREATE TRIGGER profiles_set_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
-- Generate a unique fallback username with a deterministic prefix + random suffix.
CREATE OR REPLACE FUNCTION public.generate_unique_username(base text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  prefix text;
  suffix int;
  candidate text;
  attempt int := 0;
BEGIN
  prefix := lower(regexp_replace(coalesce(base, ''), '[^a-z0-9._]+', '_', 'g'));
  prefix := regexp_replace(prefix, '^@+', '');
  prefix := regexp_replace(prefix, '^[._]+', '');
  prefix := regexp_replace(prefix, '[._]+$', '');
  IF length(prefix) < 3 THEN
    prefix := 'zenith-athlete';
  END IF;
  -- Leave room for "-####" within 20 chars.
  prefix := left(prefix, 16);

  LOOP
    suffix := floor(random() * 9000 + 1000);
    candidate := left(prefix || '-' || suffix::text, 20);
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE lower(p.username) = lower(candidate)) THEN
      RETURN candidate;
    END IF;
    attempt := attempt + 1;
    IF attempt > 80 THEN
      candidate := 'zenith-athlete-' || floor(random() * 900000 + 100000)::text;
      IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE lower(p.username) = lower(candidate)) THEN
        RETURN left(candidate, 20);
      END IF;
      attempt := 0;
    END IF;
  END LOOP;
END;
$$;
-- Normalize usernames to lower-case and auto-fill when missing.
CREATE OR REPLACE FUNCTION public.profiles_username_normalize()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.username IS NULL OR length(trim(NEW.username)) = 0 THEN
    NEW.username := public.generate_unique_username(split_part(coalesce(NEW.email, ''), '@', 1));
  END IF;
  NEW.username := lower(NEW.username);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS profiles_username_normalize ON public.profiles;
CREATE TRIGGER profiles_username_normalize
BEFORE INSERT OR UPDATE OF username, email ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.profiles_username_normalize();
-- Backfill any legacy rows missing a username.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id, email
    FROM public.profiles
    WHERE username IS NULL OR length(trim(username)) = 0
  LOOP
    UPDATE public.profiles
    SET username = public.generate_unique_username(split_part(coalesce(r.email, ''), '@', 1))
    WHERE id = r.id;
  END LOOP;
END $$;
-- If any case-only duplicates exist, rewrite all but one.
WITH d AS (
  SELECT id,
         row_number() OVER (PARTITION BY lower(username) ORDER BY created_at NULLS LAST, id) AS rn
  FROM public.profiles
  WHERE username IS NOT NULL AND length(trim(username)) > 0
)
UPDATE public.profiles p
SET username = public.generate_unique_username(p.username)
FROM d
WHERE p.id = d.id AND d.rn > 1;
-- Enforce case-insensitive uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_unique_ci
ON public.profiles (lower(username));
-- Require username once onboarding completes; DB guarantees it always exists after this migration.
ALTER TABLE public.profiles
  ALTER COLUMN username SET NOT NULL;
-- RLS: authenticated users can read public profiles; users can update their own.
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "profiles_read_authenticated"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
