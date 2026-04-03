-- Team daily check-ins for athlete wellness/coach triage.
-- Idempotent migration with RLS + helper functions.

create extension if not exists pgcrypto;
create table if not exists public.team_checkins (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  checkin_date date not null,
  sleep_quality smallint not null check (sleep_quality between 1 and 5),
  fatigue_level smallint not null check (fatigue_level between 1 and 5),
  soreness_level smallint not null check (soreness_level between 1 and 5),
  stress_level smallint not null check (stress_level between 1 and 5),
  mood_level smallint not null check (mood_level between 1 and 5),
  pain_flag smallint not null check (pain_flag between 0 and 2),
  note text,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, user_id, checkin_date),
  check (note is null or char_length(note) <= 500)
);
create index if not exists idx_team_checkins_team_date
  on public.team_checkins (team_id, checkin_date desc);
create index if not exists idx_team_checkins_user_date
  on public.team_checkins (user_id, checkin_date desc);
create or replace function public.is_team_member(p_team_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.team_members tm
    where tm.team_id = p_team_id
      and tm.user_id = p_user_id
  )
  or exists(
    select 1
    from public.teams t
    where t.id = p_team_id
      and t.owner_id = p_user_id
  );
$$;
create or replace function public.is_team_coach(p_team_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.teams t
    where t.id = p_team_id
      and t.owner_id = p_user_id
  )
  or exists(
    select 1
    from public.team_members tm
    where tm.team_id = p_team_id
      and tm.user_id = p_user_id
      and lower(coalesce(tm.role, '')) in ('owner', 'admin', 'coach', 'trainer')
  );
$$;
grant execute on function public.is_team_member(uuid, uuid) to anon, authenticated;
grant execute on function public.is_team_coach(uuid, uuid) to anon, authenticated;
create or replace function public.team_checkins_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists trg_team_checkins_set_updated_at on public.team_checkins;
create trigger trg_team_checkins_set_updated_at
before update on public.team_checkins
for each row execute function public.team_checkins_set_updated_at();
alter table public.team_checkins enable row level security;
do $$
begin
  create policy "team_checkins_select_self_or_coach"
    on public.team_checkins
    for select
    using (
      auth.uid() = user_id
      or (auth.uid() is not null and public.is_team_coach(team_id, auth.uid()))
    );
exception when duplicate_object then null;
end $$;
do $$
begin
  create policy "team_checkins_insert_own_member"
    on public.team_checkins
    for insert
    with check (
      auth.uid() = user_id
      and auth.uid() is not null
      and public.is_team_member(team_id, auth.uid())
    );
exception when duplicate_object then null;
end $$;
do $$
begin
  create policy "team_checkins_update_own_member"
    on public.team_checkins
    for update
    using (
      auth.uid() = user_id
      and auth.uid() is not null
      and public.is_team_member(team_id, auth.uid())
    )
    with check (
      auth.uid() = user_id
      and auth.uid() is not null
      and public.is_team_member(team_id, auth.uid())
    );
exception when duplicate_object then null;
end $$;
do $$
begin
  create policy "team_checkins_delete_own_or_coach"
    on public.team_checkins
    for delete
    using (
      auth.uid() = user_id
      or (auth.uid() is not null and public.is_team_coach(team_id, auth.uid()))
    );
exception when duplicate_object then null;
end $$;
