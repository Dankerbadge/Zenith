import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getChallengeDefinition,
  getChallengeParticipant,
  listCanonicalRuns,
  listChallengeDefinitions,
  listChallengeParticipants,
  patchCanonicalRun,
  upsertChallengeDefinition,
  upsertChallengeParticipant,
} from './canonicalRunService';
import {
  RUNNING_SCHEMA_VERSION,
  type CanonicalChallengeDefinition,
  type CanonicalChallengeParticipant,
  type ChallengeAcceptanceStatus,
  type ChallengeStatus,
  type OutcomeStatus,
  type QualityTier,
  nowUtcIso,
} from './canonicalRunningSchema';
import { getSegmentAttempts } from './segmentService';
import { getDailyLog, saveDailyLog } from './storageUtils';
import { clearDailyMetricCache } from './dailyMetrics';
import { emitChallengeCompletedEvent } from './activityEventService';
import { getRemainingDailyXP } from './xpSystem';

const CHALLENGE_CACHE_VERSION_KEY = 'challengeCacheVersion';
const CHALLENGE_XP_LEDGER_KEY = 'challengeXpLedger';

type ChallengeEvaluation = {
  outcomeStatus: OutcomeStatus;
  linkedRunIds: string[];
  linkedAttemptIds: string[];
  reasonCodes: string[];
  xpAwarded: number;
  xpPenalized: number;
};

function safeParseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export type ChallengeView = {
  definition: CanonicalChallengeDefinition;
  participant: CanonicalChallengeParticipant;
  computedStatus: ChallengeStatus;
  criteriaText: string;
  progressText: string;
};

export type ChallengeInviteSeed = {
  challengeId: string;
  title: string;
  endTimeUtc: string;
  rewardXp: number;
  penaltyXp: number;
  penaltyRule: CanonicalChallengeDefinition['penaltyRule'];
};

function inWindow(ts: string, start: string, end: string) {
  return ts >= start && ts <= end;
}

function challengeStarted(definition: CanonicalChallengeDefinition, now = nowUtcIso()) {
  return now >= definition.startTimeUtc;
}

function challengeExpired(definition: CanonicalChallengeDefinition, now = nowUtcIso()) {
  return now > definition.endTimeUtc;
}

function qualityRank(q?: QualityTier) {
  if (q === 'high') return 3;
  if (q === 'medium') return 2;
  if (q === 'low') return 1;
  return 0;
}

function meetsQuality(minQuality: QualityTier, candidate?: QualityTier) {
  return qualityRank(candidate) >= qualityRank(minQuality);
}

function criteriaText(challenge: CanonicalChallengeDefinition): string {
  if (challenge.type === 'segment_beat_last_by_seconds') {
    return `Beat last segment time by ${challenge.beatBySeconds || 1}s.`;
  }
  if (challenge.type === 'segment_pace_under_threshold') {
    return `Keep segment pace under ${((Number(challenge.paceThresholdSecPerMile) || 0) / 60).toFixed(2)} min/mi.`;
  }
  if (challenge.type === 'segment_attempts_count_in_window') {
    return `Complete ${challenge.requiredAttemptsCount || 1} segment attempts in window.`;
  }
  if (challenge.type === 'route_attempts_count_in_window') {
    return `Complete ${challenge.requiredAttemptsCount || 1} route attempts in window.`;
  }
  if (challenge.type === 'weekly_distance_goal') {
    return `Run ${(Number(challenge.weeklyDistanceMeters) / 1609.344).toFixed(2)} miles this week.`;
  }
  return `Complete a run meeting min threshold in window.`;
}

