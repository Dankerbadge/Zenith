-- Compatibility columns required by the runtime social client.
-- These are additive and safe to apply to existing deployments.

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS kind TEXT DEFAULT 'friend_group';
ALTER TABLE public.group_members
  ADD COLUMN IF NOT EXISTS joined_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.team_members
  ADD COLUMN IF NOT EXISTS joined_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS total_xp INTEGER DEFAULT 0;
