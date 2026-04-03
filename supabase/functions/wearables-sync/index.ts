import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const auth = req.headers.get('Authorization');
  if (!auth) return json({ error: 'missing_auth' }, 401);
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: auth } },
  });
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) return json({ error: 'unauthorized' }, 401);

  const body = await req.json().catch(() => ({} as any));
  const source = String(body?.source || 'HEALTH_CONNECT').toUpperCase();
  const workouts = Array.isArray(body?.workouts) ? body.workouts : [];
  const dailyTotals = Array.isArray(body?.dailyTotals) ? body.dailyTotals : [];

  const workoutUpserts = workouts.map((w: any) => {
    const externalId = String(w?.externalId || w?.id || crypto.randomUUID());
    return {
      user_id: user.id,
      external_id: `${source}:${externalId}`,
      start_ts: String(w?.startTs || new Date().toISOString()),
      end_ts: String(w?.endTs || w?.startTs || new Date().toISOString()),
      activity_type: String(w?.activityType || 'workout').toLowerCase(),
      location_type: String(w?.locationType || '').toLowerCase() || null,
      duration_s: Number(w?.durationS || 0) || null,
      distance_m: Number(w?.distanceM || 0) || null,
      active_kcal: Number(w?.activeKcal || 0) || null,
      avg_hr_bpm: Number(w?.avgHrBpm || 0) || null,
      source,
      was_user_entered: false,
      raw: w,
    };
  });

  if (workoutUpserts.length) {
    const { error } = await supabase.from('workouts').upsert(workoutUpserts, { onConflict: 'user_id,external_id' });
    if (error) return json({ error: error.message }, 400);
  }

  if (dailyTotals.length) {
    const samples = dailyTotals.map((d: any) => ({
      user_id: user.id,
      source,
      type: 'daily_totals',
      start_ts: d?.date ? `${String(d.date).slice(0, 10)}T00:00:00.000Z` : null,
      end_ts: d?.date ? `${String(d.date).slice(0, 10)}T23:59:59.999Z` : null,
      value: d,
    }));
    const { error: sampleErr } = await supabase.from('wearable_samples').insert(samples);
    if (sampleErr) return json({ error: sampleErr.message }, 400);
  }

  await supabase.from('wearable_sync_state').upsert({
    user_id: user.id,
    source,
    last_sync_ts: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  return json({ ok: true, source, workoutsUpserted: workoutUpserts.length, dailyTotalsStored: dailyTotals.length });
});