async function getEligibleContext(input: {
  challenge: CanonicalChallengeDefinition;
  participant: CanonicalChallengeParticipant;
}) {
  const { challenge, participant } = input;
  const runs = await listCanonicalRuns();
  const attempts = await getSegmentAttempts();
  const windowStart = participant.acceptedAtUtc && participant.acceptedAtUtc > challenge.startTimeUtc ? participant.acceptedAtUtc : challenge.startTimeUtc;
  const windowEnd = challenge.endTimeUtc;

  const eligibleRuns = runs.filter(
    (run) =>
      run.userId === participant.userId &&
      challenge.eligibleRunKinds.includes(run.kind) &&
      inWindow(run.startTimeUtc, windowStart, windowEnd)
  );

  const eligibleAttempts = attempts.filter(
    (attempt) =>
      inWindow(attempt.runTimestamp, windowStart, windowEnd) &&
      (challenge.targetSegmentId ? attempt.segmentId === challenge.targetSegmentId : true)
  );

  return { windowStart, windowEnd, eligibleRuns, eligibleAttempts };
}

function applyXpSettlement(input: {
  previous: CanonicalChallengeParticipant | null;
  next: CanonicalChallengeParticipant;
}) {
  const { previous, next } = input;
  const priorDelta = Number(previous?.xpSettlementDelta) || 0;
  const nextDelta = (Number(next.xpAwarded) || 0) - (Number(next.xpPenalized) || 0);
  return nextDelta - priorDelta;
}

async function settleChallengeXp(userId: string, participant: CanonicalChallengeParticipant, delta: number): Promise<number> {
  if (!delta) return 0;
  const now = nowUtcIso();
  const todayKey = now.slice(0, 10);
  let appliedDelta = delta;
  if (delta > 0) {
    const today = await getDailyLog(todayKey);
    const remaining = getRemainingDailyXP(Number((today as any)?.dailyXP) || 0);
    appliedDelta = Math.max(0, Math.min(delta, remaining));
  }
  if (!appliedDelta) {
    await upsertChallengeParticipant({
      ...participant,
      xpSettlementDelta: 0,
      xpSettlementAppliedAtUtc: now,
    });
    return 0;
  }

  const progressRaw = await AsyncStorage.getItem('userProgress');
  const progress = safeParseJson<any>(progressRaw, {
    totalXP: 0,
    totalWinningDays: 0,
    currentStreak: 0,
    longestStreak: 0,
    lastWinningDate: null,
  });
  progress.totalXP = Math.max(0, (Number(progress.totalXP) || 0) + appliedDelta);
  await AsyncStorage.setItem('userProgress', JSON.stringify(progress));

  const ledgerRaw = await AsyncStorage.getItem(CHALLENGE_XP_LEDGER_KEY);
  const ledger = safeParseJson<Record<string, number>>(ledgerRaw, {});
  const key = `${userId}:${todayKey}`;
  const current = Number(ledger[key]) || 0;
  ledger[key] = current + appliedDelta;
  await AsyncStorage.setItem(CHALLENGE_XP_LEDGER_KEY, JSON.stringify(ledger));

  const todayLog = await getDailyLog(todayKey);
  await saveDailyLog(todayKey, {
    ...todayLog,
    dailyXP: Math.max(0, (Number((todayLog as any)?.dailyXP) || 0) + appliedDelta),
  } as any);
  clearDailyMetricCache(todayKey);

  await upsertChallengeParticipant({
    ...participant,
    xpSettlementDelta: appliedDelta,
    xpSettlementAppliedAtUtc: now,
  });
  return appliedDelta;
}

