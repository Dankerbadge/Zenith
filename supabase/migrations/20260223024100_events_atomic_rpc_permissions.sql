-- Restrict and grant execute on event atomic RPCs.
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.create_event_atomic(jsonb, text) FROM PUBLIC';
  EXECUTE 'REVOKE ALL ON FUNCTION public.upsert_event_rsvp_atomic(uuid, text, jsonb) FROM PUBLIC';

  EXECUTE 'GRANT EXECUTE ON FUNCTION public.create_event_atomic(jsonb, text) TO authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.upsert_event_rsvp_atomic(uuid, text, jsonb) TO authenticated';
END
$$;
