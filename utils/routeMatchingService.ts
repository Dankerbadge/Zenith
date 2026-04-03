import AsyncStorage from '@react-native-async-storage/async-storage';
import { type LocationPoint } from './gpsService';
import { simplifyRoute } from './routeUtils';

const ROUTE_CATALOG_KEY = 'routeCatalog';
const MATCH_THRESHOLD = 0.78;
const MIN_OVERLAP_PERCENT = 0.62;
const MAX_ENDPOINT_DEVIATION_METERS = 220;
const OVERLAP_POINT_TOLERANCE_METERS = 85;
const MIN_ROUTE_DISTANCE_MILES = 0.35;

type RouteCentroid = { lat: number; lng: number };

type RouteBounds = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

export type RouteProfile = {
  id: string;
  hash: string;
  centroid: RouteCentroid;
  bounds: RouteBounds;
  pointCount: number;
  totalDistanceMiles: number;
  runCount: number;
  firstRunAt: string;
  lastRunAt: string;
  sampleRoute: Pick<LocationPoint, 'latitude' | 'longitude'>[];
};

export type RouteMatch = {
  profile: RouteProfile;
  score: number;
  overlapPercent: number;
  endpointDeviationMeters: number;
  direction: 'forward' | 'reverse';
};

type MatchCacheEntry = {
  catalogSignature: string;
  matches: RouteMatch[];
};

const matchCache = new Map<string, MatchCacheEntry>();

function clamp(n: number, low: number, high: number) {
  return Math.max(low, Math.min(high, n));
}

function toRad(v: number) {
  return (v * Math.PI) / 180;
}

function distanceMeters(a: Pick<LocationPoint, 'latitude' | 'longitude'>, b: Pick<LocationPoint, 'latitude' | 'longitude'>) {
  const R = 6371000;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
}

function routeDistanceMiles(route: LocationPoint[]) {
  if (route.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < route.length; i += 1) {
    total += distanceMeters(route[i - 1], route[i]);
  }
  return total / 1609.344;
}

function sampleRoute(route: LocationPoint[], sampleCount = 24) {
  if (route.length <= sampleCount) {
    return route.map((p) => ({ latitude: p.latitude, longitude: p.longitude }));
  }
  const step = (route.length - 1) / (sampleCount - 1);
  const sampled: Pick<LocationPoint, 'latitude' | 'longitude'>[] = [];
  for (let i = 0; i < sampleCount; i += 1) {
    const idx = Math.round(i * step);
    const point = route[Math.min(route.length - 1, idx)];
    sampled.push({ latitude: point.latitude, longitude: point.longitude });
  }
  return sampled;
}

function centroid(route: LocationPoint[]): RouteCentroid {
  const lat = route.reduce((sum, p) => sum + p.latitude, 0) / route.length;
  const lng = route.reduce((sum, p) => sum + p.longitude, 0) / route.length;
  return { lat, lng };
}

function bounds(route: LocationPoint[]): RouteBounds {
  const lats = route.map((p) => p.latitude);
  const lngs = route.map((p) => p.longitude);
  return {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
  };
}

function routeHash(route: LocationPoint[]) {
  const simplified = simplifyRoute(route);
  const sampled = sampleRoute(simplified, 10);
  const tokens = sampled.map((p) => `${p.latitude.toFixed(4)},${p.longitude.toFixed(4)}`);
  return tokens.join('|');
}

function fromCatalogRaw(raw: string | null): RouteProfile[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RouteProfile[]) : [];
  } catch {
    return [];
  }
}

async function getRouteCatalog(): Promise<RouteProfile[]> {
  const raw = await AsyncStorage.getItem(ROUTE_CATALOG_KEY);
  return fromCatalogRaw(raw);
}

export async function listRouteProfiles(): Promise<RouteProfile[]> {
  return getRouteCatalog();
}

async function saveRouteCatalog(catalog: RouteProfile[]): Promise<void> {
  await AsyncStorage.setItem(ROUTE_CATALOG_KEY, JSON.stringify(catalog));
  matchCache.clear();
}

function sampledSimilarity(
  a: Pick<LocationPoint, 'latitude' | 'longitude'>[],
  b: Pick<LocationPoint, 'latitude' | 'longitude'>[]
) {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    const ai = a[Math.round((i / Math.max(1, n - 1)) * (a.length - 1))];
    const bi = b[Math.round((i / Math.max(1, n - 1)) * (b.length - 1))];
    total += distanceMeters(ai, bi);
  }
  const avgDist = total / n;
  return clamp(1 - avgDist / 450, 0, 1);
}

