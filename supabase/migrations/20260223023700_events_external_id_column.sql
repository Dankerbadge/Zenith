-- Add optional external id for idempotent event creation.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS external_id text;
