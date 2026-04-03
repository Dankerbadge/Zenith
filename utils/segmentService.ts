import AsyncStorage from '@react-native-async-storage/async-storage';
import { calculateDistance, type LocationPoint } from './gpsService';
import { type QualityTier, type Visibility } from './canonicalRunningSchema';

const SEGMENTS_KEY = 'runSegments';
const SEGMENT_ATTEMPTS_KEY = 'segmentAttempts';
const SEGMENT_CACHE_VERSION_KEY = 'segmentCacheVersion';
const MIN_SEGMENT_DISTANCE_MILES = 0.2;
const MIN_SEGMENT_DURATION_SEC = 45;
const MIN_REALISTIC_PACE_MIN_PER_MILE = 3;
const MAX_REASONABLE_GPS_ACCURACY_METERS = 35;

export type RunSegment = {
  id: string;
  name: string;
  isPrivate: boolean;
  visibility?: Visibility;
  direction?: 'forward' | 'reverse' | 'either';
  createdAt: string;
  updatedAt: string;
  schemaVersion?: number;
  sourceRunTimestamp: string;
  routeProfileId?: string;
  startIndex: number;
  endIndex: number;
  pointCount: number;
  distanceMiles: number;
  distanceMetersApprox?: number;
  startMarker?: { lat: number; lon: number; toleranceRadiusMeters: number };
  endMarker?: { lat: number; lon: number; toleranceRadiusMeters: number };
  startPoint: Pick<LocationPoint, 'latitude' | 'longitude'>;
  endPoint: Pick<LocationPoint, 'latitude' | 'longitude'>;
  route: Pick<LocationPoint, 'latitude' | 'longitude'>[];
};

export type SegmentDirection = 'forward' | 'reverse';

export type SegmentDetection = {
  segmentId: string;
  name: string;
  direction: SegmentDirection;
  score: number;
  startIndex: number;
  endIndex: number;
  distanceMiles: number;
};

export type SegmentAttempt = SegmentDetection & {
  id: string;
  runTimestamp: string;
  detectedAt: string;
  quality?: QualityTier;
  qualityReasons?: string[];
  startSampleIndex?: number;
  endSampleIndex?: number;
  detectionVersionId?: string;
  estimatedDurationSec?: number;
  estimatedPaceMinPerMile?: number;
  isPrHit?: boolean;
};

export type SegmentHistory = {
  segmentId: string;
  name: string;
  distanceMiles: number;
  attempts: number;
  bestPaceMinPerMile: number;
  bestDurationSec: number;
  lastPaceMinPerMile: number;
  lastDurationSec: number;
  trendDeltaPace: number;
  trendLabel: 'improving' | 'stable' | 'slower';
  lastRunTimestamp?: string;
};

export type SegmentChallengeType = 'beat_pr' | 'pace_hold' | 'attempt_count';
export type SegmentChallengeStatus = 'locked' | 'in_progress' | 'completed';

export type SegmentChallenge = {
  type: SegmentChallengeType;
  title: string;
  status: SegmentChallengeStatus;
  progressText: string;
  detail: string;
};

export type SegmentChallengeBoard = {
  segmentId: string;
  name: string;
  history: SegmentHistory;
  challenges: SegmentChallenge[];
};

export type SegmentSelectionValidation = {
  valid: boolean;
  distanceMiles: number;
  estimatedDurationSec?: number;
  reasons: string[];
};

function safeParse(raw: string | null): RunSegment[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RunSegment[]) : [];
  } catch {
    return [];
  }
}

function safeParseAttempts(raw: string | null): SegmentAttempt[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SegmentAttempt[]) : [];
  } catch {
    return [];
  }
}

async function bumpSegmentCacheVersion() {
  const raw = await AsyncStorage.getItem(SEGMENT_CACHE_VERSION_KEY);
  const next = (Number(raw) || 0) + 1;
  await AsyncStorage.setItem(SEGMENT_CACHE_VERSION_KEY, String(next));
}

