-- Keep user_state_snapshots durable for core state, while pruning stale cache-like keys.
-- This prevents unbounded snapshot storage growth without touching user-critical history.

create index if not exists user_state_snapshots_updated_idx
  on public.user_state_snapshots (updated_at desc);
create or replace function public.prune_user_state_snapshots(p_max_age_days integer default 120)
returns table(deleted_count bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer := greatest(coalesce(p_max_age_days, 120), 14);
  v_deleted bigint := 0;
begin
  with doomed as (
    select id
    from public.user_state_snapshots
    where updated_at < (now() - make_interval(days => v_days))
      and (
        state_key like 'zenith_social_feed_cache_v1:%'
        or state_key like 'zenith_social_outbox_v1:%'
        or state_key = 'onboardingDraftV1'
        or state_key like 'challengeWizardDraftV1:%'
        or state_key = 'pendingRunReview'
        or state_key like 'zenith:projection:day:v1:%'
        or state_key = 'zenith:foodSearch:queryCache:v2'
        or state_key = 'zenith:foodRecents:v1'
      )
  )
  delete from public.user_state_snapshots uss
  using doomed
  where uss.id = doomed.id;

  get diagnostics v_deleted = row_count;
  return query select v_deleted;
end;
$$;
revoke all on function public.prune_user_state_snapshots(integer) from public;
grant execute on function public.prune_user_state_snapshots(integer) to service_role;
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception
    when others then
      null;
  end;

  begin
    if exists (
      select 1
      from information_schema.tables
      where table_schema = 'cron'
        and table_name = 'job'
    ) then
      if not exists (
        select 1 from cron.job where jobname = 'prune_user_state_snapshots_daily'
      ) then
        perform cron.schedule(
          'prune_user_state_snapshots_daily',
          '23 3 * * *',
          'select public.prune_user_state_snapshots(120);'
        );
      end if;
    end if;
  exception
    when others then
      null;
  end;
end;
$$;
