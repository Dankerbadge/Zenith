import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Visibility } from './canonicalRunningSchema';
import { getCommunityView } from './friendsService';

const ACTIVITY_EVENTS_KEY = 'activityEventsV1';
const ACTIVITY_EVENTS_VERSION_KEY = 'activityEventsVersion';
const ACTIVITY_EVENTS_SCHEMA_VERSION = 1;

export type EventType =
  | 'run_completed'
  | 'route_pr'
  | 'segment_pr'
  | 'streak_milestone'
  | 'winning_day_milestone'
  | 'rank_up'
  | 'challenge_completed'
  | 'club_joined'
  | 'club_left'
  | 'club_challenge_completed'
  | 'club_event_created'
  | 'club_event_updated';

export type ActivityEvent = {
  eventId: string;
  actorUserId: string;
  eventType: EventType;
  visibility: Visibility;
  scopeRefs: {
    clubId?: string | null;
    targetUserId?: string | null;
  };
  createdAtUtc: string;
  updatedAtUtc: string;
  primaryObjectRef: {
    objectType: 'run' | 'route' | 'segment' | 'challenge' | 'club' | 'club_event';
    objectId: string;
  };
  summaryTextShort: string;
  statsPayloadSmall?: {
    distanceMeters?: number;
    elapsedTimeSec?: number;
    paceSecPerMile?: number;
    streakCount?: number;
    xpDelta?: number;
    rankName?: string;
    prDeltaSec?: number;
  };
  collapseKey?: string;
  dedupeKey?: string;
  schemaVersion: number;
};

function safeParse(raw: string | null): ActivityEvent[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ActivityEvent[]) : [];
  } catch {
    return [];
  }
}

async function getEvents(): Promise<ActivityEvent[]> {
  const raw = await AsyncStorage.getItem(ACTIVITY_EVENTS_KEY);
  return safeParse(raw).sort((a, b) => b.createdAtUtc.localeCompare(a.createdAtUtc));
}

async function saveEvents(events: ActivityEvent[]) {
  await AsyncStorage.setItem(ACTIVITY_EVENTS_KEY, JSON.stringify(events.slice(0, 500)));
}

async function bumpEventsVersion() {
  const raw = await AsyncStorage.getItem(ACTIVITY_EVENTS_VERSION_KEY);
  const next = (Number(raw) || 0) + 1;
  await AsyncStorage.setItem(ACTIVITY_EVENTS_VERSION_KEY, String(next));
}

function nowUtcIso() {
  return new Date().toISOString();
}

export async function emitActivityEvent(
  input: Omit<ActivityEvent, 'eventId' | 'createdAtUtc' | 'updatedAtUtc' | 'schemaVersion'>
): Promise<ActivityEvent> {
  const rows = await getEvents();
  if (input.dedupeKey && rows.some((row) => row.dedupeKey === input.dedupeKey)) {
    return rows.find((row) => row.dedupeKey === input.dedupeKey)!;
  }

  const now = nowUtcIso();
  const next: ActivityEvent = {
    ...input,
    eventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    createdAtUtc: now,
    updatedAtUtc: now,
    schemaVersion: ACTIVITY_EVENTS_SCHEMA_VERSION,
  };
  await saveEvents([next, ...rows]);
  await bumpEventsVersion();
  return next;
}

export async function getActivityEventsVersion(): Promise<number> {
  const raw = await AsyncStorage.getItem(ACTIVITY_EVENTS_VERSION_KEY);
  return Number(raw) || 0;
}

