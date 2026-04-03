-- Admin RBAC + break-glass + work queue model for food operations.

create extension if not exists pgcrypto;

create table if not exists public.food_v2_admin_role_bindings (
  binding_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('food_admin', 'food_ops', 'sre')),
  granted_by uuid null references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz null,
  active boolean not null default true,
  notes text null,
  unique (user_id, role)
);

create index if not exists idx_food_v2_admin_role_bindings_user
  on public.food_v2_admin_role_bindings (user_id, role, active);

alter table public.food_v2_admin_role_bindings enable row level security;

drop policy if exists "food_v2_admin_role_bindings_select_own" on public.food_v2_admin_role_bindings;
create policy "food_v2_admin_role_bindings_select_own"
  on public.food_v2_admin_role_bindings for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "food_v2_admin_role_bindings_no_client_write" on public.food_v2_admin_role_bindings;
create policy "food_v2_admin_role_bindings_no_client_write"
  on public.food_v2_admin_role_bindings for all
  to authenticated
  using (false)
  with check (false);

create table if not exists public.food_v2_admin_break_glass_sessions (
  session_id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null,
  status text not null default 'active' check (status in ('active', 'revoked', 'expired')),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  revoked_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_food_v2_admin_break_glass_active
  on public.food_v2_admin_break_glass_sessions (admin_user_id, status, expires_at desc);

alter table public.food_v2_admin_break_glass_sessions enable row level security;

drop policy if exists "food_v2_admin_break_glass_sessions_select_own" on public.food_v2_admin_break_glass_sessions;
create policy "food_v2_admin_break_glass_sessions_select_own"
  on public.food_v2_admin_break_glass_sessions for select
  to authenticated
  using (auth.uid() = admin_user_id);

drop policy if exists "food_v2_admin_break_glass_sessions_no_client_write" on public.food_v2_admin_break_glass_sessions;
create policy "food_v2_admin_break_glass_sessions_no_client_write"
  on public.food_v2_admin_break_glass_sessions for all
  to authenticated
  using (false)
  with check (false);

create table if not exists public.food_v2_admin_work_queue (
  queue_id bigint generated always as identity primary key,
  queue_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'claimed', 'completed', 'failed')),
  priority integer not null default 50,
  created_by uuid null references auth.users(id) on delete set null,
  claimed_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz null,
  completed_at timestamptz null,
  last_error text null
);

create index if not exists idx_food_v2_admin_work_queue_status_priority
  on public.food_v2_admin_work_queue (status, priority asc, created_at asc);

alter table public.food_v2_admin_work_queue enable row level security;

drop policy if exists "food_v2_admin_work_queue_no_client_access" on public.food_v2_admin_work_queue;
create policy "food_v2_admin_work_queue_no_client_access"
  on public.food_v2_admin_work_queue for all
  to authenticated
  using (false)
  with check (false);

create table if not exists public.food_v2_admin_audit_events (
  event_id uuid primary key default gen_random_uuid(),
  actor_user_id uuid null references auth.users(id) on delete set null,
  action text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_food_v2_admin_audit_events_created
  on public.food_v2_admin_audit_events (created_at desc);

alter table public.food_v2_admin_audit_events enable row level security;

drop policy if exists "food_v2_admin_audit_events_read_own" on public.food_v2_admin_audit_events;
create policy "food_v2_admin_audit_events_read_own"
  on public.food_v2_admin_audit_events for select
  to authenticated
  using (auth.uid() = actor_user_id);

drop policy if exists "food_v2_admin_audit_events_no_client_write" on public.food_v2_admin_audit_events;
create policy "food_v2_admin_audit_events_no_client_write"
  on public.food_v2_admin_audit_events for all
  to authenticated
  using (false)
  with check (false);
