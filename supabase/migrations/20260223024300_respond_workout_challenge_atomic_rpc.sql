-- Atomic + idempotent workout challenge invite response with event side effects.
CREATE OR REPLACE FUNCTION public.respond_workout_challenge_atomic(
  p_challenge_id uuid,
  p_response text
)
RETURNS public.workout_challenge_participants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_response text := UPPER(NULLIF(TRIM(COALESCE(p_response, '')), ''));
  v_status public.challenge_participant_status;
  v_event_type text;
  v_existing public.workout_challenge_participants%ROWTYPE;
  row_out public.workout_challenge_participants;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_challenge_id IS NULL THEN
    RAISE EXCEPTION 'Challenge id required';
  END IF;
  IF v_response IS NULL OR v_response NOT IN ('ACCEPT', 'DECLINE') THEN
    RAISE EXCEPTION 'Invalid response';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.workout_challenges c
    WHERE c.id = p_challenge_id
  ) THEN
    RAISE EXCEPTION 'Challenge not found';
  END IF;

  v_status := CASE
    WHEN v_response = 'ACCEPT' THEN 'ACCEPTED'::public.challenge_participant_status
    ELSE 'DECLINED'::public.challenge_participant_status
  END;
  v_event_type := CASE WHEN v_status = 'ACCEPTED' THEN 'ACCEPTED' ELSE 'DECLINED' END;

  SELECT * INTO v_existing
  FROM public.workout_challenge_participants
  WHERE challenge_id = p_challenge_id
    AND user_id = v_uid
  LIMIT 1
  FOR UPDATE;

  IF v_existing.id IS NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.workout_challenges c
      WHERE c.id = p_challenge_id
        AND c.creator_user_id = v_uid
    ) THEN
      RAISE EXCEPTION 'Not a challenge participant';
    END IF;

    INSERT INTO public.workout_challenge_participants (
      challenge_id,
      user_id,
      role,
      status,
      joined_at,
      updated_at
    )
    VALUES (
      p_challenge_id,
      v_uid,
      'PARTICIPANT',
      v_status,
      CASE WHEN v_status = 'ACCEPTED' THEN NOW() ELSE NULL END,
      NOW()
    )
    RETURNING * INTO row_out;

    INSERT INTO public.workout_challenge_events (challenge_id, user_id, type, data)
    VALUES (p_challenge_id, v_uid, v_event_type, '{}'::jsonb);

    RETURN row_out;
  END IF;

  IF v_existing.status IS DISTINCT FROM v_status
     OR (v_status = 'ACCEPTED'::public.challenge_participant_status AND v_existing.joined_at IS NULL) THEN
    UPDATE public.workout_challenge_participants
    SET
      status = v_status,
      joined_at = CASE
        WHEN v_status = 'ACCEPTED'::public.challenge_participant_status
          THEN COALESCE(joined_at, NOW())
        ELSE joined_at
      END,
      updated_at = NOW()
    WHERE id = v_existing.id
    RETURNING * INTO row_out;
  ELSE
    row_out := v_existing;
  END IF;

  IF v_existing.status IS DISTINCT FROM v_status THEN
    INSERT INTO public.workout_challenge_events (challenge_id, user_id, type, data)
    VALUES (p_challenge_id, v_uid, v_event_type, '{}'::jsonb);
  END IF;

  RETURN row_out;
END;
$$;;
