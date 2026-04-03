import AsyncStorage from '@react-native-async-storage/async-storage';
import { listCanonicalRuns } from './canonicalRunService';
import { type ChallengeAcceptanceStatus } from './canonicalRunningSchema';
import {
  createChallengeDefinition,
  ensureChallengeParticipant,
  getChallengeParticipantForUser,
  setChallengeAcceptance,
} from './challengeService';
import { listClubMemberships } from './clubsService';
import { emitActivityEvent } from './activityEventService';

const CLUB_CHALLENGES_KEY = 'clubChallengesV1';
const CLUB_CHALLENGES_SCHEMA_VERSION = 1;

export type ClubChallengeParticipationMode = 'opt_in_required' | 'invite_members';
export type ClubChallengeLeaderboardMode = 'completion_only' | 'participation_count' | 'distance_sum';

export type ClubChallengeRecord = {
  clubChallengeId: string;
  clubId: string;
  underlyingChallengeId: string;
  createdByUserId: string;
  createdAtUtc: string;
  updatedAtUtc: string;
  participationMode: ClubChallengeParticipationMode;
  leaderboardMode: ClubChallengeLeaderboardMode;
  paceRankingsDisabledByDefault: boolean;
  schemaVersion: number;
};

export type ClubChallengeView = {
  record: ClubChallengeRecord;
  title: string;
  endTimeUtc: string;
  rewardXp: number;
  penaltyXp: number;
  myAcceptanceStatus: ChallengeAcceptanceStatus | 'not_invited';
  myOutcomeStatus: string;
  participantsAccepted: number;
  participantsCompleted: number;
  leaderboardValue: number;
};

function nowUtcIso() {
  return new Date().toISOString();
}

function safeParse(raw: string | null): ClubChallengeRecord[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ClubChallengeRecord[]) : [];
  } catch {
    return [];
  }
}

async function getClubChallenges() {
  const raw = await AsyncStorage.getItem(CLUB_CHALLENGES_KEY);
  return safeParse(raw);
}

async function setClubChallenges(rows: ClubChallengeRecord[]) {
  await AsyncStorage.setItem(CLUB_CHALLENGES_KEY, JSON.stringify(rows.slice(-1000)));
}