function computePauseOverlapSec(input: {
  route: LocationPoint[];
  startIndex: number;
  endIndex: number;
  pauseEvents?: { pauseAtUtc: string; resumeAtUtc?: string }[];
}) {
  const { route, startIndex, endIndex, pauseEvents } = input;
  const startTs = Number(route[startIndex]?.timestamp);
  const endTs = Number(route[endIndex]?.timestamp);
  if (!Number.isFinite(startTs) || !Number.isFinite(endTs) || endTs <= startTs) return 0;

  let pausedMsInside = 0;
  (pauseEvents || []).forEach((evt) => {
    const pStart = Date.parse(evt.pauseAtUtc);
    const pEnd = evt.resumeAtUtc ? Date.parse(evt.resumeAtUtc) : pStart;
    if (!Number.isFinite(pStart) || !Number.isFinite(pEnd) || pEnd <= pStart) return;
    const overlapStart = Math.max(startTs, pStart);
    const overlapEnd = Math.min(endTs, pEnd);
    if (overlapEnd > overlapStart) {
      pausedMsInside += overlapEnd - overlapStart;
    }
  });
  return Number((pausedMsInside / 1000).toFixed(1));
}

function computeSegmentActiveDurationSec(input: {
  route: LocationPoint[];
  startIndex: number;
  endIndex: number;
  pauseEvents?: { pauseAtUtc: string; resumeAtUtc?: string }[];
  fallbackDurationSec?: number;
  fallbackRunDistanceMiles?: number;
  segmentDistanceMiles?: number;
}) {
  const { route, startIndex, endIndex, pauseEvents, fallbackDurationSec, fallbackRunDistanceMiles, segmentDistanceMiles } = input;
  const startTs = Number(route[startIndex]?.timestamp);
  const endTs = Number(route[endIndex]?.timestamp);

  if (Number.isFinite(startTs) && Number.isFinite(endTs) && endTs > startTs) {
    const pausedOverlapSec = computePauseOverlapSec({ route, startIndex, endIndex, pauseEvents });
    const activeMs = Math.max(0, endTs - startTs - pausedOverlapSec * 1000);
    return Number((activeMs / 1000).toFixed(1));
  }

  if (fallbackDurationSec && fallbackRunDistanceMiles && segmentDistanceMiles && fallbackRunDistanceMiles > 0) {
    return Number(((segmentDistanceMiles / fallbackRunDistanceMiles) * fallbackDurationSec).toFixed(1));
  }

  return undefined;
}

function clampIndex(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function computeDistanceMiles(points: Pick<LocationPoint, 'latitude' | 'longitude'>[]) {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += calculateDistance(
      points[i - 1].latitude,
      points[i - 1].longitude,
      points[i].latitude,
      points[i].longitude
    );
  }
  return Number(total.toFixed(3));
}

function toRad(value: number) {
  return (value * Math.PI) / 180;
}

function distanceMeters(
  a: Pick<LocationPoint, 'latitude' | 'longitude'>,
  b: Pick<LocationPoint, 'latitude' | 'longitude'>
) {
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

function clamp(n: number, low: number, high: number) {
  return Math.max(low, Math.min(high, n));
}

function samplePoints<T>(points: T[], count = 16): T[] {
  if (points.length <= count) return points;
  const step = (points.length - 1) / (count - 1);
  const out: T[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(points[Math.round(i * step)]);
  }
  return out;
}

function nearestIndexToPoint(route: LocationPoint[], target: Pick<LocationPoint, 'latitude' | 'longitude'>, fromIndex = 0) {
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = Math.max(0, fromIndex); i < route.length; i += 1) {
    const d = distanceMeters(route[i], target);
    if (d < bestDistance) {
      bestDistance = d;
      bestIndex = i;
    }
  }
  return { index: bestIndex, distanceMeters: bestDistance };
}

function shapeScore(
  candidateSlice: LocationPoint[],
  segmentRoute: Pick<LocationPoint, 'latitude' | 'longitude'>[]
) {
  const a = samplePoints(candidateSlice, 16);
  const b = samplePoints(segmentRoute, 16);
  const n = Math.min(a.length, b.length);
  if (!n) return 0;

  let total = 0;
  for (let i = 0; i < n; i += 1) {
    const ai = a[Math.round((i / Math.max(1, n - 1)) * (a.length - 1))];
    const bi = b[Math.round((i / Math.max(1, n - 1)) * (b.length - 1))];
    total += distanceMeters(ai, bi);
  }
  const avgDistance = total / n;
  return clamp(1 - avgDistance / 180, 0, 1);
}

