-- Enforce idempotency key uniqueness per event owner.
CREATE UNIQUE INDEX IF NOT EXISTS events_owner_external_id_unique
  ON public.events(owner_id, external_id)
  WHERE external_id IS NOT NULL;
