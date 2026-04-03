-- ZENITH GARMIN CONNECT IQ BACKEND CONTRACT
-- Apply after base auth/social schema.
-- This migration adds Garmin companion linking, entitlement projection, and workout summary upsert support.

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- =====================================================
-- TABLES
-- =====================================================

create table if not exists public.garmin_device_links (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  watch_app_install_id text not null,
  link_handle text not null,
  linked_at timestamptz not null default now(),
  last_seen_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (watch_app_install_id),
  unique (link_handle)
);

create index if not exists idx_garmin_device_links_user on public.garmin_device_links(user_id);
create index if not exists idx_garmin_device_links_active on public.garmin_device_links(is_active);

create table if not exists public.garmin_link_tokens (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  watch_app_install_id text not null,
  link_token text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (link_token)
);

create index if not exists idx_garmin_link_tokens_user on public.garmin_link_tokens(user_id);
create index if not exists idx_garmin_link_tokens_expiry on public.garmin_link_tokens(expires_at);

create table if not exists public.garmin_workout_summaries (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  watch_app_install_id text,
  local_session_id text not null,
  sport_type text not null,
  start_timestamp timestamptz not null,
  end_timestamp timestamptz not null,
  elapsed_time_seconds integer not null check (elapsed_time_seconds >= 0),
  distance_meters double precision,
  avg_heart_rate integer,
  calories double precision,
  fit_file_saved boolean not null default false,
  device_model text,
  source text not null default 'garmin_watch',
  payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (local_session_id)
);

create index if not exists idx_garmin_workouts_user on public.garmin_workout_summaries(user_id);
create index if not exists idx_garmin_workouts_start on public.garmin_workout_summaries(start_timestamp desc);

-- =====================================================
-- UPDATED_AT TRIGGERS
-- =====================================================

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_garmin_device_links_updated_at on public.garmin_device_links;
create trigger trg_garmin_device_links_updated_at
before update on public.garmin_device_links
for each row execute function public.set_updated_at();

drop trigger if exists trg_garmin_workouts_updated_at on public.garmin_workout_summaries;
create trigger trg_garmin_workouts_updated_at
before update on public.garmin_workout_summaries
for each row execute function public.set_updated_at();

-- =====================================================
-- RLS
-- =====================================================

alter table public.garmin_device_links enable row level security;
alter table public.garmin_link_tokens enable row level security;
alter table public.garmin_workout_summaries enable row level security;

-- user can read/write only own rows
drop policy if exists "garmin_device_links_select_own" on public.garmin_device_links;
create policy "garmin_device_links_select_own"
  on public.garmin_device_links for select using (auth.uid() = user_id);

drop policy if exists "garmin_device_links_insert_own" on public.garmin_device_links;
create policy "garmin_device_links_insert_own"
  on public.garmin_device_links for insert with check (auth.uid() = user_id);

drop policy if exists "garmin_device_links_update_own" on public.garmin_device_links;
create policy "garmin_device_links_update_own"
  on public.garmin_device_links for update using (auth.uid() = user_id);

drop policy if exists "garmin_link_tokens_select_own" on public.garmin_link_tokens;
create policy "garmin_link_tokens_select_own"
  on public.garmin_link_tokens for select using (auth.uid() = user_id);

drop policy if exists "garmin_link_tokens_insert_own" on public.garmin_link_tokens;
create policy "garmin_link_tokens_insert_own"
  on public.garmin_link_tokens for insert with check (auth.uid() = user_id);

drop policy if exists "garmin_link_tokens_update_own" on public.garmin_link_tokens;
create policy "garmin_link_tokens_update_own"
  on public.garmin_link_tokens for update using (auth.uid() = user_id);

drop policy if exists "garmin_workouts_select_own" on public.garmin_workout_summaries;
create policy "garmin_workouts_select_own"
  on public.garmin_workout_summaries for select using (auth.uid() = user_id);

drop policy if exists "garmin_workouts_insert_own" on public.garmin_workout_summaries;
create policy "garmin_workouts_insert_own"
  on public.garmin_workout_summaries for insert with check (auth.uid() = user_id);

drop policy if exists "garmin_workouts_update_own" on public.garmin_workout_summaries;
create policy "garmin_workouts_update_own"
  on public.garmin_workout_summaries for update using (auth.uid() = user_id);

-- =====================================================
-- RPC FUNCTIONS FOR APP CONTRACT
-- =====================================================