function directionalMatch(
  route: LocationPoint[],
  segment: RunSegment,
  direction: SegmentDirection
): SegmentDetection | null {
  if (!route.length || !segment.route.length) return null;

  const segStart = direction === 'forward' ? segment.startPoint : segment.endPoint;
  const segEnd = direction === 'forward' ? segment.endPoint : segment.startPoint;
  const segRoute = direction === 'forward' ? segment.route : [...segment.route].reverse();

  const start = nearestIndexToPoint(route, segStart);
  if (start.index < 0 || start.distanceMeters > 120) return null;

  const end = nearestIndexToPoint(route, segEnd, start.index + 1);
  if (end.index < 0 || end.distanceMeters > 120 || end.index - start.index < 2) return null;

  const routeSlice = route.slice(start.index, end.index + 1);
  const sliceDistance = computeDistanceMiles(routeSlice);
  if (sliceDistance < Math.max(0.2, segment.distanceMiles * 0.65)) return null;

  const endpointScore = clamp(1 - (start.distanceMeters + end.distanceMeters) / 220, 0, 1);
  const pathScore = shapeScore(routeSlice, segRoute);
  const lengthScore = clamp(
    1 - Math.abs(sliceDistance - segment.distanceMiles) / Math.max(0.25, segment.distanceMiles * 0.45),
    0,
    1
  );

  const score = Number((endpointScore * 0.35 + pathScore * 0.45 + lengthScore * 0.2).toFixed(3));
  if (score < 0.62) return null;

  return {
    segmentId: segment.id,
    name: segment.name,
    direction,
    score,
    startIndex: start.index,
    endIndex: end.index,
    distanceMiles: Number(sliceDistance.toFixed(3)),
  };
}

export function toSafeSegmentRange(routeLength: number, startIndex: number, endIndex: number) {
  if (!Number.isFinite(routeLength) || routeLength < 2) {
    return { startIndex: 0, endIndex: 1 };
  }
  const max = routeLength - 1;
  const start = clampIndex(startIndex, 0, max - 1);
  const end = clampIndex(endIndex, start + 1, max);
  return { startIndex: start, endIndex: end };
}

export function buildSegmentPreview(
  route: LocationPoint[],
  startIndex: number,
  endIndex: number
): {
  routeSlice: Pick<LocationPoint, 'latitude' | 'longitude'>[];
  distanceMiles: number;
  pointCount: number;
  startPoint: Pick<LocationPoint, 'latitude' | 'longitude'>;
  endPoint: Pick<LocationPoint, 'latitude' | 'longitude'>;
} | null {
  if (!Array.isArray(route) || route.length < 2) return null;
  const safe = toSafeSegmentRange(route.length, startIndex, endIndex);
  const routeSlice = route
    .slice(safe.startIndex, safe.endIndex + 1)
    .map((point) => ({ latitude: point.latitude, longitude: point.longitude }));
  if (routeSlice.length < 2) return null;

  return {
    routeSlice,
    distanceMiles: computeDistanceMiles(routeSlice),
    pointCount: routeSlice.length,
    startPoint: routeSlice[0],
    endPoint: routeSlice[routeSlice.length - 1],
  };
}

export function validateSegmentSelection(
  route: LocationPoint[],
  startIndex: number,
  endIndex: number
): SegmentSelectionValidation {
  if (!Array.isArray(route) || route.length < 2) {
    return { valid: false, distanceMiles: 0, reasons: ['route_unavailable'] };
  }
  const safe = toSafeSegmentRange(route.length, startIndex, endIndex);
  const preview = buildSegmentPreview(route, safe.startIndex, safe.endIndex);
  if (!preview) {
    return { valid: false, distanceMiles: 0, reasons: ['invalid_range'] };
  }
  const reasons: string[] = [];
  const startTs = Number(route[safe.startIndex]?.timestamp);
  const endTs = Number(route[safe.endIndex]?.timestamp);
  const estimatedDurationSec =
    Number.isFinite(startTs) && Number.isFinite(endTs) && endTs > startTs
      ? Number(((endTs - startTs) / 1000).toFixed(1))
      : undefined;

  if (preview.distanceMiles < MIN_SEGMENT_DISTANCE_MILES) reasons.push('too_short_distance');
  if (estimatedDurationSec !== undefined && estimatedDurationSec < MIN_SEGMENT_DURATION_SEC) reasons.push('too_short_duration');
  if (safe.endIndex - safe.startIndex < 2) reasons.push('insufficient_points');

  return {
    valid: reasons.length === 0,
    distanceMiles: preview.distanceMiles,
    estimatedDurationSec,
    reasons,
  };
}

