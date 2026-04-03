-- Idempotent unlike operation.
CREATE OR REPLACE FUNCTION public.unlike_post_atomic(
  p_post_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_post_id IS NULL THEN
    RAISE EXCEPTION 'Post id required';
  END IF;

  DELETE FROM public.likes
  WHERE user_id = v_uid AND post_id = p_post_id;

  RETURN TRUE;
END;
$$;;
