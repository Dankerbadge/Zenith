-- Atomic + idempotent workout upsert keyed by external id.
CREATE OR REPLACE FUNCTION public.upsert_workout_atomic(
  p_external_id text,
  p_start_ts timestamptz,
  p_end_ts timestamptz,
  p_activity_type text,
  p_location_type text DEFAULT NULL,
  p_distance_m numeric DEFAULT NULL,
  p_active_kcal numeric DEFAULT NULL,
  p_avg_hr_bpm numeric DEFAULT NULL,
  p_max_hr_bpm numeric DEFAULT NULL,
  p_elevation_gain_m numeric DEFAULT NULL,
  p_elevation_loss_m numeric DEFAULT NULL,
  p_source text DEFAULT NULL,
  p_raw jsonb DEFAULT NULL
)
RETURNS public.workouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_external_id text := NULLIF(TRIM(COALESCE(p_external_id, '')), '');
  v_activity_type text := NULLIF(TRIM(COALESCE(p_activity_type, '')), '');
  row_out public.workouts;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF v_external_id IS NULL THEN
    RAISE EXCEPTION 'Workout external id required';
  END IF;
  IF v_activity_type IS NULL THEN
    RAISE EXCEPTION 'Workout activity type required';
  END IF;
  IF p_start_ts IS NULL OR p_end_ts IS NULL THEN
    RAISE EXCEPTION 'Workout start/end timestamp required';
  END IF;
  IF p_end_ts < p_start_ts THEN
    RAISE EXCEPTION 'Workout end timestamp must be >= start timestamp';
  END IF;

  INSERT INTO public.workouts (
    user_id,
    external_id,
    start_ts,
    end_ts,
    activity_type,
    location_type,
    distance_m,
    active_kcal,
    avg_hr_bpm,
    max_hr_bpm,
    elevation_gain_m,
    elevation_loss_m,
    source,
    raw
  )
  VALUES (
    v_uid,
    v_external_id,
    p_start_ts,
    p_end_ts,
    v_activity_type,
    NULLIF(TRIM(COALESCE(p_location_type, '')), ''),
    p_distance_m,
    p_active_kcal,
    p_avg_hr_bpm,
    p_max_hr_bpm,
    p_elevation_gain_m,
    p_elevation_loss_m,
    NULLIF(TRIM(COALESCE(p_source, '')), ''),
    p_raw
  )
  ON CONFLICT (user_id, external_id)
  DO UPDATE SET
    start_ts = EXCLUDED.start_ts,
    end_ts = EXCLUDED.end_ts,
    activity_type = EXCLUDED.activity_type,
    location_type = EXCLUDED.location_type,
    distance_m = EXCLUDED.distance_m,
    active_kcal = EXCLUDED.active_kcal,
    avg_hr_bpm = EXCLUDED.avg_hr_bpm,
    max_hr_bpm = EXCLUDED.max_hr_bpm,
    elevation_gain_m = EXCLUDED.elevation_gain_m,
    elevation_loss_m = EXCLUDED.elevation_loss_m,
    source = EXCLUDED.source,
    raw = COALESCE(EXCLUDED.raw, public.workouts.raw)
  RETURNING * INTO row_out;

  RETURN row_out;
END;
$$;;
