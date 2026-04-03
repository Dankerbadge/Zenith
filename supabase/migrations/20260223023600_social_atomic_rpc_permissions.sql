-- Restrict and grant execute on social atomic RPCs.
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.create_comment_atomic(uuid, text, text) FROM PUBLIC';
  EXECUTE 'REVOKE ALL ON FUNCTION public.like_post_atomic(uuid) FROM PUBLIC';
  EXECUTE 'REVOKE ALL ON FUNCTION public.unlike_post_atomic(uuid) FROM PUBLIC';

  EXECUTE 'GRANT EXECUTE ON FUNCTION public.create_comment_atomic(uuid, text, text) TO authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.like_post_atomic(uuid) TO authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.unlike_post_atomic(uuid) TO authenticated';
END
$$;
