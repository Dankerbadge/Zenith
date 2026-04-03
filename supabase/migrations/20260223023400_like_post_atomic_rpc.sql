-- Atomic + idempotent like operation.
CREATE OR REPLACE FUNCTION public.like_post_atomic(
  p_post_id uuid
)
RETURNS public.likes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  row_out public.likes;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_post_id IS NULL THEN
    RAISE EXCEPTION 'Post id required';
  END IF;

  INSERT INTO public.likes (user_id, post_id)
  VALUES (v_uid, p_post_id)
  ON CONFLICT (user_id, post_id) DO NOTHING
  RETURNING * INTO row_out;

  IF row_out.id IS NULL THEN
    SELECT * INTO row_out
    FROM public.likes
    WHERE user_id = v_uid AND post_id = p_post_id
    LIMIT 1;
  END IF;

  RETURN row_out;
END;
$$;;
