-- Immutable v2 log write path + dual-write parity storage.

create extension if not exists pgcrypto;

create table if not exists public.food_v2_log_entries (
  event_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_event_id text not null,
  state_key text not null,
  day date null,
  payload jsonb not null default '{}'::jsonb,
  payload_hash text not null,
  logged_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, client_event_id)
);

create index if not exists idx_food_v2_log_entries_user_day
  on public.food_v2_log_entries (user_id, day, logged_at desc);

create index if not exists idx_food_v2_log_entries_state_key
  on public.food_v2_log_entries (state_key, logged_at desc);

alter table public.food_v2_log_entries enable row level security;

drop policy if exists "food_v2_log_entries_select_own" on public.food_v2_log_entries;
create policy "food_v2_log_entries_select_own"
  on public.food_v2_log_entries for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "food_v2_log_entries_insert_own" on public.food_v2_log_entries;
create policy "food_v2_log_entries_insert_own"
  on public.food_v2_log_entries for insert
  to authenticated
  with check (auth.uid() = user_id);

create table if not exists public.food_v2_dual_write_parity (
  parity_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  state_key text not null,
  day date null,
  snapshot_hash text not null,
  log_hash text not null,
  parity_ok boolean not null default false,
  source text not null default 'runtime',
  checked_at timestamptz not null default now(),
  unique (user_id, state_key, day)
);

create index if not exists idx_food_v2_dual_write_parity_user_checked
  on public.food_v2_dual_write_parity (user_id, checked_at desc);

alter table public.food_v2_dual_write_parity enable row level security;

drop policy if exists "food_v2_dual_write_parity_select_own" on public.food_v2_dual_write_parity;
create policy "food_v2_dual_write_parity_select_own"
  on public.food_v2_dual_write_parity for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "food_v2_dual_write_parity_insert_own" on public.food_v2_dual_write_parity;
create policy "food_v2_dual_write_parity_insert_own"
  on public.food_v2_dual_write_parity for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "food_v2_dual_write_parity_update_own" on public.food_v2_dual_write_parity;
create policy "food_v2_dual_write_parity_update_own"
  on public.food_v2_dual_write_parity for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