async function markWinningDayEvidence(challenge: CanonicalChallengeDefinition, participant: CanonicalChallengeParticipant) {
  if (!challenge.grantsWinningDayCredit || participant.outcomeStatus !== 'pass') return;
  const runs = await listCanonicalRuns();
  const linkedRuns = runs.filter((run) => participant.linkedRunIds.includes(run.runId));
  for (const run of linkedRuns) {
    const distOk =
      typeof challenge.minRunDistanceMetersForEligibility === 'number'
        ? (Number(run.distanceMeters) || 0) >= challenge.minRunDistanceMetersForEligibility
        : false;
    const durOk =
      typeof challenge.minRunDurationSecForEligibility === 'number'
        ? run.elapsedTimeSec >= challenge.minRunDurationSecForEligibility
        : false;
    if ((distOk || durOk) && challenge.eligibleRunKinds.includes(run.kind)) {
      await patchCanonicalRun(run.runId, {
        winningDayContribution: {
          eligible: true,
          reasonCodes: [...new Set([...(run.winningDayContribution?.reasonCodes || []), `challenge:${challenge.challengeId}`])],
        },
      });

      const dateKey = run.endTimeUtc?.slice(0, 10);
      if (!dateKey) continue;
      const log = await getDailyLog(dateKey);
      const workouts = Array.isArray(log.workouts) ? log.workouts : [];
      const nextWorkouts = workouts.map((workout: any) => {
        const workoutTime = String(workout?.time || '');
        if (workoutTime && run.endTimeUtc && workoutTime === run.endTimeUtc) {
          return {
            ...workout,
            challengeCompleted: true,
            challengeId: challenge.challengeId,
          };
        }
        return workout;
      });
      await saveDailyLog(dateKey, {
        ...log,
        workouts: nextWorkouts,
        challengeEvidence: {
          challengeId: challenge.challengeId,
          runId: run.runId,
          eligible: true,
        } as any,
      } as any);
      clearDailyMetricCache(dateKey);
    }
  }
}

