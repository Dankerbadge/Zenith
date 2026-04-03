-- Allow authenticated role to satisfy FK checks against public.profiles(id)
-- when inserting into social tables (follows, friendships, group_members, etc.).

GRANT REFERENCES (id) ON TABLE public.profiles TO authenticated;
