-- Food search P0 hardening: latency metrics, prefix cache, and per-user relevance profile.

create table if not exists public.food_search_metrics (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  query text not null,
  country text not null,
  admin text,
  language text not null,
  source text not null,
  duration_ms integer not null,
  result_count integer not null,
  created_at timestamptz not null default now()
);
create index if not exists food_search_metrics_created_idx on public.food_search_metrics (created_at desc);
create index if not exists food_search_metrics_user_created_idx on public.food_search_metrics (user_id, created_at desc);
create index if not exists food_search_metrics_locale_created_idx on public.food_search_metrics (country, language, created_at desc);
alter table public.food_search_metrics enable row level security;
revoke all on table public.food_search_metrics from anon;
revoke all on table public.food_search_metrics from authenticated;
create table if not exists public.food_search_prefix_cache (
  prefix_key text primary key,
  prefix text not null,
  country text not null,
  admin text,
  language text not null,
  results jsonb not null,
  hit_count integer not null default 0,
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists food_search_prefix_cache_expires_idx on public.food_search_prefix_cache (expires_at);
create index if not exists food_search_prefix_cache_prefix_idx on public.food_search_prefix_cache (prefix, country, language);
create or replace function public.set_food_search_prefix_cache_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;
drop trigger if exists food_search_prefix_cache_set_updated_at on public.food_search_prefix_cache;
create trigger food_search_prefix_cache_set_updated_at
before update on public.food_search_prefix_cache
for each row execute function public.set_food_search_prefix_cache_updated_at();
alter table public.food_search_prefix_cache enable row level security;
revoke all on table public.food_search_prefix_cache from anon;
revoke all on table public.food_search_prefix_cache from authenticated;
create table if not exists public.food_user_query_profile (
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null,
  weight integer not null default 0,
  last_seen_at timestamptz not null default now(),
  primary key (user_id, token)
);
create index if not exists food_user_query_profile_user_weight_idx on public.food_user_query_profile (user_id, weight desc, last_seen_at desc);
alter table public.food_user_query_profile enable row level security;
revoke all on table public.food_user_query_profile from anon;
revoke all on table public.food_user_query_profile from authenticated;
create or replace function public.purge_expired_food_search_prefix_cache()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer := 0;
begin
  delete from public.food_search_prefix_cache
  where expires_at <= now();
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;
revoke all on function public.purge_expired_food_search_prefix_cache() from public;
grant execute on function public.purge_expired_food_search_prefix_cache() to service_role;
-- Keep profile table bounded by dropping very stale/low-signal tokens for each user.
create or replace function public.trim_food_user_query_profile(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer := 0;
begin
  delete from public.food_user_query_profile p
  where p.user_id = p_user_id
    and p.token in (
      select token
      from public.food_user_query_profile
      where user_id = p_user_id
      order by weight desc, last_seen_at desc
      offset 80
    );
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;
revoke all on function public.trim_food_user_query_profile(uuid) from public;
grant execute on function public.trim_food_user_query_profile(uuid) to service_role;