function evaluateFromContext(input: {
  challenge: CanonicalChallengeDefinition;
  participant: CanonicalChallengeParticipant;
  eligibleRuns: Awaited<ReturnType<typeof listCanonicalRuns>>;
  eligibleAttempts: Awaited<ReturnType<typeof getSegmentAttempts>>;
}): ChallengeEvaluation {
  const { challenge, participant, eligibleRuns, eligibleAttempts } = input;

  if (participant.acceptanceStatus === 'declined') {
    return {
      outcomeStatus: 'no_attempt',
      linkedRunIds: [],
      linkedAttemptIds: [],
      reasonCodes: ['challenge_declined'],
      xpAwarded: 0,
      xpPenalized: 0,
    };
  }

  if (participant.acceptanceStatus !== 'accepted') {
    return {
      outcomeStatus: 'no_attempt',
      linkedRunIds: [],
      linkedAttemptIds: [],
      reasonCodes: ['not_accepted'],
      xpAwarded: 0,
      xpPenalized: 0,
    };
  }

  const qualityRuns = eligibleRuns.filter((run) => meetsQuality(participant.minQualityRequired, run.gpsQuality || 'unknown'));
  const qualityAttempts = eligibleAttempts.filter((attempt) => meetsQuality(participant.minQualityRequired, attempt.quality || 'unknown'));
  const hasEligibleEvents = eligibleRuns.length > 0 || eligibleAttempts.length > 0;
  const hasQualityEvents = qualityRuns.length > 0 || qualityAttempts.length > 0;

  let pass = false;
  let linkedRunIds: string[] = [];
  let linkedAttemptIds: string[] = [];
  const reasons: string[] = [];

  if (challenge.type === 'segment_beat_last_by_seconds') {
    const sorted = qualityAttempts.sort((a, b) => (a.runTimestamp < b.runTimestamp ? -1 : 1));
    if (sorted.length >= 2) {
      const last = sorted[sorted.length - 1];
      const prev = sorted[sorted.length - 2];
      const beatBy = Number(challenge.beatBySeconds) || 0;
      pass = (Number(last.estimatedDurationSec) || Number.MAX_SAFE_INTEGER) <= (Number(prev.estimatedDurationSec) || Number.MAX_SAFE_INTEGER) - beatBy;
      linkedAttemptIds = [prev.id, last.id];
      reasons.push(pass ? 'segment_time_improved' : 'segment_time_not_improved_enough');
    }
  } else if (challenge.type === 'segment_pace_under_threshold') {
    const threshold = Number(challenge.paceThresholdSecPerMile) || 0;
    const hit = qualityAttempts.find((attempt) => {
      const paceSeconds = (Number(attempt.estimatedPaceMinPerMile) || 0) * 60;
      return paceSeconds > 0 && paceSeconds <= threshold;
    });
    pass = Boolean(hit);
    if (hit) linkedAttemptIds = [hit.id];
    reasons.push(pass ? 'segment_pace_threshold_met' : 'segment_pace_threshold_not_met');
  } else if (challenge.type === 'segment_attempts_count_in_window') {
    const required = Math.max(1, Number(challenge.requiredAttemptsCount) || 1);
    pass = qualityAttempts.length >= required;
    linkedAttemptIds = qualityAttempts.map((attempt) => attempt.id);
    reasons.push(pass ? 'segment_attempt_count_met' : 'segment_attempt_count_shortfall');
  } else if (challenge.type === 'route_attempts_count_in_window') {
    const required = Math.max(1, Number(challenge.requiredAttemptsCount) || 1);
    const filteredRuns = challenge.targetRouteId ? qualityRuns.filter((run) => run.routeId === challenge.targetRouteId) : qualityRuns;
    pass = filteredRuns.length >= required;
    linkedRunIds = filteredRuns.map((run) => run.runId);
    reasons.push(pass ? 'route_attempt_count_met' : 'route_attempt_count_shortfall');
  } else if (challenge.type === 'weekly_distance_goal') {
    const totalDistance = qualityRuns.reduce((sum, run) => sum + (Number(run.distanceMeters) || 0), 0);
    pass = totalDistance >= Math.max(0, Number(challenge.weeklyDistanceMeters) || 0);
    linkedRunIds = qualityRuns.map((run) => run.runId);
    reasons.push(pass ? 'weekly_distance_goal_met' : 'weekly_distance_goal_shortfall');
  } else {
    const minDist = Number(challenge.minRunDistanceMetersForEligibility) || 0;
    const minDuration = Number(challenge.minRunDurationSecForEligibility) || 0;
    const qualifying = qualityRuns.filter((run) => {
      const distOk = minDist > 0 ? (Number(run.distanceMeters) || 0) >= minDist : false;
      const durOk = minDuration > 0 ? run.elapsedTimeSec >= minDuration : false;
      return distOk || durOk;
    });
    pass = qualifying.length > 0;
    linkedRunIds = qualifying.map((run) => run.runId);
    reasons.push(pass ? 'minimum_run_threshold_met' : 'minimum_run_threshold_not_met');
  }

  let outcomeStatus: OutcomeStatus;
  if (pass) {
    outcomeStatus = 'pass';
  } else if (!hasEligibleEvents) {
    outcomeStatus = 'no_attempt';
  } else if (!hasQualityEvents) {
    outcomeStatus = 'invalid_data';
  } else {
    outcomeStatus = 'fail';
  }

  const xpAwarded = outcomeStatus === 'pass' ? Math.max(0, Number(challenge.rewardXp) || 0) : 0;
  const xpPenalized =
    outcomeStatus === 'fail' && challenge.penaltyRule === 'if_accepted_and_failed'
      ? Math.max(0, Number(challenge.penaltyXp) || 0)
      : outcomeStatus === 'no_attempt' && challenge.penaltyRule === 'if_accepted_and_no_attempt'
      ? Math.max(0, Number(challenge.penaltyXp) || 0)
      : 0;

  return {
    outcomeStatus,
    linkedRunIds,
    linkedAttemptIds,
    reasonCodes: outcomeStatus === 'invalid_data' ? ['insufficient_quality'] : reasons,
    xpAwarded,
    xpPenalized,
  };
}

async function bumpChallengeCacheVersion() {
  const raw = await AsyncStorage.getItem(CHALLENGE_CACHE_VERSION_KEY);
  const next = (Number(raw) || 0) + 1;
  await AsyncStorage.setItem(CHALLENGE_CACHE_VERSION_KEY, String(next));
}

export async function getChallengeCacheVersion(): Promise<number> {
  const raw = await AsyncStorage.getItem(CHALLENGE_CACHE_VERSION_KEY);
  return Number(raw) || 0;
}

export async function createChallengeDefinition(
  input: Omit<CanonicalChallengeDefinition, 'challengeId' | 'createdAtUtc' | 'updatedAtUtc' | 'schemaVersion'>
): Promise<CanonicalChallengeDefinition> {
  const now = nowUtcIso();
  const next: CanonicalChallengeDefinition = {
    ...input,
    challengeId: `challenge_${Date.now()}`,
    createdAtUtc: now,
    updatedAtUtc: now,
    schemaVersion: RUNNING_SCHEMA_VERSION,
  };
  await upsertChallengeDefinition(next);
  await bumpChallengeCacheVersion();
  return next;
}

