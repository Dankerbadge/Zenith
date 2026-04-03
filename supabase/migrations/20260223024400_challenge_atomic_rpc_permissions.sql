-- Restrict and grant execute on challenge atomic RPCs.
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.join_team_challenge_atomic(uuid) FROM PUBLIC';
  EXECUTE 'REVOKE ALL ON FUNCTION public.leave_team_challenge_atomic(uuid) FROM PUBLIC';
  EXECUTE 'REVOKE ALL ON FUNCTION public.respond_workout_challenge_atomic(uuid, text) FROM PUBLIC';

  EXECUTE 'GRANT EXECUTE ON FUNCTION public.join_team_challenge_atomic(uuid) TO authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.leave_team_challenge_atomic(uuid) TO authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.respond_workout_challenge_atomic(uuid, text) TO authenticated';
END
$$;
