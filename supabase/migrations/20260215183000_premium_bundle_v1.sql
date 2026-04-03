-- Zenith Premium Bundle v1 (P0): training load, routes, segments, nutrition insights, readiness, insights, exports.
-- Accuracy over volume: tables are generic and allow incremental population as data pipelines mature.

create extension if not exists pgcrypto;
-- =========================================================
-- Core: workouts + routes
-- =========================================================

create table if not exists public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  external_id text, -- optional id from local/offline sources for idempotent upserts
  start_ts timestamptz not null,
  end_ts timestamptz not null,
  activity_type text not null,
  location_type text,
  distance_m numeric,
  active_kcal numeric,
  avg_hr_bpm numeric,
  max_hr_bpm numeric,
  elevation_gain_m numeric,
  elevation_loss_m numeric,
  source text,
  raw jsonb,
  created_at timestamptz default now(),
  unique(user_id, external_id)
);
create index if not exists workouts_user_start_idx on public.workouts(user_id, start_ts desc);
create table if not exists public.workout_routes (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references public.workouts(id) on delete cascade unique,
  user_id uuid not null references public.profiles(id) on delete cascade,
  encoded_polyline text not null,
  bbox jsonb,
  points_count int,
  has_privacy_trim bool default false,
  privacy_trim_start_m int default 0,
  privacy_trim_end_m int default 0,
  created_at timestamptz default now()
);
create index if not exists workout_routes_user_idx on public.workout_routes(user_id, created_at desc);
-- =========================================================
-- User physiology (needed for load + readiness)
-- =========================================================

create table if not exists public.user_physiology (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  sex text,
  birthdate date,
  weight_kg numeric,
  height_cm numeric,
  hr_max_bpm int,
  hr_rest_bpm int,
  hrv_baseline_ms numeric,
  rhr_baseline_bpm numeric,
  timezone text default 'America/New_York',
  updated_at timestamptz default now()
);
-- =========================================================
-- Training load (fitness/fatigue/form)
-- =========================================================

create table if not exists public.training_load_workouts (
  workout_id uuid primary key references public.workouts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  effort_score numeric not null,
  effort_method text not null,
  confidence text not null,
  reasons jsonb default '[]'::jsonb,
  computed_at timestamptz default now()
);
create index if not exists training_load_workouts_user_idx on public.training_load_workouts(user_id, computed_at desc);
create table if not exists public.training_load_daily (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  atl numeric,
  ctl numeric,
  form numeric,
  weekly_load numeric,
  ramp_rate numeric,
  computed_at timestamptz default now(),
  primary key (user_id, day)
);
-- =========================================================
-- Routes (saved + offline assets)
-- =========================================================

create table if not exists public.saved_routes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  encoded_polyline text not null,
  bbox jsonb,
  distance_m numeric,
  elevation_gain_m numeric,
  estimated_time_s int,
  is_public bool default false,
  created_at timestamptz default now()
);
create index if not exists saved_routes_user_idx on public.saved_routes(user_id, created_at desc);
create table if not exists public.route_snapshots (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.saved_routes(id) on delete cascade,
  variant text not null,
  image_path text not null,
  generated_at timestamptz default now(),
  unique(route_id, variant)
);
-- =========================================================
-- Segments (personal-first) + efforts
-- =========================================================

create table if not exists public.segments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  encoded_polyline text not null,
  bbox jsonb,
  distance_m numeric,
  direction text default 'forward',
  is_public bool default false,
  created_at timestamptz default now()
);
create index if not exists segments_user_idx on public.segments(user_id, created_at desc);
create table if not exists public.segment_efforts (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid not null references public.segments(id) on delete cascade,
  workout_id uuid not null references public.workouts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  start_ts timestamptz not null,
  end_ts timestamptz not null,
  elapsed_s int not null,
  avg_hr_bpm numeric,
  created_at timestamptz default now()
);
create index if not exists segment_efforts_user_segment_idx on public.segment_efforts(user_id, segment_id);
create index if not exists segment_efforts_workout_idx on public.segment_efforts(workout_id);
create table if not exists public.best_efforts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  activity_type text not null,
  distance_m int not null,
  best_time_s int not null,
  workout_id uuid references public.workouts(id) on delete set null,
  computed_at timestamptz default now(),
  primary key (user_id, activity_type, distance_m)
);
-- =========================================================
-- Nutrition aggregates + digests
-- =========================================================

create table if not exists public.nutrition_daily (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  calories_kcal numeric,
  protein_g numeric,
  carbs_g numeric,
  fat_g numeric,
  fiber_g numeric,
  meal_breakdown jsonb default '{}'::jsonb,
  first_log_ts timestamptz,
  last_log_ts timestamptz,
  computed_at timestamptz default now(),
  primary key (user_id, day)
);
create table if not exists public.nutrition_weekly_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  week_start date not null,
  summary jsonb not null,
  generated_at timestamptz default now(),
  unique(user_id, week_start)
);
-- =========================================================
-- Readiness + insights
-- =========================================================