export async function createRunSegment(input: {
  name?: string;
  sourceRunTimestamp: string;
  route: LocationPoint[];
  startIndex: number;
  endIndex: number;
  isPrivate?: boolean;
  visibility?: Visibility;
  direction?: 'forward' | 'reverse' | 'either';
  routeProfileId?: string;
}): Promise<RunSegment | null> {
  const preview = buildSegmentPreview(input.route, input.startIndex, input.endIndex);
  if (!preview) return null;
  const validation = validateSegmentSelection(input.route, input.startIndex, input.endIndex);
  if (!validation.valid) return null;

  const now = new Date().toISOString();
  const segment: RunSegment = {
    id: `segment_${Date.now()}`,
    name: (input.name || 'Custom Segment').trim() || 'Custom Segment',
    isPrivate: input.isPrivate ?? true,
    visibility: input.visibility || (input.isPrivate === false ? 'friends' : 'private'),
    direction: input.direction || 'forward',
    createdAt: now,
    updatedAt: now,
    schemaVersion: 1,
    sourceRunTimestamp: input.sourceRunTimestamp,
    routeProfileId: input.routeProfileId,
    startIndex: toSafeSegmentRange(input.route.length, input.startIndex, input.endIndex).startIndex,
    endIndex: toSafeSegmentRange(input.route.length, input.startIndex, input.endIndex).endIndex,
    pointCount: preview.pointCount,
    distanceMiles: preview.distanceMiles,
    distanceMetersApprox: Number((preview.distanceMiles * 1609.344).toFixed(2)),
    startMarker: {
      lat: preview.startPoint.latitude,
      lon: preview.startPoint.longitude,
      toleranceRadiusMeters: 35,
    },
    endMarker: {
      lat: preview.endPoint.latitude,
      lon: preview.endPoint.longitude,
      toleranceRadiusMeters: 35,
    },
    startPoint: preview.startPoint,
    endPoint: preview.endPoint,
    route: preview.routeSlice,
  };

  const raw = await AsyncStorage.getItem(SEGMENTS_KEY);
  const existing = safeParse(raw);
  existing.push(segment);
  await AsyncStorage.setItem(SEGMENTS_KEY, JSON.stringify(existing));
  await bumpSegmentCacheVersion();
  return segment;
}

