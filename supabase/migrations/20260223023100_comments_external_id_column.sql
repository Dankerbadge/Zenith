-- Add optional external id for idempotent comment writes.
ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS external_id text;
