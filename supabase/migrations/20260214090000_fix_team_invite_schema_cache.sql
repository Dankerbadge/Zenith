-- Hotfix migration: tolerate partial deploys + PostgREST schema cache drift for team invite codes.
-- Goal:
-- - Ensure `teams.invite_code_plain` exists (rename legacy `invite_code` if needed)
-- - Ensure `public.resolve_team_invite_code(text)` exists and works during phased rollout
-- - Request PostgREST schema reload so clients stop seeing stale "schema cache" errors

CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- Ensure plaintext column exists (phased rename from legacy `invite_code`).
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

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'teams'
      AND column_name = 'invite_code_plain'
  ) THEN
    ALTER TABLE public.teams ADD COLUMN invite_code_plain text;
  END IF;
END $$;
-- Ensure invite hash fields exist (no-op if already present).
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS invite_code_hash text,
  ADD COLUMN IF NOT EXISTS invite_code_version integer,
  ADD COLUMN IF NOT EXISTS invite_code_rotated_at timestamptz,
  ADD COLUMN IF NOT EXISTS invite_code_rotated_by_user_id uuid;
-- Backfill hash/version best-effort.
UPDATE public.teams
SET invite_code_version = COALESCE(invite_code_version, 1)
WHERE invite_code_plain IS NOT NULL
  AND invite_code_version IS NULL;
UPDATE public.teams
SET invite_code_hash = crypt(invite_code_plain, gen_salt('bf', 10))
WHERE invite_code_plain IS NOT NULL
  AND (invite_code_hash IS NULL OR invite_code_hash = '');
CREATE UNIQUE INDEX IF NOT EXISTS teams_invite_code_plain_uniq
  ON public.teams(invite_code_plain)
  WHERE invite_code_plain IS NOT NULL;
-- Resolve invite codes: prefer hash validation, fall back to plaintext equality if hash isn't available yet.
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
    and (
      (t.invite_code_hash is not null and crypt(p_invite_code, t.invite_code_hash) = t.invite_code_hash)
      or (t.invite_code_hash is null and t.invite_code_plain = p_invite_code)
    )
  limit 1;
$$;
GRANT EXECUTE ON FUNCTION public.resolve_team_invite_code(text) TO authenticated;
-- Nudge PostgREST to refresh schema cache immediately (best-effort).
DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
EXCEPTION
  WHEN OTHERS THEN
    -- ignore: not all environments allow notify, and it's safe to continue.
    NULL;
END $$;
