-- Team invite codes (6-digit) for joining private teams.
-- Requirements:
-- - private by default
-- - unique randomized 6-digit invite_code shareable by members
--
-- NOTE: This migration is written to tolerate schema drift where earlier hotfixes
-- renamed `teams.invite_code` to `teams.invite_code_plain` (or dropped invite codes entirely)
-- before this migration was recorded in `supabase_migrations.schema_migrations`.

-- Ensure canonical plaintext code column exists (backward compatible with older clients).
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS invite_code_plain text;
-- If a legacy `invite_code` column exists, copy it forward (best-effort) so existing
-- team invite codes are preserved before we enforce constraints.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'teams'
      AND column_name = 'invite_code'
  ) THEN
    EXECUTE $sql$
      UPDATE public.teams
      SET invite_code_plain = invite_code
      WHERE invite_code_plain IS NULL
        AND invite_code IS NOT NULL
    $sql$;
  END IF;
END $$;
-- Normalize any invalid codes so we can enforce constraints safely.
UPDATE public.teams
SET invite_code_plain = NULL
WHERE invite_code_plain IS NOT NULL
  AND invite_code_plain !~ '^[0-9]{6}$';
-- Enforce basic format for invite codes when present.
DO $$
BEGIN
  ALTER TABLE public.teams
    ADD CONSTRAINT teams_invite_code_format
    CHECK (invite_code_plain IS NULL OR invite_code_plain ~ '^[0-9]{6}$');
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;
-- Best-effort: clear any duplicates before enforcing uniqueness.
WITH dups AS (
  SELECT invite_code_plain AS code, array_agg(id ORDER BY created_at DESC) AS ids
  FROM public.teams
  WHERE invite_code_plain IS NOT NULL
  GROUP BY invite_code_plain
  HAVING count(*) > 1
),
to_null AS (
  SELECT unnest(ids[2:]) AS id
  FROM dups
)
UPDATE public.teams t
SET invite_code_plain = NULL
FROM to_null n
WHERE t.id = n.id;
-- Uniqueness: one team per invite_code (NULL allowed).
CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_invite_code_unique
  ON public.teams(invite_code_plain)
  WHERE invite_code_plain IS NOT NULL;
-- Backfill missing invite codes so every team can be joined via code.
DO $$
DECLARE
  rec record;
  code text;
  tries int;
BEGIN
  FOR rec IN
    SELECT id
    FROM public.teams
    WHERE invite_code_plain IS NULL
  LOOP
    tries := 0;
    LOOP
      tries := tries + 1;
      IF tries > 50 THEN
        RAISE EXCEPTION 'invite_code_allocation_failed team_id=%', rec.id;
      END IF;

      code := lpad((floor(random() * 1000000))::int::text, 6, '0');
      IF code = '000000' THEN
        CONTINUE;
      END IF;

      BEGIN
        UPDATE public.teams
        SET invite_code_plain = code
        WHERE id = rec.id
          AND invite_code_plain IS NULL;
        EXIT;
      EXCEPTION
        WHEN unique_violation THEN
          CONTINUE;
      END;
    END LOOP;
  END LOOP;
END $$;
-- RPC: resolve an invite code to a team (SECURITY DEFINER bypasses RLS).
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
SET search_path = public
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
    and t.invite_code_plain = p_invite_code
  limit 1;
$$;
GRANT EXECUTE ON FUNCTION public.resolve_team_invite_code(text) TO authenticated;
