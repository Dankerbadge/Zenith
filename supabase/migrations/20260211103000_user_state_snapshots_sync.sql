-- P0 hybrid cloud backup for core local state (daily logs, profile, weight log).
-- This provides durable recovery after local storage loss while keeping offline-first UX.

create table if not exists public.user_state_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  state_key text not null,
  state_value jsonb,
  updated_at timestamptz not null default now(),
  unique(user_id, state_key)
);
create index if not exists user_state_snapshots_user_updated_idx
  on public.user_state_snapshots (user_id, updated_at desc);
alter table public.user_state_snapshots enable row level security;
do $$
begin
  create policy "user_state_snapshots_select_own"
    on public.user_state_snapshots
    for select
    to authenticated
    using (auth.uid() = user_id);
exception when duplicate_object then null;
end $$;
do $$
begin
  create policy "user_state_snapshots_insert_own"
    on public.user_state_snapshots
    for insert
    to authenticated
    with check (auth.uid() = user_id);
exception when duplicate_object then null;
end $$;
do $$
begin
  create policy "user_state_snapshots_update_own"
    on public.user_state_snapshots
    for update
    to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
exception when duplicate_object then null;
end $$;
do $$
begin
  create policy "user_state_snapshots_delete_own"
    on public.user_state_snapshots
    for delete
    to authenticated
    using (auth.uid() = user_id);
exception when duplicate_object then null;
end $$;
