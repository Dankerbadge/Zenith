-- Fix team_challenges activity trigger for schema drift.
-- Old function referenced NEW.created_by + NEW.title, but table now uses owner on teams and challenge name.

create or replace function public.on_team_challenge_created_feed()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  actor_user_id uuid;
begin
  select t.owner_id into actor_user_id
  from public.teams t
  where t.id = new.team_id
  limit 1;

  for r in
    select tm.user_id
    from public.team_members tm
    where tm.team_id = new.team_id
  loop
    perform public.append_activity_feed(
      r.user_id,
      'CHALLENGE_CREATED',
      jsonb_build_object(
        'challengeId', new.id,
        'teamId', new.team_id,
        'actorUserId', actor_user_id,
        'title', coalesce(new.name, 'Team challenge')
      )
    );
  end loop;

  return new;
end;
$$;
