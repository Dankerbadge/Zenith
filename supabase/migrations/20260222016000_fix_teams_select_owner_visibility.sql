-- Ensure team owners can read newly created private teams immediately.
-- Existing policy only allowed public teams or team_members entries.

DROP POLICY IF EXISTS "teams_select_public_or_member" ON public.teams;
CREATE POLICY "teams_select_public_or_member"
  ON public.teams FOR SELECT
  TO public
  USING (
    is_public = true
    OR (
      auth.uid() IS NOT NULL
      AND (
        owner_id = auth.uid()
        OR public.is_team_member(id, auth.uid())
      )
    )
  );