create or replace function public.get_garmin_entitlement()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with profile as (
    select
      coalesce(p.is_premium, false) as is_premium,
      p.premium_until
    from public.profiles p
    where p.id = auth.uid()
    limit 1
  )
  select jsonb_build_object(
    'isPremium', coalesce((select is_premium from profile), false),
    'productTier', case when coalesce((select is_premium from profile), false) then 'pro' else 'free' end,
    'expiresAt', (select premium_until from profile),
    'serverTimestamp', now(),
    'featuresEnabled', case
      when coalesce((select is_premium from profile), false)
        then jsonb_build_array(
          'garmin_recording_basic',
          'garmin_live_metrics_basic',
          'garmin_sync_summary',
          'garmin_analytics_advanced',
          'garmin_trends_deep',
          'garmin_coaching_insights',
          'garmin_config_profiles'
        )
      else jsonb_build_array(
          'garmin_recording_basic',
          'garmin_live_metrics_basic',
          'garmin_sync_summary'
      )
    end
  );
$$;

grant execute on function public.get_garmin_entitlement() to authenticated;

create or replace function public.create_garmin_link_token(watch_install_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
  v_exp timestamptz;
begin
  if watch_install_id is null or length(trim(watch_install_id)) = 0 then
    raise exception 'watch_install_id is required';
  end if;

  v_token := encode(gen_random_bytes(12), 'hex');
  v_exp := now() + interval '5 minutes';

  insert into public.garmin_link_tokens (user_id, watch_app_install_id, link_token, expires_at)
  values (auth.uid(), watch_install_id, v_token, v_exp);

  return jsonb_build_object('linkToken', v_token, 'expiresAt', v_exp);
end;
$$;

grant execute on function public.create_garmin_link_token(text) to authenticated;

create or replace function public.confirm_garmin_link(watch_install_id text, token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  token_row public.garmin_link_tokens;
  v_handle text;
begin
  select *
  into token_row
  from public.garmin_link_tokens
  where user_id = auth.uid()
    and watch_app_install_id = watch_install_id
    and link_token = token
    and consumed_at is null
    and expires_at > now()
  order by created_at desc
  limit 1;

  if token_row.id is null then
    raise exception 'Invalid or expired link token';
  end if;

  update public.garmin_link_tokens
  set consumed_at = now()
  where id = token_row.id;

  v_handle := 'garmin_' || encode(gen_random_bytes(8), 'hex');

  insert into public.garmin_device_links (user_id, watch_app_install_id, link_handle, linked_at, last_seen_at, is_active)
  values (auth.uid(), watch_install_id, v_handle, now(), now(), true)
  on conflict (watch_app_install_id)
  do update set
    user_id = excluded.user_id,
    link_handle = excluded.link_handle,
    linked_at = now(),
    last_seen_at = now(),
    is_active = true;

  return jsonb_build_object(
    'linked', true,
    'watchAppInstallId', watch_install_id,
    'linkHandle', v_handle
  );
end;
$$;

grant execute on function public.confirm_garmin_link(text, text) to authenticated;

create or replace function public.upsert_garmin_workout_summary(workout jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_local_session_id text;
begin
  v_local_session_id := workout->>'localSessionId';
  if v_local_session_id is null or length(trim(v_local_session_id)) = 0 then
    raise exception 'localSessionId is required';
  end if;

  insert into public.garmin_workout_summaries (
    user_id,
    watch_app_install_id,
    local_session_id,
    sport_type,
    start_timestamp,
    end_timestamp,
    elapsed_time_seconds,
    distance_meters,
    avg_heart_rate,
    calories,
    fit_file_saved,
    device_model,
    source,
    payload
  )
  values (
    auth.uid(),
    workout->>'watchAppInstallId',
    v_local_session_id,
    coalesce(workout->>'sportType', 'unknown'),
    (workout->>'startTimestamp')::timestamptz,
    (workout->>'endTimestamp')::timestamptz,
    coalesce((workout->>'elapsedTimeSeconds')::int, 0),
    nullif(workout->>'distanceMeters', '')::double precision,
    nullif(workout->>'avgHeartRate', '')::int,
    nullif(workout->>'calories', '')::double precision,
    coalesce((workout->>'fitFileSaved')::boolean, false),
    workout->>'deviceModel',
    coalesce(workout->>'source', 'garmin_watch'),
    workout
  )
  on conflict (local_session_id)
  do update set
    user_id = excluded.user_id,
    watch_app_install_id = excluded.watch_app_install_id,
    sport_type = excluded.sport_type,
    start_timestamp = excluded.start_timestamp,
    end_timestamp = excluded.end_timestamp,
    elapsed_time_seconds = excluded.elapsed_time_seconds,
    distance_meters = excluded.distance_meters,
    avg_heart_rate = excluded.avg_heart_rate,
    calories = excluded.calories,
    fit_file_saved = excluded.fit_file_saved,
    device_model = excluded.device_model,
    source = excluded.source,
    payload = excluded.payload,
    updated_at = now();

  return jsonb_build_object('upserted', true, 'localSessionId', v_local_session_id);
end;
$$;

grant execute on function public.upsert_garmin_workout_summary(jsonb) to authenticated;
