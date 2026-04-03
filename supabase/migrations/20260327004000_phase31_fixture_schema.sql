-- Phase 31 fixture schema
-- This schema is intended for staging validation data used by
-- scripts/phase31/*.js and is safe to apply idempotently.

create extension if not exists pgcrypto;

create table if not exists public.food_v2_slo_metrics (
  metric_id uuid primary key default gen_random_uuid(),
  critical_path text not null,
  sli_metric text not null,
  slo_target numeric not null,
  measurement_interval text not null,
  current_value numeric default 0,
  updated_at timestamptz not null default now(),
  unique (critical_path, sli_metric, measurement_interval)
);

create table if not exists public.food_v2_alert_events (
  alert_id uuid primary key default gen_random_uuid(),
  critical_path text not null,
  severity text not null,
  threshold numeric not null,
  actual_value numeric default 0,
  triggered_at timestamptz,
  resolved_at timestamptz,
  auto_action text,
  owner text
);

create index if not exists idx_food_v2_alert_events_path_triggered
  on public.food_v2_alert_events (critical_path, triggered_at desc);

create table if not exists public.food_v2_remediation_jobs (
  remediation_id uuid primary key default gen_random_uuid(),
  job_type text not null,
  target_scope jsonb not null,
  status text not null default 'pending',
  executed_at timestamptz,
  audit_log jsonb default '{}'::jsonb
);

create index if not exists idx_food_v2_remediation_jobs_status_executed
  on public.food_v2_remediation_jobs (status, executed_at desc);

create table if not exists public.food_v2_oncall_shifts (
  shift_id uuid primary key default gen_random_uuid(),
  owner text not null,
  tier text not null,
  start_time timestamptz not null,
  end_time timestamptz not null,
  escalations text[]
);

create table if not exists public.food_v2_incident_reports (
  incident_id uuid primary key default gen_random_uuid(),
  critical_path text not null,
  severity text not null,
  start_time timestamptz not null,
  resolved_time timestamptz,
  owner text not null,
  notes text
);
