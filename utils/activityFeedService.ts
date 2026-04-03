import { getActivityEventsVersion, listActivityEventsForViewer, type ActivityEvent, type EventType } from './activityEventService';
import { getAuthenticatedUserId } from './authIdentity';

export type ActivityFeedEvent = {
  id: string;
  type: EventType;
  actorUserId: string;
  actorName: string;
  timestampUtc: string;
  title: string;
  subtitle: string;
};

function formatDuration(sec?: number) {
  const n = Number(sec) || 0;
  if (!n) return '';
  const min = Math.floor(n / 60);
  const rem = n % 60;
  return `${min}:${String(rem).padStart(2, '0')}`;
}

function formatPace(secPerMile?: number) {
  const n = Number(secPerMile) || 0;
  if (!n) return '';
  const min = Math.floor(n / 60);
  const rem = Math.round(n % 60);
  return `${min}:${String(rem).padStart(2, '0')}/mi`;
}

function toFeed(event: ActivityEvent, actorName: string): ActivityFeedEvent {
  const stats = event.statsPayloadSmall || {};
  let subtitle = event.summaryTextShort;

  if (event.eventType === 'run_completed') {
    const bits = [
      stats.distanceMeters ? `${(stats.distanceMeters / 1609.344).toFixed(2)} mi` : '',
      stats.elapsedTimeSec ? formatDuration(stats.elapsedTimeSec) : '',
      stats.paceSecPerMile ? formatPace(stats.paceSecPerMile) : '',
      typeof stats.xpDelta === 'number' ? `+${stats.xpDelta} XP` : '',
    ].filter(Boolean);
    subtitle = bits.join(' • ') || subtitle;
  } else if (event.eventType === 'rank_up' && stats.rankName) {
    subtitle = stats.rankName;
  } else if (event.eventType === 'streak_milestone' && stats.streakCount) {
    subtitle = `${stats.streakCount} days`;
  } else if (event.eventType === 'winning_day_milestone' && stats.streakCount) {
    subtitle = `${stats.streakCount} total`;
  } else if (event.eventType === 'challenge_completed' && typeof stats.xpDelta === 'number') {
    subtitle = `+${stats.xpDelta} XP`;
  }

  return {
    id: event.eventId,
    type: event.eventType,
    actorUserId: event.actorUserId,
    actorName,
    timestampUtc: event.createdAtUtc,
    title: event.summaryTextShort,
    subtitle,
  };
}

function collapseRows(rows: ActivityEvent[]): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  const byKey = new Map<string, ActivityEvent>();

  rows.forEach((row) => {
    const key = row.collapseKey || '';
    if (!key) {
      out.push(row);
      return;
    }
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, row);
      return;
    }
    const existingTime = Date.parse(existing.createdAtUtc);
    const nextTime = Date.parse(row.createdAtUtc);
    if (Number.isFinite(nextTime) && Number.isFinite(existingTime) && nextTime > existingTime) {
      byKey.set(key, row);
    }
  });

  return [...out, ...Array.from(byKey.values())].sort((a, b) => b.createdAtUtc.localeCompare(a.createdAtUtc));
}

type CachedFeedEntry = {
  version: number;
  rows: ActivityFeedEvent[];
  cachedAt: number;
};

const feedCache = new Map<string, CachedFeedEntry>();
const FEED_ACTOR_CAP_PER_PAGE = 2;
const BURST_WINDOW_MS = 24 * 60 * 60 * 1000;

function applyBurstDownrank(rows: ActivityEvent[]): ActivityEvent[] {
  const now = Date.now();
  const recentCounts = new Map<string, number>();
  rows.forEach((row) => {
    const ts = Date.parse(row.createdAtUtc);
    if (Number.isFinite(ts) && now - ts <= BURST_WINDOW_MS) {
      recentCounts.set(row.actorUserId, (recentCounts.get(row.actorUserId) || 0) + 1);
    }
  });

  const withRank = rows.map((row, idx) => {
    const burstCount = recentCounts.get(row.actorUserId) || 0;
    const penalty = burstCount > 5 ? burstCount - 5 : 0;
    return { row, idx, penalty };
  });

  withRank.sort((a, b) => {
    if (a.penalty !== b.penalty) return a.penalty - b.penalty;
    const timeCmp = b.row.createdAtUtc.localeCompare(a.row.createdAtUtc);
    if (timeCmp !== 0) return timeCmp;
    return a.idx - b.idx;
  });

  return withRank.map((item) => item.row);
}

function applyActorCap(rows: ActivityEvent[], capPerActor: number): ActivityEvent[] {
  if (capPerActor < 1) return rows;
  const counts = new Map<string, number>();
  const kept: ActivityEvent[] = [];
  const overflow: ActivityEvent[] = [];

  rows.forEach((row) => {
    const n = counts.get(row.actorUserId) || 0;
    if (n < capPerActor) {
      counts.set(row.actorUserId, n + 1);
      kept.push(row);
    } else {
      overflow.push(row);
    }
  });

  return [...kept, ...overflow];
}

export async function getActivityFeed(input?: {
  userId?: string;
  actorName?: string;
  scope?: 'friends' | 'club' | 'public_discovery';
  clubId?: string;
  limit?: number;
  page?: number;
  pageSize?: number;
}): Promise<ActivityFeedEvent[]> {
  const userId = String(input?.userId || '').trim() || (await getAuthenticatedUserId());
  if (!userId) return [];
  const actorName = input?.actorName || 'You';
  const limit = Math.max(1, Number(input?.limit) || 40);
  const page = Math.max(1, Number(input?.page) || 1);
  const pageSize = Math.max(1, Number(input?.pageSize) || limit);
  const cacheKey = JSON.stringify({
    userId,
    actorName,
    scope: input?.scope || 'friends',
    clubId: input?.clubId || '',
    limit,
    page,
    pageSize,
  });
  const version = await getActivityEventsVersion();
  const cached = feedCache.get(cacheKey);
  if (cached && cached.version === version && Date.now() - cached.cachedAt < 30_000) {
    return cached.rows;
  }

  const events = await listActivityEventsForViewer({
    viewerUserId: userId,
    scope: input?.scope || 'friends',
    clubId: input?.clubId,
    limit: Math.max(limit * 4, page * pageSize * 4, 80),
  });
  const collapsed = collapseRows(events);
  const downranked = applyBurstDownrank(collapsed);
  const actorCapped = applyActorCap(downranked, FEED_ACTOR_CAP_PER_PAGE);
  const start = (page - 1) * pageSize;
  const pageRows = actorCapped.slice(start, start + pageSize).slice(0, limit);
  const mapped = pageRows.map((event) => toFeed(event, event.actorUserId === userId ? actorName : 'Athlete'));
  feedCache.set(cacheKey, { version, rows: mapped, cachedAt: Date.now() });
  return mapped;
}
