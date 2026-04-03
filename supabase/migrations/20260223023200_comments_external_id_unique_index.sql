-- Enforce idempotency key uniqueness per comment author.
CREATE UNIQUE INDEX IF NOT EXISTS comments_user_external_id_unique
  ON public.comments(user_id, external_id)
  WHERE external_id IS NOT NULL;