export async function ensureChallengeParticipant(input: {
  challengeId: string;
  userId: string;
}): Promise<CanonicalChallengeParticipant> {
  const rows = await listChallengeParticipants();
  const found = rows.find((row) => row.challengeId === input.challengeId && row.userId === input.userId);
  if (found) return found;
  const now = nowUtcIso();
  const created: CanonicalChallengeParticipant = {
    participantId: `challengeParticipant_${Date.now()}`,
    challengeId: input.challengeId,
    userId: input.userId,
    acceptanceStatus: 'pending',
    invitedAtUtc: now,
    respondedAtUtc: null,
    acceptedAtUtc: null,
    declinedAtUtc: null,
    revokedAtUtc: null,
    expiresUnacceptedAtUtc: null,
    outcomeStatus: 'no_attempt',
    outcomeEvaluatedAtUtc: null,
    outcomeReasonCodes: [],
    linkedRunIds: [],
    linkedAttemptIds: [],
    xpAwarded: 0,
    xpPenalized: 0,
    xpSettlementDelta: 0,
    xpSettlementAppliedAtUtc: null,
    minQualityRequired: 'medium',
    invalidationReasons: [],
    createdAtUtc: now,
    updatedAtUtc: now,
    schemaVersion: RUNNING_SCHEMA_VERSION,
  };
  await upsertChallengeParticipant(created);
  return created;
}

export async function setChallengeAcceptance(input: {
  challengeId: string;
  userId: string;
  acceptanceStatus: 'accepted' | 'declined';
}): Promise<CanonicalChallengeParticipant> {
  const now = nowUtcIso();
  const challenge = await getChallengeDefinition(input.challengeId);
  const participant = await ensureChallengeParticipant({ challengeId: input.challengeId, userId: input.userId });
  if (!challenge) return participant;

  if (challengeExpired(challenge, now) && participant.acceptanceStatus === 'pending') {
    const expiredPending: CanonicalChallengeParticipant = {
      ...participant,
      acceptanceStatus: 'expired_unaccepted',
      respondedAtUtc: now,
      expiresUnacceptedAtUtc: now,
      outcomeStatus: 'no_attempt',
      outcomeEvaluatedAtUtc: now,
      outcomeReasonCodes: ['expired_unaccepted'],
      xpAwarded: 0,
      xpPenalized: 0,
      updatedAtUtc: now,
    };
    await upsertChallengeParticipant(expiredPending);
    await bumpChallengeCacheVersion();
    return expiredPending;
  }

  if (!challengeStarted(challenge, now) && input.acceptanceStatus === 'declined') {
    // Allow pre-start decline with zero penalties.
  }

  const next: CanonicalChallengeParticipant = {
    ...participant,
    acceptanceStatus: input.acceptanceStatus,
    respondedAtUtc: now,
    acceptedAtUtc: input.acceptanceStatus === 'accepted' ? now : participant.acceptedAtUtc,
    declinedAtUtc: input.acceptanceStatus === 'declined' ? now : participant.declinedAtUtc,
    outcomeStatus: input.acceptanceStatus === 'declined' ? 'no_attempt' : participant.outcomeStatus,
    outcomeReasonCodes: input.acceptanceStatus === 'declined' ? ['challenge_declined'] : participant.outcomeReasonCodes,
    xpAwarded: input.acceptanceStatus === 'declined' ? 0 : participant.xpAwarded,
    xpPenalized: input.acceptanceStatus === 'declined' ? 0 : participant.xpPenalized,
    updatedAtUtc: now,
  };
  await upsertChallengeParticipant(next);
  await bumpChallengeCacheVersion();
  return next;
}

