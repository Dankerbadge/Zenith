import { isSupabaseConfigured, socialApi, supabase } from './supabaseClient';

export type ActivityType =
  | 'RUN_OUTDOOR'
  | 'RUN_TREADMILL'
  | 'WALK_OUTDOOR'
  | 'WALK_INDOOR'
  | 'CYCLE_OUTDOOR'
  | 'CYCLE_INDOOR'
  | 'HIKE'
  | 'SWIM_POOL'
  | 'SWIM_OPEN_WATER'
  | 'ROW_INDOOR'
  | 'ROW_OUTDOOR'
  | 'ELLIPTICAL'
  | 'STRENGTH'
  | 'HIIT';

export type ChallengeMode = 'SINGLE_SESSION' | 'CUMULATIVE';
export type ScoreType =
  | 'FASTEST_TIME_FOR_DISTANCE'
  | 'LONGEST_DISTANCE'
  | 'MOST_DISTANCE_CUMULATIVE'
  | 'MOST_TIME_CUMULATIVE'
  | 'BEST_AVG_PACE_FOR_DISTANCE'
  | 'COMPLETION_ONLY'
  | 'SPLITS_COMPLIANCE';

export type ChallengeParticipantStatus = 'INVITED' | 'ACCEPTED' | 'DECLINED' | 'LEFT';
export type ChallengeCompletionState = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
export type Visibility = 'PRIVATE' | 'TEAM' | 'PUBLIC';
export type ReasonCode =
  | 'OUT_OF_WINDOW'
  | 'WRONG_ACTIVITY'
  | 'WRONG_LOCATION'
  | 'SOURCE_NOT_ALLOWED'
  | 'USER_ENTERED_NOT_ALLOWED'
  | 'ROUTE_REQUIRED_MISSING'
  | 'DISTANCE_REQUIRED_MISSING'
  | 'HR_REQUIRED_MISSING'
  | 'BELOW_MIN_DURATION'
  | 'BELOW_MIN_DISTANCE'
  | 'DISTANCE_OUTSIDE_TOLERANCE'
  | 'SPLITS_DATA_MISSING'
  | 'SPLITS_RULE_FAILED';

export type ChallengeRules = {
  target: {
    distanceM?: number | null;
    timeS?: number | null;
    paceSPerKm?: number | null;
    splits?: {
      splitType: 'DISTANCE' | 'TIME';
      splitUnitM?: number | null;
      numSplits?: number | null;
      maxSplitTimeS?: number | null;
      maxPaceSPerKm?: number | null;
      mustNegativeSplit?: boolean | null;
      toleranceS?: number;
    } | null;
  };
  constraints: {
    locationRequirement: 'OUTDOOR_ONLY' | 'INDOOR_ONLY' | 'EITHER';
    requiresRoute: boolean;
    requiresHeartRate?: boolean;
    requiresNonUserEntered: boolean;
    allowedSources: Array<'WATCH' | 'PHONE' | 'IMPORT'>;
    distanceTolerancePct?: number;
    allowLongerWorkoutForDistanceGoal?: boolean;
    minDurationS?: number | null;
    minDistanceM?: number | null;
    timezonePolicy?: 'CREATOR_TIMEZONE';
  };
  attemptPolicy: {
    attemptsAllowed: 'UNLIMITED' | 'FIRST_ONLY' | 'BEST_ONLY';
    bestBy: 'TIME_ASC' | 'DIST_DESC' | 'PACE_ASC';
  };
};

export type WorkoutChallenge = {
  id: string;
  creator_user_id: string;
  title: string;
  description?: string | null;
  activity_type: ActivityType;
  mode: ChallengeMode;
  score_type: ScoreType;
  rules: ChallengeRules;
  start_ts: string;
  end_ts: string;
  visibility: Visibility;
  team_id?: string | null;
  created_at: string;
};

export type WorkoutChallengeParticipant = {
  id: string;
  challenge_id: string;
  user_id: string;
  role: string;
  status: ChallengeParticipantStatus;
  joined_at?: string | null;
  best_score?: number | null;
  best_workout_id?: string | null;
  completion_state: ChallengeCompletionState;
  progress: Record<string, any>;
  updated_at: string;
};

