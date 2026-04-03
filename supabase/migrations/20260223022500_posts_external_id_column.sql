-- Add optional external id for idempotent post writes.
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS external_id text;