export function nextChallengeStatus(definition: CanonicalChallengeDefinition): ChallengeStatus {
  const now = nowUtcIso();
  if (definition.status === 'cancelled') return 'cancelled';
  if (now > definition.endTimeUtc) return definition.status === 'completed' || definition.status === 'failed' ? definition.status : 'expired';
  if (now < definition.startTimeUtc) return 'draft';
  return definition.status === 'completed' || definition.status === 'failed' ? definition.status : 'active';
}

export async function evaluateChallengeOutcome(input: {
  challengeId: string;
  participantId: string;
  finalize?: boolean;
}): Promise<CanonicalChallengeParticipant> {
  const challenge = await getChallengeDefinition(input.challengeId);
  const participant = await getChallengeParticipant(input.participantId);
  if (!challenge || !participant) {
    throw new Error('Challenge or participant not found.');
  }

  const previous = participant;
  const context = await getEligibleContext({ challenge, participant });
  const evaluation = evaluateFromContext({
    challenge,
    participant,
    eligibleRuns: context.eligibleRuns,
    eligibleAttempts: context.eligibleAttempts,
  });
  const now = nowUtcIso();
  const shouldFinalize = Boolean(input.finalize) || challengeExpired(challenge, now);
  const canEarlyComplete = evaluation.outcomeStatus === 'pass';
  const shouldWriteFinalOutcome = shouldFinalize || canEarlyComplete;

  if (!shouldWriteFinalOutcome) {
    const inProgress: CanonicalChallengeParticipant = {
      ...participant,
      outcomeStatus: 'no_attempt',
      outcomeReasonCodes: ['in_progress'],
      linkedRunIds: evaluation.linkedRunIds,
      linkedAttemptIds: evaluation.linkedAttemptIds,
      updatedAtUtc: now,
    };
    await upsertChallengeParticipant(inProgress);
    await bumpChallengeCacheVersion();
    return inProgress;
  }

  const next: CanonicalChallengeParticipant = {
    ...participant,
    outcomeStatus: evaluation.outcomeStatus,
    outcomeEvaluatedAtUtc: now,
    outcomeReasonCodes: evaluation.reasonCodes,
    linkedRunIds: evaluation.linkedRunIds,
    linkedAttemptIds: evaluation.linkedAttemptIds,
    xpAwarded: evaluation.xpAwarded,
    xpPenalized: evaluation.xpPenalized,
    updatedAtUtc: now,
  };
  await upsertChallengeParticipant(next);

  const delta = applyXpSettlement({ previous, next });
  let appliedDelta = 0;
  if (delta !== 0) {
    appliedDelta = await settleChallengeXp(participant.userId, next, delta);
  }

  if (evaluation.outcomeStatus === 'pass') {
    await upsertChallengeDefinition({
      ...challenge,
      status: 'completed',
      updatedAtUtc: now,
    });
      await emitChallengeCompletedEvent({
        actorUserId: participant.userId,
        challengeId: challenge.challengeId,
        challengeTitle: challenge.title,
        xpDelta: Math.max(0, appliedDelta || 0),
      });
  } else if (challengeExpired(challenge, now) && participant.acceptanceStatus === 'accepted') {
    await upsertChallengeDefinition({
      ...challenge,
      status: 'failed',
      updatedAtUtc: now,
    });
  }

  await markWinningDayEvidence(challenge, next);
  await bumpChallengeCacheVersion();
  return next;
}

export async function finalizeExpiredChallengesForUser(userId: string): Promise<void> {
  const [definitions, participants] = await Promise.all([listChallengeDefinitions(), listChallengeParticipants()]);
  const now = nowUtcIso();

  for (const definition of definitions) {
    if (!challengeExpired(definition, now)) continue;
    const participant = participants.find((row) => row.challengeId === definition.challengeId && row.userId === userId);
    if (!participant) continue;

    if (participant.acceptanceStatus === 'pending') {
      await upsertChallengeParticipant({
        ...participant,
        acceptanceStatus: 'expired_unaccepted',
        respondedAtUtc: now,
        expiresUnacceptedAtUtc: now,
        outcomeStatus: 'no_attempt',
        outcomeEvaluatedAtUtc: now,
        outcomeReasonCodes: ['expired_unaccepted'],
        xpAwarded: 0,
        xpPenalized: 0,
        updatedAtUtc: now,
      });
      await upsertChallengeDefinition({
        ...definition,
        status: 'expired',
        updatedAtUtc: now,
      });
      continue;
    }

    if (participant.acceptanceStatus === 'accepted') {
      await evaluateChallengeOutcome({
        challengeId: definition.challengeId,
        participantId: participant.participantId,
        finalize: true,
      });
      continue;
    }

    if (definition.status !== 'completed' && definition.status !== 'failed' && definition.status !== 'cancelled') {
      await upsertChallengeDefinition({
        ...definition,
        status: 'expired',
        updatedAtUtc: now,
      });
    }
  }
  await bumpChallengeCacheVersion();
}

