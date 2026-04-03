-- Fix follow writes failing with:
--   permission denied for table profiles
--
-- Some environments still had legacy follow-count triggers running as invoker,
-- which broke once profile column UPDATE grants were tightened.
-- Recreate follows triggers as SECURITY DEFINER routines and reattach feed trigger.

CREATE OR REPLACE FUNCTION public.append_activity_feed(
  p_user_id UUID,
  p_activity_type TEXT,
  p_data JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.activity_feed (user_id, activity_type, data)
  VALUES (p_user_id, p_activity_type, COALESCE(p_data, '{}'::jsonb));
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END;
$$;
CREATE OR REPLACE FUNCTION public.on_follow_created_feed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.append_activity_feed(
    NEW.follower_id,
    'FOLLOWED_USER',
    jsonb_build_object('targetUserId', NEW.following_id, 'actorUserId', NEW.follower_id)
  );
  PERFORM public.append_activity_feed(
    NEW.following_id,
    'FOLLOWED_USER',
    jsonb_build_object('targetUserId', NEW.following_id, 'actorUserId', NEW.follower_id)
  );
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.recompute_follow_counts_for_user(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.profiles p
  SET
    following_count = (
      SELECT COUNT(*)::int
      FROM public.follows f
      WHERE f.follower_id = p_user_id
    ),
    follower_count = (
      SELECT COUNT(*)::int
      FROM public.follows f
      WHERE f.following_id = p_user_id
    ),
    updated_at = NOW()
  WHERE p.id = p_user_id;
END;
$$;
CREATE OR REPLACE FUNCTION public.on_follow_counts_after_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.recompute_follow_counts_for_user(NEW.follower_id);
  PERFORM public.recompute_follow_counts_for_user(NEW.following_id);
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.on_follow_counts_after_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.recompute_follow_counts_for_user(OLD.follower_id);
  PERFORM public.recompute_follow_counts_for_user(OLD.following_id);
  RETURN OLD;
END;
$$;
DO $$
DECLARE
  trig RECORD;
BEGIN
  -- Remove legacy user-defined follows triggers so we can install the canonical set.
  FOR trig IN
    SELECT tgname
    FROM pg_trigger
    WHERE tgrelid = 'public.follows'::regclass
      AND NOT tgisinternal
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.follows', trig.tgname);
  END LOOP;
END $$;
CREATE TRIGGER trg_follow_counts_after_insert
AFTER INSERT ON public.follows
FOR EACH ROW
EXECUTE FUNCTION public.on_follow_counts_after_insert();
CREATE TRIGGER trg_follow_counts_after_delete
AFTER DELETE ON public.follows
FOR EACH ROW
EXECUTE FUNCTION public.on_follow_counts_after_delete();
CREATE TRIGGER trg_follow_created_feed
AFTER INSERT ON public.follows
FOR EACH ROW
EXECUTE FUNCTION public.on_follow_created_feed();
