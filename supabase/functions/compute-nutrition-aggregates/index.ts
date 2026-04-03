import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type FoodEntry = {
  ts: string;
  meal?: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
};

type DailyLog = {
  foodEntries?: FoodEntry[];
  calories?: number;
  macros?: { protein?: number; carbs?: number; fat?: number };
};

function isoDay(d: Date) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
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

function hourInTimeZone(tsIso: string, timeZone: string): number | null {
  const d = new Date(tsIso);
  if (!Number.isFinite(d.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hour12: false }).formatToParts(d);
    const h = Number(parts.find((p) => p.type === 'hour')?.value);
    return Number.isFinite(h) ? h : null;
  } catch {
    // Invalid time zone string or Intl not available; fall back to UTC hour.
    return d.getUTCHours();
  }
}

function inferMeal(tsIso: string, timeZone: string): 'breakfast' | 'lunch' | 'dinner' | 'snack' {
  const h = hourInTimeZone(tsIso, timeZone);
  if (h == null) return 'snack';
  if (h >= 4 && h < 10) return 'breakfast';
  if (h >= 10 && h < 15) return 'lunch';
  if (h >= 15 && h < 21) return 'dinner';
  return 'snack';
}

function mondayOfWeek(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  const wd = (d.getUTCDay() + 6) % 7; // Monday=0
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

  // Timezone for meal inference (defaults to a stable US timezone).
  const { data: phys } = await supabase.from('user_physiology').select('timezone').eq('user_id', userId).maybeSingle();
  const timeZone = String((phys as any)?.timezone || '').trim() || 'America/New_York';

  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const today = isoDay(new Date());
  const fromDay = String(body?.fromDay || body?.from || '').trim() || isoDay(new Date(Date.now() - 30 * 86400000));
  const toDay = String(body?.toDay || body?.to || '').trim() || today;

  const keys = dailyLogKeysInRange(fromDay, toDay);
  const { data, error } = await supabase
    .from('user_state_snapshots')
    .select('state_key,state_value')
    .eq('user_id', userId)
    .in('state_key', keys);
  if (error) {
    return new Response(JSON.stringify({ error: 'snapshot_query_failed', detail: error.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const byKey = new Map<string, any>();
  for (const r of Array.isArray(data) ? data : []) {
    const k = String((r as any)?.state_key || '');
    if (k) byKey.set(k, (r as any)?.state_value);
  }

  const nutritionRows: any[] = [];
  const weeklyAgg = new Map<string, any>(); // weekStart -> agg

  for (const key of keys) {
    const day = key.replace(/^dailyLog_/, '');
    const raw = byKey.get(key);
    const log: DailyLog = raw && typeof raw === 'object' ? (raw as any) : {};
    const foods = Array.isArray(log.foodEntries) ? log.foodEntries : [];

    let calories = 0;
    let protein = 0;
    let carbs = 0;
    let fat = 0;
    let fiber = 0;
    let firstTs: string | null = null;
    let lastTs: string | null = null;

    const breakdown: any = {};
    for (const meal of ['breakfast', 'lunch', 'dinner', 'snack'] as const) {
      breakdown[meal] = { calories_kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
    }

    for (const f of foods) {
      const c = Number(f?.calories) || 0;
      const p = Number(f?.protein) || 0;
      const ca = Number(f?.carbs) || 0;
      const fa = Number(f?.fat) || 0;
      const fi = Number(f?.fiber) || 0;
      const ts = String(f?.ts || '');
      if (ts) {
        if (!firstTs || ts < firstTs) firstTs = ts;
        if (!lastTs || ts > lastTs) lastTs = ts;
      }
      calories += Math.max(0, c);
      protein += Math.max(0, p);
      carbs += Math.max(0, ca);
      fat += Math.max(0, fa);
      fiber += Math.max(0, fi);

      const meal = (f?.meal as any) || inferMeal(ts, timeZone);
      if (breakdown[meal]) {
        breakdown[meal].calories_kcal += Math.max(0, c);
        breakdown[meal].protein_g += Math.max(0, p);
        breakdown[meal].carbs_g += Math.max(0, ca);
        breakdown[meal].fat_g += Math.max(0, fa);
      }
    }

    // If no entries but legacy daily totals exist, still store totals (meal breakdown empty).
    if (foods.length === 0) {
      calories = Number(log.calories) || 0;
      protein = Number(log.macros?.protein) || 0;
      carbs = Number(log.macros?.carbs) || 0;
      fat = Number(log.macros?.fat) || 0;
    }

    nutritionRows.push({
      user_id: userId,
      day,
      calories_kcal: Math.round(calories),
      protein_g: Math.round(protein * 10) / 10,
      carbs_g: Math.round(carbs * 10) / 10,
      fat_g: Math.round(fat * 10) / 10,
      fiber_g: fiber > 0 ? Math.round(fiber * 10) / 10 : null,
      meal_breakdown: breakdown,
      first_log_ts: firstTs,
      last_log_ts: lastTs,
      computed_at: new Date().toISOString(),
    });

    const weekStart = mondayOfWeek(day);
    const agg = weeklyAgg.get(weekStart) || { days: 0, loggedDays: 0, calories: 0, protein: 0, carbs: 0, fat: 0, topFoods: new Map<string, number>() };
    agg.days += 1;
    if (foods.length > 0) agg.loggedDays += 1;
    agg.calories += calories;
    agg.protein += protein;
    agg.carbs += carbs;
    agg.fat += fat;
    for (const f of foods) {
      const label = String((f as any)?.label || '').trim().toLowerCase();
      if (!label) continue;
      agg.topFoods.set(label, (agg.topFoods.get(label) || 0) + 1);
    }
    weeklyAgg.set(weekStart, agg);
  }

  if (nutritionRows.length) {
    const { error: upsertErr } = await supabase.from('nutrition_daily').upsert(nutritionRows, { onConflict: 'user_id,day' });
    if (upsertErr) {
      return new Response(JSON.stringify({ error: 'nutrition_daily_upsert_failed', detail: upsertErr.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  }

  // Weekly digest rows
  const weeklyRows: any[] = [];
  for (const [weekStart, agg] of weeklyAgg.entries()) {
    const days = Math.max(1, agg.days);
    const loggedDays = agg.loggedDays;
    const topFoods = Array.from(agg.topFoods.entries())
      .sort((a: any, b: any) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name, count }));

    weeklyRows.push({
      user_id: userId,
      week_start: weekStart,
      summary: {
        days,
        loggedDays,
        consistencyPct: Math.round((loggedDays / days) * 100),
        avgCalories: Math.round(agg.calories / days),
        avgProteinG: Math.round((agg.protein / days) * 10) / 10,
        avgCarbsG: Math.round((agg.carbs / days) * 10) / 10,
        avgFatG: Math.round((agg.fat / days) * 10) / 10,
        topFoods,
      },
      generated_at: new Date().toISOString(),
    });
  }

  if (weeklyRows.length) {
    const { error: wErr } = await supabase.from('nutrition_weekly_summaries').upsert(weeklyRows, { onConflict: 'user_id,week_start' });
    if (wErr) {
      return new Response(JSON.stringify({ error: 'weekly_upsert_failed', detail: wErr.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  }

  return new Response(JSON.stringify({ ok: true, fromDay, toDay, days: keys.length }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
