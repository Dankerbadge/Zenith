import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';
type EffortMethod = 'HR_TRIMP' | 'TIME_ONLY';

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function isoDay(d: Date) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseIsoDate(s: string | null) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

function toMinutes(seconds: number) {
  return Math.max(0, seconds) / 60;
}

function trimp(avgHr: number, hrRest: number, hrMax: number, durationMinutes: number, sex: 'male' | 'female' | 'other' | null): number {
  const denom = Math.max(1, hrMax - hrRest);
  const hrr = clamp01((avgHr - hrRest) / denom);
  const k = sex === 'female' ? 1.67 : sex === 'male' ? 1.92 : 1.8;
  return durationMinutes * hrr * Math.exp(k * hrr);
}

function median(nums: number[]): number | null {
  const arr = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (arr.length === 0) return null;
  const mid = Math.floor(arr.length / 2);
  if (arr.length % 2 === 1) return arr[mid];
  return (arr[mid - 1] + arr[mid]) / 2;
}

function isoDayMinus(day: string, deltaDays: number) {
  const d = new Date(`${day}T00:00:00.000Z`);
  return isoDay(new Date(d.getTime() - deltaDays * 86400000));
}

async function sha256Hex(data: string) {
  const enc = new TextEncoder().encode(data);
  const dig = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(dig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToUuidV4Like(hex: string) {
  // Not a true UUIDv4 generator; deterministic uuid-like string for idempotent keys.
  const h = (hex || '').padEnd(32, '0').slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

type DailyLog = {
  workouts?: any[];
};

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

async function loadDailyLogs(supabase: any, userId: string, fromDay: string, toDay: string): Promise<Array<{ day: string; log: DailyLog }>> {
  const keys = dailyLogKeysInRange(fromDay, toDay);
  if (keys.length === 0) return [];
  const { data, error } = await supabase
    .from('user_state_snapshots')
    .select('state_key,state_value')
    .eq('user_id', userId)
    .in('state_key', keys);
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  const byKey = new Map<string, any>();
  for (const r of rows) {
    const k = String((r as any).state_key || '');
    const v = (r as any).state_value;
    if (k) byKey.set(k, v);
  }
  return keys.map((k) => {
    const day = k.replace(/^dailyLog_/, '');
    const log = (byKey.get(k) || {}) as DailyLog;
    return { day, log: log && typeof log === 'object' ? log : {} };
  });
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

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
  const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user?.id) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  const userId = userData.user.id;

  let body: any = null;
  try { body = await req.json(); } catch { body = {}; }
  const today = isoDay(new Date());
  const fromDay = String(body?.fromDay || body?.from || '').trim() || isoDay(new Date(Date.now() - 60 * 86400000));
  const toDay = String(body?.toDay || body?.to || '').trim() || today;

  // Load physiology baselines (best-effort).
  const { data: physRow } = await supabase.from('user_physiology').select('*').eq('user_id', userId).maybeSingle();
  const sexRaw = String((physRow as any)?.sex || '').toLowerCase();
  const sex: 'male' | 'female' | 'other' | null = sexRaw === 'male' ? 'male' : sexRaw === 'female' ? 'female' : sexRaw ? 'other' : null;
  const hrRest = Number((physRow as any)?.hr_rest_bpm);
  const hrMax = Number((physRow as any)?.hr_max_bpm);
  const hrRestKnown = Number.isFinite(hrRest) && hrRest > 0;
  const hrMaxKnown = Number.isFinite(hrMax) && hrMax > 0;

  // Derive missing baselines from snapshots (accuracy-first, but don't hard-block useful load).
  // MEDIUM confidence if derived; HIGH if explicitly set.
  let hrRestFinal = hrRestKnown ? hrRest : null;
  let hrMaxFinal = hrMaxKnown ? hrMax : null;
  let baselineConfidence: Confidence = 'HIGH';
  const baselineReasons: string[] = [];

  if (!hrRestKnown || !hrMaxKnown) {
    const baselineTo = toDay;
    const baselineFrom28 = isoDayMinus(baselineTo, 28);
    const baselineFrom180 = isoDayMinus(baselineTo, 180);
    const baselineLogs28 = await loadDailyLogs(supabase, userId, baselineFrom28, baselineTo);
    const baselineLogs180 = !hrMaxKnown ? await loadDailyLogs(supabase, userId, baselineFrom180, baselineTo) : baselineLogs28;

    if (!hrRestKnown) {
      const rhrs: number[] = [];
      for (const r of baselineLogs28) {
        const wearable = (r.log as any)?.wearableSignals || {};
        const v = Number(wearable?.restingHeartRate);
        if (Number.isFinite(v) && v > 0) rhrs.push(v);
      }
      const med = median(rhrs);
      if (med != null && med > 0) {
        hrRestFinal = Math.round(med);
        baselineConfidence = 'MEDIUM';
        baselineReasons.push('Derived hr_rest_bpm from 28-day median resting HR');
      }
    }

    if (!hrMaxKnown) {
      let maxSeen = 0;
      for (const r of baselineLogs180) {
        const workouts = Array.isArray((r.log as any)?.workouts) ? (r.log as any).workouts : [];
        for (const w of workouts) {
          const v = Number(w?.peakHeartRate ?? w?.maxHeartRate ?? w?.max_hr_bpm);
          if (Number.isFinite(v) && v > maxSeen) maxSeen = v;
        }
      }
      if (maxSeen > 0) {
        hrMaxFinal = Math.round(maxSeen);
        baselineConfidence = 'MEDIUM';
        baselineReasons.push('Derived hr_max_bpm from max observed workout HR (last 180 days)');
      }
    }
  }

  const logs = await loadDailyLogs(supabase, userId, fromDay, toDay);

  const workoutUpserts: any[] = [];
  const effortUpserts: any[] = [];
  const dayLoads = new Map<string, number>();
  const reasonsByWorkout = new Map<string, string[]>();

  for (const { day, log } of logs) {
    const workouts = Array.isArray(log.workouts) ? log.workouts : [];
    for (const w of workouts) {
      const ts = parseIsoDate(String(w?.ts || ''));
      if (!ts) continue;

      const externalId = String(w?.id || '').trim();
      if (!externalId) continue;

      const durationMin =
        Number(w?.durationMin) ||
        Number(w?.minutes) ||
        (Number(w?.minutes) ? Number(w?.minutes) : 0);
      const durationMinutes = Number.isFinite(durationMin) ? Math.max(0, durationMin) : 0;
      if (durationMinutes <= 0) continue;

      const avgHr = Number(w?.avgHeartRate);
      const calories = Number(w?.caloriesBurned);
      const activityType = String(w?.workoutClass || w?.type || 'workout').trim() || 'workout';
      const locationType = null;

      // Deterministic workout id: hash(userId + externalId)
      const uuidHex = await sha256Hex(`${userId}:${externalId}`);
      const workoutId = hexToUuidV4Like(uuidHex);

      const startTs = ts.toISOString();
      const endTs = new Date(ts.getTime() + durationMinutes * 60 * 1000).toISOString();

      workoutUpserts.push({
        id: workoutId,
        user_id: userId,
        external_id: externalId,
        start_ts: startTs,
        end_ts: endTs,
        activity_type: activityType,
        location_type: locationType,
        distance_m: null,
        active_kcal: Number.isFinite(calories) && calories >= 0 ? calories : null,
        avg_hr_bpm: Number.isFinite(avgHr) && avgHr > 0 ? avgHr : null,
        max_hr_bpm: Number.isFinite(Number(w?.peakHeartRate)) ? Number(w?.peakHeartRate) : null,
        elevation_gain_m: null,
        elevation_loss_m: null,
        source: String(w?.sourceAuthority || w?.importedSource || 'phone').trim() || null,
        raw: w,
      });

      let method: EffortMethod | null = null;
      let confidence: Confidence | null = null;
      let effortScore: number | null = null;
      const reasons: string[] = [];

      if (
        Number.isFinite(avgHr) &&
        avgHr > 0 &&
        Number.isFinite(hrRestFinal) &&
        (hrRestFinal as number) > 0 &&
        Number.isFinite(hrMaxFinal) &&
        (hrMaxFinal as number) > 0 &&
        (hrMaxFinal as number) > (hrRestFinal as number)
      ) {
        method = 'HR_TRIMP';
        confidence = baselineConfidence;
        effortScore = trimp(avgHr, hrRestFinal as number, hrMaxFinal as number, durationMinutes, sex);
        reasons.push(...baselineReasons);
      } else {
        // Accuracy-first: do not compute load when baselines are missing.
        if (!Number.isFinite(avgHr) || avgHr <= 0) reasons.push('Missing avg_hr');
        if (!Number.isFinite(hrRestFinal) || (hrRestFinal as number) <= 0) reasons.push('Missing hr_rest_bpm');
        if (!Number.isFinite(hrMaxFinal) || (hrMaxFinal as number) <= 0) reasons.push('Missing hr_max_bpm');
      }

      if (effortScore != null && method && confidence) {
        const scoreRounded = Math.max(0, Math.round(effortScore * 10) / 10);
        effortUpserts.push({
          workout_id: workoutId,
          user_id: userId,
          effort_score: scoreRounded,
          effort_method: method,
          confidence,
          reasons: reasons,
          computed_at: new Date().toISOString(),
        });
        reasonsByWorkout.set(workoutId, reasons);
        dayLoads.set(day, (dayLoads.get(day) || 0) + scoreRounded);
      }
    }
  }

  // Upsert workouts first so FK constraints are satisfied.
  if (workoutUpserts.length) {
    const { error } = await supabase.from('workouts').upsert(workoutUpserts, { onConflict: 'user_id,external_id' });
    if (error) {
      return new Response(JSON.stringify({ error: 'workouts_upsert_failed', detail: error.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  }

  if (effortUpserts.length) {
    // training_load_workouts PK is workout_id, so upsert by PK.
    const { error } = await supabase.from('training_load_workouts').upsert(effortUpserts, { onConflict: 'workout_id' });
    if (error) {
      return new Response(JSON.stringify({ error: 'effort_upsert_failed', detail: error.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  }

  // Compute EWMA series for requested range.
  const days = logs.map((r) => r.day);
  const alphaATL = 2 / (7 + 1);
  const alphaCTL = 2 / (42 + 1);
  let atl = 0;
  let ctl = 0;

  const loadArr = days.map((d) => ({ day: d, load: dayLoads.get(d) || 0 }));
  const weeklyWindow: number[] = [];
  const weeklySum = () => weeklyWindow.reduce((a, b) => a + b, 0);
  const dailyRows: any[] = [];

  for (const row of loadArr) {
    atl = atl + alphaATL * (row.load - atl);
    ctl = ctl + alphaCTL * (row.load - ctl);
    const form = ctl - atl;

    weeklyWindow.push(row.load);
    if (weeklyWindow.length > 7) weeklyWindow.shift();
    const weekly_load = weeklySum();

    dailyRows.push({
      user_id: userId,
      day: row.day,
      atl: Math.round(atl * 100) / 100,
      ctl: Math.round(ctl * 100) / 100,
      form: Math.round(form * 100) / 100,
      weekly_load: Math.round(weekly_load * 100) / 100,
      ramp_rate: null,
      computed_at: new Date().toISOString(),
    });
  }

  // ramp_rate: compare current 7-day sum with previous 7-day sum (best-effort using this range only).
  for (let i = 0; i < dailyRows.length; i += 1) {
    const prevWeekStart = Math.max(0, i - 7);
    const prevWeekSum = loadArr.slice(prevWeekStart, i).reduce((a, b) => a + (b.load || 0), 0);
    const thisWeekSum = loadArr.slice(Math.max(0, i - 6), i + 1).reduce((a, b) => a + (b.load || 0), 0);
    dailyRows[i].ramp_rate = Math.round((thisWeekSum - prevWeekSum) * 100) / 100;
  }

  if (dailyRows.length) {
    const { error } = await supabase.from('training_load_daily').upsert(dailyRows, { onConflict: 'user_id,day' });
    if (error) {
      return new Response(JSON.stringify({ error: 'daily_upsert_failed', detail: error.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  }

  const response = {
    ok: true,
    fromDay,
    toDay,
    workoutsSeen: workoutUpserts.length,
    workoutsWithEffort: effortUpserts.length,
    hrBaselines: {
      hr_rest_bpm: Number.isFinite(hrRestFinal) ? Math.round(hrRestFinal as number) : null,
      hr_max_bpm: Number.isFinite(hrMaxFinal) ? Math.round(hrMaxFinal as number) : null,
      confidence: baselineConfidence,
      reasons: baselineReasons,
    },
  };

  return new Response(JSON.stringify(response), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