export type ChallengeEvent = {
  id: string;
  challenge_id: string;
  user_id?: string | null;
  type: string;
  data: Record<string, any>;
  created_at: string;
};

function requireConfigured() {
  if (!isSupabaseConfigured) throw new Error('Supabase is not configured.');
}

function scoreAscending(scoreType: ScoreType) {
  return scoreType === 'FASTEST_TIME_FOR_DISTANCE' || scoreType === 'BEST_AVG_PACE_FOR_DISTANCE';
}

export async function createWorkoutChallenge(input: {
  creatorUserId: string;
  title: string;
  description?: string;
  activityType: ActivityType;
  mode: ChallengeMode;
  scoreType: ScoreType;
  rules: ChallengeRules;
  startTs: string;
  endTs: string;
  visibility?: Visibility;
  teamId?: string | null;
  participantUserIds: string[];
  teamFanout?: boolean;
}) {
  requireConfigured();
  const creatorUserId = String(input.creatorUserId || '').trim();
  if (!creatorUserId) throw new Error('Missing creator user.');
  const participantUserIds = Array.from(new Set((input.participantUserIds || []).map((id) => String(id || '').trim()).filter(Boolean)));

  const createResp = await supabase.functions.invoke('challenges-create', {
    body: {
      title: String(input.title || '').trim(),
      description: input.description ? String(input.description).trim() : null,
      activityType: input.activityType,
      mode: input.mode,
      scoreType: input.scoreType,
      rules: input.rules,
      startTs: input.startTs,
      endTs: input.endTs,
      visibility: input.visibility || (input.teamId ? 'TEAM' : 'PRIVATE'),
      teamId: input.teamId || null,
      teamFanout: input.teamFanout !== false,
      participantUserIds,
    },
  });
  if (createResp.error) throw createResp.error;
  const challengeId = String((createResp.data as any)?.challengeId || '').trim();
  if (!challengeId) throw new Error('Challenge creation failed.');
  const { data: created, error: fetchErr } = await supabase.from('workout_challenges').select('*').eq('id', challengeId).single();
  if (fetchErr) throw fetchErr;

  if (input.teamId) {
    const team = await socialApi.getTeam(input.teamId);
    const group = await socialApi.getTeamGroup(input.teamId);
    if (group?.id) {
      const content = `${input.title} · ${input.scoreType.replace(/_/g, ' ')}`;
      await socialApi.createPost(
        creatorUserId,
        content,
        'team_challenge',
        { workoutChallengeId: challengeId, rules: input.rules, activityType: input.activityType },
        { audience: 'group', groupId: group.id, isPublic: false }
      );
    }
    if (!team) {
      // ignore best-effort broadcast; challenge already created.
    }
  }

  return created as WorkoutChallenge;
}

export async function respondToWorkoutChallenge(input: { challengeId: string; userId: string; response: 'ACCEPT' | 'DECLINE' }) {
  requireConfigured();
  const challengeId = String(input.challengeId || '').trim();
  const userId = String(input.userId || '').trim();
  if (!challengeId || !userId) throw new Error('Missing challenge/user.');
  const status: ChallengeParticipantStatus = input.response === 'ACCEPT' ? 'ACCEPTED' : 'DECLINED';
  const patch: Record<string, any> = {
    status,
    updated_at: new Date().toISOString(),
  };
  if (status === 'ACCEPTED') patch.joined_at = new Date().toISOString();
  const { error } = await supabase.from('workout_challenge_participants').update(patch).eq('challenge_id', challengeId).eq('user_id', userId);
  if (error) throw error;
  await supabase.from('workout_challenge_events').insert({
    challenge_id: challengeId,
    user_id: userId,
    type: status === 'ACCEPTED' ? 'ACCEPTED' : 'DECLINED',
    data: {},
  });
}

