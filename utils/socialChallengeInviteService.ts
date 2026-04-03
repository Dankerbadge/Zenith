import AsyncStorage from '@react-native-async-storage/async-storage';

import type { CustomChallengePayload } from './customChallengePosts';
import { createChallengeDefinition, ensureChallengeParticipant, setChallengeAcceptance } from './challengeService';
import { getAuthenticatedUserId } from './authIdentity';

const INVITE_STATE_KEY = 'socialChallengeInviteStateV1';

type InviteStatus = 'accepted' | 'declined';
type InviteStateRow = {
  status: InviteStatus;
  localChallengeId?: string;
  updatedAtIso: string;
};

type InviteStateMap = Record<string, InviteStateRow>;

function nowIso() {
  return new Date().toISOString();
}

function parseState(raw: string | null): InviteStateMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as InviteStateMap;
  } catch {
    return {};
  }
}

async function getInviteStateMap(): Promise<InviteStateMap> {
  const raw = await AsyncStorage.getItem(INVITE_STATE_KEY);
  return parseState(raw);
}

async function setInviteStateMap(next: InviteStateMap): Promise<void> {
  await AsyncStorage.setItem(INVITE_STATE_KEY, JSON.stringify(next));
}

export async function getInviteState(postId: string): Promise<InviteStateRow | null> {
  const key = String(postId || '').trim();
  if (!key) return null;
  const rows = await getInviteStateMap();
  return rows[key] || null;
}

function toFiniteNumber(input: unknown, fallback: number): number {
  const n = Number(input);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

async function createLocalChallengeFromInvite(payload: CustomChallengePayload) {
  const participantUserId = await getAuthenticatedUserId();
  if (!participantUserId) {
    throw new Error('auth_required_for_social_challenge_invite');
  }
  const now = nowIso();
  const end = payload.expiresAtIso || new Date(Date.parse(now) + clamp(toFiniteNumber(payload.windowDays, 7), 1, 90) * 24 * 60 * 60 * 1000).toISOString();
  const rewardXp = clamp(Math.round(toFiniteNumber(payload.rewardXp, 20)), 1, 10000);
  const title = String(payload.title || 'Challenge').trim() || 'Challenge';
  const note = String(payload.note || '').trim();
  const description = note || `Social challenge invite • ${payload.metric}`;

  let definitionInput: Parameters<typeof createChallengeDefinition>[0];

  if (payload.metric === 'distance_mi') {
    definitionInput = {
      creatorUserId: String(payload.createdByUserId || 'social_invite'),
      visibility: 'private',
      status: 'active',
      type: 'weekly_distance_goal',
      title,
      description,
      startTimeUtc: now,
      endTimeUtc: end,
      timezoneContext: 'UTC',
      targetSegmentId: null,
      targetRouteId: null,
      requiredAttemptsCount: null,
      beatBySeconds: null,
      paceThresholdSecPerKm: null,
      paceThresholdSecPerMile: null,
      weeklyDistanceMeters: clamp(toFiniteNumber(payload.targetValue, 3), 0.5, 9999) * 1609.344,
      minRunDistanceMetersForEligibility: null,
      minRunDurationSecForEligibility: null,
      eligibleRunKinds: ['gps_outdoor', 'manual_treadmill', 'manual_distance'],
      grantsWinningDayCredit: true,
      rewardXp,
      penaltyXp: 0,
      rewardBadgeId: null,
      penaltyRule: 'none',
      evaluationMode: 'best_attempt_in_window',
      tieBreakPolicy: 'earliest_completion',
    };
  } else if (payload.metric === 'workouts') {
    definitionInput = {
      creatorUserId: String(payload.createdByUserId || 'social_invite'),
      visibility: 'private',
      status: 'active',
      type: 'route_attempts_count_in_window',
      title,
      description,
      startTimeUtc: now,
      endTimeUtc: end,
      timezoneContext: 'UTC',
      targetSegmentId: null,
      targetRouteId: null,
      requiredAttemptsCount: Math.max(1, Math.round(clamp(toFiniteNumber(payload.targetValue, 3), 1, 1000))),
      beatBySeconds: null,
      paceThresholdSecPerKm: null,
      paceThresholdSecPerMile: null,
      weeklyDistanceMeters: null,
      minRunDistanceMetersForEligibility: null,
      minRunDurationSecForEligibility: null,
      eligibleRunKinds: ['gps_outdoor', 'manual_treadmill', 'manual_distance'],
      grantsWinningDayCredit: true,
      rewardXp,
      penaltyXp: 0,
      rewardBadgeId: null,
      penaltyRule: 'none',
      evaluationMode: 'best_attempt_in_window',
      tieBreakPolicy: 'earliest_completion',
    };
  } else {
    // Fallback for XP-style social challenges: complete one qualifying run in the window.
    definitionInput = {
      creatorUserId: String(payload.createdByUserId || 'social_invite'),
      visibility: 'private',
      status: 'active',
      type: 'run_complete_minimum_threshold',
      title,
      description,
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
      eligibleRunKinds: ['gps_outdoor', 'manual_treadmill', 'manual_distance'],
      grantsWinningDayCredit: true,
      rewardXp,
      penaltyXp: 0,
      rewardBadgeId: null,
      penaltyRule: 'none',
      evaluationMode: 'best_attempt_in_window',
      tieBreakPolicy: 'earliest_completion',
    };
  }

  const challenge = await createChallengeDefinition(definitionInput);
  await ensureChallengeParticipant({ challengeId: challenge.challengeId, userId: participantUserId });
  await setChallengeAcceptance({ challengeId: challenge.challengeId, userId: participantUserId, acceptanceStatus: 'accepted' });
  return challenge.challengeId;
}

export async function acceptInvite(input: { postId: string; payload: CustomChallengePayload }): Promise<{ localChallengeId: string }> {
  const postId = String(input.postId || '').trim();
  if (!postId) throw new Error('Missing post ID.');
  const current = await getInviteState(postId);
  if (current?.status === 'accepted' && current.localChallengeId) {
    return { localChallengeId: current.localChallengeId };
  }

  const localChallengeId = await createLocalChallengeFromInvite(input.payload);
  const rows = await getInviteStateMap();
  rows[postId] = { status: 'accepted', localChallengeId, updatedAtIso: nowIso() };
  await setInviteStateMap(rows);
  return { localChallengeId };
}

export async function declineInvite(input: { postId: string }): Promise<void> {
  const postId = String(input.postId || '').trim();
  if (!postId) return;
  const rows = await getInviteStateMap();
  rows[postId] = { status: 'declined', updatedAtIso: nowIso() };
  await setInviteStateMap(rows);
}