create table if not exists public.readiness_daily (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  readiness_score int,
  sleep_score int,
  hrv_score int,
  rhr_score int,
  strain_score int,
  recommendation text,
  confidence text,
  reasons jsonb default '[]'::jsonb,
  computed_at timestamptz default now(),
  primary key (user_id, day)
);
create table if not exists public.insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  type text not null,
  title text not null,
  body text not null,
  data jsonb,
  confidence text,
  dismissed_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists insights_user_day_idx on public.insights(user_id, day desc);
create index if not exists insights_user_type_day_idx on public.insights(user_id, type, day desc);
-- =========================================================
-- RLS
-- =========================================================

alter table public.workouts enable row level security;
alter table public.workout_routes enable row level security;
alter table public.user_physiology enable row level security;
alter table public.training_load_workouts enable row level security;
alter table public.training_load_daily enable row level security;
alter table public.saved_routes enable row level security;
alter table public.route_snapshots enable row level security;
alter table public.segments enable row level security;
alter table public.segment_efforts enable row level security;
alter table public.best_efforts enable row level security;
alter table public.nutrition_daily enable row level security;
alter table public.nutrition_weekly_summaries enable row level security;
alter table public.readiness_daily enable row level security;
alter table public.insights enable row level security;
-- Workouts
do $$ begin
  create policy "workouts_select_own"
    on public.workouts for select to authenticated
    using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "workouts_insert_own"
    on public.workouts for insert to authenticated
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "workouts_update_own"
    on public.workouts for update to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "workouts_delete_own"
    on public.workouts for delete to authenticated
    using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
-- Workout routes
do $$ begin
  create policy "workout_routes_select_own"
    on public.workout_routes for select to authenticated
    using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "workout_routes_insert_own"
    on public.workout_routes for insert to authenticated
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "workout_routes_update_own"
    on public.workout_routes for update to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
-- User physiology
do $$ begin
  create policy "user_physiology_select_own"
    on public.user_physiology for select to authenticated
    using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "user_physiology_upsert_own"
    on public.user_physiology for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
-- Training load
do $$ begin
  create policy "training_load_workouts_select_own"
    on public.training_load_workouts for select to authenticated
    using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "training_load_workouts_upsert_own"
    on public.training_load_workouts for insert to authenticated
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "training_load_workouts_update_own"
    on public.training_load_workouts for update to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "training_load_daily_select_own"
    on public.training_load_daily for select to authenticated
    using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "training_load_daily_upsert_own"
    on public.training_load_daily for insert to authenticated
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "training_load_daily_update_own"
    on public.training_load_daily for update to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
-- Saved routes
do $$ begin
  create policy "saved_routes_select_own"
    on public.saved_routes for select to authenticated
    using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "saved_routes_manage_own"
    on public.saved_routes for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
-- Route snapshots: owner is saved_routes.user_id
do $$ begin
  create policy "route_snapshots_select_own"
    on public.route_snapshots for select to authenticated
    using (
      exists (
        select 1 from public.saved_routes r
        where r.id = route_id and r.user_id = auth.uid()
      )
    );
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "route_snapshots_insert_own"
    on public.route_snapshots for insert to authenticated
    with check (
      exists (
        select 1 from public.saved_routes r
        where r.id = route_id and r.user_id = auth.uid()
      )
    );
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "route_snapshots_update_own"
    on public.route_snapshots for update to authenticated
    using (
      exists (
        select 1 from public.saved_routes r
        where r.id = route_id and r.user_id = auth.uid()
      )
    )
    with check (
      exists (
        select 1 from public.saved_routes r
        where r.id = route_id and r.user_id = auth.uid()
      )
    );
exception when duplicate_object then null; end $$;
-- Segments
do $$ begin
  create policy "segments_select_own"
    on public.segments for select to authenticated
    using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "segments_manage_own"
    on public.segments for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
-- Segment efforts
do $$ begin
  create policy "segment_efforts_select_own"
    on public.segment_efforts for select to authenticated
    using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "segment_efforts_manage_own"
    on public.segment_efforts for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
-- Best efforts
do $$ begin
  create policy "best_efforts_select_own"
    on public.best_efforts for select to authenticated
    using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "best_efforts_manage_own"
    on public.best_efforts for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
-- Nutrition daily + weekly
do $$ begin
  create policy "nutrition_daily_select_own"
    on public.nutrition_daily for select to authenticated
    using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "nutrition_daily_manage_own"
    on public.nutrition_daily for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "nutrition_weekly_select_own"
    on public.nutrition_weekly_summaries for select to authenticated
    using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "nutrition_weekly_manage_own"
    on public.nutrition_weekly_summaries for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
-- Readiness
do $$ begin
  create policy "readiness_select_own"
    on public.readiness_daily for select to authenticated
    using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "readiness_manage_own"
    on public.readiness_daily for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
-- Insights
do $$ begin
  create policy "insights_select_own"
    on public.insights for select to authenticated
    using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "insights_manage_own"
    on public.insights for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
