-- Enforce idempotency key uniqueness per author.
CREATE UNIQUE INDEX IF NOT EXISTS posts_user_external_id_unique
  ON public.posts(user_id, external_id)
  WHERE external_id IS NOT NULL;