export async function listWorkoutChallengesForUser(input: { userId: string; scope?: 'active' | 'past' | 'invites' }) {
  requireConfigured();
  const userId = String(input.userId || '').trim();
  if (!userId) throw new Error('Missing user.');
  const scope = input.scope || 'active';

  const { data: participantRows, error: participantErr } = await supabase
    .from('workout_challenge_participants')
    .select('*,workout_challenges(*)')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(200);
  if (participantErr) throw participantErr;
  const rows = (Array.isArray(participantRows) ? participantRows : []) as Array<any>;
  const now = Date.now();
  const filtered = rows.filter((row) => {
    const challenge = row.workout_challenges as WorkoutChallenge | null;
    if (!challenge) return false;
    const endTs = Date.parse(String(challenge.end_ts || ''));
    if (scope === 'invites') return row.status === 'INVITED';
    if (scope === 'past') return Number.isFinite(endTs) && endTs < now;
    return Number.isFinite(endTs) ? endTs >= now : true;
  });

  const ids = Array.from(new Set(filtered.map((row) => String(row.challenge_id || '')).filter(Boolean)));
  const participantsByChallenge = new Map<string, WorkoutChallengeParticipant[]>();
  if (ids.length) {
    const { data: allParticipants } = await supabase
      .from('workout_challenge_participants')
      .select('*')
      .in('challenge_id', ids)
      .limit(1000);
    (Array.isArray(allParticipants) ? allParticipants : []).forEach((row: any) => {
      const cid = String(row?.challenge_id || '');
      if (!cid) return;
      const list = participantsByChallenge.get(cid) || [];
      list.push(row as WorkoutChallengeParticipant);
      participantsByChallenge.set(cid, list);
    });
  }

  return filtered.map((row) => {
    const challenge = row.workout_challenges as WorkoutChallenge;
    const participants = participantsByChallenge.get(String(challenge.id || '')) || [];
    const asc = scoreAscending(challenge.score_type);
    const sorted = participants
      .slice()
      .sort((a, b) => {
        const av = Number(a.best_score);
        const bv = Number(b.best_score);
        const aMissing = !Number.isFinite(av);
        const bMissing = !Number.isFinite(bv);
        if (aMissing && bMissing) return 0;
        if (aMissing) return 1;
        if (bMissing) return -1;
        return asc ? av - bv : bv - av;
      });
    const myRank = sorted.findIndex((p) => String(p.user_id || '') === userId) + 1;
    return {
      challenge,
      me: row as WorkoutChallengeParticipant,
      leaderboard: sorted.slice(0, 10),
      myRank: myRank > 0 ? myRank : null,
    };
  });
}

export async function getWorkoutChallengeDetail(input: { challengeId: string; userId: string }) {
  requireConfigured();
  const challengeId = String(input.challengeId || '').trim();
  const userId = String(input.userId || '').trim();
  if (!challengeId || !userId) throw new Error('Missing challenge/user.');

  const [{ data: challenge, error: challengeErr }, { data: participants, error: participantsErr }, { data: events }] = await Promise.all([
    supabase.from('workout_challenges').select('*').eq('id', challengeId).single(),
    supabase.from('workout_challenge_participants').select('*').eq('challenge_id', challengeId).order('updated_at', { ascending: false }),
    supabase.from('workout_challenge_events').select('*').eq('challenge_id', challengeId).order('created_at', { ascending: false }).limit(100),
  ]);

  if (challengeErr) throw challengeErr;
  if (participantsErr) throw participantsErr;

  const challengeRow = challenge as WorkoutChallenge;
  const participantRows = (Array.isArray(participants) ? participants : []) as WorkoutChallengeParticipant[];
  const me = participantRows.find((p) => String(p.user_id || '') === userId) || null;
  const asc = scoreAscending(challengeRow.score_type);
  const leaderboard = participantRows
    .slice()
    .sort((a, b) => {
      const av = Number(a.best_score);
      const bv = Number(b.best_score);
      const aMissing = !Number.isFinite(av);
      const bMissing = !Number.isFinite(bv);
      if (aMissing && bMissing) return 0;
      if (aMissing) return 1;
      if (bMissing) return -1;
      return asc ? av - bv : bv - av;
    })
    .map((row, index) => ({ ...row, rank: index + 1 }));

  return {
    challenge: challengeRow,
    participants: participantRows,
    me,
    leaderboard,
    events: (Array.isArray(events) ? events : []) as ChallengeEvent[],
  };
}

