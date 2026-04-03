-- Fix infinite recursion on public.groups RLS policies (PostgREST 42P17).
-- This migration force-resets policies on groups/group_members to known safe forms.

alter table if exists public.groups enable row level security;
alter table if exists public.group_members enable row level security;
do $$
declare
  p record;
begin
  for p in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'groups'
  loop
    execute format('drop policy if exists %I on public.groups', p.policyname);
  end loop;
end $$;
do $$
declare
  p record;
begin
  for p in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'group_members'
  loop
    execute format('drop policy if exists %I on public.group_members', p.policyname);
  end loop;
end $$;
-- Groups: no self-referential checks.
create policy "groups_select_public_or_owner"
  on public.groups for select
  using (is_public = true or auth.uid() = owner_id);
create policy "groups_insert_owner_only"
  on public.groups for insert
  with check (auth.uid() = owner_id);
create policy "groups_update_owner_only"
  on public.groups for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);
create policy "groups_delete_owner_only"
  on public.groups for delete
  using (auth.uid() = owner_id);
-- Group members: visibility for self, group owner, or members.
create policy "group_members_select_visible"
  on public.group_members for select
  using (
    auth.uid() = user_id
    or auth.uid() = (select g.owner_id from public.groups g where g.id = group_id)
    or (auth.uid() is not null and public.is_group_member(group_id, auth.uid()))
  );
create policy "group_members_insert_self_or_owner"
  on public.group_members for insert
  with check (
    auth.uid() = user_id
    or auth.uid() = (select g.owner_id from public.groups g where g.id = group_id)
  );
create policy "group_members_delete_self_or_owner"
  on public.group_members for delete
  using (
    auth.uid() = user_id
    or auth.uid() = (select g.owner_id from public.groups g where g.id = group_id)
  );
