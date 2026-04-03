-- Fix social activity feed trigger: follows table uses follower_id, not user_id.
-- Without this, post inserts fail at runtime with:
--   column "user_id" does not exist (in on_post_created_feed)

create or replace function public.on_post_created_feed()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
begin
  if coalesce(new.is_public, false) then
    for r in
      select distinct follower_id as user_id
      from public.follows
      where following_id = new.user_id
    loop
      perform public.append_activity_feed(
        r.user_id,
        'POST_CREATED',
        jsonb_build_object(
          'postId', new.id,
          'actorUserId', new.user_id,
          'content', left(coalesce(new.content, ''), 180),
          'postType', new.post_type
        )
      );
    end loop;
  end if;

  perform public.append_activity_feed(
    new.user_id,
    'POST_CREATED',
    jsonb_build_object('postId', new.id, 'actorUserId', new.user_id, 'postType', new.post_type)
  );

  return new;
end;
$$;
