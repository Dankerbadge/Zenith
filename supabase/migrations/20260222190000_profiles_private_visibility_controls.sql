-- Account-level social privacy controls.
-- Ensures private profiles do not leak into public surfaces.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_private_account boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS profile_visibility text NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS activity_visibility text NOT NULL DEFAULT 'friends',
  ADD COLUMN IF NOT EXISTS allow_friend_requests_from text NOT NULL DEFAULT 'everyone',
  ADD COLUMN IF NOT EXISTS discoverable_by_username boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_public_discovery_feed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_dms_from_non_friends boolean NOT NULL DEFAULT false;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_profile_visibility_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_profile_visibility_check
      CHECK (profile_visibility IN ('private', 'friends', 'public'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_activity_visibility_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_activity_visibility_check
      CHECK (activity_visibility IN ('private', 'friends', 'public'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_allow_friend_requests_from_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_allow_friend_requests_from_check
      CHECK (allow_friend_requests_from IN ('everyone', 'friends_of_friends', 'nobody'));
  END IF;
END
$$;
UPDATE public.profiles
SET
  is_private_account = CASE
    WHEN profile_visibility = 'private' THEN true
    ELSE coalesce(is_private_account, false)
  END,
  profile_visibility = CASE
    WHEN profile_visibility IN ('private', 'friends', 'public') THEN profile_visibility
    WHEN coalesce(is_private_account, false) = true THEN 'private'
    ELSE 'public'
  END,
  activity_visibility = CASE
    WHEN activity_visibility IN ('private', 'friends', 'public') THEN activity_visibility
    ELSE 'friends'
  END,
  allow_friend_requests_from = CASE
    WHEN allow_friend_requests_from IN ('everyone', 'friends_of_friends', 'nobody') THEN allow_friend_requests_from
    ELSE 'everyone'
  END,
  discoverable_by_username = coalesce(discoverable_by_username, true),
  allow_public_discovery_feed = coalesce(allow_public_discovery_feed, false),
  allow_dms_from_non_friends = coalesce(allow_dms_from_non_friends, false)
WHERE true;
-- Keep public profile reads safe: private users are visible only to self, accepted friends, or followers.
DROP POLICY IF EXISTS profiles_read_authenticated ON public.profiles;
CREATE POLICY profiles_read_authenticated
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    auth.uid() = id
    OR coalesce(is_private_account, false) = false
    OR EXISTS (
      SELECT 1
      FROM public.friendships f
      WHERE f.status = 'accepted'
        AND (
          (f.requester_id = auth.uid() AND f.addressee_id = profiles.id)
          OR (f.requester_id = profiles.id AND f.addressee_id = auth.uid())
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.follows fo
      WHERE fo.follower_id = auth.uid()
        AND fo.following_id = profiles.id
    )
  );
-- Followers/following visibility: private accounts are hidden unless relationship exists.
DROP POLICY IF EXISTS "Follows are viewable by everyone" ON public.follows;
DROP POLICY IF EXISTS follows_read_authenticated ON public.follows;
CREATE POLICY follows_read_authenticated
  ON public.follows FOR SELECT
  TO authenticated
  USING (
    auth.uid() = follower_id
    OR auth.uid() = following_id
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = follows.following_id
        AND coalesce(p.is_private_account, false) = false
    )
  );
-- Posts visibility: private-account public posts must not be visible to everyone.
DROP POLICY IF EXISTS "Public posts are viewable" ON public.posts;
DROP POLICY IF EXISTS posts_select_visibility_guard ON public.posts;
CREATE POLICY posts_select_visibility_guard
  ON public.posts FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    OR (
      audience = 'public'
      AND is_public = true
      AND EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = posts.user_id
          AND coalesce(p.is_private_account, false) = false
      )
    )
    OR (
      audience = 'friends'
      AND EXISTS (
        SELECT 1
        FROM public.friendships f
        WHERE f.status = 'accepted'
          AND (
            (f.requester_id = auth.uid() AND f.addressee_id = posts.user_id)
            OR (f.requester_id = posts.user_id AND f.addressee_id = auth.uid())
          )
      )
    )
    OR (
      audience = 'group'
      AND group_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.group_members gm
        WHERE gm.group_id = posts.group_id
          AND gm.user_id = auth.uid()
      )
    )
  );
