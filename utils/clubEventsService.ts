import AsyncStorage from '@react-native-async-storage/async-storage';
import { emitActivityEvent } from './activityEventService';
import { createClubChallenge } from './clubChallengesService';
import { getClubMembership } from './clubsService';

const CLUB_EVENTS_KEY = 'clubEventsV1';
const CLUB_EVENT_RSVP_KEY = 'clubEventRsvpsV1';
const CLUB_EVENTS_SCHEMA_VERSION = 1;

export type ClubEventRsvpStatus = 'going' | 'maybe' | 'not_going';

export type ClubEventRecord = {
  clubEventId: string;
  clubId: string;
  createdByUserId: string;
  title: string;
  description?: string;
  startTimeUtc: string;
  durationSec?: number;
  locationText?: string;
  visibility: 'club' | 'private';
  linkedChallengeId?: string | null;
  createdAtUtc: string;
  updatedAtUtc: string;
  schemaVersion: number;
};

export type ClubEventRsvp = {
  rsvpId: string;
  clubEventId: string;
  userId: string;
  status: ClubEventRsvpStatus;
  respondedAtUtc: string;
  schemaVersion: number;
};

export type ClubEventView = {
  event: ClubEventRecord;
  myRsvp: ClubEventRsvpStatus | null;
  counts: Record<ClubEventRsvpStatus, number>;
};

function nowUtcIso() {
  return new Date().toISOString();
}

function safeParse<T>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

async function getEvents(): Promise<ClubEventRecord[]> {
  const raw = await AsyncStorage.getItem(CLUB_EVENTS_KEY);
  return safeParse<ClubEventRecord>(raw);
}

async function setEvents(rows: ClubEventRecord[]) {
  await AsyncStorage.setItem(CLUB_EVENTS_KEY, JSON.stringify(rows.slice(-2000)));
}

async function getRsvps(): Promise<ClubEventRsvp[]> {
  const raw = await AsyncStorage.getItem(CLUB_EVENT_RSVP_KEY);
  return safeParse<ClubEventRsvp>(raw);
}

async function setRsvps(rows: ClubEventRsvp[]) {
  await AsyncStorage.setItem(CLUB_EVENT_RSVP_KEY, JSON.stringify(rows.slice(-5000)));
}

function canCreateEvents(role?: string | null) {
  return role === 'owner' || role === 'admin';
}

export async function createClubEvent(input: {
  clubId: string;
  actorUserId: string;
  title: string;
  description?: string;
  startTimeUtc: string;
  durationSec?: number;
  locationText?: string;
  spawnChallenge?: boolean;
}): Promise<{ ok: boolean; reason: string; event?: ClubEventRecord }> {
  const membership = await getClubMembership(input.clubId, input.actorUserId);
  if (!membership || membership.status !== 'active' || !canCreateEvents(membership.role)) {
    return { ok: false, reason: 'Only owner/admin can create club events.' };
  }

  const now = nowUtcIso();
  let linkedChallengeId: string | null = null;
  if (input.spawnChallenge) {
    const challenge = await createClubChallenge({
      clubId: input.clubId,
      createdByUserId: input.actorUserId,
      title: `Event Challenge: ${input.title}`,
      participationMode: 'invite_members',
      leaderboardMode: 'completion_only',
    });
    linkedChallengeId = challenge.underlyingChallengeId;
  }

  const event: ClubEventRecord = {
    clubEventId: `clubEvent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    clubId: input.clubId,
    createdByUserId: input.actorUserId,
    title: input.title.trim(),
    description: (input.description || '').trim() || undefined,
    startTimeUtc: input.startTimeUtc,
    durationSec: input.durationSec,
    locationText: input.locationText,
    visibility: 'club',
    linkedChallengeId,
    createdAtUtc: now,
    updatedAtUtc: now,
    schemaVersion: CLUB_EVENTS_SCHEMA_VERSION,
  };

  const rows = await getEvents();
  await setEvents([...rows, event]);

  await emitActivityEvent({
    actorUserId: input.actorUserId,
    eventType: 'club_event_created',
    visibility: 'club',
    scopeRefs: { clubId: input.clubId },
    primaryObjectRef: { objectType: 'club_event', objectId: event.clubEventId },
    summaryTextShort: `Club event created • ${event.title}`,
    dedupeKey: `club_event_created:${event.clubEventId}`,
  });

  return { ok: true, reason: 'Event created.', event };
}

export async function setClubEventRsvp(input: {
  clubEventId: string;
  userId: string;
  status: ClubEventRsvpStatus;
}): Promise<{ ok: boolean; reason: string }> {
  const events = await getEvents();
  const event = events.find((row) => row.clubEventId === input.clubEventId);
  if (!event) return { ok: false, reason: 'Event not found.' };

  const membership = await getClubMembership(event.clubId, input.userId);
  if (!membership || membership.status !== 'active') {
    return { ok: false, reason: 'Only active members can RSVP.' };
  }

  const rows = await getRsvps();
  const idx = rows.findIndex((row) => row.clubEventId === input.clubEventId && row.userId === input.userId);
  const now = nowUtcIso();
  if (idx >= 0) {
    rows[idx] = {
      ...rows[idx],
      status: input.status,
      respondedAtUtc: now,
    };
  } else {
    rows.push({
      rsvpId: `rsvp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      clubEventId: input.clubEventId,
      userId: input.userId,
      status: input.status,
      respondedAtUtc: now,
      schemaVersion: CLUB_EVENTS_SCHEMA_VERSION,
    });
  }
  await setRsvps(rows);
  return { ok: true, reason: 'RSVP updated.' };
}

export async function listClubEventViews(input: {
  clubId: string;
  userId: string;
}): Promise<ClubEventView[]> {
  const [events, rsvps, membership] = await Promise.all([
    getEvents(),
    getRsvps(),
    getClubMembership(input.clubId, input.userId),
  ]);
  if (!membership || membership.status !== 'active') return [];

  const scoped = events.filter((row) => row.clubId === input.clubId);
  return scoped
    .map((event) => {
      const eventRsvps = rsvps.filter((row) => row.clubEventId === event.clubEventId);
      const mine = eventRsvps.find((row) => row.userId === input.userId);
      return {
        event,
        myRsvp: mine?.status || null,
        counts: {
          going: eventRsvps.filter((row) => row.status === 'going').length,
          maybe: eventRsvps.filter((row) => row.status === 'maybe').length,
          not_going: eventRsvps.filter((row) => row.status === 'not_going').length,
        },
      };
    })
    .sort((a, b) => b.event.startTimeUtc.localeCompare(a.event.startTimeUtc));
}
