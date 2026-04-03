--
-- PostgreSQL database dump
--

\restrict z0V1yal1JfaJ9BpxcUk2upqZVMIiqEROJnvi9aKfveeiCMOiCpLG08OdpwBaSnG

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.1

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: pg_database_owner
--

CREATE SCHEMA public;


ALTER SCHEMA public OWNER TO pg_database_owner;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: pg_database_owner
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: friendship_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.friendship_status AS ENUM (
    'pending',
    'accepted',
    'blocked'
);


ALTER TYPE public.friendship_status OWNER TO postgres;

--
-- Name: group_kind; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.group_kind AS ENUM (
    'friend_group',
    'coaching_team'
);


ALTER TYPE public.group_kind OWNER TO postgres;

--
-- Name: group_role; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.group_role AS ENUM (
    'owner',
    'coach',
    'admin',
    'member'
);


ALTER TYPE public.group_role OWNER TO postgres;

--
-- Name: post_audience; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.post_audience AS ENUM (
    'friends',
    'public',
    'group'
);


ALTER TYPE public.post_audience OWNER TO postgres;

--
-- Name: team_reaction_key; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.team_reaction_key AS ENUM (
    'completed',
    'locked_in',
    'intensity',
    'strength',
    'recovery',
    'consistency',
    'progress',
    'coach_approved'
);


ALTER TYPE public.team_reaction_key OWNER TO postgres;

