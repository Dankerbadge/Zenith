-- Canonical clubs persistence for social/community flows.
-- Non-Garmin scope: shared backend truth for clubs + memberships + moderation/audit controls.

create table if not exists public.clubs (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  description text not null default '',
  visibility_mode text not null default 'private_invite_only',
  created_by_user_id uuid not null references public.profiles(id) on delete cascade,
  invite_link_enabled boolean not null default true,
  invite_link_token text unique,
  allow_member_invites boolean not null default false,
  require_approval boolean not null default false,
  default_member_visibility text not null default 'club',
  announcements_posting_roles text[] not null default array['owner','admin']::text[],
  general_chat_enabled boolean not null default true,
  content_rules text not null default 'Be respectful and accountable.',
  tags text[] not null default array[]::text[],
  location_hint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clubs_visibility_mode_check
    check (visibility_mode in ('private_invite_only', 'request_to_join', 'public_discoverable')),
  constraint clubs_default_member_visibility_check
    check (default_member_visibility in ('private', 'club'))
);

create index if not exists idx_clubs_created_by on public.clubs(created_by_user_id);
create index if not exists idx_clubs_visibility_mode on public.clubs(visibility_mode);

create table if not exists public.club_memberships (
  id uuid default uuid_generate_v4() primary key,
  club_id uuid not null references public.clubs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member',
  status text not null default 'pending_request',
  joined_at timestamptz,
  invited_at timestamptz,
  requested_at timestamptz,
  removed_at timestamptz,
  removed_by_user_id uuid references public.profiles(id) on delete set null,
  muted_in_club_chat boolean not null default false,
  last_changed_by_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint club_memberships_role_check
    check (role in ('owner', 'admin', 'moderator', 'member')),
  constraint club_memberships_status_check
    check (status in ('active', 'pending_request', 'invited', 'removed', 'banned')),
  constraint club_memberships_unique_club_user unique (club_id, user_id)
);

create index if not exists idx_club_memberships_user_status on public.club_memberships(user_id, status);
create index if not exists idx_club_memberships_club_status on public.club_memberships(club_id, status);

create table if not exists public.club_action_audit (
  id uuid default uuid_generate_v4() primary key,
  at_utc timestamptz not null default now(),
  actor_user_id uuid not null references public.profiles(id) on delete cascade,
  action text not null,
  club_id uuid references public.clubs(id) on delete cascade,
  target_user_id uuid references public.profiles(id) on delete set null,
  success boolean not null default true,
  reason text,
  created_at timestamptz not null default now(),
  constraint club_action_audit_action_check
    check (action in (
      'invite_sent',
      'invite_accepted',
      'join_request_sent',
      'join_request_approved',
      'join_request_declined',
      'invite_token_failed',
      'invite_token_joined',
      'invite_token_rotated'
    ))
);

create index if not exists idx_club_action_audit_actor_action_time
  on public.club_action_audit(actor_user_id, action, at_utc desc);
create index if not exists idx_club_action_audit_club_time
  on public.club_action_audit(club_id, at_utc desc);

create or replace function public.is_active_club_member(p_club_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.club_memberships cm
    where cm.club_id = p_club_id
      and cm.user_id = p_user_id
      and cm.status = 'active'
  );
$$;

create or replace function public.can_manage_club(p_club_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.club_memberships cm
    where cm.club_id = p_club_id
      and cm.user_id = p_user_id
      and cm.status = 'active'
      and cm.role in ('owner', 'admin')
  );
$$;

create or replace function public.can_moderate_club(p_club_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.club_memberships cm
    where cm.club_id = p_club_id
      and cm.user_id = p_user_id
      and cm.status = 'active'
      and cm.role in ('owner', 'admin', 'moderator')
  );
$$;

create or replace function public.can_view_club(p_club_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.clubs c
    where c.id = p_club_id
      and (
        c.visibility_mode in ('public_discoverable', 'request_to_join')
        or c.created_by_user_id = p_user_id
        or exists (
          select 1
          from public.club_memberships cm
          where cm.club_id = p_club_id
            and cm.user_id = p_user_id
            and cm.status in ('active', 'pending_request', 'invited')
        )
      )
  );
$$;

alter table if exists public.clubs enable row level security;
alter table if exists public.club_memberships enable row level security;
alter table if exists public.club_action_audit enable row level security;

-- clubs policies
DO $$
BEGIN
  CREATE POLICY clubs_select_visible
    ON public.clubs FOR SELECT
    USING (public.can_view_club(id, auth.uid()));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY clubs_insert_owner_only
    ON public.clubs FOR INSERT
    WITH CHECK (auth.uid() = created_by_user_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY clubs_update_manage
    ON public.clubs FOR UPDATE
    USING (public.can_manage_club(id, auth.uid()))
    WITH CHECK (public.can_manage_club(id, auth.uid()));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY clubs_delete_owner_only
    ON public.clubs FOR DELETE
    USING (auth.uid() = created_by_user_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- club_memberships policies
DO $$
BEGIN
  CREATE POLICY club_memberships_select_visible
    ON public.club_memberships FOR SELECT
    USING (
      auth.uid() = user_id
      OR public.can_manage_club(club_id, auth.uid())
      OR public.is_active_club_member(club_id, auth.uid())
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY club_memberships_insert_self_or_manage
    ON public.club_memberships FOR INSERT
    WITH CHECK (
      (auth.uid() = user_id AND role = 'member')
      OR public.can_manage_club(club_id, auth.uid())
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY club_memberships_update_self_member_or_moderate
    ON public.club_memberships FOR UPDATE
    USING (
      (auth.uid() = user_id AND role = 'member')
      OR public.can_moderate_club(club_id, auth.uid())
    )
    WITH CHECK (
      (auth.uid() = user_id AND role = 'member')
      OR public.can_moderate_club(club_id, auth.uid())
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY club_memberships_delete_self_or_manage
    ON public.club_memberships FOR DELETE
    USING (
      auth.uid() = user_id
      OR public.can_manage_club(club_id, auth.uid())
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- club_action_audit policies
DO $$
BEGIN
  CREATE POLICY club_action_audit_select_visible
    ON public.club_action_audit FOR SELECT
    USING (
      auth.uid() = actor_user_id
      OR (club_id IS NOT NULL AND public.can_manage_club(club_id, auth.uid()))
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY club_action_audit_insert_actor_only
    ON public.club_action_audit FOR INSERT
    WITH CHECK (auth.uid() = actor_user_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Updated-at triggers
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'set_updated_at'
      AND pg_function_is_visible(oid)
  ) THEN
    DROP TRIGGER IF EXISTS trg_clubs_set_updated_at ON public.clubs;
    CREATE TRIGGER trg_clubs_set_updated_at
      BEFORE UPDATE ON public.clubs
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

    DROP TRIGGER IF EXISTS trg_club_memberships_set_updated_at ON public.club_memberships;
    CREATE TRIGGER trg_club_memberships_set_updated_at
      BEFORE UPDATE ON public.club_memberships
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;
