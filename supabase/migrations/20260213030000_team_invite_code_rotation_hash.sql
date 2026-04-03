-- Team invite code rotation (6-digit) + hash+versioned validation.
-- Decision lock:
-- - Validation uses hash (primary)
-- - Rotation invalidates immediately via version bump + replacing hash
-- - Keep plaintext (or encrypted plaintext) temporarily for admin "copy code" UI
-- - Plaintext must never be selectable by non-admins

-- pgcrypto provides crypt() + gen_salt().
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- Rename legacy `invite_code` to `invite_code_plain` (phased migration).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'teams'
      AND column_name = 'invite_code'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'teams'
      AND column_name = 'invite_code_plain'
  ) THEN
    ALTER TABLE public.teams RENAME COLUMN invite_code TO invite_code_plain;
  END IF;
END $$;
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS invite_code_hash text,
  ADD COLUMN IF NOT EXISTS invite_code_version integer,
  ADD COLUMN IF NOT EXISTS invite_code_rotated_at timestamptz,
  ADD COLUMN IF NOT EXISTS invite_code_rotated_by_user_id uuid;
-- Backfill hash/version for existing teams.
UPDATE public.teams
SET invite_code_version = COALESCE(invite_code_version, 1)
WHERE invite_code_plain IS NOT NULL
  AND invite_code_version IS NULL;
UPDATE public.teams
SET invite_code_hash = crypt(invite_code_plain, gen_salt('bf', 10))
WHERE invite_code_plain IS NOT NULL
  AND (invite_code_hash IS NULL OR invite_code_hash = '');
UPDATE public.teams
SET invite_code_rotated_at = COALESCE(invite_code_rotated_at, updated_at, created_at, now()),
    invite_code_rotated_by_user_id = COALESCE(invite_code_rotated_by_user_id, owner_id)
WHERE invite_code_plain IS NOT NULL
  AND invite_code_rotated_at IS NULL;
DO $$
BEGIN
  ALTER TABLE public.teams
    ADD CONSTRAINT teams_invite_code_hash_required
    CHECK (invite_code_plain IS NULL OR invite_code_hash IS NOT NULL);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
-- RPC: resolve an invite code to a team (SECURITY DEFINER bypasses RLS).
-- Validation uses hash, never plaintext equality.
CREATE OR REPLACE FUNCTION public.resolve_team_invite_code(p_invite_code text)
RETURNS TABLE (
  team_id uuid,
  name text,
  description text,
  team_type text,
  owner_id uuid,
  is_public boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  select
    t.id as team_id,
    t.name,
    t.description,
    t.team_type,
    t.owner_id,
    t.is_public
  from public.teams t
  where auth.uid() is not null
    and p_invite_code ~ '^[0-9]{6}$'
    and t.invite_code_hash is not null
    and crypt(p_invite_code, t.invite_code_hash) = t.invite_code_hash
  limit 1;
$$;
GRANT EXECUTE ON FUNCTION public.resolve_team_invite_code(text) TO authenticated;
-- Admin-only plaintext retrieval (for copy/share UI).
CREATE OR REPLACE FUNCTION public.get_team_invite_code(p_team_id uuid)
RETURNS TABLE (
  invite_code text,
  invite_code_version integer,
  rotated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  select
    t.invite_code_plain as invite_code,
    t.invite_code_version,
    t.invite_code_rotated_at as rotated_at
  from public.teams t
  where auth.uid() is not null
    and t.id = p_team_id
    and (
      t.owner_id = auth.uid()
      or exists (
        select 1
        from public.team_members tm
        where tm.team_id = t.id
          and tm.user_id = auth.uid()
          and lower(tm.role) in ('owner', 'admin')
      )
    )
  limit 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_team_invite_code(uuid) TO authenticated;
-- Rotation (owner/admin only). Rate-limited (1/min per team).
CREATE OR REPLACE FUNCTION public.rotate_team_invite_code(p_team_id uuid)
RETURNS TABLE (
  invite_code text,
  invite_code_version integer,
  rotated_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user uuid;
  v_now timestamptz := now();
  v_last_rotated timestamptz;
  v_owner uuid;
  v_code text;
  tries int := 0;
BEGIN
  v_user := auth.uid();
  IF v_user IS NULL THEN
    RETURN;
  END IF;

  SELECT t.owner_id, t.invite_code_rotated_at
  INTO v_owner, v_last_rotated
  FROM public.teams t
  WHERE t.id = p_team_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'team_not_found';
  END IF;

  IF NOT (
    v_owner = v_user
    OR EXISTS (
      SELECT 1
      FROM public.team_members tm
      WHERE tm.team_id = p_team_id
        AND tm.user_id = v_user
        AND lower(tm.role) IN ('owner', 'admin')
    )
  ) THEN
    RETURN;
  END IF;

  IF v_last_rotated IS NOT NULL AND (v_now - v_last_rotated) < interval '60 seconds' THEN
    RAISE EXCEPTION 'invite_code_rotation_rate_limited';
  END IF;

  LOOP
    tries := tries + 1;
    IF tries > 50 THEN
      RAISE EXCEPTION 'invite_code_allocation_failed team_id=%', p_team_id;
    END IF;

    v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    IF v_code = '000000' THEN
      CONTINUE;
    END IF;

    BEGIN
      UPDATE public.teams
      SET invite_code_plain = v_code,
          invite_code_hash = crypt(v_code, gen_salt('bf', 10)),
          invite_code_version = COALESCE(invite_code_version, 0) + 1,
          invite_code_rotated_at = v_now,
          invite_code_rotated_by_user_id = v_user
      WHERE id = p_team_id;
      EXIT;
    EXCEPTION
      WHEN unique_violation THEN
        CONTINUE;
    END;
  END LOOP;

  RETURN QUERY
  SELECT
    t.invite_code_plain as invite_code,
    t.invite_code_version,
    t.invite_code_rotated_at as rotated_at
  FROM public.teams t
  WHERE t.id = p_team_id
  LIMIT 1;
END;
$$;
GRANT EXECUTE ON FUNCTION public.rotate_team_invite_code(uuid) TO authenticated;
-- Treat plaintext/hash as sensitive: do not allow direct SELECT from clients.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'teams'
      AND column_name = 'invite_code_plain'
  ) THEN
    EXECUTE 'REVOKE SELECT (invite_code_plain) ON public.teams FROM anon, authenticated';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'teams'
      AND column_name = 'invite_code_hash'
  ) THEN
    EXECUTE 'REVOKE SELECT (invite_code_hash) ON public.teams FROM anon, authenticated';
  END IF;
END $$;
