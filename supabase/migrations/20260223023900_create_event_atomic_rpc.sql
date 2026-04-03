-- Atomic + optionally idempotent event creation.
CREATE OR REPLACE FUNCTION public.create_event_atomic(
  p_payload jsonb,
  p_external_id text DEFAULT NULL
)
RETURNS public.events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_external_id text := NULLIF(TRIM(COALESCE(p_external_id, v_payload->>'external_id', '')), '');
  v_group_id uuid := NULLIF(TRIM(COALESCE(v_payload->>'group_id', '')), '')::uuid;
  v_title text := NULLIF(TRIM(COALESCE(v_payload->>'title', '')), '');
  v_description text := NULLIF(TRIM(COALESCE(v_payload->>'description', '')), '');
  v_event_type text := NULLIF(TRIM(COALESCE(v_payload->>'event_type', '')), '');
  v_start_at timestamptz := NULLIF(TRIM(COALESCE(v_payload->>'start_at', '')), '')::timestamptz;
  v_end_at timestamptz := NULLIF(TRIM(COALESCE(v_payload->>'end_at', '')), '')::timestamptz;
  v_timezone text := NULLIF(TRIM(COALESCE(v_payload->>'timezone', '')), '');
  v_location_name text := NULLIF(TRIM(COALESCE(v_payload->>'location_name', '')), '');
  v_location_address text := NULLIF(TRIM(COALESCE(v_payload->>'location_address', '')), '');
  v_location_lat double precision := NULLIF(TRIM(COALESCE(v_payload->>'location_lat', '')), '')::double precision;
  v_location_lng double precision := NULLIF(TRIM(COALESCE(v_payload->>'location_lng', '')), '')::double precision;
  v_meeting_notes text := NULLIF(TRIM(COALESCE(v_payload->>'meeting_notes', '')), '');
  v_rsvp_enabled boolean := COALESCE(NULLIF(TRIM(COALESCE(v_payload->>'rsvp_enabled', '')), '')::boolean, true);
  v_capacity integer := NULLIF(TRIM(COALESCE(v_payload->>'capacity', '')), '')::integer;
  v_waitlist_enabled boolean := COALESCE(NULLIF(TRIM(COALESCE(v_payload->>'waitlist_enabled', '')), '')::boolean, false);
  v_rsvp_questions jsonb := CASE WHEN v_payload ? 'rsvp_questions' THEN v_payload->'rsvp_questions' ELSE NULL END;
  v_reminders jsonb := CASE WHEN v_payload ? 'reminders' THEN v_payload->'reminders' ELSE NULL END;
  v_recurrence_rule text := NULLIF(TRIM(COALESCE(v_payload->>'recurrence_rule', '')), '');
  v_recurrence_until timestamptz := NULLIF(TRIM(COALESCE(v_payload->>'recurrence_until', '')), '')::timestamptz;
  row_out public.events;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF v_title IS NULL THEN
    RAISE EXCEPTION 'Event title required';
  END IF;
  IF v_start_at IS NULL THEN
    RAISE EXCEPTION 'Event start_at required';
  END IF;
  IF v_event_type IS NULL THEN
    v_event_type := 'training';
  END IF;

  INSERT INTO public.events (
    group_id,
    owner_id,
    title,
    description,
    event_type,
    start_at,
    end_at,
    timezone,
    location_name,
    location_address,
    location_lat,
    location_lng,
    meeting_notes,
    rsvp_enabled,
    capacity,
    waitlist_enabled,
    rsvp_questions,
    reminders,
    recurrence_rule,
    recurrence_until,
    external_id
  )
  VALUES (
    v_group_id,
    v_uid,
    v_title,
    v_description,
    v_event_type,
    v_start_at,
    v_end_at,
    v_timezone,
    v_location_name,
    v_location_address,
    v_location_lat,
    v_location_lng,
    v_meeting_notes,
    v_rsvp_enabled,
    v_capacity,
    v_waitlist_enabled,
    v_rsvp_questions,
    v_reminders,
    v_recurrence_rule,
    v_recurrence_until,
    v_external_id
  )
  ON CONFLICT (owner_id, external_id) WHERE external_id IS NOT NULL
  DO UPDATE SET
    updated_at = public.events.updated_at
  RETURNING * INTO row_out;

  RETURN row_out;
END;
$$;;
