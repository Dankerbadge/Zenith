import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  type CanonicalChallengeDefinition,
  type CanonicalChallengeParticipant,
  type CanonicalRun,
  type RunKind,
  RUNNING_SCHEMA_VERSION,
  nowUtcIso,
} from './canonicalRunningSchema';
import { type LocationPoint } from './gpsService';
import { createRunMetricVersionSet } from './runMetricVersions';

const CANONICAL_RUNS_KEY = 'canonicalRuns';
const CANONICAL_CHALLENGES_KEY = 'canonicalChallenges';
const CANONICAL_CHALLENGE_PARTICIPANTS_KEY = 'canonicalChallengeParticipants';
const IMMUTABLE_RUN_METRIC_KEYS: Array<keyof CanonicalRun> = [
  'startTimeUtc',
  'endTimeUtc',
  'elapsedTimeSec',
  'movingTimeSec',
  'pausedTimeSec',
  'distanceMeters',
  'distanceSource',
  'avgPaceSecPerKm',
  'avgPaceSecPerMile',
  'paceSource',
  'samplesRef',
  'samplesSummary',
  'polylineSimplifiedRef',
  'polylineBounds',
  'gpsQuality',
  'gapSegments',
  'estimatedDistanceMeters',
  'confidenceSummary',
  'metricVersions',
];

function safeParseArray<T>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function polylineBounds(route: LocationPoint[]) {
  if (!route.length) return null;
  const lats = route.map((p) => p.latitude);
  const lons = route.map((p) => p.longitude);
  return {
    minLat: Math.min(...lats),
    minLon: Math.min(...lons),
    maxLat: Math.max(...lats),
    maxLon: Math.max(...lons),
  };
}

export async function listCanonicalRuns(): Promise<CanonicalRun[]> {
  const raw = await AsyncStorage.getItem(CANONICAL_RUNS_KEY);
  return safeParseArray<CanonicalRun>(raw).sort((a, b) => (a.startTimeUtc < b.startTimeUtc ? 1 : -1));
}

export async function upsertCanonicalRun(run: CanonicalRun): Promise<void> {
  const rows = await listCanonicalRuns();
  const idx = rows.findIndex((r) => r.runId === run.runId);
  if (idx >= 0) rows[idx] = { ...rows[idx], ...run, updatedAtUtc: nowUtcIso() };
  else rows.push(run);
  await AsyncStorage.setItem(CANONICAL_RUNS_KEY, JSON.stringify(rows));
}

export async function patchCanonicalRun(
  runId: string,
  patch: Partial<CanonicalRun>,
  options?: { allowMetricPatch?: boolean }
): Promise<void> {
  if (!runId) return;
  const rows = await listCanonicalRuns();
  const idx = rows.findIndex((row) => row.runId === runId);
  if (idx < 0) return;
  const target = rows[idx];
  const lockActive = target.metricsLock?.metricsImmutable !== false;
  const safePatch: Partial<CanonicalRun> = { ...patch };
  if (lockActive && !options?.allowMetricPatch) {
    IMMUTABLE_RUN_METRIC_KEYS.forEach((key) => {
      if (key in safePatch) {
        delete (safePatch as Record<string, unknown>)[key];
      }
    });
  }
  rows[idx] = {
    ...target,
    ...safePatch,
    updatedAtUtc: nowUtcIso(),
  };
  await AsyncStorage.setItem(CANONICAL_RUNS_KEY, JSON.stringify(rows));
}

export async function getCanonicalRun(runId: string): Promise<CanonicalRun | null> {
  if (!runId) return null;
  const rows = await listCanonicalRuns();
  return rows.find((row) => row.runId === runId) || null;
}

