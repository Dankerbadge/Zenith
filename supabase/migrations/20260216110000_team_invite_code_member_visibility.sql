-- Allow all team members to view a team's current 6-digit invite code.
-- Rotation remains owner/admin-only via rotate_team_invite_code.

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
      )
    )
  limit 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_team_invite_code(uuid) TO authenticated;