export async function getRunSegments(): Promise<RunSegment[]> {
  const raw = await AsyncStorage.getItem(SEGMENTS_KEY);
  return safeParse(raw).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function detectSegmentsForRun(route: LocationPoint[]): Promise<SegmentDetection[]> {
  if (!Array.isArray(route) || route.length < 2) return [];

  const segments = await getRunSegments();
  const detections = segments
    .map((segment) => {
      const forward = directionalMatch(route, segment, 'forward');
      const reverse = directionalMatch(route, segment, 'reverse');
      if (!forward && !reverse) return null;
      if (forward && reverse) return forward.score >= reverse.score ? forward : reverse;
      return forward || reverse;
    })
    .filter((row): row is SegmentDetection => Boolean(row))
    .sort((a, b) => b.score - a.score);

  return detections;
}

export async function detectAndStoreSegmentAttempts(input: {
  runTimestamp: string;
  route: LocationPoint[];
  maxMatches?: number;
  runDistanceMiles?: number;
  runDurationSec?: number;
  pauseEvents?: { pauseAtUtc: string; resumeAtUtc?: string }[];
  runDistanceConfidence?: number;
  prDistanceConfidenceMin?: number;
}): Promise<SegmentAttempt[]> {
  const detections = await detectSegmentsForRun(input.route);
  if (!detections.length) return [];

  const raw = await AsyncStorage.getItem(SEGMENT_ATTEMPTS_KEY);
  const existing = safeParseAttempts(raw);
  const topMatches = detections.slice(0, Math.max(1, input.maxMatches ?? 4));
  const now = new Date().toISOString();
  const minDistanceConfidence = Number(input.prDistanceConfidenceMin) || 70;
  const runDistanceConfidence = Number(input.runDistanceConfidence);
  const runConfidenceEligible = !Number.isFinite(runDistanceConfidence) || runDistanceConfidence >= minDistanceConfidence;

  const attempts: SegmentAttempt[] = topMatches.map((row) => {
    const pauseOverlapSec = computePauseOverlapSec({
      route: input.route,
      startIndex: row.startIndex,
      endIndex: row.endIndex,
      pauseEvents: input.pauseEvents,
    });
    const estimatedDurationSec = computeSegmentActiveDurationSec({
      route: input.route,
      startIndex: row.startIndex,
      endIndex: row.endIndex,
      pauseEvents: input.pauseEvents,
      fallbackDurationSec: input.runDurationSec,
      fallbackRunDistanceMiles: input.runDistanceMiles,
      segmentDistanceMiles: row.distanceMiles,
    });
    const estimatedPace =
      (Number(estimatedDurationSec) || 0) > 0
        ? Number(((Number(estimatedDurationSec) / 60) / Math.max(0.0001, row.distanceMiles)).toFixed(3))
        : undefined;
    const segmentSlice = input.route.slice(row.startIndex, row.endIndex + 1);
    const accuracyValues = segmentSlice
      .map((point) => Number(point?.accuracy))
      .filter((value) => Number.isFinite(value) && value > 0);
    const avgAccuracy = accuracyValues.length
      ? accuracyValues.reduce((sum, value) => sum + value, 0) / accuracyValues.length
      : null;
    const qualityReasons: string[] = [];
    if (row.score < 0.7) qualityReasons.push('low_match_score');
    if (pauseOverlapSec > 0) qualityReasons.push('paused_within_segment');
    if (avgAccuracy !== null && avgAccuracy > MAX_REASONABLE_GPS_ACCURACY_METERS) qualityReasons.push('low_gps_accuracy');
    if ((Number(estimatedPace) || 0) > 0 && Number(estimatedPace) < MIN_REALISTIC_PACE_MIN_PER_MILE) {
      qualityReasons.push('unrealistic_pace_spike');
    }
    if (!runConfidenceEligible) qualityReasons.push('run_distance_confidence_low');
    const quality: QualityTier =
      qualityReasons.includes('paused_within_segment') ||
      qualityReasons.includes('unrealistic_pace_spike') ||
      qualityReasons.includes('low_gps_accuracy') ||
      qualityReasons.includes('low_match_score') ||
      qualityReasons.includes('run_distance_confidence_low')
        ? 'low'
        : row.score >= 0.82
        ? 'high'
        : 'medium';
    return {
      ...row,
      id: `segmentAttempt_${Date.now()}_${row.segmentId}`,
      runTimestamp: input.runTimestamp,
      detectedAt: now,
      estimatedDurationSec,
      estimatedPaceMinPerMile: estimatedPace,
      quality,
      qualityReasons,
      startSampleIndex: row.startIndex,
      endSampleIndex: row.endIndex,
      detectionVersionId: 'segment_detect_v1',
      isPrHit: false,
    };
  });

  const attemptsWithPr = attempts.map((attempt) => {
    if (!runConfidenceEligible) return attempt;
    const pace = Number(attempt.estimatedPaceMinPerMile) || 0;
    if (attempt.quality === 'low') return attempt;
    if (!pace) return attempt;
    const priorPaces = existing
      .filter((item) => item.segmentId === attempt.segmentId && item.quality !== 'low')
      .map((item) => Number(item.estimatedPaceMinPerMile) || 0)
      .filter((item) => item > 0);
    if (!priorPaces.length) return attempt;
    const priorBest = Math.min(...priorPaces);
    return {
      ...attempt,
      isPrHit: pace < priorBest - 0.01,
    };
  });

  const merged = [...existing, ...attemptsWithPr].slice(-800);
  await AsyncStorage.setItem(SEGMENT_ATTEMPTS_KEY, JSON.stringify(merged));
  await bumpSegmentCacheVersion();
  return attemptsWithPr;
}

export async function getSegmentAttempts(): Promise<SegmentAttempt[]> {
  const raw = await AsyncStorage.getItem(SEGMENT_ATTEMPTS_KEY);
  return safeParseAttempts(raw)
    .map((attempt) => ({
      ...attempt,
      quality: attempt.quality || 'unknown',
      qualityReasons: Array.isArray(attempt.qualityReasons) ? attempt.qualityReasons : [],
      detectionVersionId: attempt.detectionVersionId || 'segment_detect_v1',
    }))
    .sort((a, b) => (a.detectedAt < b.detectedAt ? 1 : -1));
}

export async function getSegmentCacheVersion(): Promise<number> {
  const raw = await AsyncStorage.getItem(SEGMENT_CACHE_VERSION_KEY);
  return Number(raw) || 0;
}

function avg(nums: number[]) {
  if (!nums.length) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function toHistory(segmentId: string, attempts: SegmentAttempt[]): SegmentHistory {
  const ordered = [...attempts].sort((a, b) => (a.runTimestamp < b.runTimestamp ? -1 : 1));
  const paces = ordered
    .filter((row) => row.quality !== 'low')
    .map((row) => Number(row.estimatedPaceMinPerMile) || 0)
    .filter((row) => row > 0);
  const durations = ordered
    .filter((row) => row.quality !== 'low')
    .map((row) => Number(row.estimatedDurationSec) || 0)
    .filter((row) => row > 0);

  const recentPaces = paces.slice(-3);
  const previousPaces = paces.slice(-6, -3);
  const trendDeltaPace = previousPaces.length ? Number((avg(recentPaces) - avg(previousPaces)).toFixed(3)) : 0;
  const trendLabel = trendDeltaPace <= -0.15 ? 'improving' : trendDeltaPace >= 0.15 ? 'slower' : 'stable';

  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const bestPace = paces.length ? Math.min(...paces) : 0;
  const bestDuration = durations.length ? Math.min(...durations) : 0;

  return {
    segmentId,
    name: last?.name || first?.name || 'Segment',
    distanceMiles: Number((last?.distanceMiles || first?.distanceMiles || 0).toFixed(3)),
    attempts: ordered.length,
    bestPaceMinPerMile: Number(bestPace.toFixed(3)),
    bestDurationSec: Number(bestDuration.toFixed(1)),
    lastPaceMinPerMile: Number((Number(last?.estimatedPaceMinPerMile) || 0).toFixed(3)),
    lastDurationSec: Number((Number(last?.estimatedDurationSec) || 0).toFixed(1)),
    trendDeltaPace,
    trendLabel,
    lastRunTimestamp: last?.runTimestamp,
  };
}

export async function getSegmentHistory(): Promise<SegmentHistory[]> {
  const attempts = await getSegmentAttempts();
  if (!attempts.length) return [];

  const grouped: Record<string, SegmentAttempt[]> = {};
  attempts.forEach((attempt) => {
    if (!grouped[attempt.segmentId]) grouped[attempt.segmentId] = [];
    grouped[attempt.segmentId].push(attempt);
  });

  return Object.entries(grouped)
    .map(([segmentId, rows]) => toHistory(segmentId, rows))
    .sort((a, b) => b.attempts - a.attempts);
}

export async function getTopSegmentHistory(limit = 3): Promise<SegmentHistory[]> {
  const all = await getSegmentHistory();
  return all.slice(0, Math.max(1, limit));
}

function buildBeatPrChallenge(orderedAttempts: SegmentAttempt[]): SegmentChallenge {
  const paces = orderedAttempts
    .map((row) => Number(row.estimatedPaceMinPerMile) || 0)
    .filter((row) => row > 0);
  if (paces.length < 2) {
    return {
      type: 'beat_pr',
      title: 'Beat Your Segment PR',
      status: 'in_progress',
      progressText: `${paces.length}/2 qualifying attempts`,
      detail: 'Complete one more matching effort to unlock PR chase.',
    };
  }

  const last = paces[paces.length - 1];
  const previousBest = Math.min(...paces.slice(0, -1));
  const beatBy = Number((previousBest - last).toFixed(3));
  const completed = beatBy > 0.01;
  const target = Number((previousBest - 0.01).toFixed(2));

  return {
    type: 'beat_pr',
    title: 'Beat Your Segment PR',
    status: completed ? 'completed' : 'in_progress',
    progressText: completed ? `PR improved by ${beatBy.toFixed(2)} min/mi` : `Target <= ${target.toFixed(2)} min/mi`,
    detail: completed ? 'You set a faster segment PR on your latest attempt.' : 'Push one controlled effort to beat your previous best pace.',
  };
}

function buildPaceHoldChallenge(orderedAttempts: SegmentAttempt[]): SegmentChallenge {
  const paces = orderedAttempts
    .map((row) => Number(row.estimatedPaceMinPerMile) || 0)
    .filter((row) => row > 0);
  if (paces.length < 2) {
    return {
      type: 'pace_hold',
      title: 'Pace Hold',
      status: 'in_progress',
      progressText: `${paces.length}/3 efforts`,
      detail: 'Need three attempts to evaluate consistency at target pace.',
    };
  }

  const bestPace = Math.min(...paces);
  const targetPace = Number((bestPace * 1.08).toFixed(2));
  const recent = paces.slice(-3);
  const heldCount = recent.filter((pace) => pace <= targetPace).length;
  const completed = recent.length === 3 && heldCount === 3;

  return {
    type: 'pace_hold',
    title: 'Pace Hold',
    status: completed ? 'completed' : 'in_progress',
    progressText: `${heldCount}/${Math.min(3, recent.length)} <= ${targetPace.toFixed(2)} min/mi`,
    detail: completed ? 'You held target pace across the last three attempts.' : 'Hold pace within 8% of your best across three recent attempts.',
  };
}

function buildAttemptCountChallenge(orderedAttempts: SegmentAttempt[]): SegmentChallenge {
  const count = orderedAttempts.length;
  const milestones = [3, 5, 10, 20, 30];
  const next = milestones.find((m) => m > count) || milestones[milestones.length - 1];
  const completed = milestones.includes(count);

  return {
    type: 'attempt_count',
    title: 'Attempt Builder',
    status: completed ? 'completed' : 'in_progress',
    progressText: completed ? `${count} attempts milestone` : `${count}/${next} attempts`,
    detail: completed ? 'Milestone unlocked. Keep stacking repetitions for stronger trends.' : 'Accumulate attempts to improve confidence and trend stability.',
  };
}

function buildChallengesForSegment(orderedAttempts: SegmentAttempt[]): SegmentChallenge[] {
  return [
    buildBeatPrChallenge(orderedAttempts),
    buildPaceHoldChallenge(orderedAttempts),
    buildAttemptCountChallenge(orderedAttempts),
  ];
}

export async function getSegmentChallengeBoards(limit?: number): Promise<SegmentChallengeBoard[]> {
  const attempts = await getSegmentAttempts();
  if (!attempts.length) return [];

  const grouped: Record<string, SegmentAttempt[]> = {};
  attempts.forEach((attempt) => {
    if (!grouped[attempt.segmentId]) grouped[attempt.segmentId] = [];
    grouped[attempt.segmentId].push(attempt);
  });

  const boards = Object.entries(grouped)
    .map(([segmentId, rows]) => {
      const ordered = rows.sort((a, b) => (a.runTimestamp < b.runTimestamp ? -1 : 1));
      const history = toHistory(segmentId, ordered);
      return {
        segmentId,
        name: history.name,
        history,
        challenges: buildChallengesForSegment(ordered),
      } as SegmentChallengeBoard;
    })
    .sort((a, b) => b.history.attempts - a.history.attempts);

  if (typeof limit === 'number' && limit > 0) {
    return boards.slice(0, limit);
  }
  return boards;
}