--
-- Name: confirm_garmin_link(text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.confirm_garmin_link(watch_install_id text, token text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  token_row public.garmin_link_tokens;
  v_handle text;
begin
  select *
  into token_row
  from public.garmin_link_tokens
  where user_id = auth.uid()
    and watch_app_install_id = watch_install_id
    and link_token = token
    and consumed_at is null
    and expires_at > now()
  order by created_at desc
  limit 1;

  if token_row.id is null then
    raise exception 'Invalid or expired link token';
  end if;

  update public.garmin_link_tokens
  set consumed_at = now()
  where id = token_row.id;

  v_handle := 'garmin_' || encode(gen_random_bytes(8), 'hex');

  insert into public.garmin_device_links (user_id, watch_app_install_id, link_handle, linked_at, last_seen_at, is_active)
  values (auth.uid(), watch_install_id, v_handle, now(), now(), true)
  on conflict (watch_app_install_id)
  do update set
    user_id = excluded.user_id,
    link_handle = excluded.link_handle,
    linked_at = now(),
    last_seen_at = now(),
    is_active = true;

  return jsonb_build_object(
    'linked', true,
    'watchAppInstallId', watch_install_id,
    'linkHandle', v_handle
  );
end;
$$;


ALTER FUNCTION public.confirm_garmin_link(watch_install_id text, token text) OWNER TO postgres;

--
-- Name: create_garmin_link_token(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.create_garmin_link_token(watch_install_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_token text;
  v_exp timestamptz;
begin
  if watch_install_id is null or length(trim(watch_install_id)) = 0 then
    raise exception 'watch_install_id is required';
  end if;

  v_token := encode(gen_random_bytes(12), 'hex');
  v_exp := now() + interval '5 minutes';

  insert into public.garmin_link_tokens (user_id, watch_app_install_id, link_token, expires_at)
  values (auth.uid(), watch_install_id, v_token, v_exp);

  return jsonb_build_object('linkToken', v_token, 'expiresAt', v_exp);
end;
$$;


ALTER FUNCTION public.create_garmin_link_token(watch_install_id text) OWNER TO postgres;

--
-- Name: decrement_follow_counts(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.decrement_follow_counts() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE public.profiles SET followers_count = followers_count - 1 WHERE id = OLD.following_id;
  UPDATE public.profiles SET following_count = following_count - 1 WHERE id = OLD.follower_id;
  RETURN OLD;
END;
$$;


ALTER FUNCTION public.decrement_follow_counts() OWNER TO postgres;

--
-- Name: decrement_post_comments(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.decrement_post_comments() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE public.posts SET comments_count = comments_count - 1 WHERE id = OLD.post_id;
  RETURN OLD;
END;
$$;


ALTER FUNCTION public.decrement_post_comments() OWNER TO postgres;

--
-- Name: decrement_post_likes(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.decrement_post_likes() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE public.posts SET likes_count = likes_count - 1 WHERE id = OLD.post_id;
  RETURN OLD;
END;
$$;


ALTER FUNCTION public.decrement_post_likes() OWNER TO postgres;

--
-- Name: evaluate_food_search_slo_alerts(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.evaluate_food_search_slo_alerts() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  window_rows integer := 0;
  p95_ms numeric := 0;
  empty_rate numeric := 0;
  error_rate numeric := 0;
  backup_stale boolean := false;
  backup_last timestamptz;
begin
  with windowed as (
    select *
    from public.food_search_metrics
    where created_at > now() - interval '15 minutes'
  )
  select
    count(*)::int,
    coalesce(percentile_disc(0.95) within group (order by duration_ms), 0),
    coalesce(avg(case when result_count = 0 then 1 else 0 end), 0),
    coalesce(avg(case when source like 'error%' then 1 else 0 end), 0)
  into window_rows, p95_ms, empty_rate, error_rate
  from windowed;

  select last_seen_at into backup_last
  from public.backend_ops_heartbeats
  where component = 'logical_backup';

  backup_stale := backup_last is null or backup_last < now() - interval '8 days';

  if window_rows >= 20 and p95_ms > 1800 then
    perform public.insert_backend_ops_alert(
      'food_search_p95_high',
      'high',
      'food_search',
      'Food search p95 latency exceeded 1800ms in last 15m',
      jsonb_build_object('p95_ms', p95_ms, 'rows', window_rows),
      30
    );
  end if;

  if window_rows >= 20 and empty_rate > 0.35 then
    perform public.insert_backend_ops_alert(
      'food_search_empty_rate_high',
      'medium',
      'food_search',
      'Food search empty-result rate exceeded 35% in last 15m',
      jsonb_build_object('empty_rate', empty_rate, 'rows', window_rows),
      30
    );
  end if;

  if window_rows >= 20 and error_rate > 0.08 then
    perform public.insert_backend_ops_alert(
      'food_search_error_rate_high',
      'high',
      'food_search',
      'Food search error rate exceeded 8% in last 15m',
      jsonb_build_object('error_rate', error_rate, 'rows', window_rows),
      15
    );
  end if;

  if backup_stale then
    perform public.insert_backend_ops_alert(
      'backup_heartbeat_stale',
      'high',
      'backup',
      'No logical backup heartbeat in last 8 days',
      jsonb_build_object('last_seen_at', backup_last),
      720
    );
  end if;

  return jsonb_build_object(
    'rows', window_rows,
    'p95_ms', p95_ms,
    'empty_rate', empty_rate,
    'error_rate', error_rate,
    'backup_last_seen', backup_last,
    'backup_stale', backup_stale
  );
end;
$$;


ALTER FUNCTION public.evaluate_food_search_slo_alerts() OWNER TO postgres;

--
-- Name: food_search_allow_request(uuid, text, integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.food_search_allow_request(p_user_id uuid, p_scope text DEFAULT 'food_search'::text, p_window_seconds integer DEFAULT 60, p_limit integer DEFAULT 120) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  bucket_start timestamptz;
  next_count integer;
begin
  if p_user_id is null then
    return false;
  end if;

  if p_window_seconds < 1 then
    p_window_seconds := 60;
  end if;

  if p_limit < 1 then
    p_limit := 60;
  end if;

  bucket_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.food_search_rate_limit_state (user_id, scope, window_seconds, window_start, request_count, updated_at)
  values (p_user_id, p_scope, p_window_seconds, bucket_start, 1, now())
  on conflict (user_id, scope, window_seconds, window_start)
  do update set
    request_count = public.food_search_rate_limit_state.request_count + 1,
    updated_at = now()
  returning request_count into next_count;

  return next_count <= p_limit;
end;
$$;


ALTER FUNCTION public.food_search_allow_request(p_user_id uuid, p_scope text, p_window_seconds integer, p_limit integer) OWNER TO postgres;

--
-- Name: food_search_maintenance_tick(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.food_search_maintenance_tick() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  a integer := 0;
  b integer := 0;
  c integer := 0;
  alerts jsonb := '{}'::jsonb;
begin
  a := public.purge_expired_food_search_cache();
  b := public.purge_expired_food_search_prefix_cache();
  c := public.purge_old_food_search_rate_limit_state();
  alerts := public.evaluate_food_search_slo_alerts();

  perform public.record_backend_ops_heartbeat(
    'food_search_maintenance',
    jsonb_build_object('purged_cache', a, 'purged_prefix', b, 'purged_rate_limit', c)
  );

  return jsonb_build_object(
    'purged_cache', a,
    'purged_prefix', b,
    'purged_rate_limit', c,
    'alerts', alerts
  );
end;
$$;


ALTER FUNCTION public.food_search_maintenance_tick() OWNER TO postgres;

--
-- Name: get_garmin_entitlement(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_garmin_entitlement() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with profile as (
    select
      coalesce(p.is_premium, false) as is_premium,
      p.premium_until
    from public.profiles p
    where p.id = auth.uid()
    limit 1
  )
  select jsonb_build_object(
    'isPremium', coalesce((select is_premium from profile), false),
    'productTier', case when coalesce((select is_premium from profile), false) then 'pro' else 'free' end,
    'expiresAt', (select premium_until from profile),
    'serverTimestamp', now(),
    'featuresEnabled', case
      when coalesce((select is_premium from profile), false)
        then jsonb_build_array(
          'garmin_recording_basic',
          'garmin_live_metrics_basic',
          'garmin_sync_summary',
          'garmin_analytics_advanced',
          'garmin_trends_deep',
          'garmin_coaching_insights',
          'garmin_config_profiles'
        )
      else jsonb_build_array(
          'garmin_recording_basic',
          'garmin_live_metrics_basic',
          'garmin_sync_summary'
      )
    end
  );
$$;


ALTER FUNCTION public.get_garmin_entitlement() OWNER TO postgres;

--
-- Name: increment_follow_counts(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.increment_follow_counts() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE public.profiles SET followers_count = followers_count + 1 WHERE id = NEW.following_id;
  UPDATE public.profiles SET following_count = following_count + 1 WHERE id = NEW.follower_id;
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.increment_follow_counts() OWNER TO postgres;

--
-- Name: increment_post_comments(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.increment_post_comments() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE public.posts SET comments_count = comments_count + 1 WHERE id = NEW.post_id;
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.increment_post_comments() OWNER TO postgres;

--
-- Name: increment_post_likes(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.increment_post_likes() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE public.posts SET likes_count = likes_count + 1 WHERE id = NEW.post_id;
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.increment_post_likes() OWNER TO postgres;

--
-- Name: insert_backend_ops_alert(text, text, text, text, jsonb, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.insert_backend_ops_alert(p_alert_key text, p_severity text, p_source text, p_message text, p_details jsonb DEFAULT '{}'::jsonb, p_dedupe_minutes integer DEFAULT 60) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if exists (
    select 1
    from public.backend_ops_alerts
    where alert_key = p_alert_key
      and triggered_at > now() - make_interval(mins => greatest(1, p_dedupe_minutes))
  ) then
    return;
  end if;

  insert into public.backend_ops_alerts (alert_key, severity, source, message, details)
  values (p_alert_key, p_severity, p_source, p_message, coalesce(p_details, '{}'::jsonb));
end;
$$;


ALTER FUNCTION public.insert_backend_ops_alert(p_alert_key text, p_severity text, p_source text, p_message text, p_details jsonb, p_dedupe_minutes integer) OWNER TO postgres;

--
-- Name: is_group_member(uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.is_group_member(p_group_id uuid, p_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists(
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = p_user_id
  );
$$;


ALTER FUNCTION public.is_group_member(p_group_id uuid, p_user_id uuid) OWNER TO postgres;

--
-- Name: purge_expired_food_search_cache(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.purge_expired_food_search_cache() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  deleted_count integer := 0;
begin
  delete from public.food_search_cache
  where expires_at <= now();
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;


ALTER FUNCTION public.purge_expired_food_search_cache() OWNER TO postgres;

--
-- Name: purge_expired_food_search_prefix_cache(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.purge_expired_food_search_prefix_cache() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  deleted_count integer := 0;
begin
  delete from public.food_search_prefix_cache
  where expires_at <= now();
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;


ALTER FUNCTION public.purge_expired_food_search_prefix_cache() OWNER TO postgres;

--
-- Name: purge_old_food_search_rate_limit_state(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.purge_old_food_search_rate_limit_state() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  deleted_count integer := 0;
begin
  delete from public.food_search_rate_limit_state
  where updated_at < now() - interval '2 days';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;


ALTER FUNCTION public.purge_old_food_search_rate_limit_state() OWNER TO postgres;

--
-- Name: record_backend_ops_heartbeat(text, jsonb); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.record_backend_ops_heartbeat(p_component text, p_meta jsonb DEFAULT '{}'::jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if coalesce(trim(p_component), '') = '' then
    return;
  end if;

  insert into public.backend_ops_heartbeats (component, last_seen_at, meta)
  values (trim(p_component), now(), coalesce(p_meta, '{}'::jsonb))
  on conflict (component)
  do update set
    last_seen_at = excluded.last_seen_at,
    meta = excluded.meta;
end;
$$;


ALTER FUNCTION public.record_backend_ops_heartbeat(p_component text, p_meta jsonb) OWNER TO postgres;

--
-- Name: set_food_search_cache_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.set_food_search_cache_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION public.set_food_search_cache_updated_at() OWNER TO postgres;

--
-- Name: set_food_search_prefix_cache_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.set_food_search_prefix_cache_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION public.set_food_search_prefix_cache_updated_at() OWNER TO postgres;

--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.set_updated_at() OWNER TO postgres;

--
-- Name: trim_food_user_query_profile(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.trim_food_user_query_profile(p_user_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  deleted_count integer := 0;
begin
  delete from public.food_user_query_profile p
  where p.user_id = p_user_id
    and p.token in (
      select token
      from public.food_user_query_profile
      where user_id = p_user_id
      order by weight desc, last_seen_at desc
      offset 80
    );
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;


ALTER FUNCTION public.trim_food_user_query_profile(p_user_id uuid) OWNER TO postgres;

--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_updated_at_column() OWNER TO postgres;

--
-- Name: upsert_garmin_workout_summary(jsonb); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.upsert_garmin_workout_summary(workout jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_local_session_id text;
begin
  v_local_session_id := workout->>'localSessionId';
  if v_local_session_id is null or length(trim(v_local_session_id)) = 0 then
    raise exception 'localSessionId is required';
  end if;

  insert into public.garmin_workout_summaries (
    user_id,
    watch_app_install_id,
    local_session_id,
    sport_type,
    start_timestamp,
    end_timestamp,
    elapsed_time_seconds,
    distance_meters,
    avg_heart_rate,
    calories,
    fit_file_saved,
    device_model,
    source,
    payload
  )
  values (
    auth.uid(),
    workout->>'watchAppInstallId',
    v_local_session_id,
    coalesce(workout->>'sportType', 'unknown'),
    (workout->>'startTimestamp')::timestamptz,
    (workout->>'endTimestamp')::timestamptz,
    coalesce((workout->>'elapsedTimeSeconds')::int, 0),
    nullif(workout->>'distanceMeters', '')::double precision,
    nullif(workout->>'avgHeartRate', '')::int,
    nullif(workout->>'calories', '')::double precision,
    coalesce((workout->>'fitFileSaved')::boolean, false),
    workout->>'deviceModel',
    coalesce(workout->>'source', 'garmin_watch'),
    workout
  )
  on conflict (local_session_id)
  do update set
    user_id = excluded.user_id,
    watch_app_install_id = excluded.watch_app_install_id,
    sport_type = excluded.sport_type,
    start_timestamp = excluded.start_timestamp,
    end_timestamp = excluded.end_timestamp,
    elapsed_time_seconds = excluded.elapsed_time_seconds,
    distance_meters = excluded.distance_meters,
    avg_heart_rate = excluded.avg_heart_rate,
    calories = excluded.calories,
    fit_file_saved = excluded.fit_file_saved,
    device_model = excluded.device_model,
    source = excluded.source,
    payload = excluded.payload,
    updated_at = now();

  return jsonb_build_object('upserted', true, 'localSessionId', v_local_session_id);
end;
$$;


ALTER FUNCTION public.upsert_garmin_workout_summary(workout jsonb) OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: activity_feed; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.activity_feed (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid,
    activity_type text NOT NULL,
    actor_id uuid,
    post_id uuid,
    team_id uuid,
    is_read boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.activity_feed OWNER TO postgres;

--
-- Name: backend_ops_alerts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.backend_ops_alerts (
    id bigint NOT NULL,
    alert_key text NOT NULL,
    severity text NOT NULL,
    source text NOT NULL,
    message text NOT NULL,
    details jsonb,
    triggered_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.backend_ops_alerts OWNER TO postgres;

--
-- Name: backend_ops_alerts_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.backend_ops_alerts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.backend_ops_alerts_id_seq OWNER TO postgres;

--
-- Name: backend_ops_alerts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.backend_ops_alerts_id_seq OWNED BY public.backend_ops_alerts.id;


--
-- Name: backend_ops_heartbeats; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.backend_ops_heartbeats (
    component text NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    meta jsonb
);


ALTER TABLE public.backend_ops_heartbeats OWNER TO postgres;

--
-- Name: comments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.comments (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid,
    post_id uuid,
    content text NOT NULL,
    likes_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.comments OWNER TO postgres;

--
-- Name: follows; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.follows (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    follower_id uuid,
    following_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT follows_check CHECK ((follower_id <> following_id))
);


ALTER TABLE public.follows OWNER TO postgres;

--
-- Name: food_search_cache; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.food_search_cache (
    query_key text NOT NULL,
    query text NOT NULL,
    country text NOT NULL,
    admin text,
    language text NOT NULL,
    results jsonb NOT NULL,
    source text DEFAULT 'off_usda'::text NOT NULL,
    hit_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL
);


ALTER TABLE public.food_search_cache OWNER TO postgres;

--
-- Name: food_search_metrics; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.food_search_metrics (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    query text NOT NULL,
    country text NOT NULL,
    admin text,
    language text NOT NULL,
    source text NOT NULL,
    duration_ms integer NOT NULL,
    result_count integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.food_search_metrics OWNER TO postgres;

--
-- Name: food_search_metrics_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.food_search_metrics_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.food_search_metrics_id_seq OWNER TO postgres;

--
-- Name: food_search_metrics_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.food_search_metrics_id_seq OWNED BY public.food_search_metrics.id;


--
-- Name: food_search_prefix_cache; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.food_search_prefix_cache (
    prefix_key text NOT NULL,
    prefix text NOT NULL,
    country text NOT NULL,
    admin text,
    language text NOT NULL,
    results jsonb NOT NULL,
    hit_count integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL
);


ALTER TABLE public.food_search_prefix_cache OWNER TO postgres;

--
-- Name: food_search_rate_limit_state; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.food_search_rate_limit_state (
    user_id uuid NOT NULL,
    scope text NOT NULL,
    window_seconds integer NOT NULL,
    window_start timestamp with time zone NOT NULL,
    request_count integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.food_search_rate_limit_state OWNER TO postgres;

--
-- Name: food_user_query_profile; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.food_user_query_profile (
    user_id uuid NOT NULL,
    token text NOT NULL,
    weight integer DEFAULT 0 NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.food_user_query_profile OWNER TO postgres;

--
-- Name: friendships; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.friendships (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    requester_id uuid,
    addressee_id uuid,
    status public.friendship_status DEFAULT 'pending'::public.friendship_status NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT friendships_check CHECK ((requester_id <> addressee_id))
);


ALTER TABLE public.friendships OWNER TO postgres;

--
-- Name: garmin_device_links; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.garmin_device_links (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    watch_app_install_id text NOT NULL,
    link_handle text NOT NULL,
    linked_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.garmin_device_links OWNER TO postgres;

--
-- Name: garmin_entitlements; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.garmin_entitlements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    premium_sync_enabled boolean DEFAULT false,
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.garmin_entitlements OWNER TO postgres;

--
-- Name: garmin_link_tokens; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.garmin_link_tokens (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    watch_app_install_id text NOT NULL,
    link_token text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.garmin_link_tokens OWNER TO postgres;

--
-- Name: garmin_workout_summaries; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.garmin_workout_summaries (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    watch_app_install_id text,
    local_session_id text NOT NULL,
    sport_type text NOT NULL,
    start_timestamp timestamp with time zone NOT NULL,
    end_timestamp timestamp with time zone NOT NULL,
    elapsed_time_seconds integer NOT NULL,
    distance_meters double precision,
    avg_heart_rate integer,
    calories double precision,
    fit_file_saved boolean DEFAULT false NOT NULL,
    device_model text,
    source text DEFAULT 'garmin_watch'::text NOT NULL,
    payload jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT garmin_workout_summaries_elapsed_time_seconds_check CHECK ((elapsed_time_seconds >= 0))
);


ALTER TABLE public.garmin_workout_summaries OWNER TO postgres;

--
-- Name: garmin_workouts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.garmin_workouts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    garmin_device_id text,
    garmin_activity_id text,
    workout_type text NOT NULL,
    started_at timestamp with time zone NOT NULL,
    duration_sec integer NOT NULL,
    distance_meters double precision,
    calories integer,
    avg_hr integer,
    max_hr integer,
    raw jsonb,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.garmin_workouts OWNER TO postgres;

--
-- Name: group_members; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.group_members (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    group_id uuid,
    user_id uuid,
    role public.group_role DEFAULT 'member'::public.group_role NOT NULL,
    joined_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.group_members OWNER TO postgres;

--
-- Name: groups; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.groups (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    kind public.group_kind NOT NULL,
    name text NOT NULL,
    description text,
    avatar_url text,
    is_public boolean DEFAULT false,
    join_code text,
    owner_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.groups OWNER TO postgres;

--
-- Name: leaderboards; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.leaderboards (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    leaderboard_type text NOT NULL,
    period_start timestamp with time zone NOT NULL,
    period_end timestamp with time zone NOT NULL,
    rankings jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.leaderboards OWNER TO postgres;

--
-- Name: likes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.likes (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid,
    post_id uuid,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.likes OWNER TO postgres;

--
-- Name: posts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.posts (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid,
    content text NOT NULL,
    post_type text NOT NULL,
    data jsonb,
    image_url text,
    likes_count integer DEFAULT 0,
    comments_count integer DEFAULT 0,
    is_public boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    audience public.post_audience DEFAULT 'public'::public.post_audience,
    group_id uuid
);


ALTER TABLE public.posts OWNER TO postgres;

--
-- Name: profiles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    email text NOT NULL,
    username text,
    display_name text,
    avatar_url text,
    bio text,
    total_xp integer DEFAULT 0,
    current_rank text DEFAULT 'Iron IV'::text,
    winning_days integer DEFAULT 0,
    total_workouts integer DEFAULT 0,
    followers_count integer DEFAULT 0,
    following_count integer DEFAULT 0,
    posts_count integer DEFAULT 0,
    is_premium boolean DEFAULT false,
    premium_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.profiles OWNER TO postgres;

--
-- Name: reactions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.reactions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    post_id uuid,
    user_id uuid,
    emoji text,
    reaction_key public.team_reaction_key,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT reactions_check CHECK ((((emoji IS NOT NULL) AND (reaction_key IS NULL)) OR ((emoji IS NULL) AND (reaction_key IS NOT NULL))))
);


ALTER TABLE public.reactions OWNER TO postgres;

--
-- Name: team_challenges; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.team_challenges (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    team_id uuid,
    name text NOT NULL,
    description text,
    challenge_type text NOT NULL,
    goal_value integer NOT NULL,
    current_value integer DEFAULT 0,
    start_date timestamp with time zone NOT NULL,
    end_date timestamp with time zone NOT NULL,
    is_active boolean DEFAULT true,
    is_completed boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.team_challenges OWNER TO postgres;

--
-- Name: team_members; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.team_members (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    team_id uuid,
    user_id uuid,
    role text DEFAULT 'member'::text,
    xp_contributed integer DEFAULT 0,
    workouts_contributed integer DEFAULT 0,
    joined_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.team_members OWNER TO postgres;

--
-- Name: teams; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.teams (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    description text,
    avatar_url text,
    team_type text NOT NULL,
    is_public boolean DEFAULT true,
    max_members integer DEFAULT 50,
    total_xp integer DEFAULT 0,
    members_count integer DEFAULT 0,
    owner_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.teams OWNER TO postgres;

--
-- Name: backend_ops_alerts id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.backend_ops_alerts ALTER COLUMN id SET DEFAULT nextval('public.backend_ops_alerts_id_seq'::regclass);


--
-- Name: food_search_metrics id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.food_search_metrics ALTER COLUMN id SET DEFAULT nextval('public.food_search_metrics_id_seq'::regclass);


--
-- Data for Name: activity_feed; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.activity_feed (id, user_id, activity_type, actor_id, post_id, team_id, is_read, created_at) FROM stdin;
\.


--
-- Data for Name: backend_ops_alerts; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.backend_ops_alerts (id, alert_key, severity, source, message, details, triggered_at) FROM stdin;
1	backup_heartbeat_stale	high	backup	No logical backup heartbeat in last 8 days	{"last_seen_at": null}	2026-02-11 07:10:00.079387+00
\.


--
-- Data for Name: backend_ops_heartbeats; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.backend_ops_heartbeats (component, last_seen_at, meta) FROM stdin;
food_search_maintenance	2026-02-11 07:26:08.538884+00	{"purged_cache": 0, "purged_prefix": 0, "purged_rate_limit": 0}
\.


--
-- Data for Name: comments; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.comments (id, user_id, post_id, content, likes_count, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: follows; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.follows (id, follower_id, following_id, created_at) FROM stdin;
\.


--
-- Data for Name: food_search_cache; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.food_search_cache (query_key, query, country, admin, language, results, source, hit_count, created_at, updated_at, expires_at) FROM stdin;
\.


--
-- Data for Name: food_search_metrics; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.food_search_metrics (id, user_id, query, country, admin, language, source, duration_ms, result_count, created_at) FROM stdin;
\.


--
-- Data for Name: food_search_prefix_cache; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.food_search_prefix_cache (prefix_key, prefix, country, admin, language, results, hit_count, updated_at, expires_at) FROM stdin;
\.


--
-- Data for Name: food_search_rate_limit_state; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.food_search_rate_limit_state (user_id, scope, window_seconds, window_start, request_count, updated_at) FROM stdin;
\.


--
-- Data for Name: food_user_query_profile; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.food_user_query_profile (user_id, token, weight, last_seen_at) FROM stdin;
\.


--
-- Data for Name: friendships; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.friendships (id, requester_id, addressee_id, status, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: garmin_device_links; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.garmin_device_links (id, user_id, watch_app_install_id, link_handle, linked_at, last_seen_at, is_active, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: garmin_entitlements; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.garmin_entitlements (id, user_id, premium_sync_enabled, updated_at) FROM stdin;
\.


--
-- Data for Name: garmin_link_tokens; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.garmin_link_tokens (id, user_id, watch_app_install_id, link_token, expires_at, consumed_at, created_at) FROM stdin;
\.


--
-- Data for Name: garmin_workout_summaries; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.garmin_workout_summaries (id, user_id, watch_app_install_id, local_session_id, sport_type, start_timestamp, end_timestamp, elapsed_time_seconds, distance_meters, avg_heart_rate, calories, fit_file_saved, device_model, source, payload, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: garmin_workouts; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.garmin_workouts (id, user_id, garmin_device_id, garmin_activity_id, workout_type, started_at, duration_sec, distance_meters, calories, avg_hr, max_hr, raw, created_at) FROM stdin;
\.


--
-- Data for Name: group_members; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.group_members (id, group_id, user_id, role, joined_at) FROM stdin;
\.


--
-- Data for Name: groups; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.groups (id, kind, name, description, avatar_url, is_public, join_code, owner_id, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: leaderboards; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.leaderboards (id, leaderboard_type, period_start, period_end, rankings, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: likes; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.likes (id, user_id, post_id, created_at) FROM stdin;
\.


--
-- Data for Name: posts; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.posts (id, user_id, content, post_type, data, image_url, likes_count, comments_count, is_public, created_at, updated_at, audience, group_id) FROM stdin;
\.


--
-- Data for Name: profiles; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.profiles (id, email, username, display_name, avatar_url, bio, total_xp, current_rank, winning_days, total_workouts, followers_count, following_count, posts_count, is_premium, premium_until, created_at, updated_at) FROM stdin;
8e24306e-8c79-49fa-aa4a-eebaf4707ba4	elizabethgolderer@gmail.com	\N	Ellie	\N	\N	0	Iron IV	0	0	0	0	0	f	\N	2026-02-10 16:56:08.330301+00	2026-02-10 16:56:07.762+00
\.


--
-- Data for Name: reactions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.reactions (id, post_id, user_id, emoji, reaction_key, created_at) FROM stdin;
\.


--
-- Data for Name: team_challenges; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.team_challenges (id, team_id, name, description, challenge_type, goal_value, current_value, start_date, end_date, is_active, is_completed, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: team_members; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.team_members (id, team_id, user_id, role, xp_contributed, workouts_contributed, joined_at) FROM stdin;
\.


--
-- Data for Name: teams; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.teams (id, name, description, avatar_url, team_type, is_public, max_members, total_xp, members_count, owner_id, created_at, updated_at) FROM stdin;
\.


--
-- Name: backend_ops_alerts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.backend_ops_alerts_id_seq', 1, true);


--
-- Name: food_search_metrics_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.food_search_metrics_id_seq', 1, false);


--
-- Name: activity_feed activity_feed_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.activity_feed
    ADD CONSTRAINT activity_feed_pkey PRIMARY KEY (id);


--
-- Name: backend_ops_alerts backend_ops_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.backend_ops_alerts
    ADD CONSTRAINT backend_ops_alerts_pkey PRIMARY KEY (id);


--
-- Name: backend_ops_heartbeats backend_ops_heartbeats_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.backend_ops_heartbeats
    ADD CONSTRAINT backend_ops_heartbeats_pkey PRIMARY KEY (component);


--
-- Name: comments comments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_pkey PRIMARY KEY (id);


--
-- Name: follows follows_follower_id_following_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_follower_id_following_id_key UNIQUE (follower_id, following_id);


--
-- Name: follows follows_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_pkey PRIMARY KEY (id);


--
-- Name: food_search_cache food_search_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.food_search_cache
    ADD CONSTRAINT food_search_cache_pkey PRIMARY KEY (query_key);


--
-- Name: food_search_metrics food_search_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.food_search_metrics
    ADD CONSTRAINT food_search_metrics_pkey PRIMARY KEY (id);


--
-- Name: food_search_prefix_cache food_search_prefix_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.food_search_prefix_cache
    ADD CONSTRAINT food_search_prefix_cache_pkey PRIMARY KEY (prefix_key);


--
-- Name: food_search_rate_limit_state food_search_rate_limit_state_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.food_search_rate_limit_state
    ADD CONSTRAINT food_search_rate_limit_state_pkey PRIMARY KEY (user_id, scope, window_seconds, window_start);


--
-- Name: food_user_query_profile food_user_query_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.food_user_query_profile
    ADD CONSTRAINT food_user_query_profile_pkey PRIMARY KEY (user_id, token);


--
-- Name: friendships friendships_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.friendships
    ADD CONSTRAINT friendships_pkey PRIMARY KEY (id);


--
-- Name: friendships friendships_requester_id_addressee_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.friendships
    ADD CONSTRAINT friendships_requester_id_addressee_id_key UNIQUE (requester_id, addressee_id);


--
-- Name: garmin_device_links garmin_device_links_link_handle_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.garmin_device_links
    ADD CONSTRAINT garmin_device_links_link_handle_key UNIQUE (link_handle);


--
-- Name: garmin_device_links garmin_device_links_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.garmin_device_links
    ADD CONSTRAINT garmin_device_links_pkey PRIMARY KEY (id);


--
-- Name: garmin_device_links garmin_device_links_watch_app_install_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.garmin_device_links
    ADD CONSTRAINT garmin_device_links_watch_app_install_id_key UNIQUE (watch_app_install_id);


--
-- Name: garmin_entitlements garmin_entitlements_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.garmin_entitlements
    ADD CONSTRAINT garmin_entitlements_pkey PRIMARY KEY (id);


--
-- Name: garmin_entitlements garmin_entitlements_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.garmin_entitlements
    ADD CONSTRAINT garmin_entitlements_user_id_key UNIQUE (user_id);


--
-- Name: garmin_link_tokens garmin_link_tokens_link_token_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.garmin_link_tokens
    ADD CONSTRAINT garmin_link_tokens_link_token_key UNIQUE (link_token);


--
-- Name: garmin_link_tokens garmin_link_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.garmin_link_tokens
    ADD CONSTRAINT garmin_link_tokens_pkey PRIMARY KEY (id);


--
-- Name: garmin_workout_summaries garmin_workout_summaries_local_session_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.garmin_workout_summaries
    ADD CONSTRAINT garmin_workout_summaries_local_session_id_key UNIQUE (local_session_id);


--
-- Name: garmin_workout_summaries garmin_workout_summaries_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.garmin_workout_summaries
    ADD CONSTRAINT garmin_workout_summaries_pkey PRIMARY KEY (id);


--
-- Name: garmin_workouts garmin_workouts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.garmin_workouts
    ADD CONSTRAINT garmin_workouts_pkey PRIMARY KEY (id);


--
-- Name: garmin_workouts garmin_workouts_user_id_garmin_activity_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.garmin_workouts
    ADD CONSTRAINT garmin_workouts_user_id_garmin_activity_id_key UNIQUE (user_id, garmin_activity_id);


--
-- Name: group_members group_members_group_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.group_members
    ADD CONSTRAINT group_members_group_id_user_id_key UNIQUE (group_id, user_id);


--
-- Name: group_members group_members_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.group_members
    ADD CONSTRAINT group_members_pkey PRIMARY KEY (id);


--
-- Name: groups groups_join_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_join_code_key UNIQUE (join_code);


--
-- Name: groups groups_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_pkey PRIMARY KEY (id);


--
-- Name: leaderboards leaderboards_leaderboard_type_period_start_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.leaderboards
    ADD CONSTRAINT leaderboards_leaderboard_type_period_start_key UNIQUE (leaderboard_type, period_start);


--
-- Name: leaderboards leaderboards_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.leaderboards
    ADD CONSTRAINT leaderboards_pkey PRIMARY KEY (id);


--
-- Name: likes likes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.likes
    ADD CONSTRAINT likes_pkey PRIMARY KEY (id);


--
-- Name: likes likes_user_id_post_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.likes
    ADD CONSTRAINT likes_user_id_post_id_key UNIQUE (user_id, post_id);


--
-- Name: posts posts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_email_key UNIQUE (email);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_username_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_username_key UNIQUE (username);


--
-- Name: reactions reactions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reactions
    ADD CONSTRAINT reactions_pkey PRIMARY KEY (id);


--
-- Name: team_challenges team_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.team_challenges
    ADD CONSTRAINT team_challenges_pkey PRIMARY KEY (id);


--
-- Name: team_members team_members_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_pkey PRIMARY KEY (id);


--
-- Name: team_members team_members_team_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_team_id_user_id_key UNIQUE (team_id, user_id);


--
-- Name: teams teams_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (id);


--
-- Name: backend_ops_alerts_key_time_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX backend_ops_alerts_key_time_idx ON public.backend_ops_alerts USING btree (alert_key, triggered_at DESC);


--
-- Name: backend_ops_alerts_triggered_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX backend_ops_alerts_triggered_idx ON public.backend_ops_alerts USING btree (triggered_at DESC);


--
-- Name: food_search_cache_expires_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX food_search_cache_expires_idx ON public.food_search_cache USING btree (expires_at);


--
-- Name: food_search_cache_query_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX food_search_cache_query_idx ON public.food_search_cache USING btree (query, country, language);


--
-- Name: food_search_metrics_created_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX food_search_metrics_created_idx ON public.food_search_metrics USING btree (created_at DESC);


--
-- Name: food_search_metrics_locale_created_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX food_search_metrics_locale_created_idx ON public.food_search_metrics USING btree (country, language, created_at DESC);


--
-- Name: food_search_metrics_user_created_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX food_search_metrics_user_created_idx ON public.food_search_metrics USING btree (user_id, created_at DESC);


--
-- Name: food_search_prefix_cache_expires_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX food_search_prefix_cache_expires_idx ON public.food_search_prefix_cache USING btree (expires_at);


--
-- Name: food_search_prefix_cache_prefix_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX food_search_prefix_cache_prefix_idx ON public.food_search_prefix_cache USING btree (prefix, country, language);


--
-- Name: food_search_rate_limit_state_updated_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX food_search_rate_limit_state_updated_idx ON public.food_search_rate_limit_state USING btree (updated_at DESC);


--
-- Name: food_user_query_profile_user_weight_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX food_user_query_profile_user_weight_idx ON public.food_user_query_profile USING btree (user_id, weight DESC, last_seen_at DESC);


--
-- Name: idx_activity_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_activity_created ON public.activity_feed USING btree (created_at DESC);


--
-- Name: idx_activity_feed_actor; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_activity_feed_actor ON public.activity_feed USING btree (actor_id);


--
-- Name: idx_activity_feed_post; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_activity_feed_post ON public.activity_feed USING btree (post_id);


--
-- Name: idx_activity_feed_team; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_activity_feed_team ON public.activity_feed USING btree (team_id);


--
-- Name: idx_activity_unread; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_activity_unread ON public.activity_feed USING btree (user_id, is_read);


--
-- Name: idx_activity_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_activity_user ON public.activity_feed USING btree (user_id);


--
-- Name: idx_comments_post; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_comments_post ON public.comments USING btree (post_id);


--
-- Name: idx_comments_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_comments_user ON public.comments USING btree (user_id);


--
-- Name: idx_follows_follower; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_follows_follower ON public.follows USING btree (follower_id);


--
-- Name: idx_follows_following; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_follows_following ON public.follows USING btree (following_id);


--
-- Name: idx_friendships_addressee; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_friendships_addressee ON public.friendships USING btree (addressee_id);


--
-- Name: idx_friendships_requester; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_friendships_requester ON public.friendships USING btree (requester_id);


--
-- Name: idx_friendships_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_friendships_status ON public.friendships USING btree (status);


--
-- Name: idx_garmin_device_links_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_garmin_device_links_active ON public.garmin_device_links USING btree (is_active);


--
-- Name: idx_garmin_device_links_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_garmin_device_links_user ON public.garmin_device_links USING btree (user_id);


--
-- Name: idx_garmin_link_tokens_expiry; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_garmin_link_tokens_expiry ON public.garmin_link_tokens USING btree (expires_at);


--
-- Name: idx_garmin_link_tokens_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_garmin_link_tokens_user ON public.garmin_link_tokens USING btree (user_id);


--
-- Name: idx_garmin_workouts_start; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_garmin_workouts_start ON public.garmin_workout_summaries USING btree (start_timestamp DESC);


--
-- Name: idx_garmin_workouts_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_garmin_workouts_user ON public.garmin_workout_summaries USING btree (user_id);


--
-- Name: idx_group_members_group; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_group_members_group ON public.group_members USING btree (group_id);


--
-- Name: idx_group_members_role; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_group_members_role ON public.group_members USING btree (role);


--
-- Name: idx_group_members_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_group_members_user ON public.group_members USING btree (user_id);


--
-- Name: idx_groups_kind; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_groups_kind ON public.groups USING btree (kind);


--
-- Name: idx_groups_owner; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_groups_owner ON public.groups USING btree (owner_id);


--
-- Name: idx_groups_public; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_groups_public ON public.groups USING btree (is_public);


--
-- Name: idx_likes_post; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_likes_post ON public.likes USING btree (post_id);


--
-- Name: idx_likes_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_likes_user ON public.likes USING btree (user_id);


--
-- Name: idx_posts_audience; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_posts_audience ON public.posts USING btree (audience);


--
-- Name: idx_posts_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_posts_created ON public.posts USING btree (created_at DESC);


--
-- Name: idx_posts_group; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_posts_group ON public.posts USING btree (group_id);


--
-- Name: idx_posts_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_posts_type ON public.posts USING btree (post_type);


--
-- Name: idx_posts_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_posts_user ON public.posts USING btree (user_id);


--
-- Name: idx_profiles_total_xp; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_profiles_total_xp ON public.profiles USING btree (total_xp DESC);


--
-- Name: idx_profiles_username; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_profiles_username ON public.profiles USING btree (username);


--
-- Name: idx_reactions_post; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_reactions_post ON public.reactions USING btree (post_id);


--
-- Name: idx_reactions_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_reactions_user ON public.reactions USING btree (user_id);


--
-- Name: idx_team_challenges_team; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_team_challenges_team ON public.team_challenges USING btree (team_id);


--
-- Name: idx_team_members_team; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_team_members_team ON public.team_members USING btree (team_id);


--
-- Name: idx_team_members_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_team_members_user ON public.team_members USING btree (user_id);


--
-- Name: idx_teams_owner; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_teams_owner ON public.teams USING btree (owner_id);


--
-- Name: idx_teams_public; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_teams_public ON public.teams USING btree (is_public);


--
-- Name: idx_teams_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_teams_type ON public.teams USING btree (team_type);


--
-- Name: uq_reactions_emoji; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_reactions_emoji ON public.reactions USING btree (post_id, user_id, emoji) WHERE (emoji IS NOT NULL);


--
-- Name: uq_reactions_team_one_per_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_reactions_team_one_per_user ON public.reactions USING btree (post_id, user_id) WHERE (reaction_key IS NOT NULL);


--
-- Name: food_search_cache food_search_cache_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER food_search_cache_set_updated_at BEFORE UPDATE ON public.food_search_cache FOR EACH ROW EXECUTE FUNCTION public.set_food_search_cache_updated_at();


--
-- Name: food_search_prefix_cache food_search_prefix_cache_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER food_search_prefix_cache_set_updated_at BEFORE UPDATE ON public.food_search_prefix_cache FOR EACH ROW EXECUTE FUNCTION public.set_food_search_prefix_cache_updated_at();


--
-- Name: comments on_comment_added; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER on_comment_added AFTER INSERT ON public.comments FOR EACH ROW EXECUTE FUNCTION public.increment_post_comments();


--
-- Name: comments on_comment_removed; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER on_comment_removed AFTER DELETE ON public.comments FOR EACH ROW EXECUTE FUNCTION public.decrement_post_comments();


--
-- Name: follows on_follow_added; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER on_follow_added AFTER INSERT ON public.follows FOR EACH ROW EXECUTE FUNCTION public.increment_follow_counts();


--
-- Name: follows on_follow_removed; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER on_follow_removed AFTER DELETE ON public.follows FOR EACH ROW EXECUTE FUNCTION public.decrement_follow_counts();


--
-- Name: likes on_like_added; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER on_like_added AFTER INSERT ON public.likes FOR EACH ROW EXECUTE FUNCTION public.increment_post_likes();


--
-- Name: likes on_like_removed; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER on_like_removed AFTER DELETE ON public.likes FOR EACH ROW EXECUTE FUNCTION public.decrement_post_likes();


--
-- Name: garmin_device_links trg_garmin_device_links_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_garmin_device_links_updated_at BEFORE UPDATE ON public.garmin_device_links FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: garmin_workout_summaries trg_garmin_workouts_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_garmin_workouts_updated_at BEFORE UPDATE ON public.garmin_workout_summaries FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: comments update_comments_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_comments_updated_at BEFORE UPDATE ON public.comments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: friendships update_friendships_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_friendships_updated_at BEFORE UPDATE ON public.friendships FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: groups update_groups_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_groups_updated_at BEFORE UPDATE ON public.groups FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: posts update_posts_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_posts_updated_at BEFORE UPDATE ON public.posts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: profiles update_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: teams update_teams_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_teams_updated_at BEFORE UPDATE ON public.teams FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: activity_feed activity_feed_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.activity_feed
    ADD CONSTRAINT activity_feed_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: activity_feed activity_feed_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.activity_feed
    ADD CONSTRAINT activity_feed_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: activity_feed activity_feed_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.activity_feed
    ADD CONSTRAINT activity_feed_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: activity_feed activity_feed_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.activity_feed
    ADD CONSTRAINT activity_feed_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: comments comments_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: comments comments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: follows follows_follower_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_follower_id_fkey FOREIGN KEY (follower_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: follows follows_following_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_following_id_fkey FOREIGN KEY (following_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: food_search_metrics food_search_metrics_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.food_search_metrics
    ADD CONSTRAINT food_search_metrics_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: food_search_rate_limit_state food_search_rate_limit_state_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.food_search_rate_limit_state
    ADD CONSTRAINT food_search_rate_limit_state_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: food_user_query_profile food_user_query_profile_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.food_user_query_profile
    ADD CONSTRAINT food_user_query_profile_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: friendships friendships_addressee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.friendships
    ADD CONSTRAINT friendships_addressee_id_fkey FOREIGN KEY (addressee_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: friendships friendships_requester_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.friendships
    ADD CONSTRAINT friendships_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: garmin_device_links garmin_device_links_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.garmin_device_links
    ADD CONSTRAINT garmin_device_links_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: garmin_entitlements garmin_entitlements_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.garmin_entitlements
    ADD CONSTRAINT garmin_entitlements_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: garmin_link_tokens garmin_link_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.garmin_link_tokens
    ADD CONSTRAINT garmin_link_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: garmin_workout_summaries garmin_workout_summaries_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.garmin_workout_summaries
    ADD CONSTRAINT garmin_workout_summaries_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: garmin_workouts garmin_workouts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.garmin_workouts
    ADD CONSTRAINT garmin_workouts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: group_members group_members_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.group_members
    ADD CONSTRAINT group_members_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;


--
-- Name: group_members group_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.group_members
    ADD CONSTRAINT group_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: groups groups_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: likes likes_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.likes
    ADD CONSTRAINT likes_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: likes likes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.likes
    ADD CONSTRAINT likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: posts posts_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE SET NULL;


--
-- Name: posts posts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id);


--
-- Name: reactions reactions_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reactions
    ADD CONSTRAINT reactions_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: reactions reactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reactions
    ADD CONSTRAINT reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: team_challenges team_challenges_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.team_challenges
    ADD CONSTRAINT team_challenges_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: team_members team_members_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: team_members team_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: teams teams_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: comments Comments are viewable; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Comments are viewable" ON public.comments FOR SELECT USING (true);


--
-- Name: follows Follows are viewable by everyone; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Follows are viewable by everyone" ON public.follows FOR SELECT USING (true);


--
-- Name: friendships Friendships are viewable by participants; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Friendships are viewable by participants" ON public.friendships FOR SELECT USING (((( SELECT auth.uid() AS uid) = requester_id) OR (( SELECT auth.uid() AS uid) = addressee_id)));


--
-- Name: likes Likes are viewable; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Likes are viewable" ON public.likes FOR SELECT USING (true);


--
-- Name: teams Owners can delete teams; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Owners can delete teams" ON public.teams FOR DELETE USING ((( SELECT auth.uid() AS uid) = owner_id));


--
-- Name: teams Owners can update teams; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Owners can update teams" ON public.teams FOR UPDATE USING ((( SELECT auth.uid() AS uid) = owner_id));


--
-- Name: friendships Participants can delete friendships; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Participants can delete friendships" ON public.friendships FOR DELETE USING (((( SELECT auth.uid() AS uid) = requester_id) OR (( SELECT auth.uid() AS uid) = addressee_id)));


--
-- Name: friendships Participants can update friendship status; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Participants can update friendship status" ON public.friendships FOR UPDATE USING (((( SELECT auth.uid() AS uid) = requester_id) OR (( SELECT auth.uid() AS uid) = addressee_id)));


--
-- Name: posts Posts viewable by audience; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Posts viewable by audience" ON public.posts FOR SELECT USING (((auth.uid() = user_id) OR (audience = 'public'::public.post_audience) OR ((audience = 'friends'::public.post_audience) AND (EXISTS ( SELECT 1
   FROM public.friendships f
  WHERE ((f.status = 'accepted'::public.friendship_status) AND (((f.requester_id = auth.uid()) AND (f.addressee_id = posts.user_id)) OR ((f.addressee_id = auth.uid()) AND (f.requester_id = posts.user_id))))))) OR ((audience = 'group'::public.post_audience) AND (group_id IS NOT NULL) AND (auth.uid() IS NOT NULL) AND public.is_group_member(group_id, auth.uid()))));


--
-- Name: profiles Public profiles are viewable by everyone; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public profiles are viewable by everyone" ON public.profiles FOR SELECT USING (true);


--
-- Name: teams Public teams viewable; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public teams viewable" ON public.teams FOR SELECT USING (((is_public = true) OR (owner_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM public.team_members
  WHERE ((team_members.team_id = teams.id) AND (team_members.user_id = ( SELECT auth.uid() AS uid)))))));


--
-- Name: team_members Team members viewable; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Team members viewable" ON public.team_members FOR SELECT USING (true);


--
-- Name: comments Users can create comments; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can create comments" ON public.comments FOR INSERT WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: posts Users can create posts; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can create posts" ON public.posts FOR INSERT WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: teams Users can create teams; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can create teams" ON public.teams FOR INSERT WITH CHECK ((( SELECT auth.uid() AS uid) = owner_id));


--
-- Name: comments Users can delete own comments; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can delete own comments" ON public.comments FOR DELETE USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: posts Users can delete own posts; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can delete own posts" ON public.posts FOR DELETE USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: follows Users can follow others; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can follow others" ON public.follows FOR INSERT WITH CHECK ((( SELECT auth.uid() AS uid) = follower_id));


--
-- Name: garmin_workouts Users can insert own garmin workouts; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can insert own garmin workouts" ON public.garmin_workouts FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: profiles Users can insert own profile; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK ((( SELECT auth.uid() AS uid) = id));


--
-- Name: team_members Users can join teams; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can join teams" ON public.team_members FOR INSERT WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: team_members Users can leave teams; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can leave teams" ON public.team_members FOR DELETE USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: likes Users can like posts; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can like posts" ON public.likes FOR INSERT WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: garmin_device_links Users can manage own device links; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can manage own device links" ON public.garmin_device_links USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: garmin_link_tokens Users can manage own link tokens; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can manage own link tokens" ON public.garmin_link_tokens USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: garmin_entitlements Users can read own entitlements; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can read own entitlements" ON public.garmin_entitlements FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: garmin_workouts Users can read own garmin workouts; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can read own garmin workouts" ON public.garmin_workouts FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: friendships Users can request friendships; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can request friendships" ON public.friendships FOR INSERT WITH CHECK ((( SELECT auth.uid() AS uid) = requester_id));


--
-- Name: follows Users can unfollow; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can unfollow" ON public.follows FOR DELETE USING ((( SELECT auth.uid() AS uid) = follower_id));


--
-- Name: likes Users can unlike posts; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can unlike posts" ON public.likes FOR DELETE USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: comments Users can update own comments; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update own comments" ON public.comments FOR UPDATE USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: garmin_entitlements Users can update own entitlements; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update own entitlements" ON public.garmin_entitlements FOR UPDATE USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: posts Users can update own posts; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update own posts" ON public.posts FOR UPDATE USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: profiles Users can update own profile; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING ((( SELECT auth.uid() AS uid) = id));


--
-- Name: activity_feed Users see own activity; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users see own activity" ON public.activity_feed FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: activity_feed; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.activity_feed ENABLE ROW LEVEL SECURITY;

--
-- Name: backend_ops_alerts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.backend_ops_alerts ENABLE ROW LEVEL SECURITY;

--
-- Name: backend_ops_heartbeats; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.backend_ops_heartbeats ENABLE ROW LEVEL SECURITY;

--
-- Name: comments; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

--
-- Name: follows; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;

--
-- Name: food_search_cache; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.food_search_cache ENABLE ROW LEVEL SECURITY;

--
-- Name: food_search_metrics; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.food_search_metrics ENABLE ROW LEVEL SECURITY;

--
-- Name: food_search_prefix_cache; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.food_search_prefix_cache ENABLE ROW LEVEL SECURITY;

--
-- Name: food_search_rate_limit_state; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.food_search_rate_limit_state ENABLE ROW LEVEL SECURITY;

--
-- Name: food_user_query_profile; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.food_user_query_profile ENABLE ROW LEVEL SECURITY;

--
-- Name: friendships; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;

--
-- Name: garmin_device_links; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.garmin_device_links ENABLE ROW LEVEL SECURITY;

--
-- Name: garmin_device_links garmin_device_links_insert_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY garmin_device_links_insert_own ON public.garmin_device_links FOR INSERT WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: garmin_device_links garmin_device_links_select_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY garmin_device_links_select_own ON public.garmin_device_links FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: garmin_device_links garmin_device_links_update_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY garmin_device_links_update_own ON public.garmin_device_links FOR UPDATE USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: garmin_entitlements; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.garmin_entitlements ENABLE ROW LEVEL SECURITY;

--
-- Name: garmin_link_tokens; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.garmin_link_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: garmin_link_tokens garmin_link_tokens_insert_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY garmin_link_tokens_insert_own ON public.garmin_link_tokens FOR INSERT WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: garmin_link_tokens garmin_link_tokens_select_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY garmin_link_tokens_select_own ON public.garmin_link_tokens FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: garmin_link_tokens garmin_link_tokens_update_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY garmin_link_tokens_update_own ON public.garmin_link_tokens FOR UPDATE USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: garmin_workout_summaries; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.garmin_workout_summaries ENABLE ROW LEVEL SECURITY;

--
-- Name: garmin_workouts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.garmin_workouts ENABLE ROW LEVEL SECURITY;

--
-- Name: garmin_workout_summaries garmin_workouts_insert_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY garmin_workouts_insert_own ON public.garmin_workout_summaries FOR INSERT WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: garmin_workout_summaries garmin_workouts_select_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY garmin_workouts_select_own ON public.garmin_workout_summaries FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: garmin_workout_summaries garmin_workouts_update_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY garmin_workouts_update_own ON public.garmin_workout_summaries FOR UPDATE USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: group_members; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;

--
-- Name: group_members group_members_delete_self_or_owner; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY group_members_delete_self_or_owner ON public.group_members FOR DELETE USING (((auth.uid() = user_id) OR (auth.uid() = ( SELECT g.owner_id
   FROM public.groups g
  WHERE (g.id = group_members.group_id)))));


--
-- Name: group_members group_members_insert_self_or_owner; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY group_members_insert_self_or_owner ON public.group_members FOR INSERT WITH CHECK (((auth.uid() = user_id) OR (auth.uid() = ( SELECT g.owner_id
   FROM public.groups g
  WHERE (g.id = group_members.group_id)))));


--
-- Name: group_members group_members_select_visible; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY group_members_select_visible ON public.group_members FOR SELECT USING (((auth.uid() = user_id) OR (auth.uid() = ( SELECT g.owner_id
   FROM public.groups g
  WHERE (g.id = group_members.group_id))) OR ((auth.uid() IS NOT NULL) AND public.is_group_member(group_id, auth.uid()))));


--
-- Name: groups; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;

--
-- Name: groups groups_delete_owner_only; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY groups_delete_owner_only ON public.groups FOR DELETE USING ((auth.uid() = owner_id));


--
-- Name: groups groups_insert_owner_only; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY groups_insert_owner_only ON public.groups FOR INSERT WITH CHECK ((auth.uid() = owner_id));


--
-- Name: groups groups_select_public_or_owner; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY groups_select_public_or_owner ON public.groups FOR SELECT USING (((is_public = true) OR (auth.uid() = owner_id)));


--
-- Name: groups groups_update_owner_only; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY groups_update_owner_only ON public.groups FOR UPDATE USING ((auth.uid() = owner_id)) WITH CHECK ((auth.uid() = owner_id));


--
-- Name: leaderboards; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.leaderboards ENABLE ROW LEVEL SECURITY;

--
-- Name: leaderboards leaderboards_select_authenticated; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY leaderboards_select_authenticated ON public.leaderboards FOR SELECT USING ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: likes; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.likes ENABLE ROW LEVEL SECURITY;

--
-- Name: posts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: reactions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.reactions ENABLE ROW LEVEL SECURITY;

--
-- Name: reactions reactions_delete_self; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY reactions_delete_self ON public.reactions FOR DELETE USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: reactions reactions_insert_self; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY reactions_insert_self ON public.reactions FOR INSERT WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: reactions reactions_select_visible_post; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY reactions_select_visible_post ON public.reactions FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.posts p
  WHERE ((p.id = reactions.post_id) AND ((p.audience = 'public'::public.post_audience) OR (p.user_id = ( SELECT auth.uid() AS uid)) OR ((p.audience = 'friends'::public.post_audience) AND (EXISTS ( SELECT 1
           FROM public.friendships f
          WHERE ((f.status = 'accepted'::public.friendship_status) AND (((f.requester_id = ( SELECT auth.uid() AS uid)) AND (f.addressee_id = p.user_id)) OR ((f.addressee_id = ( SELECT auth.uid() AS uid)) AND (f.requester_id = p.user_id))))))) OR ((p.audience = 'group'::public.post_audience) AND (EXISTS ( SELECT 1
           FROM public.group_members gm
          WHERE ((gm.group_id = p.group_id) AND (gm.user_id = ( SELECT auth.uid() AS uid)))))))))));


--
-- Name: team_challenges; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.team_challenges ENABLE ROW LEVEL SECURITY;

--
-- Name: team_challenges team_challenges_delete_owner; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY team_challenges_delete_owner ON public.team_challenges FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.teams t
  WHERE ((t.id = team_challenges.team_id) AND (t.owner_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: team_challenges team_challenges_insert_owner; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY team_challenges_insert_owner ON public.team_challenges FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.teams t
  WHERE ((t.id = team_challenges.team_id) AND (t.owner_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: team_challenges team_challenges_select_members; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY team_challenges_select_members ON public.team_challenges FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.team_members tm
  WHERE ((tm.team_id = team_challenges.team_id) AND (tm.user_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: team_challenges team_challenges_update_owner; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY team_challenges_update_owner ON public.team_challenges FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.teams t
  WHERE ((t.id = team_challenges.team_id) AND (t.owner_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: team_members; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

--
-- Name: teams; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION confirm_garmin_link(watch_install_id text, token text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.confirm_garmin_link(watch_install_id text, token text) TO anon;
GRANT ALL ON FUNCTION public.confirm_garmin_link(watch_install_id text, token text) TO authenticated;
GRANT ALL ON FUNCTION public.confirm_garmin_link(watch_install_id text, token text) TO service_role;


--
-- Name: FUNCTION create_garmin_link_token(watch_install_id text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.create_garmin_link_token(watch_install_id text) TO anon;
GRANT ALL ON FUNCTION public.create_garmin_link_token(watch_install_id text) TO authenticated;
GRANT ALL ON FUNCTION public.create_garmin_link_token(watch_install_id text) TO service_role;


--
-- Name: FUNCTION decrement_follow_counts(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.decrement_follow_counts() TO anon;
GRANT ALL ON FUNCTION public.decrement_follow_counts() TO authenticated;
GRANT ALL ON FUNCTION public.decrement_follow_counts() TO service_role;


--
-- Name: FUNCTION decrement_post_comments(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.decrement_post_comments() TO anon;
GRANT ALL ON FUNCTION public.decrement_post_comments() TO authenticated;
GRANT ALL ON FUNCTION public.decrement_post_comments() TO service_role;


--
-- Name: FUNCTION decrement_post_likes(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.decrement_post_likes() TO anon;
GRANT ALL ON FUNCTION public.decrement_post_likes() TO authenticated;
GRANT ALL ON FUNCTION public.decrement_post_likes() TO service_role;


--
-- Name: FUNCTION evaluate_food_search_slo_alerts(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.evaluate_food_search_slo_alerts() FROM PUBLIC;
GRANT ALL ON FUNCTION public.evaluate_food_search_slo_alerts() TO anon;
GRANT ALL ON FUNCTION public.evaluate_food_search_slo_alerts() TO authenticated;
GRANT ALL ON FUNCTION public.evaluate_food_search_slo_alerts() TO service_role;


--
-- Name: FUNCTION food_search_allow_request(p_user_id uuid, p_scope text, p_window_seconds integer, p_limit integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.food_search_allow_request(p_user_id uuid, p_scope text, p_window_seconds integer, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.food_search_allow_request(p_user_id uuid, p_scope text, p_window_seconds integer, p_limit integer) TO anon;
GRANT ALL ON FUNCTION public.food_search_allow_request(p_user_id uuid, p_scope text, p_window_seconds integer, p_limit integer) TO authenticated;
GRANT ALL ON FUNCTION public.food_search_allow_request(p_user_id uuid, p_scope text, p_window_seconds integer, p_limit integer) TO service_role;


--
-- Name: FUNCTION food_search_maintenance_tick(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.food_search_maintenance_tick() FROM PUBLIC;
GRANT ALL ON FUNCTION public.food_search_maintenance_tick() TO anon;
GRANT ALL ON FUNCTION public.food_search_maintenance_tick() TO authenticated;
GRANT ALL ON FUNCTION public.food_search_maintenance_tick() TO service_role;


--
-- Name: FUNCTION get_garmin_entitlement(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.get_garmin_entitlement() TO anon;
GRANT ALL ON FUNCTION public.get_garmin_entitlement() TO authenticated;
GRANT ALL ON FUNCTION public.get_garmin_entitlement() TO service_role;


--
-- Name: FUNCTION increment_follow_counts(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.increment_follow_counts() TO anon;
GRANT ALL ON FUNCTION public.increment_follow_counts() TO authenticated;
GRANT ALL ON FUNCTION public.increment_follow_counts() TO service_role;


--
-- Name: FUNCTION increment_post_comments(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.increment_post_comments() TO anon;
GRANT ALL ON FUNCTION public.increment_post_comments() TO authenticated;
GRANT ALL ON FUNCTION public.increment_post_comments() TO service_role;


--
-- Name: FUNCTION increment_post_likes(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.increment_post_likes() TO anon;
GRANT ALL ON FUNCTION public.increment_post_likes() TO authenticated;
GRANT ALL ON FUNCTION public.increment_post_likes() TO service_role;


--
-- Name: FUNCTION insert_backend_ops_alert(p_alert_key text, p_severity text, p_source text, p_message text, p_details jsonb, p_dedupe_minutes integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.insert_backend_ops_alert(p_alert_key text, p_severity text, p_source text, p_message text, p_details jsonb, p_dedupe_minutes integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.insert_backend_ops_alert(p_alert_key text, p_severity text, p_source text, p_message text, p_details jsonb, p_dedupe_minutes integer) TO anon;
GRANT ALL ON FUNCTION public.insert_backend_ops_alert(p_alert_key text, p_severity text, p_source text, p_message text, p_details jsonb, p_dedupe_minutes integer) TO authenticated;
GRANT ALL ON FUNCTION public.insert_backend_ops_alert(p_alert_key text, p_severity text, p_source text, p_message text, p_details jsonb, p_dedupe_minutes integer) TO service_role;


--
-- Name: FUNCTION is_group_member(p_group_id uuid, p_user_id uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.is_group_member(p_group_id uuid, p_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_group_member(p_group_id uuid, p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_group_member(p_group_id uuid, p_user_id uuid) TO service_role;


--
-- Name: FUNCTION purge_expired_food_search_cache(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.purge_expired_food_search_cache() FROM PUBLIC;
GRANT ALL ON FUNCTION public.purge_expired_food_search_cache() TO anon;
GRANT ALL ON FUNCTION public.purge_expired_food_search_cache() TO authenticated;
GRANT ALL ON FUNCTION public.purge_expired_food_search_cache() TO service_role;


--
-- Name: FUNCTION purge_expired_food_search_prefix_cache(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.purge_expired_food_search_prefix_cache() FROM PUBLIC;
GRANT ALL ON FUNCTION public.purge_expired_food_search_prefix_cache() TO anon;
GRANT ALL ON FUNCTION public.purge_expired_food_search_prefix_cache() TO authenticated;
GRANT ALL ON FUNCTION public.purge_expired_food_search_prefix_cache() TO service_role;


--
-- Name: FUNCTION purge_old_food_search_rate_limit_state(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.purge_old_food_search_rate_limit_state() FROM PUBLIC;
GRANT ALL ON FUNCTION public.purge_old_food_search_rate_limit_state() TO anon;
GRANT ALL ON FUNCTION public.purge_old_food_search_rate_limit_state() TO authenticated;
GRANT ALL ON FUNCTION public.purge_old_food_search_rate_limit_state() TO service_role;


--
-- Name: FUNCTION record_backend_ops_heartbeat(p_component text, p_meta jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.record_backend_ops_heartbeat(p_component text, p_meta jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_backend_ops_heartbeat(p_component text, p_meta jsonb) TO anon;
GRANT ALL ON FUNCTION public.record_backend_ops_heartbeat(p_component text, p_meta jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.record_backend_ops_heartbeat(p_component text, p_meta jsonb) TO service_role;


--
-- Name: FUNCTION set_food_search_cache_updated_at(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.set_food_search_cache_updated_at() TO anon;
GRANT ALL ON FUNCTION public.set_food_search_cache_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_food_search_cache_updated_at() TO service_role;


--
-- Name: FUNCTION set_food_search_prefix_cache_updated_at(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.set_food_search_prefix_cache_updated_at() TO anon;
GRANT ALL ON FUNCTION public.set_food_search_prefix_cache_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_food_search_prefix_cache_updated_at() TO service_role;


--
-- Name: FUNCTION set_updated_at(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.set_updated_at() TO anon;
GRANT ALL ON FUNCTION public.set_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_updated_at() TO service_role;


--
-- Name: FUNCTION trim_food_user_query_profile(p_user_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.trim_food_user_query_profile(p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.trim_food_user_query_profile(p_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.trim_food_user_query_profile(p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.trim_food_user_query_profile(p_user_id uuid) TO service_role;


--
-- Name: FUNCTION update_updated_at_column(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.update_updated_at_column() TO anon;
GRANT ALL ON FUNCTION public.update_updated_at_column() TO authenticated;
GRANT ALL ON FUNCTION public.update_updated_at_column() TO service_role;


--
-- Name: FUNCTION upsert_garmin_workout_summary(workout jsonb); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.upsert_garmin_workout_summary(workout jsonb) TO anon;
GRANT ALL ON FUNCTION public.upsert_garmin_workout_summary(workout jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.upsert_garmin_workout_summary(workout jsonb) TO service_role;


--
-- Name: TABLE activity_feed; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.activity_feed TO anon;
GRANT ALL ON TABLE public.activity_feed TO authenticated;
GRANT ALL ON TABLE public.activity_feed TO service_role;


--
-- Name: TABLE backend_ops_alerts; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.backend_ops_alerts TO service_role;


--
-- Name: SEQUENCE backend_ops_alerts_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.backend_ops_alerts_id_seq TO anon;
GRANT ALL ON SEQUENCE public.backend_ops_alerts_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.backend_ops_alerts_id_seq TO service_role;


--
-- Name: TABLE backend_ops_heartbeats; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.backend_ops_heartbeats TO service_role;


--
-- Name: TABLE comments; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.comments TO anon;
GRANT ALL ON TABLE public.comments TO authenticated;
GRANT ALL ON TABLE public.comments TO service_role;


--
-- Name: TABLE follows; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.follows TO anon;
GRANT ALL ON TABLE public.follows TO authenticated;
GRANT ALL ON TABLE public.follows TO service_role;


--
-- Name: TABLE food_search_cache; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.food_search_cache TO service_role;


--
-- Name: TABLE food_search_metrics; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.food_search_metrics TO service_role;


--
-- Name: SEQUENCE food_search_metrics_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.food_search_metrics_id_seq TO anon;
GRANT ALL ON SEQUENCE public.food_search_metrics_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.food_search_metrics_id_seq TO service_role;


--
-- Name: TABLE food_search_prefix_cache; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.food_search_prefix_cache TO service_role;


--
-- Name: TABLE food_search_rate_limit_state; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.food_search_rate_limit_state TO service_role;


--
-- Name: TABLE food_user_query_profile; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.food_user_query_profile TO service_role;


--
-- Name: TABLE friendships; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.friendships TO anon;
GRANT ALL ON TABLE public.friendships TO authenticated;
GRANT ALL ON TABLE public.friendships TO service_role;


--
-- Name: TABLE garmin_device_links; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.garmin_device_links TO anon;
GRANT ALL ON TABLE public.garmin_device_links TO authenticated;
GRANT ALL ON TABLE public.garmin_device_links TO service_role;


--
-- Name: TABLE garmin_entitlements; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.garmin_entitlements TO anon;
GRANT ALL ON TABLE public.garmin_entitlements TO authenticated;
GRANT ALL ON TABLE public.garmin_entitlements TO service_role;


--
-- Name: TABLE garmin_link_tokens; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.garmin_link_tokens TO anon;
GRANT ALL ON TABLE public.garmin_link_tokens TO authenticated;
GRANT ALL ON TABLE public.garmin_link_tokens TO service_role;


--
-- Name: TABLE garmin_workout_summaries; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.garmin_workout_summaries TO anon;
GRANT ALL ON TABLE public.garmin_workout_summaries TO authenticated;
GRANT ALL ON TABLE public.garmin_workout_summaries TO service_role;


--
-- Name: TABLE garmin_workouts; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.garmin_workouts TO anon;
GRANT ALL ON TABLE public.garmin_workouts TO authenticated;
GRANT ALL ON TABLE public.garmin_workouts TO service_role;


--
-- Name: TABLE group_members; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.group_members TO anon;
GRANT ALL ON TABLE public.group_members TO authenticated;
GRANT ALL ON TABLE public.group_members TO service_role;


--
-- Name: TABLE groups; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.groups TO anon;
GRANT ALL ON TABLE public.groups TO authenticated;
GRANT ALL ON TABLE public.groups TO service_role;


--
-- Name: TABLE leaderboards; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.leaderboards TO anon;
GRANT ALL ON TABLE public.leaderboards TO authenticated;
GRANT ALL ON TABLE public.leaderboards TO service_role;


--
-- Name: TABLE likes; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.likes TO anon;
GRANT ALL ON TABLE public.likes TO authenticated;
GRANT ALL ON TABLE public.likes TO service_role;


--
-- Name: TABLE posts; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.posts TO anon;
GRANT ALL ON TABLE public.posts TO authenticated;
GRANT ALL ON TABLE public.posts TO service_role;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.profiles TO anon;
GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;


--
-- Name: TABLE reactions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.reactions TO anon;
GRANT ALL ON TABLE public.reactions TO authenticated;
GRANT ALL ON TABLE public.reactions TO service_role;


--
-- Name: TABLE team_challenges; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.team_challenges TO anon;
GRANT ALL ON TABLE public.team_challenges TO authenticated;
GRANT ALL ON TABLE public.team_challenges TO service_role;


--
-- Name: TABLE team_members; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.team_members TO anon;
GRANT ALL ON TABLE public.team_members TO authenticated;
GRANT ALL ON TABLE public.team_members TO service_role;


--
-- Name: TABLE teams; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.teams TO anon;
GRANT ALL ON TABLE public.teams TO authenticated;
GRANT ALL ON TABLE public.teams TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--

\unrestrict z0V1yal1JfaJ9BpxcUk2upqZVMIiqEROJnvi9aKfveeiCMOiCpLG08OdpwBaSnG

