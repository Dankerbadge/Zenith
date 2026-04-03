-- Ensure newly created teams satisfy invite-code hash constraints.
-- Without this, client-side inserts that set only `invite_code_plain` will fail once
-- `teams_invite_code_hash_required` is present.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE OR REPLACE FUNCTION public.team_invite_code_before_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- Always keep hash in sync when plaintext is present.
  IF NEW.invite_code_plain IS NOT NULL AND (NEW.invite_code_hash IS NULL OR NEW.invite_code_hash = '') THEN
    NEW.invite_code_hash := crypt(NEW.invite_code_plain, gen_salt('bf', 10));
  END IF;

  -- Default rotation metadata for rows that carry an invite code.
  IF NEW.invite_code_plain IS NOT NULL THEN
    NEW.invite_code_version := COALESCE(NEW.invite_code_version, 1);
    NEW.invite_code_rotated_at := COALESCE(NEW.invite_code_rotated_at, now());
    NEW.invite_code_rotated_by_user_id := COALESCE(NEW.invite_code_rotated_by_user_id, NEW.owner_id);
  END IF;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS teams_invite_code_before_write ON public.teams;
CREATE TRIGGER teams_invite_code_before_write
BEFORE INSERT OR UPDATE OF invite_code_plain, invite_code_hash, invite_code_version, invite_code_rotated_at, invite_code_rotated_by_user_id
ON public.teams
FOR EACH ROW EXECUTE FUNCTION public.team_invite_code_before_write();
