-- Social schema extensions required by the runtime social client.
-- This migration is additive and idempotent where possible.

-- ============================================
-- GROUPS (informal communities)
-- ============================================
CREATE TABLE IF NOT EXISTS public.groups (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  avatar_url TEXT,
  is_public BOOLEAN DEFAULT TRUE,
  join_code TEXT UNIQUE,
  owner_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- ============================================
-- GROUP MEMBERS
-- ============================================
CREATE TABLE IF NOT EXISTS public.group_members (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  group_id UUID REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member', -- 'owner' | 'admin' | 'member'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(group_id, user_id)
);
-- ============================================
-- FRIENDSHIPS (mutual connections)
-- ============================================
CREATE TABLE IF NOT EXISTS public.friendships (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  requester_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  addressee_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'accepted' | 'declined'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(requester_id, addressee_id),
  CHECK (requester_id != addressee_id)
);
-- ============================================
-- POSTS EXTENSIONS (audiences / groups)
-- ============================================
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS audience TEXT DEFAULT 'public';
-- 'public' | 'friends' | 'group'

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES public.groups(id) ON DELETE SET NULL;
-- ============================================
-- RLS
-- ============================================
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
-- GROUPS POLICIES
DO $$
BEGIN
  CREATE POLICY "Groups are viewable"
    ON public.groups FOR SELECT
    USING (is_public = true OR auth.uid() = owner_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  CREATE POLICY "Users can create groups"
    ON public.groups FOR INSERT
    WITH CHECK (auth.uid() = owner_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  CREATE POLICY "Owners can update groups"
    ON public.groups FOR UPDATE
    USING (auth.uid() = owner_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  CREATE POLICY "Owners can delete groups"
    ON public.groups FOR DELETE
    USING (auth.uid() = owner_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
-- GROUP MEMBERS POLICIES
DO $$
BEGIN
  CREATE POLICY "Group members viewable"
    ON public.group_members FOR SELECT
    USING (
      auth.uid() = user_id
      OR auth.uid() = (SELECT owner_id FROM public.groups g WHERE g.id = group_id)
      OR EXISTS (SELECT 1 FROM public.group_members gm2 WHERE gm2.group_id = group_id AND gm2.user_id = auth.uid())
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  CREATE POLICY "Users can join groups"
    ON public.group_members FOR INSERT
    WITH CHECK (
      auth.uid() = user_id
      OR auth.uid() = (SELECT owner_id FROM public.groups g WHERE g.id = group_id)
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  CREATE POLICY "Users can leave groups"
    ON public.group_members FOR DELETE
    USING (
      auth.uid() = user_id
      OR auth.uid() = (SELECT owner_id FROM public.groups g WHERE g.id = group_id)
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
-- FRIENDSHIPS POLICIES
DO $$
BEGIN
  CREATE POLICY "Friendships are viewable by participants"
    ON public.friendships FOR SELECT
    USING (auth.uid() = requester_id OR auth.uid() = addressee_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  CREATE POLICY "Users can request friendships"
    ON public.friendships FOR INSERT
    WITH CHECK (auth.uid() = requester_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  CREATE POLICY "Participants can update friendship status"
    ON public.friendships FOR UPDATE
    USING (auth.uid() = requester_id OR auth.uid() = addressee_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  CREATE POLICY "Participants can delete friendships"
    ON public.friendships FOR DELETE
    USING (auth.uid() = requester_id OR auth.uid() = addressee_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
-- POSTS SELECT POLICY needs to understand audiences.
-- Replace the earlier broad policy by adding a stricter one; RLS combines policies with OR.
DO $$
BEGIN
  CREATE POLICY "Posts viewable by audience"
    ON public.posts FOR SELECT
    USING (
      auth.uid() = user_id
      OR audience = 'public'
      OR (audience = 'friends' AND EXISTS (
        SELECT 1
        FROM public.friendships f
        WHERE f.status = 'accepted'
          AND (
            (f.requester_id = auth.uid() AND f.addressee_id = user_id)
            OR (f.addressee_id = auth.uid() AND f.requester_id = user_id)
          )
      ))
      OR (audience = 'group' AND EXISTS (
        SELECT 1
        FROM public.group_members gm
        WHERE gm.group_id = group_id AND gm.user_id = auth.uid()
      ))
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