export async function listActivityEventsForViewer(input: {
  viewerUserId: string;
  scope?: 'friends' | 'club' | 'public_discovery';
  clubId?: string;
  limit?: number;
}): Promise<ActivityEvent[]> {
  const scope = input.scope || 'friends';
  const limit = Math.max(1, Number(input.limit) || 40);
  const rows = await getEvents();

  const community = await getCommunityView(input.viewerUserId);
  const friendIds = new Set(community.friends.map((row) => row.profile.userId));
  const blockedIds = new Set(community.blocked.map((row) => row.profile.userId));

  const visible = rows.filter((event) => {
    const isSelf = event.actorUserId === input.viewerUserId;
    if (isSelf) return true;
    if (blockedIds.has(event.actorUserId)) return false;

    if (scope === 'friends') {
      if (!friendIds.has(event.actorUserId)) return false;
      return event.visibility === 'friends' || event.visibility === 'public';
    }

    if (scope === 'club') {
      if (!input.clubId) return false;
      return event.visibility === 'club' && event.scopeRefs.clubId === input.clubId;
    }

    if (!community.settings.allowPublicDiscoveryFeed) return false;
    return event.visibility === 'public';
  });

  return visible.slice(0, limit);
}

export async function getActivityEventById(eventId: string): Promise<ActivityEvent | null> {
  if (!eventId) return null;
  const rows = await getEvents();
  return rows.find((row) => row.eventId === eventId) || null;
}

export async function listClubActivityEvents(input: {
  clubId: string;
  sinceUtc?: string;
  untilUtc?: string;
}): Promise<ActivityEvent[]> {
  const rows = await getEvents();
  return rows.filter((row) => {
    if (row.scopeRefs.clubId !== input.clubId) return false;
    if (input.sinceUtc && row.createdAtUtc < input.sinceUtc) return false;
    if (input.untilUtc && row.createdAtUtc > input.untilUtc) return false;
    return true;
  });
}

export async function emitRunCompletedEvent(input: {
  actorUserId: string;
  runId: string;
  distanceMeters: number;
  elapsedTimeSec: number;
  paceSecPerMile?: number;
  xpDelta?: number;
  visibility?: Visibility;
  clubId?: string;
}) {
  const scopeClubId = input.clubId || null;
  return emitActivityEvent({
    actorUserId: input.actorUserId,
    eventType: 'run_completed',
    visibility: input.visibility || 'friends',
    scopeRefs: { clubId: scopeClubId },
    primaryObjectRef: { objectType: 'run', objectId: input.runId },
    summaryTextShort: `Run complete • ${(input.distanceMeters / 1609.344).toFixed(2)} mi`,
    statsPayloadSmall: {
      distanceMeters: input.distanceMeters,
      elapsedTimeSec: input.elapsedTimeSec,
      paceSecPerMile: input.paceSecPerMile,
      xpDelta: input.xpDelta,
    },
    collapseKey: `run:${input.actorUserId}:${new Date().toISOString().slice(0, 10)}:${scopeClubId || 'global'}`,
    dedupeKey: `run_completed:${input.runId}:${scopeClubId || 'global'}`,
  });
}

export async function emitRoutePrEvent(input: { actorUserId: string; routeId: string; runId: string; prDeltaSec?: number; visibility?: Visibility }) {
  return emitActivityEvent({
    actorUserId: input.actorUserId,
    eventType: 'route_pr',
    visibility: input.visibility || 'friends',
    scopeRefs: {},
    primaryObjectRef: { objectType: 'route', objectId: input.routeId },
    summaryTextShort: 'Route PR improved',
    statsPayloadSmall: { prDeltaSec: input.prDeltaSec },
    dedupeKey: `route_pr:${input.routeId}:${input.runId}`,
  });
}

export async function emitSegmentPrEvent(input: { actorUserId: string; runId: string; segmentCount: number; visibility?: Visibility }) {
  return emitActivityEvent({
    actorUserId: input.actorUserId,
    eventType: 'segment_pr',
    visibility: input.visibility || 'friends',
    scopeRefs: {},
    primaryObjectRef: { objectType: 'run', objectId: input.runId },
    summaryTextShort: `${input.segmentCount} segment PR${input.segmentCount === 1 ? '' : 's'} hit`,
    statsPayloadSmall: {},
    dedupeKey: `segment_pr:${input.runId}`,
  });
}

