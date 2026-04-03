import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { evaluateWorkoutForChallenge } from '../_shared/challenge-scoring.ts';

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
  if (req.method !== 'POST') {
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

  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const challengeId = String(body?.challengeId || '').trim();
  if (!challengeId) return new Response(JSON.stringify({ error: 'missing_challenge_id' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const { data: challenge, error: challengeErr } = await supabase.from('workout_challenges').select('*').eq('id', challengeId).single();
  if (challengeErr || !challenge) return new Response(JSON.stringify({ error: 'challenge_not_found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  if (String((challenge as any).creator_user_id || '') !== userId) return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const { data: participants } = await supabase
    .from('workout_challenge_participants')
    .select('*')
    .eq('challenge_id', challengeId)
    .eq('status', 'ACCEPTED');
  const list = Array.isArray(participants) ? participants : [];

  for (const p of list) {
    const uid = String((p as any).user_id || '');
    if (!uid) continue;
    const { data: workouts } = await supabase
      .from('workouts')
      .select('*')
      .eq('user_id', uid)
      .gte('start_ts', (challenge as any).start_ts)
      .lte('start_ts', (challenge as any).end_ts)
      .order('start_ts', { ascending: true })
      .limit(1000);
    const wRows = Array.isArray(workouts) ? workouts : [];
    let bestScore: number | null = null;
    let bestWorkoutId: string | null = null;
    let qualifying = 0;
    let rejected = 0;
    let cumDist = 0;
    let cumTime = 0;
    const asc = ascForScore(String((challenge as any).score_type || ''));
    let completionState: string = 'NOT_STARTED';

    for (const row of wRows) {
      const result = evaluateWorkoutForChallenge(challenge as any, row as any);
      if (!result.accepted) {
        rejected += 1;
        continue;
      }
      qualifying += 1;
      const dist = Number((row as any).distance_m);
      const durationS = Number((row as any).duration_s ?? ((Date.parse(String((row as any).end_ts || '')) - Date.parse(String((row as any).start_ts || ''))) / 1000));
      if (Number.isFinite(dist) && dist > 0) cumDist += dist;
      if (Number.isFinite(durationS) && durationS > 0) cumTime += durationS;
      if (typeof result.score === 'number' && Number.isFinite(result.score)) {
        if (bestScore == null) {
          bestScore = result.score;
          bestWorkoutId = String((row as any).id || '');
        } else if (asc ? result.score < bestScore : result.score > bestScore) {
          bestScore = result.score;
          bestWorkoutId = String((row as any).id || '');
        }
      }
      if (result.completionState === 'COMPLETED') completionState = 'COMPLETED';
      else if (completionState !== 'COMPLETED') completionState = 'IN_PROGRESS';
    }

    await supabase
      .from('workout_challenge_participants')
      .update({
        best_score: bestScore,
        best_workout_id: bestWorkoutId,
        completion_state: completionState,
        progress: {
          qualifyingWorkoutsCount: qualifying,
          rejectedWorkoutsCount: rejected,
          cumulativeDistanceM: cumDist,
          cumulativeTimeS: cumTime,
          lastEvaluatedAt: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      })
      .eq('challenge_id', challengeId)
      .eq('user_id', uid);
  }

  await supabase.from('workout_challenge_events').insert({
    challenge_id: challengeId,
    user_id: userId,
    type: 'LEADERBOARD_CHANGE',
    data: { recomputed: true },
  });

  return new Response(JSON.stringify({ ok: true, challengeId, participantsRecomputed: list.length }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});

