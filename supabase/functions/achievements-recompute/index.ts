import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

type MetricSnapshot = {
  workouts: number;
  distanceM: number;
  runCount: number;
  kcal: number;
  challengeCompletions: number;
};

async function gatherMetrics(supabase: any, userId: string): Promise<MetricSnapshot> {
  const [{ data: workouts }, { data: challengeRows }] = await Promise.all([
    supabase.from('workouts').select('activity_type, distance_m, active_kcal').eq('user_id', userId),
    supabase
      .from('challenge_participants')
      .select('completion_state')
      .eq('user_id', userId)
      .eq('completion_state', 'COMPLETED'),
  ]);
  const ws = Array.isArray(workouts) ? workouts : [];
  return {
    workouts: ws.length,
    distanceM: ws.reduce((sum: number, w: any) => sum + (Number(w?.distance_m) || 0), 0),
    runCount: ws.filter((w: any) => String(w?.activity_type || '').toLowerCase().includes('run')).length,
    kcal: ws.reduce((sum: number, w: any) => sum + (Number(w?.active_kcal) || 0), 0),
    challengeCompletions: Array.isArray(challengeRows) ? challengeRows.length : 0,
  };
}

function evalProgress(criteria: any, m: MetricSnapshot) {
  const kind = String(criteria?.kind || 'workouts_count');
  const target = Math.max(1, Number(criteria?.target || 1));
  let value = 0;
  if (kind === 'workouts_count') value = m.workouts;
  else if (kind === 'distance_m') value = m.distanceM;
  else if (kind === 'run_count') value = m.runCount;
  else if (kind === 'active_kcal') value = m.kcal;
  else if (kind === 'challenge_completions') value = m.challengeCompletions;
  const pct = Math.max(0, Math.min(100, Math.round((value / target) * 100)));
  return { value, target, pct, earned: value >= target };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'missing_auth' }, 401);

  const anon = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: authErr,
  } = await anon.auth.getUser();

  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const isService = authHeader === `Bearer ${serviceRole}`;
  if (!user && !isService) return json({ error: authErr?.message || 'unauthorized' }, 401);

  const body = await req.json().catch(() => ({} as any));
  const targetUserId = String(body?.userId || user?.id || '').trim();
  if (!targetUserId) return json({ error: 'missing_user_id' }, 400);

  const service = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceRole, { auth: { persistSession: false } });
  const defsRes = await service.from('achievements_definitions').select('*').eq('active', true);
  if (defsRes.error) return json({ error: defsRes.error.message }, 400);
  const defs = Array.isArray(defsRes.data) ? defsRes.data : [];
  if (!defs.length) return json({ ok: true, updated: 0, reason: 'no_definitions' });

  const metrics = await gatherMetrics(service, targetUserId);
  const upserts = defs.map((d: any) => {
    const progress = evalProgress(d.criteria || {}, metrics);
    return {
      user_id: targetUserId,
      achievement_id: d.id,
      progress_value: progress.value,
      progress: {
        pct: progress.pct,
        target: progress.target,
        kind: d?.criteria?.kind || 'workouts_count',
        snapshot: metrics,
      },
      earned_at: progress.earned ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    };
  });
  const { error: upErr } = await service.from('user_achievements').upsert(upserts, { onConflict: 'user_id,achievement_id' });
  if (upErr) return json({ error: upErr.message }, 400);

  return json({ ok: true, updated: upserts.length, userId: targetUserId });
});