export async function refreshChallengeProgressForUser(userId: string): Promise<void> {
  const [definitions, participants] = await Promise.all([listChallengeDefinitions(), listChallengeParticipants()]);
  const now = nowUtcIso();
  for (const definition of definitions) {
    const participant = participants.find((row) => row.challengeId === definition.challengeId && row.userId === userId);
    if (!participant) continue;
    if (participant.acceptanceStatus !== 'accepted') continue;
    if (challengeExpired(definition, now)) continue;
    await evaluateChallengeOutcome({
      challengeId: definition.challengeId,
      participantId: participant.participantId,
      finalize: false,
    });
  }
  await bumpChallengeCacheVersion();
}

export async function listChallengeViewsForUser(userId: string): Promise<ChallengeView[]> {
  const [definitions, participants] = await Promise.all([listChallengeDefinitions(), listChallengeParticipants()]);
  const views: ChallengeView[] = [];
  for (const definition of definitions) {
    const participant = participants.find((row) => row.challengeId === definition.challengeId && row.userId === userId);
    if (!participant) continue;
    const status = nextChallengeStatus(definition);
    const context = await getEligibleContext({ challenge: definition, participant });
    let progressText = `${context.windowStart.slice(0, 10)} -> ${context.windowEnd.slice(0, 10)} | runs:${context.eligibleRuns.length} attempts:${context.eligibleAttempts.length}`;
    if (definition.type === 'segment_attempts_count_in_window') {
      const required = Math.max(1, Number(definition.requiredAttemptsCount) || 1);
      const done = context.eligibleAttempts.length;
      progressText = `${context.windowStart.slice(0, 10)} -> ${context.windowEnd.slice(0, 10)} | segment attempts ${done}/${required}`;
    } else if (definition.type === 'route_attempts_count_in_window') {
      const required = Math.max(1, Number(definition.requiredAttemptsCount) || 1);
      const done = definition.targetRouteId
        ? context.eligibleRuns.filter((run) => run.routeId === definition.targetRouteId).length
        : context.eligibleRuns.length;
      progressText = `${context.windowStart.slice(0, 10)} -> ${context.windowEnd.slice(0, 10)} | route attempts ${done}/${required}`;
    } else if (definition.type === 'weekly_distance_goal') {
      const totalMeters = context.eligibleRuns.reduce((sum, run) => sum + (Number(run.distanceMeters) || 0), 0);
      const targetMeters = Math.max(0, Number(definition.weeklyDistanceMeters) || 0);
      progressText = `${context.windowStart.slice(0, 10)} -> ${context.windowEnd.slice(0, 10)} | distance ${(totalMeters / 1609.344).toFixed(2)}/${(targetMeters / 1609.344).toFixed(2)} mi`;
    } else if (definition.type === 'run_complete_minimum_threshold') {
      const minDist = Number(definition.minRunDistanceMetersForEligibility) || 0;
      const minDur = Number(definition.minRunDurationSecForEligibility) || 0;
      const qualifying = context.eligibleRuns.filter((run) => {
        const distOk = minDist > 0 ? (Number(run.distanceMeters) || 0) >= minDist : false;
        const durOk = minDur > 0 ? run.elapsedTimeSec >= minDur : false;
        return distOk || durOk;
      }).length;
      progressText = `${context.windowStart.slice(0, 10)} -> ${context.windowEnd.slice(0, 10)} | qualifying runs ${qualifying}`;
    }
    views.push({
      definition,
      participant,
      computedStatus: status,
      criteriaText: criteriaText(definition),
      progressText,
    });
  }
  return views.sort((a, b) => (a.definition.endTimeUtc < b.definition.endTimeUtc ? 1 : -1));
}

