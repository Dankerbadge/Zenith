-- P0: Cache responses for photo-based food scan so we don't hammer external APIs.
create table if not exists public.food_photo_scan_cache (
  scan_key text primary key,
  response jsonb not null,
  expires_at timestamptz not null,
  hit_count bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists food_photo_scan_cache_expires_idx on public.food_photo_scan_cache (expires_at);
create or replace function public.touch_updated_at_food_photo_scan_cache()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists trg_touch_food_photo_scan_cache on public.food_photo_scan_cache;
create trigger trg_touch_food_photo_scan_cache
before update on public.food_photo_scan_cache
for each row
execute function public.touch_updated_at_food_photo_scan_cache();
-- RLS: service role only for now.
alter table public.food_photo_scan_cache enable row level security;
drop policy if exists "service_role_only_photo_scan_cache" on public.food_photo_scan_cache;
create policy "service_role_only_photo_scan_cache"
on public.food_photo_scan_cache
for all
to service_role
using (true)
with check (true);
