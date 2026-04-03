import { listClubActivityEvents } from './activityEventService';
import { listClubChallengeViews } from './clubChallengesService';
import { listClubMemberships } from './clubsService';

export type ClubAnalyticsWindow = 'daily' | 'weekly' | 'monthly';

export type ClubAggregateMetrics = {
  clubId: string;
  windowType: ClubAnalyticsWindow;
  windowStartDateKey: string;
  windowEndDateKey: string;
  totals: {
    totalRuns: number;
    totalDistanceMeters: number;
    totalElapsedTimeSec: number;
    totalWinningDays: number;
    uniqueParticipantsCount: number;
    challengesCompletedCount: number;
    challengesParticipationCount: number;
  };
  derived: {
    participationRatePercent: number;
    avgRunsPerParticipant: number;
  };
  computedAtUtc: string;
  schemaVersion: number;
};

const CLUB_ANALYTICS_SCHEMA_VERSION = 1;

function toDateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfWindow(windowType: ClubAnalyticsWindow): Date {
  const now = new Date();
  if (windowType === 'daily') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  if (windowType === 'weekly') {
    const day = now.getDay();
    const diff = (day + 6) % 7; // monday-start
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
  }
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export async function getClubAggregateMetrics(input: {
  clubId: string;
  userId: string;
  windowType?: ClubAnalyticsWindow;
}): Promise<ClubAggregateMetrics> {
  const windowType = input.windowType || 'weekly';
  const since = startOfWindow(windowType);
  const sinceUtc = since.toISOString();
  const untilUtc = new Date().toISOString();

  const [events, memberships, challenges] = await Promise.all([
    listClubActivityEvents({ clubId: input.clubId, sinceUtc, untilUtc }),
    listClubMemberships(input.clubId),
    listClubChallengeViews({ clubId: input.clubId, userId: input.userId }),
  ]);

  const runEvents = events.filter((e) => e.eventType === 'run_completed');
  const challengeCompletedEvents = events.filter((e) => e.eventType === 'club_challenge_completed');

  const totalRuns = runEvents.length;
  const totalDistanceMeters = runEvents.reduce((sum, e) => sum + (Number(e.statsPayloadSmall?.distanceMeters) || 0), 0);
  const totalElapsedTimeSec = runEvents.reduce((sum, e) => sum + (Number(e.statsPayloadSmall?.elapsedTimeSec) || 0), 0);

  const participantSet = new Set<string>();
  runEvents.forEach((e) => participantSet.add(e.actorUserId));
  challengeCompletedEvents.forEach((e) => participantSet.add(e.actorUserId));
  const uniqueParticipantsCount = participantSet.size;

  const activeMemberCount = memberships.filter((m) => m.status === 'active').length;

  // Proxy winning-day count by unique actor-date participation records in the window.
  const winningDayProxy = new Set<string>();
  runEvents.forEach((e) => winningDayProxy.add(`${e.actorUserId}:${e.createdAtUtc.slice(0, 10)}`));
  const totalWinningDays = winningDayProxy.size;

  const challengesCompletedCount = challengeCompletedEvents.length;
  const challengesParticipationCount = challenges.reduce((sum, c) => sum + c.participantsAccepted, 0);

  const participationRatePercent = activeMemberCount > 0 ? Number(((uniqueParticipantsCount / activeMemberCount) * 100).toFixed(1)) : 0;
  const avgRunsPerParticipant = uniqueParticipantsCount > 0 ? Number((totalRuns / uniqueParticipantsCount).toFixed(2)) : 0;

  return {
    clubId: input.clubId,
    windowType,
    windowStartDateKey: toDateKey(since),
    windowEndDateKey: toDateKey(new Date()),
    totals: {
      totalRuns,
      totalDistanceMeters,
      totalElapsedTimeSec,
      totalWinningDays,
      uniqueParticipantsCount,
      challengesCompletedCount,
      challengesParticipationCount,
    },
    derived: {
      participationRatePercent,
      avgRunsPerParticipant,
    },
    computedAtUtc: new Date().toISOString(),
    schemaVersion: CLUB_ANALYTICS_SCHEMA_VERSION,
  };
}