export async function createClubChallenge(input: {
  clubId: string;
  createdByUserId: string;
  title?: string;
  participationMode?: ClubChallengeParticipationMode;
  leaderboardMode?: ClubChallengeLeaderboardMode;
}): Promise<ClubChallengeRecord> {
  const now = nowUtcIso();
  const end = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
  const definition = await createChallengeDefinition({
    creatorUserId: input.createdByUserId,
    visibility: 'club',
    status: 'active',
    type: 'run_complete_minimum_threshold',
    title: input.title || 'Club Challenge: Qualifying Run',
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
    rewardXp: 14,
    penaltyXp: 4,
    rewardBadgeId: null,
    penaltyRule: 'if_accepted_and_no_attempt',
    evaluationMode: 'best_attempt_in_window',
    tieBreakPolicy: 'earliest_completion',
  });

  const memberships = await listClubMemberships(input.clubId);
  const activeUserIds = memberships.filter((m) => m.status === 'active').map((m) => m.userId);
  for (const userId of activeUserIds) {
    await ensureChallengeParticipant({
      challengeId: definition.challengeId,
      userId,
    });
  }

  const record: ClubChallengeRecord = {
    clubChallengeId: `clubChallenge_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    clubId: input.clubId,
    underlyingChallengeId: definition.challengeId,
    createdByUserId: input.createdByUserId,
    createdAtUtc: now,
    updatedAtUtc: now,
    participationMode: input.participationMode || 'invite_members',
    leaderboardMode: input.leaderboardMode || 'completion_only',
    paceRankingsDisabledByDefault: true,
    schemaVersion: CLUB_CHALLENGES_SCHEMA_VERSION,
  };

  const rows = await getClubChallenges();
  await setClubChallenges([...rows, record]);

  await emitActivityEvent({
    actorUserId: input.createdByUserId,
    eventType: 'club_event_created',
    visibility: 'club',
    scopeRefs: { clubId: input.clubId },
    primaryObjectRef: { objectType: 'challenge', objectId: definition.challengeId },
    summaryTextShort: `Created club challenge • ${definition.title}`,
    dedupeKey: `club_challenge_created:${record.clubChallengeId}`,
  });

  return record;
}

export async function setClubChallengeAcceptance(input: {
  clubChallengeId: string;
  userId: string;
  acceptanceStatus: 'accepted' | 'declined';
}): Promise<{ ok: boolean; reason: string }> {
  const rows = await getClubChallenges();
  const found = rows.find((row) => row.clubChallengeId === input.clubChallengeId);
  if (!found) return { ok: false, reason: 'Club challenge not found.' };
  await setChallengeAcceptance({
    challengeId: found.underlyingChallengeId,
    userId: input.userId,
    acceptanceStatus: input.acceptanceStatus,
  });
  return { ok: true, reason: 'Updated.' };
}

export async function syncClubChallengeCompletionEvents(input: { clubId: string }) {
  const rows = await getClubChallenges();
  const scoped = rows.filter((row) => row.clubId === input.clubId);
  for (const row of scoped) {
    const memberships = await listClubMemberships(row.clubId);
    for (const membership of memberships) {
      const participant = await getChallengeParticipantForUser({
        challengeId: row.underlyingChallengeId,
        userId: membership.userId,
      });
      if (!participant || participant.outcomeStatus !== 'pass') continue;
      await emitActivityEvent({
        actorUserId: membership.userId,
        eventType: 'club_challenge_completed',
        visibility: 'club',
        scopeRefs: { clubId: row.clubId },
        primaryObjectRef: { objectType: 'challenge', objectId: row.underlyingChallengeId },
        summaryTextShort: 'Completed club challenge',
        dedupeKey: `club_challenge_completed:${row.clubChallengeId}:${membership.userId}`,
      });
    }
  }
}

export async function listClubChallengeViews(input: {
  clubId: string;
  userId: string;
}): Promise<ClubChallengeView[]> {
  const rows = (await getClubChallenges()).filter((row) => row.clubId === input.clubId);
  if (!rows.length) return [];

  const [definitions, memberships, runs] = await Promise.all([
    AsyncStorage.getItem('challengeDefinitions').then((raw) => {
      try {
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }),
    listClubMemberships(input.clubId),
    listCanonicalRuns(),
  ]);

  const participantsRaw = await AsyncStorage.getItem('challengeParticipants');
  const participants = (() => {
    try {
      const parsed = participantsRaw ? JSON.parse(participantsRaw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();

  return rows
    .map((record) => {
      const def = definitions.find((d: any) => d.challengeId === record.underlyingChallengeId);
      const scopedParticipants = participants.filter((p: any) => p.challengeId === record.underlyingChallengeId);
      const mine = scopedParticipants.find((p: any) => p.userId === input.userId);
      const accepted = scopedParticipants.filter((p: any) => p.acceptanceStatus === 'accepted');
      const completed = scopedParticipants.filter((p: any) => p.outcomeStatus === 'pass');

      let leaderboardValue = completed.length;
      if (record.leaderboardMode === 'participation_count') {
        leaderboardValue = accepted.length;
      } else if (record.leaderboardMode === 'distance_sum') {
        const runIds = completed.flatMap((p: any) => (Array.isArray(p.linkedRunIds) ? p.linkedRunIds : []));
        const totalMeters = runs
          .filter((run) => runIds.includes(run.runId))
          .reduce((sum, run) => sum + (Number(run.distanceMeters) || 0), 0);
        leaderboardValue = Math.round(totalMeters / 1609.344);
      }

      return {
        record,
        title: String(def?.title || 'Club Challenge'),
        endTimeUtc: String(def?.endTimeUtc || ''),
        rewardXp: Number(def?.rewardXp) || 0,
        penaltyXp: Number(def?.penaltyXp) || 0,
        myAcceptanceStatus: (mine?.acceptanceStatus || 'not_invited') as ClubChallengeView['myAcceptanceStatus'],
        myOutcomeStatus: String(mine?.outcomeStatus || 'no_attempt'),
        participantsAccepted: accepted.length,
        participantsCompleted: completed.length,
        leaderboardValue,
      };
    })
    .sort((a, b) => b.record.createdAtUtc.localeCompare(a.record.createdAtUtc));
}
