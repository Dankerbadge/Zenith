import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function truncateError(e: unknown) {
  const msg = String((e as any)?.message || e || 'unknown_error');
  return msg.slice(0, 500);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  if (!serviceRole || !supabaseUrl) {
    return new Response(JSON.stringify({ error: 'service_role_missing' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  const supabase = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

  const lockId = crypto.randomUUID();

  const { data: lockedRows, error: lockErr } = await supabase.rpc('claim_challenge_recompute_jobs', {
    p_lock_id: lockId,
    p_limit: 50,
  });
  if (lockErr) {
    await supabase.from('challenge_worker_runs').insert({
      source: 'process-challenge-queue',
      processed: 0,
      failed: 0,
      claimed: 0,
      remaining_approx: 0,
      error: `claim_failed:${lockErr.message}`.slice(0, 500),
    });
    return new Response(JSON.stringify({ error: 'claim_failed', detail: lockErr.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const rows = Array.isArray(lockedRows) ? lockedRows : [];
  let processed = 0;
  let failed = 0;

  for (const row of rows) {
    const workoutId = String((row as any)?.workout_id || '');
    const queueId = Number((row as any)?.id || 0);
    if (!workoutId || !queueId) continue;
    try {
      const evalResponse = await fetch(`${supabaseUrl}/functions/v1/challenges-evaluate-workout`, {
        method: 'POST',
        headers: {
          apikey: serviceRole,
          Authorization: `Bearer ${serviceRole}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ workoutId }),
      });
      if (!evalResponse.ok) {
        const body = await evalResponse.text();
        throw new Error(`evaluate_failed_${evalResponse.status}:${body.slice(0, 300)}`);
      }

      const { error: doneErr } = await supabase
        .from('challenge_recompute_queue')
        .update({
          processed_at: new Date().toISOString(),
          locked_at: null,
          lock_id: null,
          last_error: null,
        })
        .eq('id', queueId)
        .eq('lock_id', lockId);
      if (doneErr) throw doneErr;
      processed += 1;
    } catch (err) {
      failed += 1;
      const message = truncateError(err);
      await supabase.rpc('fail_challenge_recompute_job', {
        p_id: queueId,
        p_lock_id: lockId,
        p_error: message,
      });
    }
  }

  const [{ count: remainingApprox }, { data: oldest }] = await Promise.all([
    supabase.from('challenge_recompute_queue').select('id', { count: 'exact', head: true }).is('processed_at', null),
    supabase
      .from('challenge_recompute_queue')
      .select('inserted_at')
      .is('processed_at', null)
      .order('inserted_at', { ascending: true })
      .limit(1),
  ]);
  const oldestUnprocessed = Array.isArray(oldest) && oldest[0]?.inserted_at ? String(oldest[0].inserted_at) : null;

  await supabase.from('challenge_worker_runs').insert({
    source: 'process-challenge-queue',
    processed,
    failed,
    claimed: rows.length,
    remaining_approx: Number(remainingApprox || 0),
    oldest_unprocessed: oldestUnprocessed,
    error: null,
  });

  return new Response(
    JSON.stringify({
      processed,
      failed,
      claimed: rows.length,
      remainingApprox: Number(remainingApprox || 0),
      oldestUnprocessed,
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
