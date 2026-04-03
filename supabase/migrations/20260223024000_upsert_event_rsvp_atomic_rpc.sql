-- Atomic + idempotent RSVP upsert for current user.
CREATE OR REPLACE FUNCTION public.upsert_event_rsvp_atomic(
  p_event_id uuid,
  p_status text,
  p_answers jsonb DEFAULT NULL
)
RETURNS public.event_rsvps
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_status text := LOWER(NULLIF(TRIM(COALESCE(p_status, '')), ''));
  row_out public.event_rsvps;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_event_id IS NULL THEN
    RAISE EXCEPTION 'Event id required';
  END IF;
  IF v_status IS NULL OR v_status NOT IN ('going', 'maybe', 'not_going') THEN
    RAISE EXCEPTION 'Invalid RSVP status';
  END IF;

  INSERT INTO public.event_rsvps (event_id, user_id, status, answers)
  VALUES (p_event_id, v_uid, v_status, p_answers)
  ON CONFLICT (event_id, user_id)
  DO UPDATE SET
    status = EXCLUDED.status,
    answers = EXCLUDED.answers,
    updated_at = NOW()
  RETURNING * INTO row_out;

  RETURN row_out;
END;
$$;;