export async function upsertWorkoutForChallengeEngine(input: {
  userId: string;
  runId: string;
  startedAtIso: string;
  durationSec: number;
  distanceMeters?: number | null;
  caloriesKcal?: number | null;
  avgHrBpm?: number | null;
  maxHrBpm?: number | null;
  activityType?: ActivityType;
  locationType?: 'indoor' | 'outdoor' | null;
  source?: 'WATCH' | 'PHONE' | 'IMPORT';
  raw?: Record<string, any>;
}) {
  requireConfigured();
  const userId = String(input.userId || '').trim();
  const runId = String(input.runId || '').trim();
  if (!userId || !runId) throw new Error('Missing user/run id.');

  const start = new Date(String(input.startedAtIso || new Date().toISOString()));
  const startIso = Number.isFinite(start.getTime()) ? start.toISOString() : new Date().toISOString();
  const durationSec = Math.max(1, Number(input.durationSec) || 1);
  const endIso = new Date(Date.parse(startIso) + durationSec * 1000).toISOString();
  const externalId = `local_run:${runId}`;
  const activityType = String(input.activityType || 'RUN_OUTDOOR');
  const locationType = input.locationType || (activityType.includes('OUTDOOR') ? 'outdoor' : activityType.includes('INDOOR') ? 'indoor' : null);
  const distanceM = Number(input.distanceMeters);
  const calories = Number(input.caloriesKcal);
  const avgHr = Number(input.avgHrBpm);
  const maxHr = Number(input.maxHrBpm);

  const { data: existing, error: existingErr } = await supabase
    .from('workouts')
    .select('id')
    .eq('user_id', userId)
    .eq('external_id', externalId)
    .limit(1);
  if (existingErr) throw existingErr;

  let workoutId = '';
  if (Array.isArray(existing) && existing.length > 0 && existing[0]?.id) {
    workoutId = String(existing[0].id);
    const { error: updateErr } = await supabase
      .from('workouts')
      .update({
        start_ts: startIso,
        end_ts: endIso,
        activity_type: activityType,
        location_type: locationType,
        distance_m: Number.isFinite(distanceM) ? distanceM : null,
        active_kcal: Number.isFinite(calories) ? calories : null,
        avg_hr_bpm: Number.isFinite(avgHr) ? avgHr : null,
        max_hr_bpm: Number.isFinite(maxHr) ? maxHr : null,
        source: String(input.source || 'WATCH'),
        raw: input.raw || {},
      })
      .eq('id', workoutId);
    if (updateErr) throw updateErr;
  } else {
    const { data: inserted, error: insertErr } = await supabase
      .from('workouts')
      .insert({
        user_id: userId,
        external_id: externalId,
        start_ts: startIso,
        end_ts: endIso,
        activity_type: activityType,
        location_type: locationType,
        distance_m: Number.isFinite(distanceM) ? distanceM : null,
        active_kcal: Number.isFinite(calories) ? calories : null,
        avg_hr_bpm: Number.isFinite(avgHr) ? avgHr : null,
        max_hr_bpm: Number.isFinite(maxHr) ? maxHr : null,
        source: String(input.source || 'WATCH'),
        raw: input.raw || {},
      })
      .select('id')
      .single();
    if (insertErr) throw insertErr;
    workoutId = String((inserted as any)?.id || '');
  }

  if (!workoutId) throw new Error('Workout upsert failed.');
  await supabase.functions.invoke('challenges-evaluate-workout', { body: { workoutId } });
  await supabase.rpc('evaluate_team_challenges_for_workout', { p_workout_id: workoutId });
  return { workoutId };
}
