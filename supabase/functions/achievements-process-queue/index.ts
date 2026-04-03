import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function truncateError(e: unknown) {
  return String((e as any)?.message || e || 'unknown').slice(0, 500);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST' && req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const auth = req.headers.get('Authorization') || '';
  if (!serviceKey || auth !== `Bearer ${serviceKey}`) return json({ error: 'forbidden' }, 403);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const lockId = crypto.randomUUID();

  const { data: lockedRows, error: lockErr } = await supabase.rpc('claim_achievements_recompute_jobs', {
    p_lock_id: lockId,
    p_limit: 50,
  });
  if (lockErr) {
    await supabase.from('worker_runs').insert({
      source: 'achievements-process-queue',
      processed: 0,
      failed: 0,
      claimed: 0,
      remaining_approx: 0,
      error: `claim_failed:${lockErr.message}`.slice(0, 500),
    });
    return json({ error: 'claim_failed', detail: lockErr.message }, 400);
  }

  const rows = Array.isArray(lockedRows) ? lockedRows : [];
  let processed = 0;
  let failed = 0;

  for (const row of rows) {
    const userId = String((row as any)?.user_id || '');
    const queueId = Number((row as any)?.id || 0);
    if (!userId || !queueId) continue;
    try {
      const evalResponse = await fetch(`${supabaseUrl}/functions/v1/achievements-recompute`, {
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId }),
      });
      if (!evalResponse.ok) {
        const body = await evalResponse.text();
        throw new Error(`recompute_failed_${evalResponse.status}:${body.slice(0, 300)}`);
      }

      const { error: doneErr } = await supabase
        .from('achievements_recompute_queue')
        .update({
          processed_at: new Date().toISOString(),
          lock_id: null,
          locked_at: null,
          last_error: null,
        })
        .eq('id', queueId)
        .eq('lock_id', lockId);
      if (doneErr) throw doneErr;
      processed += 1;
    } catch (err) {
      failed += 1;
      const message = truncateError(err);
      await supabase.rpc('fail_achievements_recompute_job', {
        p_id: queueId,
        p_lock_id: lockId,
        p_error: message,
      });
    }
  }

  const [{ count: remainingApprox }, { data: oldest }] = await Promise.all([
    supabase.from('achievements_recompute_queue').select('id', { count: 'exact', head: true }).is('processed_at', null),
    supabase
      .from('achievements_recompute_queue')
      .select('inserted_at')
      .is('processed_at', null)
      .order('inserted_at', { ascending: true })
      .limit(1),
  ]);

  await supabase.from('worker_runs').insert({
    source: 'achievements-process-queue',
    processed,
    failed,
    claimed: rows.length,
    remaining_approx: Number(remainingApprox || 0),
    oldest_unprocessed: Array.isArray(oldest) && oldest[0]?.inserted_at ? String(oldest[0].inserted_at) : null,
    error: null,
  });

  return json({
    processed,
    failed,
    claimed: rows.length,
    remainingApprox: Number(remainingApprox || 0),
  });
});
