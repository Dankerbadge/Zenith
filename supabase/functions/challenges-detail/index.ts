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
  if (req.method !== 'GET') {
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
  const challengeId = String(url.searchParams.get('challengeId') || '').trim();
  if (!challengeId) return new Response(JSON.stringify({ error: 'missing_challenge_id' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const [{ data: challenge, error: challengeErr }, { data: participants, error: participantErr }, { data: events }] = await Promise.all([
    supabase.from('workout_challenges').select('*').eq('id', challengeId).single(),
    supabase.from('workout_challenge_participants').select('*').eq('challenge_id', challengeId),
    supabase.from('workout_challenge_events').select('*').eq('challenge_id', challengeId).order('created_at', { ascending: false }).limit(120),
  ]);
  if (challengeErr) return new Response(JSON.stringify({ error: 'challenge_not_found', detail: challengeErr.message }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  if (participantErr) return new Response(JSON.stringify({ error: 'participants_not_found', detail: participantErr.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const list = Array.isArray(participants) ? participants : [];
  const asc = ascForScore(String((challenge as any)?.score_type || ''));
  const leaderboard = list
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
    })
    .map((row: any, idx: number) => ({ ...row, rank: idx + 1 }));
  const me = list.find((row: any) => String(row?.user_id || '') === userId) || null;

  return new Response(
    JSON.stringify({
      challenge,
      participants: list,
      leaderboard,
      me,
      events: Array.isArray(events) ? events : [],
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});

