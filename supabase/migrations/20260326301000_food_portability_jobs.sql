-- Restore-grade portability import jobs and audit trail.

create extension if not exists pgcrypto;

create table if not exists public.food_v2_portability_jobs (
  job_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  operation text not null check (operation in ('import_preview', 'import_apply', 'export', 'delete')),
  status text not null check (status in ('queued', 'previewed', 'succeeded', 'failed')),
  payload jsonb not null default '{}'::jsonb,
  result_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz null
);

create index if not exists idx_food_v2_portability_jobs_user_created
  on public.food_v2_portability_jobs (user_id, created_at desc);

alter table public.food_v2_portability_jobs enable row level security;

drop policy if exists "food_v2_portability_jobs_select_own" on public.food_v2_portability_jobs;
create policy "food_v2_portability_jobs_select_own"
  on public.food_v2_portability_jobs for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "food_v2_portability_jobs_insert_own" on public.food_v2_portability_jobs;
create policy "food_v2_portability_jobs_insert_own"
  on public.food_v2_portability_jobs for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "food_v2_portability_jobs_update_own" on public.food_v2_portability_jobs;
create policy "food_v2_portability_jobs_update_own"
  on public.food_v2_portability_jobs for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.food_v2_portability_audit_events (
  event_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_food_v2_portability_audit_events_user_created
  on public.food_v2_portability_audit_events (user_id, created_at desc);

alter table public.food_v2_portability_audit_events enable row level security;

drop policy if exists "food_v2_portability_audit_events_select_own" on public.food_v2_portability_audit_events;
create policy "food_v2_portability_audit_events_select_own"
  on public.food_v2_portability_audit_events for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "food_v2_portability_audit_events_insert_own" on public.food_v2_portability_audit_events;
create policy "food_v2_portability_audit_events_insert_own"
  on public.food_v2_portability_audit_events for insert
  to authenticated
  with check (auth.uid() = user_id);
