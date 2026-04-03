import AsyncStorage from '@react-native-async-storage/async-storage';
import { getActivityEventById } from './activityEventService';
import { isBlockedBetweenUsers } from './friendsService';

const REACTIONS_KEY = 'eventReactionsV1';
const REACTION_SCHEMA_VERSION = 1;

export type ReactionType = 'respect' | 'fire' | 'lock_in' | 'salute' | 'beast';

export type EventReaction = {
  reactionId: string;
  eventId: string;
  reactorUserId: string;
  reactionType: ReactionType;
  createdAtUtc: string;
  updatedAtUtc: string;
  schemaVersion: number;
};

export type EventReactionSummary = {
  byType: Record<ReactionType, number>;
  total: number;
  userReaction: ReactionType | null;
};

const ZERO_BY_TYPE: Record<ReactionType, number> = {
  respect: 0,
  fire: 0,
  lock_in: 0,
  salute: 0,
  beast: 0,
};

function safeParse(raw: string | null): EventReaction[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as EventReaction[]) : [];
  } catch {
    return [];
  }
}

async function getAllReactions(): Promise<EventReaction[]> {
  const raw = await AsyncStorage.getItem(REACTIONS_KEY);
  return safeParse(raw);
}

async function saveAllReactions(rows: EventReaction[]): Promise<void> {
  await AsyncStorage.setItem(REACTIONS_KEY, JSON.stringify(rows.slice(-2000)));
}

function nowUtcIso() {
  return new Date().toISOString();
}

export async function toggleEventReaction(input: {
  eventId: string;
  reactorUserId: string;
  reactionType: ReactionType;
}): Promise<{ ok: boolean; reason: string }> {
  const event = await getActivityEventById(input.eventId);
  if (!event) return { ok: false, reason: 'Event not found.' };

  const blocked = await isBlockedBetweenUsers(input.reactorUserId, event.actorUserId);
  if (blocked && event.actorUserId !== input.reactorUserId) {
    return { ok: false, reason: 'Blocked relationship.' };
  }

  const rows = await getAllReactions();
  const idx = rows.findIndex((row) => row.eventId === input.eventId && row.reactorUserId === input.reactorUserId);
  const now = nowUtcIso();

  if (idx >= 0) {
    const existing = rows[idx];
    if (existing.reactionType === input.reactionType) {
      rows.splice(idx, 1);
      await saveAllReactions(rows);
      return { ok: true, reason: 'Reaction removed.' };
    }
    rows[idx] = {
      ...existing,
      reactionType: input.reactionType,
      updatedAtUtc: now,
    };
    await saveAllReactions(rows);
    return { ok: true, reason: 'Reaction updated.' };
  }

  rows.push({
    reactionId: `reaction_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    eventId: input.eventId,
    reactorUserId: input.reactorUserId,
    reactionType: input.reactionType,
    createdAtUtc: now,
    updatedAtUtc: now,
    schemaVersion: REACTION_SCHEMA_VERSION,
  });
  await saveAllReactions(rows);
  return { ok: true, reason: 'Reaction added.' };
}

export async function getReactionSummaries(input: {
  eventIds: string[];
  viewerUserId: string;
}): Promise<Record<string, EventReactionSummary>> {
  const rows = await getAllReactions();
  const eventSet = new Set(input.eventIds);
  const filtered = rows.filter((row) => eventSet.has(row.eventId));
  const summaries: Record<string, EventReactionSummary> = {};

  input.eventIds.forEach((id) => {
    summaries[id] = {
      byType: { ...ZERO_BY_TYPE },
      total: 0,
      userReaction: null,
    };
  });

  filtered.forEach((row) => {
    if (!summaries[row.eventId]) return;
    summaries[row.eventId].byType[row.reactionType] += 1;
    summaries[row.eventId].total += 1;
    if (row.reactorUserId === input.viewerUserId) {
      summaries[row.eventId].userReaction = row.reactionType;
    }
  });

  return summaries;
}
