-- Event Hub extensions: shared checklist + schedule, and a simple recurring-series identifier.
-- Additive and idempotent.

alter table public.events
  add column if not exists series_id uuid,
  add column if not exists schedule_items jsonb,
  add column if not exists checklist_shared jsonb;
create index if not exists idx_events_series_start
  on public.events (series_id, start_at asc);
