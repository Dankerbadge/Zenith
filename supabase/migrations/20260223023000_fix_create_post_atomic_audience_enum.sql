-- Fix create_post_atomic for deployments where posts.audience is enum (post_audience) instead of text.
CREATE OR REPLACE FUNCTION public.create_post_atomic(
  p_content text,
  p_post_type text,
  p_data jsonb DEFAULT NULL,
  p_audience text DEFAULT 'public',
  p_group_id uuid DEFAULT NULL,
  p_is_public boolean DEFAULT NULL,
  p_image_url text DEFAULT NULL,
  p_external_id text DEFAULT NULL
)
RETURNS public.posts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_content text := NULLIF(TRIM(COALESCE(p_content, '')), '');
  v_post_type text := NULLIF(TRIM(COALESCE(p_post_type, '')), '');
  v_audience text := LOWER(NULLIF(TRIM(COALESCE(p_audience, '')), ''));
  v_external_id text := NULLIF(TRIM(COALESCE(p_external_id, '')), '');
  v_image_url text := NULLIF(TRIM(COALESCE(p_image_url, '')), '');
  v_is_public boolean := COALESCE(p_is_public, LOWER(COALESCE(p_audience, 'public')) = 'public');
  v_use_enum boolean := TO_REGTYPE('public.post_audience') IS NOT NULL;
  row_out public.posts;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF v_content IS NULL THEN
    RAISE EXCEPTION 'Post content required';
  END IF;
  IF v_post_type IS NULL THEN
    RAISE EXCEPTION 'Post type required';
  END IF;

  IF v_audience IS NULL OR v_audience NOT IN ('public', 'friends', 'group') THEN
    v_audience := 'public';
  END IF;

  IF v_use_enum THEN
    EXECUTE $SQL$
      INSERT INTO public.posts (
        user_id,
        content,
        post_type,
        data,
        audience,
        group_id,
        is_public,
        image_url,
        external_id
      )
      VALUES ($1, $2, $3, $4, $5::public.post_audience, $6, $7, $8, $9)
      ON CONFLICT (user_id, external_id) WHERE external_id IS NOT NULL
      DO UPDATE SET
        updated_at = public.posts.updated_at
      RETURNING *
    $SQL$
    INTO row_out
    USING v_uid, v_content, v_post_type, p_data, v_audience, p_group_id, v_is_public, v_image_url, v_external_id;
  ELSE
    INSERT INTO public.posts (
      user_id,
      content,
      post_type,
      data,
      audience,
      group_id,
      is_public,
      image_url,
      external_id
    )
    VALUES (
      v_uid,
      v_content,
      v_post_type,
      p_data,
      v_audience,
      p_group_id,
      v_is_public,
      v_image_url,
      v_external_id
    )
    ON CONFLICT (user_id, external_id) WHERE external_id IS NOT NULL
    DO UPDATE SET
      updated_at = public.posts.updated_at
    RETURNING * INTO row_out;
  END IF;

  RETURN row_out;
END;
$$;;
