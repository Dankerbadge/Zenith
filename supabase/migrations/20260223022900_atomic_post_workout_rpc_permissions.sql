-- Restrict/allow execution for new atomic write RPCs.
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.create_post_atomic(text, text, jsonb, text, uuid, boolean, text, text) FROM PUBLIC';
  EXECUTE 'REVOKE ALL ON FUNCTION public.upsert_workout_atomic(text, timestamptz, timestamptz, text, text, numeric, numeric, numeric, numeric, numeric, numeric, text, jsonb) FROM PUBLIC';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.create_post_atomic(text, text, jsonb, text, uuid, boolean, text, text) TO authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.upsert_workout_atomic(text, timestamptz, timestamptz, text, text, numeric, numeric, numeric, numeric, numeric, numeric, text, jsonb) TO authenticated';
END
$$;
