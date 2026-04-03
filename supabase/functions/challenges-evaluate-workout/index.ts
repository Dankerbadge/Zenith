import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { evaluateWorkoutForChallenge } from '../_shared/challenge-scoring.ts';
import type { ChallengeRecord, WorkoutRecord } from '../_shared/challenge-types.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function isAscendingScore(scoreType: string) {
  const s = String(scoreType || '').toUpperCase();
  return s === 'FASTEST_TIME_FOR_DISTANCE' || s === 'BEST_AVG_PACE_FOR_DISTANCE';
}

function haversineMeters(aLat: number, aLon: number, bLat: number, bLon: number) {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLon / 2);
  const aa = s1 * s1 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * s2 * s2;
  return 2 * R * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
}

function normalizeRoutePoints(points: any[]): Array<{ seq: number; ts: string; dist_m: number; lat: number | null; lon: number | null }> {
  const ordered = (Array.isArray(points) ? points : [])
    .map((row, idx) => ({
      seq: Number(row?.seq ?? idx),
      ts: String(row?.ts || ''),
      dist_m: Number(row?.dist_m),
      lat: row?.lat == null ? null : Number(row.lat),
      lon: row?.lon == null ? null : Number(row.lon),
    }))
    .filter((row) => row.ts && Number.isFinite(Date.parse(row.ts)))
    .sort((a, b) => a.seq - b.seq);
  if (!ordered.length) return [];

  let cumulative = 0;
  for (let i = 0; i < ordered.length; i += 1) {
    const row = ordered[i];
    if (Number.isFinite(row.dist_m) && row.dist_m >= 0) {
      cumulative = Math.max(cumulative, row.dist_m);
      row.dist_m = cumulative;
      continue;
    }
    if (i === 0) {
      row.dist_m = 0;
      continue;
    }
    const prev = ordered[i - 1];
    if (
      prev.lat != null &&
      prev.lon != null &&
      row.lat != null &&
      row.lon != null &&
      Number.isFinite(prev.lat) &&
      Number.isFinite(prev.lon) &&
      Number.isFinite(row.lat) &&
      Number.isFinite(row.lon)
    ) {
      cumulative += haversineMeters(prev.lat, prev.lon, row.lat, row.lon);
    }
    row.dist_m = cumulative;
  }

  return ordered.map((row) => ({
    seq: row.seq,
    ts: row.ts,
    dist_m: Number(row.dist_m.toFixed(2)),
    lat: row.lat,
    lon: row.lon,
  }));
}

