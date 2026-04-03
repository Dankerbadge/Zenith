-- Ensure runtime-probed tables exist in remote (idempotent backfill).
-- This protects environments where migration history was repaired but DDL diverged.

create extension if not exists pgcrypto;
create table if not exists public.garmin_link_tokens (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);
create table if not exists public.garmin_device_links (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade,
  garmin_device_id text not null,
  garmin_user_id text,
  linked_at timestamptz default now(),
  last_seen_at timestamptz,
  unique(user_id, garmin_device_id)
);
create table if not exists public.garmin_workouts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade,
  garmin_device_id text,
  garmin_activity_id text,
  workout_type text not null,
  started_at timestamptz not null,
  duration_sec integer not null,
  distance_meters double precision,
  calories integer,
  avg_hr integer,
  max_hr integer,
  raw jsonb,
  created_at timestamptz default now(),
  unique(user_id, garmin_activity_id)
);
create table if not exists public.garmin_entitlements (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade unique,
  premium_sync_enabled boolean default false,
  updated_at timestamptz default now()
);
alter table public.garmin_link_tokens enable row level security;
alter table public.garmin_device_links enable row level security;
alter table public.garmin_workouts enable row level security;
alter table public.garmin_entitlements enable row level security;
do $$
begin
  create policy "Users can manage own link tokens"
    on public.garmin_link_tokens
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
exception when duplicate_object then null;
end $$;
do $$
begin
  create policy "Users can manage own device links"
    on public.garmin_device_links
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
exception when duplicate_object then null;
end $$;
do $$
begin
  create policy "Users can read own garmin workouts"
    on public.garmin_workouts
    for select
    using (auth.uid() = user_id);
exception when duplicate_object then null;
end $$;
do $$
begin
  create policy "Users can insert own garmin workouts"
    on public.garmin_workouts
    for insert
    with check (auth.uid() = user_id);
exception when duplicate_object then null;
end $$;
do $$
begin
  create policy "Users can read own entitlements"
    on public.garmin_entitlements
    for select
    using (auth.uid() = user_id);
exception when duplicate_object then null;
end $$;
do $$
begin
  create policy "Users can update own entitlements"
    on public.garmin_entitlements
    for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
exception when duplicate_object then null;
end $$;
