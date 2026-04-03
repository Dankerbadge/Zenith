-- Structured events for groups and coaching teams (Race Day / Event Hub system).
-- Additive + idempotent migration with RLS and helper functions.

create extension if not exists "uuid-ossp";
create table if not exists public.events (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid references public.groups(id) on delete cascade,
  owner_id uuid references public.profiles(id) on delete set null,

  title text not null,
  description text,
  event_type text not null default 'training', -- training | social | race | meeting | travel | other

  start_at timestamptz not null,
  end_at timestamptz,
  timezone text,

  location_name text,
  location_address text,
  location_lat double precision,
  location_lng double precision,
  meeting_notes text,

  rsvp_enabled boolean not null default true,
  capacity integer,
  waitlist_enabled boolean not null default false,
  rsvp_questions jsonb,
  reminders jsonb,

  recurrence_rule text,
  recurrence_until timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (char_length(title) > 0),
  check (capacity is null or capacity > 0)
);
create index if not exists idx_events_group_start
  on public.events (group_id, start_at asc);
create index if not exists idx_events_owner_start
  on public.events (owner_id, start_at asc);
create table if not exists public.event_rsvps (
  id uuid primary key default uuid_generate_v4(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null, -- going | maybe | not_going
  answers jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, user_id),
  check (status in ('going', 'maybe', 'not_going'))
);
create index if not exists idx_event_rsvps_event
  on public.event_rsvps (event_id, status);
create index if not exists idx_event_rsvps_user
  on public.event_rsvps (user_id, updated_at desc);
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists trg_events_set_updated_at on public.events;
create trigger trg_events_set_updated_at
before update on public.events
for each row execute function public.set_updated_at();
drop trigger if exists trg_event_rsvps_set_updated_at on public.event_rsvps;
create trigger trg_event_rsvps_set_updated_at
before update on public.event_rsvps
for each row execute function public.set_updated_at();
-- RLS helper predicates. SECURITY DEFINER avoids recursive-policy pitfalls.
create or replace function public.is_group_member(p_group_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.groups g
    where g.id = p_group_id
      and g.owner_id = p_user_id
  )
  or exists(
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = p_user_id
  );
$$;
create or replace function public.is_group_event_admin(p_group_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.groups g
    where g.id = p_group_id
      and g.owner_id = p_user_id
  )
  or exists(
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = p_user_id
      and lower(coalesce(gm.role::text, '')) in ('owner', 'admin', 'mod')
  )
  or exists(
    select 1
    from public.groups g
    where g.id = p_group_id
      and lower(coalesce(g.kind::text, '')) = 'coaching_team'
      and g.join_code like 'team:%'
      and public.is_team_coach((split_part(g.join_code, ':', 2))::uuid, p_user_id)
  );
$$;
create or replace function public.is_event_viewer(p_event_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when e.group_id is null then e.owner_id = p_user_id
    else public.is_group_member(e.group_id, p_user_id)
  end
  from public.events e
  where e.id = p_event_id;
$$;
create or replace function public.is_event_admin(p_event_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when e.group_id is null then e.owner_id = p_user_id
    else public.is_group_event_admin(e.group_id, p_user_id)
  end
  from public.events e
  where e.id = p_event_id;
$$;
grant execute on function public.is_group_member(uuid, uuid) to anon, authenticated;
grant execute on function public.is_group_event_admin(uuid, uuid) to anon, authenticated;
grant execute on function public.is_event_viewer(uuid, uuid) to anon, authenticated;
grant execute on function public.is_event_admin(uuid, uuid) to anon, authenticated;
alter table public.events enable row level security;
alter table public.event_rsvps enable row level security;
do $$
begin
  create policy "events_select_personal_or_group_member"
    on public.events
    for select
    using (
      (group_id is null and auth.uid() = owner_id)
      or (group_id is not null and auth.uid() is not null and public.is_group_member(group_id, auth.uid()))
    );
exception when duplicate_object then null;
end $$;
do $$
begin
  create policy "events_insert_own_personal_or_group_admin"
    on public.events
    for insert
    with check (
      auth.uid() = owner_id
      and auth.uid() is not null
      and (
        group_id is null
        or public.is_group_event_admin(group_id, auth.uid())
      )
    );
exception when duplicate_object then null;
end $$;
do $$
begin
  create policy "events_update_owner_or_group_admin"
    on public.events
    for update
    using (
      auth.uid() is not null
      and (
        (auth.uid() = owner_id and (group_id is null or public.is_group_event_admin(group_id, auth.uid())))
        or (group_id is not null and public.is_group_event_admin(group_id, auth.uid()))
      )
    )
    with check (
      auth.uid() is not null
      and (
        (auth.uid() = owner_id and (group_id is null or public.is_group_event_admin(group_id, auth.uid())))
        or (group_id is not null and public.is_group_event_admin(group_id, auth.uid()))
      )
    );
exception when duplicate_object then null;
end $$;
do $$
begin
  create policy "events_delete_owner_or_group_admin"
    on public.events
    for delete
    using (
      auth.uid() is not null
      and (
        auth.uid() = owner_id
        or (group_id is not null and public.is_group_event_admin(group_id, auth.uid()))
      )
    );
exception when duplicate_object then null;
end $$;
do $$
begin
  create policy "event_rsvps_select_event_viewers"
    on public.event_rsvps
    for select
    using (
      auth.uid() is not null
      and public.is_event_viewer(event_id, auth.uid())
    );
exception when duplicate_object then null;
end $$;
do $$
begin
  create policy "event_rsvps_insert_own"
    on public.event_rsvps
    for insert
    with check (
      auth.uid() is not null
      and auth.uid() = user_id
      and public.is_event_viewer(event_id, auth.uid())
    );
exception when duplicate_object then null;
end $$;
do $$
begin
  create policy "event_rsvps_update_own"
    on public.event_rsvps
    for update
    using (
      auth.uid() is not null
      and auth.uid() = user_id
      and public.is_event_viewer(event_id, auth.uid())
    )
    with check (
      auth.uid() is not null
      and auth.uid() = user_id
      and public.is_event_viewer(event_id, auth.uid())
    );
exception when duplicate_object then null;
end $$;
do $$
begin
  create policy "event_rsvps_delete_own_or_admin"
    on public.event_rsvps
    for delete
    using (
      auth.uid() is not null
      and (
        auth.uid() = user_id
        or public.is_event_admin(event_id, auth.uid())
      )
    );
exception when duplicate_object then null;
end $$;
