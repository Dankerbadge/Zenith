-- Canonical avatar reference fields.
-- `avatar_path` is the storage object path (e.g. "<user_id>/avatar.jpg")
-- `avatar_version` is a monotonic cache-busting token.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_path text,
  ADD COLUMN IF NOT EXISTS avatar_version bigint;
GRANT UPDATE (avatar_path, avatar_version) ON TABLE public.profiles TO authenticated;
