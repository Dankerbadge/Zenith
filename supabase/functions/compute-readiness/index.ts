import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';
type Recommendation = 'PUSH' | 'MAINTAIN' | 'RECOVER';

function isoDay(d: Date) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function clamp(x: number, a: number, b: number) {
  return Math.max(a, Math.min(b, x));
}

function isoDayMinus(day: string, deltaDays: number) {
  const d = new Date(`${day}T00:00:00.000Z`);
  return isoDay(new Date(d.getTime() - deltaDays * 86400000));
}

function median(nums: number[]): number | null {
  const arr = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (arr.length === 0) return null;
  const mid = Math.floor(arr.length / 2);
  if (arr.length % 2 === 1) return arr[mid];
  return (arr[mid - 1] + arr[mid]) / 2;
}

function dailyLogKeysInRange(fromDay: string, toDay: string) {
  const out: string[] = [];
  const from = new Date(`${fromDay}T00:00:00.000Z`);
  const to = new Date(`${toDay}T00:00:00.000Z`);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) return out;
  for (let t = from.getTime(); t <= to.getTime(); t += 86400000) {
    out.push(`dailyLog_${isoDay(new Date(t))}`);
  }
  return out;
}

async function deriveRhrBaseline(supabase: any, userId: string, day: string): Promise<number | null> {
  const fromDay = isoDayMinus(day, 28);
  const keys = dailyLogKeysInRange(fromDay, day);
  if (keys.length === 0) return null;
  const { data, error } = await supabase
    .from('user_state_snapshots')
    .select('state_key,state_value')
    .eq('user_id', userId)
    .in('state_key', keys);
  if (error) return null;
  const vals: number[] = [];
  for (const r of Array.isArray(data) ? data : []) {
    const log = (r as any)?.state_value || {};
    const wearable = (log as any)?.wearableSignals || {};
    const v = Number(wearable?.restingHeartRate);
    if (Number.isFinite(v) && v > 0) vals.push(v);
  }
  const m = median(vals);
  return m != null && m > 0 ? Math.round(m) : null;
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

  const key = `dailyLog_${day}`;
  const { data: snapshot, error: snapErr } = await supabase
    .from('user_state_snapshots')
    .select('state_value')
    .eq('user_id', userId)
    .eq('state_key', key)
    .maybeSingle();
  if (snapErr) {
    return new Response(JSON.stringify({ error: 'snapshot_query_failed', detail: snapErr.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const log = (snapshot as any)?.state_value || {};
  const wearable = (log as any)?.wearableSignals || {};
  const sleepMinutes = Number(wearable?.sleepMinutes);
  const restingHr = Number(wearable?.restingHeartRate);

  // Training load for strain score.
  const { data: tlRow } = await supabase.from('training_load_daily').select('atl,ctl,form').eq('user_id', userId).eq('day', day).maybeSingle();
  const form = Number((tlRow as any)?.form);

  const reasons: string[] = [];

  // Sleep (0-40)
  const targetHours = 8;
  let sleepScoreMax = 40;
  let sleepScore = 0;
  if (Number.isFinite(sleepMinutes) && sleepMinutes > 0) {
    const hours = sleepMinutes / 60;
    const ratio = clamp(hours / targetHours, 0, 1);
    sleepScore = Math.round(sleepScoreMax * ratio);
    if (ratio < 0.85) reasons.push('Sleep duration below target');
  } else {
    sleepScoreMax = 0;
    reasons.push('Sleep data missing');
  }

  // RHR (0-20) vs baseline, if available.
  let rhrScoreMax = 20;
  let rhrScore = 0;
  const { data: phys } = await supabase.from('user_physiology').select('rhr_baseline_bpm').eq('user_id', userId).maybeSingle();
  const rhrBaselineStored = Number((phys as any)?.rhr_baseline_bpm);
  const rhrBaselineDerived = (!Number.isFinite(rhrBaselineStored) || rhrBaselineStored <= 0) ? await deriveRhrBaseline(supabase, userId, day) : null;
  const rhrBaseline = Number.isFinite(rhrBaselineStored) && rhrBaselineStored > 0 ? rhrBaselineStored : rhrBaselineDerived;

  if (Number.isFinite(restingHr) && restingHr > 0 && Number.isFinite(rhrBaseline) && (rhrBaseline as number) > 0) {
    const delta = restingHr - (rhrBaseline as number);
    if (delta <= -2) rhrScore = 20;
    else if (delta <= 2) rhrScore = 16;
    else if (delta <= 6) rhrScore = 10;
    else rhrScore = 4;
    if (delta > 2) reasons.push('Resting HR above baseline');
    if (rhrBaselineDerived != null) reasons.push('Resting HR baseline derived from recent history');
  } else {
    rhrScoreMax = 0;
    reasons.push('Resting HR baseline missing');
  }

  // HRV is not currently present in local snapshots; keep slot for future.
  const hrvScoreMax = 0;
  const hrvScore = 0;

  // Strain (0-15) based on FORM.
  let strainScoreMax = 15;
  let strainScore = 0;
  if (Number.isFinite(form)) {
    if (form < -10) strainScore = 5;
    else if (form < -3) strainScore = 9;
    else strainScore = 15;
    if (form < -10) reasons.push('High fatigue (form very negative)');
  } else {
    strainScoreMax = 0;
    reasons.push('Training load missing');
  }

  const maxPossible = sleepScoreMax + rhrScoreMax + hrvScoreMax + strainScoreMax;
  const raw = sleepScore + rhrScore + hrvScore + strainScore;
  const readiness = maxPossible > 0 ? Math.round((raw / maxPossible) * 100) : 0;

  let confidence: Confidence = 'LOW';
  if (sleepScoreMax > 0 && rhrScoreMax > 0 && strainScoreMax > 0) confidence = 'MEDIUM';
  if (sleepScoreMax > 0 && rhrScoreMax > 0 && strainScoreMax > 0 && hrvScoreMax > 0) confidence = 'HIGH';

  let recommendation: Recommendation = 'MAINTAIN';
  if (readiness >= 75 && (!Number.isFinite(form) || form >= -5)) recommendation = 'PUSH';
  else if (readiness < 50 || (Number.isFinite(form) && form < -10)) recommendation = 'RECOVER';

  const row = {
    user_id: userId,
    day,
    readiness_score: readiness,
    sleep_score: sleepScoreMax ? sleepScore : null,
    hrv_score: hrvScoreMax ? hrvScore : null,
    rhr_score: rhrScoreMax ? rhrScore : null,
    strain_score: strainScoreMax ? strainScore : null,
    recommendation,
    confidence,
    reasons,
    computed_at: new Date().toISOString(),
  };

  const { error: upErr } = await supabase.from('readiness_daily').upsert(row, { onConflict: 'user_id,day' });
  if (upErr) {
    return new Response(JSON.stringify({ error: 'upsert_failed', detail: upErr.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ ok: true, day, readiness, recommendation, confidence }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
