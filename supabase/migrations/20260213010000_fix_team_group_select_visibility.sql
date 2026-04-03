-- Ensure private Teams/Groups are still viewable by their members.
-- Requirement: teams/groups are private by default but must not "disappear" for non-owner members.

-- Helpers used by RLS policies. SECURITY DEFINER bypasses RLS for membership lookup.
-- Keep these definitions stable and idempotent so policy evaluation never fails due to missing helpers.
CREATE OR REPLACE FUNCTION public.is_group_member(p_group_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  select exists(
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = p_user_id
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_group_member(uuid, uuid) TO anon, authenticated;
CREATE OR REPLACE FUNCTION public.is_team_member(p_team_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  select exists(
    select 1
    from public.team_members tm
    where tm.team_id = p_team_id
      and tm.user_id = p_user_id
  )
  or exists(
    select 1
    from public.teams t
    where t.id = p_team_id
      and t.owner_id = p_user_id
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_team_member(uuid, uuid) TO anon, authenticated;
-- TEAMS: allow SELECT if public OR caller is a team member (owner included by is_team_member()).
DO $$
BEGIN
  DROP POLICY IF EXISTS "Public teams viewable" ON public.teams;
  DROP POLICY IF EXISTS "teams_select_public_or_member" ON public.teams;
EXCEPTION
  WHEN undefined_table THEN NULL;
END $$;
DO $$
BEGIN
  CREATE POLICY "teams_select_public_or_member"
    ON public.teams FOR SELECT
    USING (
      is_public = true
      OR (
        auth.uid() IS NOT NULL
        AND public.is_team_member(id, auth.uid())
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
-- GROUPS: allow SELECT if public OR caller is owner OR group member.
DO $$
BEGIN
  DROP POLICY IF EXISTS "groups_select_public_or_owner" ON public.groups;
  DROP POLICY IF EXISTS "groups_select_public_owner_or_member" ON public.groups;
  DROP POLICY IF EXISTS "Groups are viewable" ON public.groups;
EXCEPTION
  WHEN undefined_table THEN NULL;
END $$;
DO $$
BEGIN
  CREATE POLICY "groups_select_public_owner_or_member"
    ON public.groups FOR SELECT
    USING (
      is_public = true
      OR auth.uid() = owner_id
      OR (
        auth.uid() IS NOT NULL
        AND public.is_group_member(id, auth.uid())
      )
      OR (
        -- Team groups are private by default. Allow team members to discover/select the team group
        -- by join_code so the client can self-enroll in group_members after joining the team.
        auth.uid() IS NOT NULL
        AND join_code IS NOT NULL
        AND join_code LIKE 'team:%'
        AND split_part(join_code, ':', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND public.is_team_member(split_part(join_code, ':', 2)::uuid, auth.uid())
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