export async function createDemoChallengeForUser(userId: string): Promise<void> {
  const now = nowUtcIso();
  const start = now;
  const end = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  const def = await createChallengeDefinition({
    creatorUserId: userId,
    visibility: 'private',
    status: 'active',
    type: 'run_complete_minimum_threshold',
    title: 'Complete One Qualifying Run',
    description: 'Finish one run above threshold before expiry.',
    startTimeUtc: start,
    endTimeUtc: end,
    timezoneContext: 'UTC',
    targetSegmentId: null,
    targetRouteId: null,
    requiredAttemptsCount: null,
    beatBySeconds: null,
    paceThresholdSecPerKm: null,
    paceThresholdSecPerMile: null,
    weeklyDistanceMeters: null,
    minRunDistanceMetersForEligibility: 1600,
    minRunDurationSecForEligibility: 600,
    eligibleRunKinds: ['gps_outdoor', 'manual_treadmill'],
    grantsWinningDayCredit: true,
    rewardXp: 12,
    penaltyXp: 4,
    rewardBadgeId: null,
    penaltyRule: 'if_accepted_and_no_attempt',
    evaluationMode: 'best_attempt_in_window',
    tieBreakPolicy: 'earliest_completion',
  });
  await ensureChallengeParticipant({ challengeId: def.challengeId, userId });
  await bumpChallengeCacheVersion();
}

export async function createChallengeInviteForUser(input: {
  creatorUserId: string;
  targetUserId: string;
  title?: string;
  rewardXp?: number;
  penaltyXp?: number;
  expiresInDays?: number;
}): Promise<ChallengeInviteSeed> {
  const now = nowUtcIso();
  const end = new Date(Date.now() + Math.max(1, Number(input.expiresInDays) || 3) * 24 * 60 * 60 * 1000).toISOString();
  const def = await createChallengeDefinition({
    creatorUserId: input.creatorUserId,
    visibility: 'private',
    status: 'active',
    type: 'run_complete_minimum_threshold',
    title: input.title || 'Challenge Invite',
    description: 'Complete one qualifying run before expiry.',
    startTimeUtc: now,
    endTimeUtc: end,
    timezoneContext: 'UTC',
    targetSegmentId: null,
    targetRouteId: null,
    requiredAttemptsCount: null,
    beatBySeconds: null,
    paceThresholdSecPerKm: null,
    paceThresholdSecPerMile: null,
    weeklyDistanceMeters: null,
    minRunDistanceMetersForEligibility: 1600,
    minRunDurationSecForEligibility: 600,
    eligibleRunKinds: ['gps_outdoor', 'manual_treadmill'],
    grantsWinningDayCredit: true,
    rewardXp: Math.max(1, Number(input.rewardXp) || 12),
    penaltyXp: Math.max(0, Number(input.penaltyXp) || 4),
    rewardBadgeId: null,
    penaltyRule: 'if_accepted_and_no_attempt',
    evaluationMode: 'best_attempt_in_window',
    tieBreakPolicy: 'earliest_completion',
  });
  await ensureChallengeParticipant({ challengeId: def.challengeId, userId: input.targetUserId });
  await bumpChallengeCacheVersion();
  return {
    challengeId: def.challengeId,
    title: def.title,
    endTimeUtc: def.endTimeUtc,
    rewardXp: def.rewardXp,
    penaltyXp: def.penaltyXp,
    penaltyRule: def.penaltyRule,
  };
}

export async function getChallengeParticipantForUser(input: {
  challengeId: string;
  userId: string;
}): Promise<CanonicalChallengeParticipant | null> {
  const rows = await listChallengeParticipants();
  return rows.find((row) => row.challengeId === input.challengeId && row.userId === input.userId) || null;
}
