-- Cloud food search cache for fast, locale-aware mobile lookups.
create table if not exists public.food_search_cache (
  query_key text primary key,
  query text not null,
  country text not null,
  admin text,
  language text not null,
  results jsonb not null,
  source text not null default 'off_usda',
  hit_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists food_search_cache_expires_idx on public.food_search_cache (expires_at);
create index if not exists food_search_cache_query_idx on public.food_search_cache (query, country, language);
create or replace function public.set_food_search_cache_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;
drop trigger if exists food_search_cache_set_updated_at on public.food_search_cache;
create trigger food_search_cache_set_updated_at
before update on public.food_search_cache
for each row execute function public.set_food_search_cache_updated_at();
-- Service-role only table; prevent accidental client reads/writes.
alter table public.food_search_cache enable row level security;
revoke all on table public.food_search_cache from anon;
revoke all on table public.food_search_cache from authenticated;
-- Maintenance helper for edge jobs.
create or replace function public.purge_expired_food_search_cache()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer := 0;
begin
  delete from public.food_search_cache
  where expires_at <= now();
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;
revoke all on function public.purge_expired_food_search_cache() from public;
grant execute on function public.purge_expired_food_search_cache() to service_role;
