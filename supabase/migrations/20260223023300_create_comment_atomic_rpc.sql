-- Atomic + idempotent comment creation.
CREATE OR REPLACE FUNCTION public.create_comment_atomic(
  p_post_id uuid,
  p_content text,
  p_external_id text DEFAULT NULL
)
RETURNS public.comments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_content text := NULLIF(TRIM(COALESCE(p_content, '')), '');
  v_external_id text := NULLIF(TRIM(COALESCE(p_external_id, '')), '');
  row_out public.comments;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_post_id IS NULL THEN
    RAISE EXCEPTION 'Post id required';
  END IF;
  IF v_content IS NULL THEN
    RAISE EXCEPTION 'Comment content required';
  END IF;

  INSERT INTO public.comments (user_id, post_id, content, external_id)
  VALUES (v_uid, p_post_id, v_content, v_external_id)
  ON CONFLICT (user_id, external_id) WHERE external_id IS NOT NULL
  DO UPDATE SET
    updated_at = public.comments.updated_at
  RETURNING * INTO row_out;

  RETURN row_out;
END;
$$;;