async function updateParticipantProgress(supabase: any, input: {
  challenge: ChallengeRecord;
  participant: any;
  workout: WorkoutRecord;
  score: number | null;
  completionState: string;
  scoringMeta?: Record<string, any>;
}) {
  const current = input.participant || {};
  const currentScore = Number(current?.best_score);
  const nextScore = Number(input.score);
  const hasCurrent = Number.isFinite(currentScore);
  const hasNext = Number.isFinite(nextScore);
  const asc = isAscendingScore(input.challenge.score_type);
  let shouldReplaceBest = false;
  if (!hasCurrent && hasNext) shouldReplaceBest = true;
  if (hasCurrent && hasNext) shouldReplaceBest = asc ? nextScore < currentScore : nextScore > currentScore;

  const prevProgress = current?.progress && typeof current.progress === 'object' ? current.progress : {};
  const qualifyingCount = Math.max(0, Number(prevProgress?.qualifyingWorkoutsCount || 0)) + 1;
  const cumulativeDistanceM = Math.max(0, Number(prevProgress?.cumulativeDistanceM || 0)) + Math.max(0, Number(input.workout.distance_m || 0));
  const durationS = Number(input.workout.duration_s || 0);
  const cumulativeTimeS = Math.max(0, Number(prevProgress?.cumulativeTimeS || 0)) + (Number.isFinite(durationS) && durationS > 0 ? durationS : 0);

  const progress = {
    ...prevProgress,
    qualifyingWorkoutsCount: qualifyingCount,
    lastEvaluatedAt: new Date().toISOString(),
    cumulativeDistanceM,
    cumulativeTimeS,
    bestAttempt: shouldReplaceBest
      ? {
          workoutId: input.workout.id,
          score: hasNext ? nextScore : null,
          occurredAt: input.workout.start_ts,
        }
      : prevProgress?.bestAttempt || null,
    ...(Array.isArray(input.scoringMeta?.splitTimesS)
      ? {
          lastComputedSplits: {
            splitTimesS: (input.scoringMeta.splitTimesS as number[]).slice(0, 50),
            unitM: Number(input.scoringMeta.unitM || 0) || null,
            computedAt: new Date().toISOString(),
            truncated: Boolean(input.scoringMeta.truncated),
          },
        }
      : {}),
  };

  const patch: Record<string, any> = {
    completion_state: input.completionState,
    progress,
    updated_at: new Date().toISOString(),
  };
  if (shouldReplaceBest) {
    patch.best_score = hasNext ? nextScore : null;
    patch.best_workout_id = input.workout.id;
  }

  const { error } = await supabase
    .from('workout_challenge_participants')
    .update(patch)
    .eq('challenge_id', input.challenge.id)
    .eq('user_id', input.participant.user_id);
  if (error) throw error;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  const authHeader = String(req.headers.get('Authorization') || '');
  if (!authHeader) return new Response(JSON.stringify({ error: 'missing_authorization' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const internalServiceCall = Boolean(serviceRoleKey && bearer && bearer === serviceRoleKey);

  const supabase = createClient(supabaseUrl, internalServiceCall ? serviceRoleKey : anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  let callerUserId: string | null = null;
  if (!internalServiceCall) {
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user?.id) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    callerUserId = String(auth.user.id);
  }

  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const workoutId = String(body?.workoutId || '').trim();
  if (!workoutId) return new Response(JSON.stringify({ error: 'missing_workout_id' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const { data: workoutRow, error: workoutErr } = await supabase.from('workouts').select('*').eq('id', workoutId).single();
  if (workoutErr || !workoutRow) {
    return new Response(JSON.stringify({ error: 'workout_not_found', detail: workoutErr?.message || 'unknown' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  const workout = {
    id: String((workoutRow as any).id || ''),
    user_id: String((workoutRow as any).user_id || ''),
    start_ts: String((workoutRow as any).start_ts || ''),
    end_ts: String((workoutRow as any).end_ts || ''),
    activity_type: String((workoutRow as any).activity_type || ''),
    location_type: (workoutRow as any).location_type ?? null,
    duration_s: Number((workoutRow as any).duration_s ?? ((Date.parse(String((workoutRow as any).end_ts || '')) - Date.parse(String((workoutRow as any).start_ts || ''))) / 1000)),
    distance_m: Number((workoutRow as any).distance_m),
    source: String((workoutRow as any).source || ''),
    was_user_entered: Boolean((workoutRow as any).was_user_entered),
    route_points: (workoutRow as any).route_points ?? null,
    avg_hr_bpm: Number((workoutRow as any).avg_hr_bpm),
  } as WorkoutRecord;
  if (!workout.user_id) return new Response(JSON.stringify({ error: 'invalid_workout_user' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  if (!internalServiceCall && callerUserId !== workout.user_id) {
    return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  if (Array.isArray(workout.route_points) && workout.route_points.length > 0) {
    workout.route_points = normalizeRoutePoints(workout.route_points as any);
  } else {
    const { data: routePointRows } = await supabase
      .from('workout_route_points')
      .select('seq,ts,dist_m,lat,lon')
      .eq('workout_id', workout.id)
      .order('seq', { ascending: true })
      .limit(10000);
    if (Array.isArray(routePointRows) && routePointRows.length > 0) {
      workout.route_points = normalizeRoutePoints(routePointRows as any);
    }
  }

  const [{ data: participants, error: pErr }, { data: challenges, error: cErr }] = await Promise.all([
    supabase
      .from('workout_challenge_participants')
      .select('*')
      .eq('user_id', workout.user_id)
      .eq('status', 'ACCEPTED'),
    supabase
      .from('workout_challenges')
      .select('*')
      .gte('end_ts', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .limit(500),
  ]);
  if (pErr) return new Response(JSON.stringify({ error: 'participant_query_failed', detail: pErr.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  if (cErr) return new Response(JSON.stringify({ error: 'challenge_query_failed', detail: cErr.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const participantRows = Array.isArray(participants) ? participants : [];
  const challengeMap = new Map<string, any>((Array.isArray(challenges) ? challenges : []).map((row: any) => [String(row.id), row]));
  const updates: Array<{ challengeId: string; accepted: boolean; reasonCodes: string[] }> = [];

  for (const participant of participantRows) {
    const challenge = challengeMap.get(String((participant as any).challenge_id || ''));
    if (!challenge) continue;
    const result = evaluateWorkoutForChallenge(challenge as ChallengeRecord, workout as WorkoutRecord);
    if (!result.accepted) {
      const reasonCode = String(result.reasonCodes[0] || 'WRONG_ACTIVITY');
      await supabase.from('workout_challenge_events').insert({
        challenge_id: challenge.id,
        user_id: workout.user_id,
        type: 'WORKOUT_REJECTED',
        data: { workoutId: workout.id, reasonCode, reasonCodes: result.reasonCodes },
      });
      updates.push({ challengeId: challenge.id, accepted: false, reasonCodes: result.reasonCodes });
      continue;
    }

    await updateParticipantProgress(supabase, {
      challenge: challenge as ChallengeRecord,
      participant,
      workout: workout as WorkoutRecord,
      score: result.score,
      completionState: result.completionState,
      scoringMeta: result.scoringMeta,
    });

    await supabase.from('workout_challenge_events').insert({
      challenge_id: challenge.id,
      user_id: workout.user_id,
      type: result.completionState === 'COMPLETED' ? 'COMPLETED' : 'WORKOUT_COUNTED',
      data: {
        workoutId: workout.id,
        score: result.score,
        completionState: result.completionState,
      },
    });
    updates.push({ challengeId: challenge.id, accepted: true, reasonCodes: [] });
  }

  return new Response(JSON.stringify({ ok: true, workoutId, updates }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
