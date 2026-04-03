import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function isoDay(d: Date) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function csvEscape(value: any) {
  const s = String(value ?? '');
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/\"/g, '""')}"`;
  }
  return s;
}

function buildCsv(rows: any[]) {
  const header = ['day', 'calories_kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'first_log_ts', 'last_log_ts'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([
      csvEscape(r.day),
      csvEscape(r.calories_kcal ?? ''),
      csvEscape(r.protein_g ?? ''),
      csvEscape(r.carbs_g ?? ''),
      csvEscape(r.fat_g ?? ''),
      csvEscape(r.fiber_g ?? ''),
      csvEscape(r.first_log_ts ?? ''),
      csvEscape(r.last_log_ts ?? ''),
    ].join(','));
  }
  return lines.join('\n');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'GET') {
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

  const url = new URL(req.url);
  const from = url.searchParams.get('from') || isoDay(new Date(Date.now() - 30 * 86400000));
  const to = url.searchParams.get('to') || isoDay(new Date());

  const { data, error } = await supabase
    .from('nutrition_daily')
    .select('day,calories_kcal,protein_g,carbs_g,fat_g,fiber_g,first_log_ts,last_log_ts')
    .eq('user_id', userId)
    .gte('day', from)
    .lte('day', to)
    .order('day', { ascending: true });

  if (error) {
    return new Response(JSON.stringify({ error: 'query_failed', detail: error.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const rows = Array.isArray(data) ? data : [];
  const csv = buildCsv(rows);

  // P0: return CSV directly. Storage-backed exports can be added once bucket conventions are finalized.
  return new Response(csv, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename=${csvEscape(`zenith_nutrition_${from}_to_${to}.csv`)}`,
    },
  });
});