export async function emitStreakMilestoneEvent(input: { actorUserId: string; streakCount: number; visibility?: Visibility }) {
  return emitActivityEvent({
    actorUserId: input.actorUserId,
    eventType: 'streak_milestone',
    visibility: input.visibility || 'friends',
    scopeRefs: {},
    primaryObjectRef: { objectType: 'run', objectId: `streak_${input.streakCount}` },
    summaryTextShort: `Streak milestone • ${input.streakCount} days`,
    statsPayloadSmall: { streakCount: input.streakCount },
    dedupeKey: `streak_milestone:${input.actorUserId}:${input.streakCount}`,
  });
}

export async function emitWinningDayMilestoneEvent(input: { actorUserId: string; winningDayCount: number; visibility?: Visibility }) {
  return emitActivityEvent({
    actorUserId: input.actorUserId,
    eventType: 'winning_day_milestone',
    visibility: input.visibility || 'friends',
    scopeRefs: {},
    primaryObjectRef: { objectType: 'run', objectId: `winning_day_${input.winningDayCount}` },
    summaryTextShort: `Winning Days • ${input.winningDayCount}`,
    statsPayloadSmall: { streakCount: input.winningDayCount },
    dedupeKey: `winning_day_milestone:${input.actorUserId}:${input.winningDayCount}`,
  });
}

export async function emitRankUpEvent(input: { actorUserId: string; rankName: string; visibility?: Visibility }) {
  return emitActivityEvent({
    actorUserId: input.actorUserId,
    eventType: 'rank_up',
    visibility: input.visibility || 'friends',
    scopeRefs: {},
    primaryObjectRef: { objectType: 'run', objectId: `rank_${input.rankName}` },
    summaryTextShort: `Rank up • ${input.rankName}`,
    statsPayloadSmall: { rankName: input.rankName },
    dedupeKey: `rank_up:${input.actorUserId}:${input.rankName}`,
  });
}

export async function emitChallengeCompletedEvent(input: {
  actorUserId: string;
  challengeId: string;
  challengeTitle: string;
  xpDelta?: number;
  visibility?: Visibility;
}) {
  return emitActivityEvent({
    actorUserId: input.actorUserId,
    eventType: 'challenge_completed',
    visibility: input.visibility || 'friends',
    scopeRefs: {},
    primaryObjectRef: { objectType: 'challenge', objectId: input.challengeId },
    summaryTextShort: `Challenge complete • ${input.challengeTitle}`,
    statsPayloadSmall: { xpDelta: input.xpDelta },
    dedupeKey: `challenge_completed:${input.challengeId}:${input.actorUserId}`,
  });
}

export async function emitClubJoinedEvent(input: {
  actorUserId: string;
  clubId: string;
  clubName: string;
}) {
  const day = new Date().toISOString().slice(0, 10);
  return emitActivityEvent({
    actorUserId: input.actorUserId,
    eventType: 'club_joined',
    visibility: 'club',
    scopeRefs: { clubId: input.clubId },
    primaryObjectRef: { objectType: 'club', objectId: input.clubId },
    summaryTextShort: `Joined ${input.clubName}`,
    collapseKey: `club_joined:${input.actorUserId}:${input.clubId}:${day}`,
    dedupeKey: `club_joined:${input.actorUserId}:${input.clubId}:${day}`,
  });
}

export async function emitClubLeftEvent(input: {
  actorUserId: string;
  clubId: string;
  clubName: string;
}) {
  const day = new Date().toISOString().slice(0, 10);
  return emitActivityEvent({
    actorUserId: input.actorUserId,
    eventType: 'club_left',
    visibility: 'club',
    scopeRefs: { clubId: input.clubId },
    primaryObjectRef: { objectType: 'club', objectId: input.clubId },
    summaryTextShort: `Left ${input.clubName}`,
    collapseKey: `club_left:${input.actorUserId}:${input.clubId}:${day}`,
    dedupeKey: `club_left:${input.actorUserId}:${input.clubId}:${day}`,
  });
}
