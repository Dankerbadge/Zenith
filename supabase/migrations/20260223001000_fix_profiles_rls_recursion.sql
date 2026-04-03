-- Fix RLS recursion between profiles <-> follows policies.
-- Prior profiles SELECT policy referenced follows, while follows SELECT policy referenced profiles,
-- which can trigger "infinite recursion detected in policy for relation profiles".

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
  );