function overlapPercent(
  current: Pick<LocationPoint, 'latitude' | 'longitude'>[],
  candidate: Pick<LocationPoint, 'latitude' | 'longitude'>[]
) {
  if (!current.length || !candidate.length) return 0;
  let matched = 0;
  for (let i = 0; i < current.length; i += 1) {
    const point = current[i];
    let nearest = Number.POSITIVE_INFINITY;
    for (let j = 0; j < candidate.length; j += 1) {
      const d = distanceMeters(point, candidate[j]);
      if (d < nearest) nearest = d;
      if (nearest <= OVERLAP_POINT_TOLERANCE_METERS) break;
    }
    if (nearest <= OVERLAP_POINT_TOLERANCE_METERS) matched += 1;
  }
  return matched / current.length;
}

function routeMatchScore(
  route: LocationPoint[],
  profile: RouteProfile,
  direction: 'forward' | 'reverse'
) {
  const currentSample = sampleRoute(route, 24);
  const start = route[0];
  const end = route[route.length - 1];
  const profileSample = direction === 'forward' ? profile.sampleRoute : [...profile.sampleRoute].reverse();
  const profStart = profileSample[0];
  const profEnd = profileSample[profileSample.length - 1];

  const startDist = distanceMeters(start, profStart);
  const endDist = distanceMeters(end, profEnd);
  const directScore = clamp(1 - (startDist + endDist) / 550, 0, 1);
  const endpointDeviationMeters = Number((startDist + endDist).toFixed(2));

  const shapeScore = sampledSimilarity(currentSample, profileSample);
  const overlap = overlapPercent(currentSample, profileSample);
  const overlapScore = clamp((overlap - 0.45) / 0.55, 0, 1);

  const distMiles = routeDistanceMiles(route);
  const distanceDelta = Math.abs(distMiles - profile.totalDistanceMiles);
  const distanceScore = clamp(1 - distanceDelta / Math.max(0.8, profile.totalDistanceMiles * 0.5), 0, 1);

  const score = Number((directScore * 0.3 + shapeScore * 0.35 + distanceScore * 0.15 + overlapScore * 0.2).toFixed(3));
  return {
    score,
    overlapPercent: Number((overlap * 100).toFixed(1)),
    endpointDeviationMeters,
    direction,
  };
}

function catalogSignature(catalog: RouteProfile[]) {
  const size = catalog.length;
  const latest = catalog
    .map((row) => row.lastRunAt)
    .sort()
    .slice(-1)[0] || 'none';
  return `${size}:${latest}`;
}

export async function findRouteMatches(route: LocationPoint[]): Promise<RouteMatch[]> {
  if (!Array.isArray(route) || route.length < 2) return [];
  if (routeDistanceMiles(route) < MIN_ROUTE_DISTANCE_MILES) return [];
  const catalog = await getRouteCatalog();
  const signature = catalogSignature(catalog);
  const cacheKey = routeHash(route);
  const cached = matchCache.get(cacheKey);
  if (cached && cached.catalogSignature === signature) {
    return cached.matches;
  }

  const matches = catalog
    .map((profile) => {
      const forward = routeMatchScore(route, profile, 'forward');
      const reverse = routeMatchScore(route, profile, 'reverse');
      const best = forward.score >= reverse.score ? forward : reverse;
      return { profile, ...best };
    })
    .filter(
      (row) =>
        row.score >= MATCH_THRESHOLD &&
        row.overlapPercent / 100 >= MIN_OVERLAP_PERCENT &&
        row.endpointDeviationMeters <= MAX_ENDPOINT_DEVIATION_METERS
    )
    .sort((a, b) => b.score - a.score);

  matchCache.set(cacheKey, { catalogSignature: signature, matches });
  return matches;
}

export async function registerRouteProfile(options: {
  route: LocationPoint[];
  runAt: string;
  mode: 'merge' | 'separate';
  mergeTargetId?: string;
}): Promise<{ profileId: string; merged: boolean }> {
  const { route, runAt, mode, mergeTargetId } = options;
  if (!Array.isArray(route) || route.length < 2) {
    return { profileId: '', merged: false };
  }

  const catalog = await getRouteCatalog();

  if (mode === 'merge' && mergeTargetId) {
    const idx = catalog.findIndex((row) => row.id === mergeTargetId);
    if (idx >= 0) {
      const existing = catalog[idx];
      catalog[idx] = {
        ...existing,
        runCount: existing.runCount + 1,
        lastRunAt: runAt,
        totalDistanceMiles: Number(((existing.totalDistanceMiles * existing.runCount + routeDistanceMiles(route)) / (existing.runCount + 1)).toFixed(3)),
      };
      await saveRouteCatalog(catalog);
      return { profileId: existing.id, merged: true };
    }
  }

  const nextProfile: RouteProfile = {
    id: `route_${Date.now()}`,
    hash: routeHash(route),
    centroid: centroid(route),
    bounds: bounds(route),
    pointCount: route.length,
    totalDistanceMiles: Number(routeDistanceMiles(route).toFixed(3)),
    runCount: 1,
    firstRunAt: runAt,
    lastRunAt: runAt,
    sampleRoute: sampleRoute(route),
  };

  catalog.push(nextProfile);
  await saveRouteCatalog(catalog);
  return { profileId: nextProfile.id, merged: false };
}
