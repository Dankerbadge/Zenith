-- Make recompute outbox trigger resilient to mixed truth-table schemas.
-- Some tables expose day_key while older ones expose day (date). Direct NEW.day
-- access fails on tables that do not have that field.

create or replace function public.enqueue_recompute_outbox()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new jsonb;
  v_old jsonb;
  v_user uuid;
  v_day_key text;
  v_reason text;
  v_row_id text;
  v_updated_at text;
  v_idem text;
begin
  v_new := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  v_old := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;

  v_user := coalesce(
    nullif(v_new->>'user_id', '')::uuid,
    nullif(v_old->>'user_id', '')::uuid
  );

  v_day_key := coalesce(
    nullif(v_new->>'day_key', ''),
    nullif(v_old->>'day_key', ''),
    nullif(v_new->>'day', ''),
    nullif(v_old->>'day', '')
  );

  v_reason := tg_table_name || ':' || tg_op;
  v_row_id := coalesce(nullif(v_new->>'id', ''), nullif(v_old->>'id', ''), '');
  v_updated_at := coalesce(nullif(v_new->>'updated_at', ''), nullif(v_old->>'updated_at', ''), now()::text);
  v_idem := md5(concat_ws('|', tg_table_name, tg_op, v_row_id, v_updated_at));

  if v_user is null or v_day_key is null then
    return coalesce(new, old);
  end if;

  insert into public.recompute_outbox(user_id, day_key, reason, idempotency_key)
  values (v_user, v_day_key, v_reason, v_idem)
  on conflict (user_id, day_key, idempotency_key) do nothing;

  return coalesce(new, old);
end;
$$;
