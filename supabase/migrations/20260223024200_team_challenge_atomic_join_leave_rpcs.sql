-- Atomic + idempotent join/leave writes for team challenge participants.
CREATE OR REPLACE FUNCTION public.join_team_challenge_atomic(
  p_challenge_id uuid
)
RETURNS public.team_challenge_participants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_challenge public.team_challenges%ROWTYPE;
  row_out public.team_challenge_participants;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_challenge_id IS NULL THEN
    RAISE EXCEPTION 'Challenge id required';
  END IF;

  SELECT * INTO v_challenge
  FROM public.team_challenges
  WHERE id = p_challenge_id
  LIMIT 1;

  IF v_challenge.id IS NULL THEN
    RAISE EXCEPTION 'Challenge not found';
  END IF;
  IF v_challenge.team_id IS NULL THEN
    RAISE EXCEPTION 'Invalid team challenge';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.team_members tm
    WHERE tm.team_id = v_challenge.team_id
      AND tm.user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Not a team member';
  END IF;

  INSERT INTO public.team_challenge_participants (
    challenge_id,
    user_id,
    status,
    joined_at,
    progress,
    updated_at
  )
  VALUES (
    p_challenge_id,
    v_uid,
    'JOINED',
    NOW(),
    '{}'::jsonb,
    NOW()
  )
  ON CONFLICT (challenge_id, user_id)
  DO UPDATE SET
    status = 'JOINED',
    joined_at = COALESCE(public.team_challenge_participants.joined_at, NOW()),
    updated_at = NOW()
  RETURNING * INTO row_out;

  RETURN row_out;
END;
$$;;
