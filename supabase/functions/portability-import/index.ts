import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type ImportRow = {
  day: string;
  calories_kcal?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  fiber_g?: number;
  first_log_ts?: string | null;
  last_log_ts?: string | null;
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function parseRows(body: any): ImportRow[] {
  const fromBody = Array.isArray(body?.rows) ? body.rows : [];
  const fromPayload = Array.isArray(body?.payload?.rows) ? body.payload.rows : [];
  const input = fromBody.length ? fromBody : fromPayload;

  const out: ImportRow[] = [];
  for (const row of input) {
    const day = String((row as any)?.day || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    out.push({
      day,
      calories_kcal: Number((row as any)?.calories_kcal || 0) || 0,
      protein_g: Number((row as any)?.protein_g || 0) || 0,
      carbs_g: Number((row as any)?.carbs_g || 0) || 0,
      fat_g: Number((row as any)?.fat_g || 0) || 0,
      fiber_g: Number((row as any)?.fiber_g || 0) || 0,
      first_log_ts: (row as any)?.first_log_ts ? String((row as any).first_log_ts) : null,
      last_log_ts: (row as any)?.last_log_ts ? String((row as any).last_log_ts) : null,
    });
  }
  return out;
}

function summarizeRows(rows: ImportRow[]) {
  const sorted = rows.map((row) => row.day).sort();
  return {
    rowCount: rows.length,
    dateFrom: sorted[0] || null,
    dateTo: sorted[sorted.length - 1] || null,
  };
}

async function appendAuditEvent(client: any, userId: string, action: string, payload: Record<string, unknown>) {
  try {
    await client.from('food_v2_portability_audit_events').insert({
      user_id: userId,
      action,
      payload,
    });
  } catch {
    // non-fatal
  }
}

async function createJob(client: any, userId: string, operation: string, status: string, payload: Record<string, unknown>) {
  const { data, error } = await client
    .from('food_v2_portability_jobs')
    .insert({
      user_id: userId,
      operation,
      status,
      payload,
      result_summary: {},
      completed_at: status === 'queued' ? null : new Date().toISOString(),
    })
    .select('job_id')
    .single();

  if (error) throw new Error(`portability_job_failed:${error.message}`);
  return String((data as any)?.job_id || '');
}

async function updateJob(client: any, jobId: string, status: string, resultSummary: Record<string, unknown>) {
  await client
    .from('food_v2_portability_jobs')
    .update({
      status,
      result_summary: resultSummary,
      completed_at: new Date().toISOString(),
    })
    .eq('job_id', jobId);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'missing_authorization' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: 'supabase_env_missing' }, 500);

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: auth, error: authErr } = await authClient.auth.getUser();
  if (authErr || !auth?.user?.id) return json({ error: 'unauthorized' }, 401);
  const userId = auth.user.id;

  const body = await req.json().catch(() => ({} as any));
  const dryRun = body?.dryRun !== false;
  const wipeMissing = body?.wipeMissing === true;
  const rows = parseRows(body);
  const summary = summarizeRows(rows);

  const jobId = await createJob(
    serviceClient,
    userId,
    dryRun ? 'import_preview' : 'import_apply',
    dryRun ? 'previewed' : 'queued',
    { dryRun, wipeMissing, rowCount: summary.rowCount }
  );

  if (dryRun) {
    await updateJob(serviceClient, jobId, 'previewed', {
      ...summary,
      acceptsApply: true,
      requiredColumns: ['day', 'calories_kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g'],
    });
    await appendAuditEvent(serviceClient, userId, 'import_preview', {
      jobId,
      ...summary,
    });
    return json({
      ok: true,
      dryRun: true,
      jobId,
      summary: {
        ...summary,
        acceptsApply: true,
      },
    });
  }

  if (!rows.length) {
    await updateJob(serviceClient, jobId, 'failed', { error: 'no_rows_for_apply' });
    return json({ error: 'no_rows_for_apply', jobId }, 400);
  }

  const payload = rows.map((row) => ({
    user_id: userId,
    day: row.day,
    calories_kcal: row.calories_kcal ?? 0,
    protein_g: row.protein_g ?? 0,
    carbs_g: row.carbs_g ?? 0,
    fat_g: row.fat_g ?? 0,
    fiber_g: row.fiber_g ?? 0,
    first_log_ts: row.first_log_ts ?? null,
    last_log_ts: row.last_log_ts ?? null,
    computed_at: new Date().toISOString(),
    meal_breakdown: {},
  }));

  const { error: upsertErr } = await authClient.from('nutrition_daily').upsert(payload, {
    onConflict: 'user_id,day',
  });
  if (upsertErr) {
    await updateJob(serviceClient, jobId, 'failed', { error: upsertErr.message });
    return json({ error: 'nutrition_upsert_failed', detail: upsertErr.message, jobId }, 400);
  }

  if (wipeMissing && summary.dateFrom && summary.dateTo) {
    const importDays = new Set(rows.map((row) => row.day));
    const { data: existing } = await authClient
      .from('nutrition_daily')
      .select('day')
      .eq('user_id', userId)
      .gte('day', summary.dateFrom)
      .lte('day', summary.dateTo);
    const toDelete = (Array.isArray(existing) ? existing : [])
      .map((row: any) => String(row?.day || ''))
      .filter((day) => day && !importDays.has(day));
    if (toDelete.length) {
      await authClient.from('nutrition_daily').delete().eq('user_id', userId).in('day', toDelete);
    }
  }

  await updateJob(serviceClient, jobId, 'succeeded', {
    ...summary,
    restoredRows: rows.length,
    wipeMissingApplied: wipeMissing,
  });
  await appendAuditEvent(serviceClient, userId, 'import_apply', {
    jobId,
    restoredRows: rows.length,
    wipeMissing,
  });

  return json({
    ok: true,
    dryRun: false,
    jobId,
    restoredRows: rows.length,
    wipeMissingApplied: wipeMissing,
  });
});
