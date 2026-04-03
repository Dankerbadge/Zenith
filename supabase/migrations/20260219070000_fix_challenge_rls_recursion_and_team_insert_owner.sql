-- Fix workout challenge RLS recursion (42P17) and harden teams owner identity on insert.

alter table if exists public.workout_challenges enable row level security;
alter table if exists public.workout_challenge_participants enable row level security;
alter table if exists public.workout_challenge_invites enable row level security;
alter table if exists public.workout_challenge_events enable row level security;
create or replace function public.workout_challenge_creator_uid(p_challenge_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.creator_user_id
  from public.workout_challenges c
  where c.id = p_challenge_id
  limit 1;
$$;
create or replace function public.is_workout_challenge_visible_to_user(p_challenge_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workout_challenges c
    where c.id = p_challenge_id
      and (
        c.visibility = 'PUBLIC'
        or c.creator_user_id = p_user_id
        or exists (
          select 1
          from public.workout_challenge_participants p
          where p.challenge_id = c.id
            and p.user_id = p_user_id
        )
        or (
          c.visibility = 'TEAM'
          and c.team_id is not null
          and exists (
            select 1
            from public.team_members tm
            where tm.team_id = c.team_id
              and tm.user_id = p_user_id
          )
        )
      )
  );
$$;
grant execute on function public.workout_challenge_creator_uid(uuid) to anon, authenticated;
grant execute on function public.is_workout_challenge_visible_to_user(uuid, uuid) to anon, authenticated;
-- Rebuild challenge policies to eliminate table-to-table RLS recursion.
drop policy if exists "workout challenges selectable by scoped users" on public.workout_challenges;
create policy "workout challenges selectable by scoped users"
  on public.workout_challenges for select
  to authenticated
  using (
    auth.uid() is not null
    and public.is_workout_challenge_visible_to_user(id, auth.uid())
  );
drop policy if exists "workout challenges creator insert" on public.workout_challenges;
create policy "workout challenges creator insert"
  on public.workout_challenges for insert
  to authenticated
  with check (
    auth.uid() is not null
    and creator_user_id = auth.uid()
  );
drop policy if exists "workout challenges creator update" on public.workout_challenges;
create policy "workout challenges creator update"
  on public.workout_challenges for update
  to authenticated
  using (
    auth.uid() is not null
    and creator_user_id = auth.uid()
  )
  with check (
    auth.uid() is not null
    and creator_user_id = auth.uid()
  );
drop policy if exists "participants select scoped" on public.workout_challenge_participants;
create policy "participants select scoped"
  on public.workout_challenge_participants for select
  to authenticated
  using (
    auth.uid() is not null
    and (
      user_id = auth.uid()
      or public.is_workout_challenge_visible_to_user(challenge_id, auth.uid())
    )
  );
drop policy if exists "participants insert by creator" on public.workout_challenge_participants;
create policy "participants insert by creator"
  on public.workout_challenge_participants for insert
  to authenticated
  with check (
    auth.uid() is not null
    and (
      user_id = auth.uid()
      or public.workout_challenge_creator_uid(challenge_id) = auth.uid()
    )
  );
drop policy if exists "participants update self or creator" on public.workout_challenge_participants;
create policy "participants update self or creator"
  on public.workout_challenge_participants for update
  to authenticated
  using (
    auth.uid() is not null
    and (
      user_id = auth.uid()
      or public.workout_challenge_creator_uid(challenge_id) = auth.uid()
    )
  )
  with check (
    auth.uid() is not null
    and (
      user_id = auth.uid()
      or public.workout_challenge_creator_uid(challenge_id) = auth.uid()
    )
  );
drop policy if exists "invites select scoped" on public.workout_challenge_invites;
create policy "invites select scoped"
  on public.workout_challenge_invites for select
  to authenticated
  using (
    auth.uid() is not null
    and (
      inviter_user_id = auth.uid()
      or invitee_user_id = auth.uid()
      or public.workout_challenge_creator_uid(challenge_id) = auth.uid()
      or public.is_workout_challenge_visible_to_user(challenge_id, auth.uid())
    )
  );
drop policy if exists "invites insert creator" on public.workout_challenge_invites;
create policy "invites insert creator"
  on public.workout_challenge_invites for insert
  to authenticated
  with check (
    auth.uid() is not null
    and inviter_user_id = auth.uid()
    and public.workout_challenge_creator_uid(challenge_id) = auth.uid()
  );
drop policy if exists "events select scoped" on public.workout_challenge_events;
create policy "events select scoped"
  on public.workout_challenge_events for select
  to authenticated
  using (
    auth.uid() is not null
    and public.is_workout_challenge_visible_to_user(challenge_id, auth.uid())
  );
drop policy if exists "events insert scoped" on public.workout_challenge_events;
create policy "events insert scoped"
  on public.workout_challenge_events for insert
  to authenticated
  with check (
    auth.uid() is not null
    and public.is_workout_challenge_visible_to_user(challenge_id, auth.uid())
    and (
      user_id is null
      or user_id = auth.uid()
      or public.workout_challenge_creator_uid(challenge_id) = auth.uid()
    )
  );
-- Teams: always bind INSERT owner_id to caller auth uid when JWT is present.
create or replace function public.teams_enforce_owner_uid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
begin
  v_uid := auth.uid();

  if tg_op = 'INSERT' then
    if v_uid is not null then
      new.owner_id := v_uid;
    end if;
  elsif tg_op = 'UPDATE' then
    if new.owner_id is distinct from old.owner_id then
      new.owner_id := old.owner_id;
    end if;
  end if;

  return new;
end;
$$;
drop trigger if exists teams_enforce_owner_uid_before_write on public.teams;
create trigger teams_enforce_owner_uid_before_write
before insert or update of owner_id on public.teams
for each row execute function public.teams_enforce_owner_uid();
drop policy if exists "Users can create teams" on public.teams;
drop policy if exists "teams_insert_owner_only" on public.teams;
create policy "teams_insert_owner_only"
  on public.teams for insert
  to authenticated
  with check (
    auth.uid() is not null
    and owner_id = auth.uid()
  );
