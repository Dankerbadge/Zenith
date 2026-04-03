import AsyncStorage from '@react-native-async-storage/async-storage';
import { listRouteProfiles } from './routeMatchingService';

const ROUTE_ATTEMPTS_KEY = 'routeAttempts';

type RouteAttempt = {
  routeId: string;
  timestamp: string;
  distance: number;
  pace: number;
  duration: number;
  distanceConfidence?: number;
  prEligible?: boolean;
};

type AttemptsMap = Record<string, RouteAttempt[]>;

export type RouteStats = {
  routeId: string;
  attempts: number;
  bestDistance: number;
  bestPace: number;
  lastDistance: number;
  lastPace: number;
  trendDeltaPace: number;
  trendLabel: 'improving' | 'stable' | 'slower';
};

function safeParse(raw: string | null): AttemptsMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as AttemptsMap) : {};
  } catch {
    return {};
  }
}

function avg(nums: number[]) {
  if (!nums.length) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function asStats(routeId: string, attempts: RouteAttempt[]): RouteStats {
  const ordered = [...attempts].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const last = ordered[ordered.length - 1];
  const prEligibleAttempts = ordered.filter((row) => row.prEligible !== false);
  const bestPace = prEligibleAttempts.reduce(
    (best, row) => (row.pace > 0 ? Math.min(best, row.pace) : best),
    Number.POSITIVE_INFINITY
  );
  const bestDistance = ordered.reduce((best, row) => Math.max(best, row.distance || 0), 0);

  const recent = ordered.slice(-3).map((row) => row.pace).filter((row) => row > 0);
  const previous = ordered.slice(-6, -3).map((row) => row.pace).filter((row) => row > 0);
  const trendDeltaPace = previous.length ? Number((avg(recent) - avg(previous)).toFixed(2)) : 0;
  const trendLabel = trendDeltaPace <= -0.15 ? 'improving' : trendDeltaPace >= 0.15 ? 'slower' : 'stable';

  return {
    routeId,
    attempts: ordered.length,
    bestDistance: Number(bestDistance.toFixed(2)),
    bestPace: Number((bestPace === Number.POSITIVE_INFINITY ? 0 : bestPace).toFixed(2)),
    lastDistance: Number((last?.distance || 0).toFixed(2)),
    lastPace: Number((last?.pace || 0).toFixed(2)),
    trendDeltaPace,
    trendLabel,
  };
}

export async function recordRouteAttempt(input: RouteAttempt): Promise<void> {
  const raw = await AsyncStorage.getItem(ROUTE_ATTEMPTS_KEY);
  const map = safeParse(raw);
  const list = Array.isArray(map[input.routeId]) ? map[input.routeId] : [];
  list.push(input);
  map[input.routeId] = list.slice(-120);
  await AsyncStorage.setItem(ROUTE_ATTEMPTS_KEY, JSON.stringify(map));
}

export async function getRouteStats(routeId: string): Promise<RouteStats | null> {
  const raw = await AsyncStorage.getItem(ROUTE_ATTEMPTS_KEY);
  const map = safeParse(raw);
  const attempts = Array.isArray(map[routeId]) ? map[routeId] : [];
  if (!attempts.length) return null;
  return asStats(routeId, attempts);
}

export async function getTopRouteStats(limit = 3): Promise<RouteStats[]> {
  const [profiles, raw] = await Promise.all([listRouteProfiles(), AsyncStorage.getItem(ROUTE_ATTEMPTS_KEY)]);
  const map = safeParse(raw);

  const profileIds = new Set(profiles.map((p) => p.id));
  const stats = Object.entries(map)
    .filter(([routeId, attempts]) => profileIds.has(routeId) && Array.isArray(attempts) && attempts.length > 0)
    .map(([routeId, attempts]) => asStats(routeId, attempts))
    .sort((a, b) => b.attempts - a.attempts);

  return stats.slice(0, Math.max(1, limit));
}
