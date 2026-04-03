import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function ascForScore(scoreType: string) {
  const s = String(scoreType || '').toUpperCase();
  return s === 'FASTEST_TIME_FOR_DISTANCE' || s === 'BEST_AVG_PACE_FOR_DISTANCE';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response(JSON.stringify({ error: 'missing_authorization' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user?.id) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  const userId = auth.user.id;

  const url = new URL(req.url);
  const scope = String(url.searchParams.get('scope') || 'active').toLowerCase();
  const now = Date.now();
  const { data, error } = await supabase
    .from('workout_challenge_participants')
    .select('*,workout_challenges(*)')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(200);
  if (error) return new Response(JSON.stringify({ error: 'query_failed', detail: error.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const rows = Array.isArray(data) ? data : [];
  const filtered = rows.filter((row: any) => {
    const challenge = row?.workout_challenges;
    if (!challenge) return false;
    const endTs = Date.parse(String(challenge?.end_ts || ''));
    if (scope === 'invites') return String(row?.status || '') === 'INVITED';
    if (scope === 'past') return Number.isFinite(endTs) && endTs < now;
    return Number.isFinite(endTs) ? endTs >= now : true;
  });
  const challengeIds = Array.from(new Set(filtered.map((row: any) => String(row?.challenge_id || '')).filter(Boolean)));
  const participantsByChallenge = new Map<string, any[]>();
  if (challengeIds.length) {
    const { data: participantRows } = await supabase
      .from('workout_challenge_participants')
      .select('*')
      .in('challenge_id', challengeIds)
      .limit(1000);
    (Array.isArray(participantRows) ? participantRows : []).forEach((row: any) => {
      const key = String(row?.challenge_id || '');
      if (!key) return;
      const list = participantsByChallenge.get(key) || [];
      list.push(row);
      participantsByChallenge.set(key, list);
    });
  }

  const payload = filtered.map((row: any) => {
    const challenge = row?.workout_challenges || {};
    const list = participantsByChallenge.get(String(row?.challenge_id || '')) || [];
    const asc = ascForScore(String(challenge?.score_type || ''));
    const board = list
      .slice()
      .sort((a: any, b: any) => {
        const av = Number(a?.best_score);
        const bv = Number(b?.best_score);
        const aMissing = !Number.isFinite(av);
        const bMissing = !Number.isFinite(bv);
        if (aMissing && bMissing) return 0;
        if (aMissing) return 1;
        if (bMissing) return -1;
        return asc ? av - bv : bv - av;
      });
    const myRank = board.findIndex((p: any) => String(p?.user_id || '') === userId) + 1;
    return { challenge, me: row, leaderboard: board.slice(0, 10), myRank: myRank > 0 ? myRank : null };
  });

  return new Response(JSON.stringify({ challenges: payload }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});

