-- Ensure a team has a linked group feed that any team member can initialize.

CREATE OR REPLACE FUNCTION public.ensure_team_group_feed(p_team_id UUID)
RETURNS public.groups
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team public.teams%ROWTYPE;
  v_group public.groups%ROWTYPE;
  v_actor UUID;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_team FROM public.teams WHERE id = p_team_id;
  IF v_team.id IS NULL THEN
    RAISE EXCEPTION 'Team not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.team_members tm
    WHERE tm.team_id = p_team_id AND tm.user_id = v_actor
  ) THEN
    RAISE EXCEPTION 'Not a team member';
  END IF;

  SELECT * INTO v_group
  FROM public.groups
  WHERE join_code = ('team:' || p_team_id::text)
  LIMIT 1;

  IF v_group.id IS NULL THEN
    INSERT INTO public.groups (kind, owner_id, name, description, is_public, join_code)
    VALUES (
      'coaching_team',
      v_team.owner_id,
      v_team.name,
      COALESCE(v_team.description, 'Team space'),
      false,
      'team:' || p_team_id::text
    )
    RETURNING * INTO v_group;
  END IF;

  INSERT INTO public.group_members (group_id, user_id, role)
  VALUES (v_group.id, v_team.owner_id, 'owner')
  ON CONFLICT (group_id, user_id) DO NOTHING;

  INSERT INTO public.group_members (group_id, user_id, role)
  VALUES (v_group.id, v_actor, 'member')
  ON CONFLICT (group_id, user_id) DO NOTHING;

  RETURN v_group;
END;
$$;
REVOKE ALL ON FUNCTION public.ensure_team_group_feed(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_team_group_feed(UUID) TO authenticated;
