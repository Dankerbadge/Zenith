-- Fix infinite recursion in RLS policies caused by self-referential group_members SELECT policy.
-- Symptom: PostgREST reads (e.g. /rest/v1/posts) return 500 with code 42P17.
--
-- Root cause:
-- - posts RLS policy checks group membership via public.group_members
-- - group_members SELECT policy referenced public.group_members again (EXISTS ... FROM public.group_members ...)
-- - Postgres detects recursion and aborts.
--
-- Fix:
-- - introduce SECURITY DEFINER helper to check membership (bypasses RLS)
-- - rewrite group_members SELECT policy to use helper (no self-reference)
-- - rewrite posts audience policy to use helper (avoid joining group_members under RLS)

-- Helper: check if a user is a member of a group.
-- SECURITY DEFINER bypasses RLS for the membership lookup.
CREATE OR REPLACE FUNCTION public.is_group_member(p_group_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  select exists(
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = p_user_id
  );
$$;
-- Allow calling from RLS evaluation contexts.
GRANT EXECUTE ON FUNCTION public.is_group_member(uuid, uuid) TO anon, authenticated;
-- Replace the recursive group_members SELECT policy.
DO $$
BEGIN
  DROP POLICY IF EXISTS "Group members viewable" ON public.group_members;
EXCEPTION
  WHEN undefined_table THEN NULL;
END $$;
DO $$
BEGIN
  CREATE POLICY "Group members viewable"
    ON public.group_members FOR SELECT
    USING (
      auth.uid() = user_id
      OR auth.uid() = (SELECT owner_id FROM public.groups g WHERE g.id = group_id)
      OR (auth.uid() IS NOT NULL AND public.is_group_member(group_id, auth.uid()))
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
-- Rewrite posts policy to avoid group_members recursion.
DO $$
BEGIN
  DROP POLICY IF EXISTS "Posts viewable by audience" ON public.posts;
EXCEPTION
  WHEN undefined_table THEN NULL;
END $$;
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
      OR (
        audience = 'group'
        AND group_id IS NOT NULL
        AND auth.uid() IS NOT NULL
        AND public.is_group_member(group_id, auth.uid())
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