export async function upsertCanonicalRunFromLegacy(input: {
  runId: string;
  userId: string;
  kind?: RunKind;
  startTimeUtc: string;
  endTimeUtc: string;
  elapsedTimeSec: number;
  pausedTimeSec: number;
  distanceMiles: number;
  avgPaceSecPerMile: number;
  route: LocationPoint[];
  gpsQuality?: 'high' | 'medium' | 'low' | 'unknown';
  xpAwarded: number;
  notes?: string;
  hrAvailable?: boolean;
  hrConfidence?: number | null;
}) {
  const createdAtUtc = nowUtcIso();
  const hrAvailable = input.hrAvailable === true;
  const hrConfidence =
    hrAvailable && input.hrConfidence != null && Number.isFinite(Number(input.hrConfidence))
      ? Math.max(0, Math.min(100, Math.round(Number(input.hrConfidence))))
      : null;
  const run: CanonicalRun = {
    runId: input.runId,
    userId: input.userId,
    kind: input.kind || (input.route.length ? 'gps_outdoor' : 'manual_treadmill'),
    state: 'saved',
    startTimeUtc: input.startTimeUtc,
    endTimeUtc: input.endTimeUtc,
    elapsedTimeSec: Math.max(0, Math.round(input.elapsedTimeSec)),
    movingTimeSec: Math.max(0, Math.round(input.elapsedTimeSec)),
    pausedTimeSec: Math.max(0, Math.round(input.pausedTimeSec)),
    distanceMeters: Math.max(0, Number((input.distanceMiles * 1609.344).toFixed(2))),
    distanceSource: input.route.length ? 'gps_measured' : 'user_entered',
    avgPaceSecPerKm:
      input.avgPaceSecPerMile > 0
        ? Number((input.avgPaceSecPerMile * (60 / 1.609344)).toFixed(2))
        : null,
    avgPaceSecPerMile:
      input.avgPaceSecPerMile > 0 ? Number((input.avgPaceSecPerMile * 60).toFixed(2)) : null,
    paceSource: input.route.length ? 'derived_from_gps' : 'derived_from_user_entry',
    elevationGainMeters: null,
    elevationLossMeters: null,
    elevationSource: 'unknown',
    samplesRef: null,
    samplesSummary: input.route.length
      ? {
          totalSamples: input.route.length,
          samplingStrategyId: 'adaptive_v1',
        }
      : null,
    polylineSimplifiedRef: null,
    polylineBounds: polylineBounds(input.route),
    gpsQuality: input.route.length ? input.gpsQuality || 'unknown' : 'unknown',
    gpsSignalState: input.route.length ? 'good' : 'unknown',
    dataQualityNotes: [],
    gapSegments: [],
    estimatedDistanceMeters: 0,
    hrAvailable,
    confidenceSummary: {
      distanceConfidence: input.route.length ? 80 : 50,
      paceConfidence: input.route.length ? 80 : 50,
      hrConfidence,
    },
    metricVersions: createRunMetricVersionSet(),
    metricsLock: {
      metricsImmutable: true,
      metricsLockedAtUtc: createdAtUtc,
      sessionIntegrityState: 'finalized',
    },
    notes: input.notes,
    trainingLoadScoreEstimated: undefined,
    xpAwarded: input.xpAwarded,
    winningDayContribution: { eligible: input.distanceMiles >= 0.5 || input.elapsedTimeSec >= 600, reasonCodes: [] },
    measuredLabel: input.route.length ? 'measured' : 'user_entered',
    createdAtUtc,
    updatedAtUtc: createdAtUtc,
    schemaVersion: RUNNING_SCHEMA_VERSION,
  };
  await upsertCanonicalRun(run);
}

export async function listChallengeDefinitions(): Promise<CanonicalChallengeDefinition[]> {
  const raw = await AsyncStorage.getItem(CANONICAL_CHALLENGES_KEY);
  return safeParseArray<CanonicalChallengeDefinition>(raw);
}

export async function getChallengeDefinition(challengeId: string): Promise<CanonicalChallengeDefinition | null> {
  if (!challengeId) return null;
  const rows = await listChallengeDefinitions();
  return rows.find((row) => row.challengeId === challengeId) || null;
}

export async function upsertChallengeDefinition(definition: CanonicalChallengeDefinition): Promise<void> {
  const rows = await listChallengeDefinitions();
  const idx = rows.findIndex((row) => row.challengeId === definition.challengeId);
  if (idx >= 0) rows[idx] = { ...rows[idx], ...definition, updatedAtUtc: nowUtcIso() };
  else rows.push(definition);
  await AsyncStorage.setItem(CANONICAL_CHALLENGES_KEY, JSON.stringify(rows));
}

export async function listChallengeParticipants(): Promise<CanonicalChallengeParticipant[]> {
  const raw = await AsyncStorage.getItem(CANONICAL_CHALLENGE_PARTICIPANTS_KEY);
  return safeParseArray<CanonicalChallengeParticipant>(raw);
}

export async function getChallengeParticipant(participantId: string): Promise<CanonicalChallengeParticipant | null> {
  if (!participantId) return null;
  const rows = await listChallengeParticipants();
  return rows.find((row) => row.participantId === participantId) || null;
}

export async function upsertChallengeParticipant(participant: CanonicalChallengeParticipant): Promise<void> {
  const rows = await listChallengeParticipants();
  const idx = rows.findIndex((row) => row.participantId === participant.participantId);
  if (idx >= 0) rows[idx] = { ...rows[idx], ...participant, updatedAtUtc: nowUtcIso() };
  else rows.push(participant);
  await AsyncStorage.setItem(CANONICAL_CHALLENGE_PARTICIPANTS_KEY, JSON.stringify(rows));
}
