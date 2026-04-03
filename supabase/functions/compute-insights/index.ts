import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Tier = 'HIGH' | 'MEDIUM' | 'LOW';

function isoDay(d: Date) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function dayMinus(day: string, deltaDays: number) {
  const d = new Date(`${day}T00:00:00.000Z`);
  return isoDay(new Date(d.getTime() - deltaDays * 86400000));
}

function mondayOfWeek(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  const wd = (d.getUTCDay() + 6) % 7;
  const monday = new Date(d.getTime() - wd * 86400000);
  return isoDay(monday);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'missing_authorization' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user?.id) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  const userId = userData.user.id;

  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const day = String(body?.day || '').trim() || isoDay(new Date());
  const fromDay = dayMinus(day, 28);

  // Pull last 28 days nutrition + load + readiness
  const [{ data: nutRows }, { data: tlRows }, { data: rdRows }] = await Promise.all([
    supabase.from('nutrition_daily').select('*').eq('user_id', userId).gte('day', fromDay).lte('day', day),
    supabase.from('training_load_daily').select('*').eq('user_id', userId).gte('day', fromDay).lte('day', day),
    supabase.from('readiness_daily').select('*').eq('user_id', userId).gte('day', fromDay).lte('day', day),
  ]);

  const nutrition = Array.isArray(nutRows) ? nutRows : [];
  const tl = Array.isArray(tlRows) ? tlRows : [];
  const readiness = Array.isArray(rdRows) ? rdRows : [];

  const insights: any[] = [];

  // A) FUELING_PROTEIN: last 7 days logged >= 5 and protein < 0.8 * goal.
  const weekFrom = dayMinus(day, 6);
  const last7 = nutrition.filter((r: any) => String(r.day) >= weekFrom && String(r.day) <= day);
  const loggedDays = last7.filter((r: any) => Number(r.protein_g) > 0 || Number(r.calories_kcal) > 0).length;

  // Protein goal comes from user profile snapshot if present. Best-effort.
  // Real keys are `userProfile` (legacy) and `userProfile:<canonical-email>`.
  const profResp = await supabase
    .from('user_state_snapshots')
    .select('state_key,state_value,updated_at')
    .eq('user_id', userId)
    .or('state_key.eq.userProfile,state_key.like.userProfile:%')
    .order('updated_at', { ascending: false })
    .limit(5);
  let proteinGoal = 0;
  if (!profResp.error && Array.isArray(profResp.data)) {
    for (const row of profResp.data) {
      const v = (row as any)?.state_value;
      const g = Number(v?.goals?.proteinTarget);
      if (Number.isFinite(g) && g > 0) {
        proteinGoal = g;
        break;
      }
    }
  }

  if (proteinGoal > 0 && loggedDays >= 5) {
    const avgProtein = last7.reduce((sum: number, r: any) => sum + (Number(r.protein_g) || 0), 0) / 7;
    if (avgProtein < proteinGoal * 0.8) {
      const tier: Tier = loggedDays >= 6 ? 'HIGH' : 'MEDIUM';
      insights.push({
        user_id: userId,
        day,
        type: 'FUELING_PROTEIN',
        title: 'Protein trending low',
        body: 'Your logged protein is trending below your target. Consider adding a protein-forward snack or increasing protein at your next meal.',
        data: { avgProteinG: Math.round(avgProtein * 10) / 10, goalProteinG: proteinGoal, daysLogged: loggedDays },
        confidence: tier,
      });
    }
  }

  // D) TRAINING_RAMP_RATE: if ramp_rate is high.
  const tlToday = tl.find((r: any) => String(r.day) === day);
  if (tlToday && Number.isFinite(Number(tlToday.ramp_rate))) {
    const ramp = Number(tlToday.ramp_rate);
    if (ramp > 25) {
      insights.push({
        user_id: userId,
        day,
        type: 'TRAINING_RAMP_RATE',
        title: 'Training ramp is steep',
        body: 'Your recent weekly load is rising quickly. Consider adding an easier day to protect consistency.',
        data: { rampRate: ramp, weeklyLoad: Number(tlToday.weekly_load) || null },
        confidence: 'MEDIUM',
      });
    }
  }

  // E) RECOVERY_LOW_READINESS_STREAK: readiness < 50 for 3 consecutive days.
  const rMap = new Map<string, number>();
  for (const r of readiness) rMap.set(String((r as any).day), Number((r as any).readiness_score) || 0);
  const r0 = rMap.get(day) ?? null;
  const r1 = rMap.get(dayMinus(day, 1)) ?? null;
  const r2 = rMap.get(dayMinus(day, 2)) ?? null;
  if ([r0, r1, r2].every((v) => typeof v === 'number' && v < 50)) {
    insights.push({
      user_id: userId,
      day,
      type: 'RECOVERY_LOW_READINESS_STREAK',
      title: 'Recovery trending low',
      body: 'Readiness has been low for three days. Consider a recovery-focused day: lighter training, earlier bedtime, and hydration.',
      data: { readiness: [r2, r1, r0] },
      confidence: 'MEDIUM',
    });
  }

  // De-dupe: one per type per day.
  const unique = new Map<string, any>();
  for (const i of insights) unique.set(`${i.type}:${i.day}`, i);
  const rows = Array.from(unique.values()).map((i) => ({
    ...i,
    dismissed_at: null,
    created_at: new Date().toISOString(),
  }));

  if (rows.length) {
    // idempotent-ish: delete existing types for that day first (RLS-safe), then insert.
    const types = rows.map((r) => r.type);
    await supabase.from('insights').delete().eq('user_id', userId).eq('day', day).in('type', types);
    const { error: insErr } = await supabase.from('insights').insert(rows);
    if (insErr) {
      return new Response(JSON.stringify({ error: 'insert_failed', detail: insErr.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  }

  return new Response(JSON.stringify({ ok: true, day, inserted: rows.length, weekStart: mondayOfWeek(day) }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
