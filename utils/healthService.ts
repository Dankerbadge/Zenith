// Health Integration Service
// Supports Apple Health (iOS) and Health Connect (Android)
// Reads: HR, workouts, calories, steps, sleep, HRV
// Writes: Workouts, active calories

import { Platform } from 'react-native';
import type { HealthValue, HealthKitPermissions } from 'react-native-health';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { captureException } from './crashReporter';

type AppleHealthKitType = typeof import('react-native-health').default;

let cachedHealthKit: AppleHealthKitType | null | undefined;

export type ZenithHealthAuthorizationState = 'unavailable' | 'notDetermined' | 'denied' | 'authorized';

export type TodaySignalPermissionPrefs = {
  steps?: boolean;
  activeEnergy?: boolean;
  sleep?: boolean;
  restingHeartRate?: boolean;
};

export type HealthPermissionRequest = {
  // Workout read/write (used for export + workout-based features).
  workouts?: boolean;
  // Workout read only (used for importing recorded sessions without write permissions).
  workoutRead?: boolean;
  // Live HR samples (used for workout diagnostics/analytics).
  heartRate?: boolean;
  // Daily signals import (driven by user toggles).
  todaySignals?: TodaySignalPermissionPrefs;
};

const DEFAULT_PERMISSION_REQUEST: Required<Pick<HealthPermissionRequest, 'workouts' | 'todaySignals'>> = {
  workouts: true,
  todaySignals: {
    steps: true,
    activeEnergy: true,
    sleep: true,
    restingHeartRate: true,
  },
};

type TodaySignalKey = 'steps' | 'activeEnergy' | 'sleep' | 'restingHeartRate';
type TodaySignalAuthState = ZenithHealthAuthorizationState | 'disabled';
type TodaySignalAuthMap = Record<TodaySignalKey, TodaySignalAuthState>;

export interface HealthWorkoutSession {
  id: string;
  activityId: number | null;
  activityName: string;
  calories: number;
  durationMin: number;
  distanceMiles: number;
  sourceName?: string;
  sourceId?: string;
  tracked?: boolean;
  metadata?: Record<string, unknown> | null;
  start: string;
  end: string;
}

export const HEALTH_TODAY_SIGNAL_TYPES = [
  { key: 'StepCount', label: 'Steps' },
  { key: 'ActiveEnergyBurned', label: 'Active energy' },
  { key: 'SleepAnalysis', label: 'Sleep duration' },
  { key: 'RestingHeartRate', label: 'Resting heart rate' },
] as const;

const HEALTH_AUTH_REQUESTED_AT_KEY = 'healthkit:requestedAt';
const HEALTH_AUTH_LAST_RESULT_KEY = 'healthkit:lastResult';

type HealthStatusCode = 0 | 1 | 2; // NotDetermined | SharingDenied | SharingAuthorized

export async function resetHealthkitLocalState(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([HEALTH_AUTH_REQUESTED_AT_KEY, HEALTH_AUTH_LAST_RESULT_KEY]);
  } catch {
    // ignore
  }
}

// Convenience helper for iPhone-only users who only want passive daily signal import.
// This avoids requesting Workout write permissions (higher denial risk).
export async function requestReadOnlyHealthPermissions(
  required: TodaySignalPermissionPrefs = {},
  options: { includeWorkoutRead?: boolean } = {}
): Promise<boolean> {
  return requestHealthPermissions(
    {
      workouts: false,
      workoutRead: options.includeWorkoutRead !== false,
      heartRate: false,
      todaySignals: {
        steps: required.steps ?? true,
        activeEnergy: required.activeEnergy ?? true,
        sleep: required.sleep ?? true,
        restingHeartRate: required.restingHeartRate ?? true,
      },
    },
    { allowPartialGrant: true }
  );
}

export async function getHealthkitLastRequestInfo(): Promise<{ requestedAt: string | null; lastResult: string | null }> {
  try {
    const [requestedAt, lastResult] = await Promise.all([
      AsyncStorage.getItem(HEALTH_AUTH_REQUESTED_AT_KEY),
      AsyncStorage.getItem(HEALTH_AUTH_LAST_RESULT_KEY),
    ]);
    return { requestedAt: requestedAt || null, lastResult: lastResult || null };
  } catch {
    return { requestedAt: null, lastResult: null };
  }
}

async function persistHealthAuthResult(value: string): Promise<void> {
  try {
    await AsyncStorage.setItem(HEALTH_AUTH_LAST_RESULT_KEY, value);
  } catch (error) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('Health auth result persist failed:', error);
    } else {
      void captureException(error, { feature: 'health', op: 'persist_auth_result' });
    }
  }
}

export async function isHealthKitAvailable(): Promise<{ available: boolean; error?: string }> {
  const AppleHealthKit = getAppleHealthKit();
  if (!AppleHealthKit) return { available: false, error: 'HealthKit bridge is not active in this runtime.' };
  if (typeof (AppleHealthKit as any).isAvailable !== 'function') {
    // Some builds expose init/getAuth but omit isAvailable from JS shape.
    // Treat this as available and let downstream init/auth checks prove connectivity.
    if (
      typeof (AppleHealthKit as any).initHealthKit === 'function' ||
      typeof (AppleHealthKit as any).getAuthStatus === 'function' ||
      typeof (AppleHealthKit as any).getDailyStepCount === 'function'
    ) {
      return { available: true };
    }
    return { available: false, error: 'HealthKit bridge is not active in this runtime.' };
  }
  return new Promise((resolve) => {
    AppleHealthKit.isAvailable((err: any, results: boolean) => {
      if (err) return resolve({ available: false, error: String((err as any)?.message || err) });
      resolve({ available: Boolean(results) });
    });
  });
}

export type HealthkitProofOfLifeStatus =
  | 'not_available'
  | 'not_authorized'
  | 'authorized_but_partial'
  | 'authorized_write_failed'
  | 'authorized_read_failed'
  | 'connected';

export type HealthkitProofOfLifeResult = {
  checkedAt: string;
  rateLimit?: { limited: boolean; cachedAt?: string; nextAllowedAt?: string; reason?: string };
  availability: { available: boolean; error?: string };
  requested: { read: string[]; write: string[] };
  status: { read: Record<string, HealthStatusCode>; write: Record<string, HealthStatusCode> };
  missing: { read: string[]; write: string[] };
  denied: { read: string[]; write: string[] };
  notDetermined: { read: string[]; write: string[] };
  writeTest: {
    ok: boolean;
    error?: string;
    startIso?: string;
    endIso?: string;
    workoutId?: string;
    diagnosticId?: string;
    buildStamp?: { version?: string | null; build?: string | null };
  };
  readTest: {
    ok: boolean;
    error?: string;
    workoutsSeen: number;
    matchedByWorkoutId: number;
    matchedByDiagnosticId: number;
    matchedByDiagnosticFlag: number;
    matchedByTime: number;
    matchedBySource: number;
  };
  summary: HealthkitProofOfLifeStatus;
  connected: boolean;
};

function toIso(d: Date) {
  return d.toISOString();
}

function withinMs(isoA: string, isoB: string, deltaMs: number) {
  const a = Date.parse(isoA);
  const b = Date.parse(isoB);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= deltaMs;
}

function getBuildStamp(): { version?: string | null; build?: string | null } {
  const expoConfig =
    (Constants as any)?.expoConfig || (Constants as any)?.manifest || (Constants as any)?.manifest2?.extra?.expoClient?.expoConfig;
  const version: string | null = typeof expoConfig?.version === 'string' ? expoConfig.version : null;
  const buildRaw =
    expoConfig?.ios?.buildNumber ??
    (Constants as any)?.nativeBuildVersion ??
    (Constants as any)?.manifest?.ios?.buildNumber ??
    null;
  const build = buildRaw == null ? null : String(buildRaw);
  return { version, build };
}

function newDiagnosticId(): string {
  try {
    return Crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
  }
}

function pickLowImpactWorkoutType(AppleHealthKit: AppleHealthKitType): any {
  const A: any = AppleHealthKit.Constants?.Activities || {};
  return A.MindAndBody || A.Cooldown || A.Yoga || A.Other || A.TraditionalStrengthTraining || A.Running || 'Other';
}

function resolvePermissionKeys(AppleHealthKit: AppleHealthKitType, keys: readonly string[]): string[] {
  const P: any = AppleHealthKit.Constants?.Permissions || {};
  const resolved = keys.map((k) => (P && P[k] ? P[k] : k)).filter(Boolean).map(String);
  return Array.from(new Set(resolved));
}

function buildPermissionKeyLists(request: HealthPermissionRequest): { read: string[]; write: string[] } {
  const read: string[] = [];
  const write: string[] = [];
  const today = request.todaySignals;
  if (today) {
    if (today.steps) read.push('StepCount');
    if (today.activeEnergy) read.push('ActiveEnergyBurned');
    if (today.sleep) read.push('SleepAnalysis');
    if (today.restingHeartRate) read.push('RestingHeartRate');
  }
  if (request.heartRate) read.push('HeartRate');
  if (request.workouts || request.workoutRead) {
    read.push('Workout');
  }
  if (request.workouts) {
    write.push('Workout');
  }
  return { read: Array.from(new Set(read)), write: Array.from(new Set(write)) };
}

function buildPermissionsRequest(AppleHealthKit: AppleHealthKitType, request: HealthPermissionRequest): HealthKitPermissions {
  const keys = buildPermissionKeyLists(request);
  const readPerms = resolvePermissionKeys(AppleHealthKit, keys.read);
  const writePerms = resolvePermissionKeys(AppleHealthKit, keys.write);
  return {
    permissions: {
      read: readPerms as any,
      write: writePerms as any,
    },
  };
}

async function getAuthStatusForPermissions(
  AppleHealthKit: AppleHealthKitType,
  requested: HealthKitPermissions
): Promise<{ status: { read: Record<string, HealthStatusCode>; write: Record<string, HealthStatusCode> }; error?: string }> {
  return new Promise((resolve) => {
    AppleHealthKit.getAuthStatus(requested, (err: string, results: any) => {
      if (err) return resolve({ status: { read: {}, write: {} }, error: err });
      const readReq = requested.permissions.read || [];
      const writeReq = requested.permissions.write || [];
      const readCodes = (results?.permissions?.read || []) as HealthStatusCode[];
      const writeCodes = (results?.permissions?.write || []) as HealthStatusCode[];
      const read: Record<string, HealthStatusCode> = {};
      const write: Record<string, HealthStatusCode> = {};
      readReq.forEach((perm, idx) => {
        read[String(perm)] = readCodes[idx] ?? 0;
      });
      writeReq.forEach((perm, idx) => {
        write[String(perm)] = writeCodes[idx] ?? 0;
      });
      resolve({ status: { read, write } });
    });
  });
}

const HEALTH_PROOF_LAST_RUN_AT_KEY = 'healthkit:proof:lastRunAt';
const HEALTH_PROOF_LAST_RESULT_KEY = 'healthkit:proof:lastResult';
const HEALTH_PROOF_COOLDOWN_MS = 30 * 60 * 1000;

async function readProofCache(): Promise<{ cachedAt: string | null; result: HealthkitProofOfLifeResult | null }> {
  try {
    const [cachedAt, resultRaw] = await Promise.all([
      AsyncStorage.getItem(HEALTH_PROOF_LAST_RUN_AT_KEY),
      AsyncStorage.getItem(HEALTH_PROOF_LAST_RESULT_KEY),
    ]);
    if (!resultRaw) return { cachedAt: cachedAt || null, result: null };
    const parsed = JSON.parse(resultRaw) as HealthkitProofOfLifeResult;
    return { cachedAt: cachedAt || null, result: parsed };
  } catch {
    return { cachedAt: null, result: null };
  }
}

async function writeProofCache(result: HealthkitProofOfLifeResult): Promise<void> {
  try {
    await Promise.all([
      AsyncStorage.setItem(HEALTH_PROOF_LAST_RUN_AT_KEY, result.checkedAt),
      AsyncStorage.setItem(HEALTH_PROOF_LAST_RESULT_KEY, JSON.stringify(result)),
    ]);
  } catch {
    // ignore
  }
}

export async function runHealthkitProofOfLifeDiagnostic(
  options: { force?: boolean; readOnly?: boolean } = {}
): Promise<HealthkitProofOfLifeResult> {
  const checkedAt = new Date().toISOString();
  const AppleHealthKit = getAppleHealthKit();
  if (!AppleHealthKit) {
    return {
      checkedAt,
      rateLimit: { limited: false },
      availability: { available: false, error: 'HealthKit native module unavailable in this client.' },
      requested: { read: [], write: [] },
      status: { read: {}, write: {} },
      missing: { read: [], write: [] },
      denied: { read: [], write: [] },
      notDetermined: { read: [], write: [] },
      writeTest: { ok: false, error: 'HealthKit unavailable.' },
      readTest: {
        ok: false,
        error: 'HealthKit unavailable.',
        workoutsSeen: 0,
        matchedByWorkoutId: 0,
        matchedByDiagnosticId: 0,
        matchedByDiagnosticFlag: 0,
        matchedByTime: 0,
        matchedBySource: 0,
      },
      summary: 'not_available',
      connected: false,
    };
  }

  const availability = await isHealthKitAvailable();
  if (!availability.available) {
    return {
      checkedAt,
      rateLimit: { limited: false },
      availability,
      requested: { read: [], write: [] },
      status: { read: {}, write: {} },
      missing: { read: [], write: [] },
      denied: { read: [], write: [] },
      notDetermined: { read: [], write: [] },
      writeTest: { ok: false, error: availability.error || 'HealthKit is not available on this device/runtime.' },
      readTest: {
        ok: false,
        error: availability.error || 'HealthKit is not available on this device/runtime.',
        workoutsSeen: 0,
        matchedByWorkoutId: 0,
        matchedByDiagnosticId: 0,
        matchedByDiagnosticFlag: 0,
        matchedByTime: 0,
        matchedBySource: 0,
      },
      summary: 'not_available',
      connected: false,
    };
  }

  // Proof-of-life has 2 modes:
  // - default (full): can we write a workout and read it back.
  // - readOnly: can we read daily signals (no workout write required).
  const read = options.readOnly ? resolvePermissionKeys(AppleHealthKit, ['StepCount']) : resolvePermissionKeys(AppleHealthKit, ['Workout']);
  const write = options.readOnly ? [] : resolvePermissionKeys(AppleHealthKit, ['Workout']);

  if (read.length === 0 && write.length === 0) {
    const error = 'HealthKit permission identifiers unavailable. Native module may be misconfigured.';
    await writeProofCache({
      checkedAt,
      rateLimit: { limited: false },
      availability,
      requested: { read: [], write: [] },
      status: { read: {}, write: {} },
      missing: { read: [], write: [] },
      denied: { read: [], write: [] },
      notDetermined: { read: [], write: [] },
      writeTest: { ok: false, error },
      readTest: {
        ok: false,
        error,
        workoutsSeen: 0,
        matchedByWorkoutId: 0,
        matchedByDiagnosticId: 0,
        matchedByDiagnosticFlag: 0,
        matchedByTime: 0,
        matchedBySource: 0,
      },
      summary: 'not_available',
      connected: false,
    });
    return {
      checkedAt,
      rateLimit: { limited: false },
      availability,
      requested: { read: [], write: [] },
      status: { read: {}, write: {} },
      missing: { read: [], write: [] },
      denied: { read: [], write: [] },
      notDetermined: { read: [], write: [] },
      writeTest: { ok: false, error },
      readTest: {
        ok: false,
        error,
        workoutsSeen: 0,
        matchedByWorkoutId: 0,
        matchedByDiagnosticId: 0,
        matchedByDiagnosticFlag: 0,
        matchedByTime: 0,
        matchedBySource: 0,
      },
      summary: 'not_available',
      connected: false,
    };
  }

  const missingRead: string[] = [];
  const missingWrite: string[] = [];
  // The above list is already filtered; keep placeholders for future expansion.

  const authRes = await getAuthStatusForPermissions(AppleHealthKit, { permissions: { read: read as any, write: write as any } });
  const status = authRes.status;

  const denied = { read: [] as string[], write: [] as string[] };
  const notDetermined = { read: [] as string[], write: [] as string[] };
  Object.entries(status.read).forEach(([perm, code]) => {
    if (code === 1) denied.read.push(perm);
    if (code === 0) notDetermined.read.push(perm);
  });
  Object.entries(status.write).forEach(([perm, code]) => {
    if (code === 1) denied.write.push(perm);
    if (code === 0) notDetermined.write.push(perm);
  });

  const requested = { read, write };

  if (denied.read.length || denied.write.length || notDetermined.read.length || notDetermined.write.length) {
    const total = read.length + write.length;
    const missingCount = denied.read.length + denied.write.length + notDetermined.read.length + notDetermined.write.length;
    const authorizedCount =
      Object.values(status.read).filter((c) => c === 2).length + Object.values(status.write).filter((c) => c === 2).length;
    const partial = total > 0 && missingCount > 0 && authorizedCount > 0;
    return {
      checkedAt,
      rateLimit: { limited: false },
      availability,
      requested,
      status,
      missing: { read: missingRead, write: missingWrite },
      denied,
      notDetermined,
      writeTest: { ok: false, error: 'Not authorized.' },
      readTest: {
        ok: false,
        error: 'Not authorized.',
        workoutsSeen: 0,
        matchedByWorkoutId: 0,
        matchedByDiagnosticId: 0,
        matchedByDiagnosticFlag: 0,
        matchedByTime: 0,
        matchedBySource: 0,
      },
      summary: partial ? 'authorized_but_partial' : 'not_authorized',
      connected: false,
    };
  }

  // Rate limit: avoid writing repeated diagnostic workouts.
  // If we recently verified a successful connection, return cached proof unless forced.
  const cache = await readProofCache();
  if (!options.force && cache.cachedAt && cache.result?.summary === 'connected') {
    const cachedAtMs = Date.parse(cache.cachedAt);
    if (Number.isFinite(cachedAtMs) && Date.now() - cachedAtMs < HEALTH_PROOF_COOLDOWN_MS) {
      const nextAllowedAt = new Date(cachedAtMs + HEALTH_PROOF_COOLDOWN_MS).toISOString();
      return {
        ...cache.result,
        checkedAt,
        rateLimit: { limited: true, cachedAt: cache.cachedAt, nextAllowedAt, reason: 'recent_connected_proof' },
      };
    }
  }

  const diagnosticId = newDiagnosticId();
  const buildStamp = getBuildStamp();

  if (options.readOnly) {
    const steps = await tryGetDailySteps();
    const ok = Boolean(steps.ok);
    const result: HealthkitProofOfLifeResult = {
      checkedAt,
      rateLimit: { limited: false },
      availability,
      requested,
      status,
      missing: { read: missingRead, write: missingWrite },
      denied,
      notDetermined,
      writeTest: { ok: true, error: 'skipped_read_only', buildStamp },
      readTest: {
        ok,
        error: ok ? undefined : steps.error || 'Step read failed.',
        workoutsSeen: 0,
        matchedByWorkoutId: 0,
        matchedByDiagnosticId: 0,
        matchedByDiagnosticFlag: 0,
        matchedByTime: 0,
        matchedBySource: 0,
      },
      summary: ok ? 'connected' : 'authorized_read_failed',
      connected: ok,
    };
    await writeProofCache(result);
    return result;
  }

  const now = new Date();
  const start = new Date(now.getTime() - 25_000);
  const end = new Date(now.getTime() - 5_000);
  const startIso = toIso(start);
  const endIso = toIso(end);

  const writeTest = await new Promise<{ ok: boolean; error?: string; workoutId?: string }>((resolve) => {
    const options = {
      type: pickLowImpactWorkoutType(AppleHealthKit),
      startDate: startIso,
      endDate: endIso,
      energyBurned: 1,
      energyBurnedUnit: 'calorie',
      distance: 0,
      distanceUnit: 'meter',
      metadata: {
        HKWorkoutBrandName: 'Zenith',
        zenith_diagnostic: true,
        zenith_diag_id: diagnosticId,
        ...(buildStamp.version ? { zenith_version: buildStamp.version } : {}),
        ...(buildStamp.build ? { zenith_build: buildStamp.build } : {}),
      },
    };
    AppleHealthKit.saveWorkout(options as any, (err: any, result: any) => {
      if (err) return resolve({ ok: false, error: String((err as any)?.message || err) });
      resolve({
        ok: true,
        workoutId: typeof result === 'string' ? result : result?.id ? String(result.id) : undefined,
      });
    });
  });

  if (!writeTest.ok) {
    const result: HealthkitProofOfLifeResult = {
      checkedAt,
      rateLimit: { limited: false },
      availability,
      requested,
      status,
      missing: { read: missingRead, write: missingWrite },
      denied,
      notDetermined,
      writeTest: { ...writeTest, startIso, endIso, diagnosticId, buildStamp },
      readTest: {
        ok: false,
        error: 'Write failed.',
        workoutsSeen: 0,
        matchedByWorkoutId: 0,
        matchedByDiagnosticId: 0,
        matchedByDiagnosticFlag: 0,
        matchedByTime: 0,
        matchedBySource: 0,
      },
      summary: 'authorized_write_failed',
      connected: false,
    };
    await writeProofCache(result);
    return result;
  }

  // Read back workouts and verify:
  // - exact workout UUID (if the native module returned one), OR
  // - diagnostic metadata id, OR
  // - diagnostic flag within a tight time window
  const pullWorkouts = async () =>
    new Promise<{ ok: boolean; error?: string; data?: any[] }>((resolve) => {
      AppleHealthKit.getAnchoredWorkouts(
        {
          startDate: new Date(now.getTime() - 15 * 60 * 1000).toISOString(),
          endDate: new Date(now.getTime() + 2 * 60 * 1000).toISOString(),
          limit: 30,
          ascending: false,
        } as any,
        (err: any, results: any) => {
          if (err) return resolve({ ok: false, error: String((err as any)?.message || err) });
          const rows = Array.isArray(results?.data) ? results.data : [];
          resolve({ ok: true, data: rows });
        }
      );
    });

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  let readTest = await pullWorkouts();

  const workoutId = writeTest.workoutId ? String(writeTest.workoutId).toUpperCase() : null;
  const matches = (w: any) => {
    const id = (w?.id == null ? '' : String(w.id)).toUpperCase();
    const sourceName = String(w?.sourceName || '');
    const sourceId = String(w?.sourceId || '');
    const md = (w?.metadata || {}) as any;

    const byWorkoutId = Boolean(workoutId && id && id === workoutId);
    const byDiagnosticId = String(md?.zenith_diag_id || '') === diagnosticId;
    const diagnosticFlagRaw = md?.zenith_diagnostic;
    const hasDiagnosticFlag = diagnosticFlagRaw === true || diagnosticFlagRaw === 1 || diagnosticFlagRaw === 'true';
    const byTime = withinMs(String(w?.start || ''), startIso, 2 * 60 * 1000);
    const bySource = /zenith/i.test(sourceName) || /zenith/i.test(sourceId);
    const byDiagnosticFlag = Boolean(hasDiagnosticFlag && byTime);

    return { byWorkoutId, byDiagnosticId, byDiagnosticFlag, byTime, bySource };
  };

  const workouts = Array.isArray(readTest.data) ? readTest.data : [];
  const m1 = workouts.map(matches);
  let found = m1.some((m) => m.byWorkoutId) || m1.some((m) => m.byDiagnosticId) || m1.some((m) => m.byDiagnosticFlag);

  // Health writes can take a moment to appear in read queries. Retry once to avoid false negatives.
  if (readTest.ok && !found) {
    await sleep(900);
    readTest = await pullWorkouts();
  }

  const workouts2 = Array.isArray(readTest.data) ? readTest.data : [];
  const m2 = workouts2.map(matches);
  const matchedByWorkoutId2 = m2.filter((m) => m.byWorkoutId).length;
  const matchedByDiagnosticId2 = m2.filter((m) => m.byDiagnosticId).length;
  const matchedByDiagnosticFlag2 = m2.filter((m) => m.byDiagnosticFlag).length;
  const matchedByTime2 = m2.filter((m) => m.byTime).length;
  const matchedBySource2 = m2.filter((m) => m.bySource).length;
  found = readTest.ok
    ? matchedByWorkoutId2 > 0 || matchedByDiagnosticId2 > 0 || matchedByDiagnosticFlag2 > 0
    : false;

  const computedRead = {
    ok: Boolean(readTest.ok && found),
    error: !readTest.ok
      ? readTest.error || 'Read failed.'
      : !found
        ? 'Wrote diagnostic workout, but could not read it back from Health (diagnostic match failed).'
        : undefined,
    workoutsSeen: workouts2.length,
    matchedByWorkoutId: matchedByWorkoutId2,
    matchedByDiagnosticId: matchedByDiagnosticId2,
    matchedByDiagnosticFlag: matchedByDiagnosticFlag2,
    matchedByTime: matchedByTime2,
    matchedBySource: matchedBySource2,
  };

  const connected = Boolean(writeTest.ok && computedRead.ok);
  const result: HealthkitProofOfLifeResult = {
    checkedAt,
    rateLimit: { limited: false },
    availability,
    requested,
    status,
    missing: { read: missingRead, write: missingWrite },
    denied,
    notDetermined,
    writeTest: { ...writeTest, startIso, endIso, diagnosticId, buildStamp },
    readTest: computedRead,
    summary: connected ? 'connected' : 'authorized_read_failed',
    connected,
  };
  await writeProofCache(result);
  return result;
}

function getAppleHealthKit(): AppleHealthKitType | null {
  if (Platform.OS !== 'ios') return null;
  if (cachedHealthKit !== undefined) return cachedHealthKit;

  try {
    // Keep this lazy so Expo Go can still load the app without native HealthKit.
    // `react-native-health` is CommonJS at runtime (module.exports), but its types expose a default export.
    // Support both shapes so TestFlight/prod never treats HealthKit as "missing" due to interop differences.
    const mod = require('react-native-health');
    const rn = require('react-native');
    const root = (mod?.default ?? mod) as any;
    const constants = root?.Constants || root?.HealthKit?.Constants || undefined;
    const nativeModules = rn?.NativeModules || {};

    const candidates: any[] = [
      mod?.AppleHealthKit,
      mod?.HealthKit,
      root?.HealthKit,
      root,
      nativeModules?.AppleHealthKit,
      nativeModules?.RNAppleHealthKit,
      nativeModules?.RCTAppleHealthKit,
    ].filter(Boolean);

    const picked = candidates.find((candidate) => {
      const c = candidate as any;
      return typeof c?.initHealthKit === 'function' || typeof c?.isAvailable === 'function' || typeof c?.getAuthStatus === 'function';
    });

    if (!picked) {
      cachedHealthKit = null;
      return cachedHealthKit;
    }

    if (constants && !(picked as any).Constants) {
      (picked as any).Constants = constants;
    }
    cachedHealthKit = picked as AppleHealthKitType;
  } catch (error) {
    // Non-fatal: native HealthKit module may be absent in some clients (e.g. Expo Go).
    // Avoid production log noise; this is expected for some setups.
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('HealthKit native module unavailable:', error);
    }
    cachedHealthKit = null;
  }

  return cachedHealthKit;
}

function buildTodaySignalsPermissions(AppleHealthKit: AppleHealthKitType, required: TodaySignalPermissionPrefs): HealthKitPermissions {
  const P: any = AppleHealthKit.Constants?.Permissions || {};
  const readKeys: string[] = [];
  if (required.steps) readKeys.push(P.StepCount || 'StepCount');
  if (required.activeEnergy) readKeys.push(P.ActiveEnergyBurned || 'ActiveEnergyBurned');
  if (required.sleep) readKeys.push(P.SleepAnalysis || 'SleepAnalysis');
  if (required.restingHeartRate) readKeys.push(P.RestingHeartRate || 'RestingHeartRate');
  return {
    permissions: {
      read: (readKeys.filter(Boolean).map(String) as any),
      write: [] as any,
    },
  };
}

function buildTodaySignalPermissionMap(
  AppleHealthKit: AppleHealthKitType,
  required: TodaySignalPermissionPrefs
): Record<TodaySignalKey, string | null> {
  const P: any = AppleHealthKit.Constants?.Permissions || {};
  return {
    steps: required.steps ? String(P.StepCount || 'StepCount') : null,
    activeEnergy: required.activeEnergy ? String(P.ActiveEnergyBurned || 'ActiveEnergyBurned') : null,
    sleep: required.sleep ? String(P.SleepAnalysis || 'SleepAnalysis') : null,
    restingHeartRate: required.restingHeartRate ? String(P.RestingHeartRate || 'RestingHeartRate') : null,
  };
}

function createTodaySignalAuthMap(
  required: TodaySignalPermissionPrefs,
  selectedState: ZenithHealthAuthorizationState
): TodaySignalAuthMap {
  return {
    steps: required.steps ? selectedState : 'disabled',
    activeEnergy: required.activeEnergy ? selectedState : 'disabled',
    sleep: required.sleep ? selectedState : 'disabled',
    restingHeartRate: required.restingHeartRate ? selectedState : 'disabled',
  };
}

function aggregateTodaySignalAuthState(signals: TodaySignalAuthMap): ZenithHealthAuthorizationState {
  const selectedStates = (Object.values(signals) as TodaySignalAuthState[]).filter((v) => v !== 'disabled');
  if (selectedStates.length === 0) return 'authorized';
  if (selectedStates.includes('authorized')) return 'authorized';
  if (selectedStates.includes('denied')) return 'denied';
  if (selectedStates.includes('notDetermined')) return 'notDetermined';
  if (selectedStates.includes('unavailable')) return 'unavailable';
  return 'notDetermined';
}

function signalKeyLabel(key: TodaySignalKey): string {
  switch (key) {
    case 'steps':
      return 'Steps';
    case 'activeEnergy':
      return 'Active energy';
    case 'sleep':
      return 'Sleep';
    case 'restingHeartRate':
      return 'Resting HR';
    default:
      return key;
  }
}

function readStatusCodeToAuthState(code: HealthStatusCode | undefined): ZenithHealthAuthorizationState {
  if (code === 2) return 'authorized';
  if (code === 1) return 'denied';
  return 'notDetermined';
}

export async function getTodaySignalsAuthorizationState(input: { required?: TodaySignalPermissionPrefs } = {}): Promise<{
  state: ZenithHealthAuthorizationState;
  detail: { requestedAt?: string | null; lastResult?: string | null; error?: string; note?: string };
  signals: TodaySignalAuthMap;
}> {
  const required: TodaySignalPermissionPrefs =
    typeof input.required === 'object' && input.required
      ? { ...DEFAULT_PERMISSION_REQUEST.todaySignals, ...input.required }
      : DEFAULT_PERMISSION_REQUEST.todaySignals;

  const AppleHealthKit = getAppleHealthKit();
  if (!AppleHealthKit) {
    return {
      state: 'unavailable',
      detail: { requestedAt: null, lastResult: null, error: 'HealthKit bridge is not active in this runtime.' },
      signals: createTodaySignalAuthMap(required, 'unavailable'),
    };
  }

  const availability = await isHealthKitAvailable();
  if (!availability.available) {
    return {
      state: 'unavailable',
      detail: { requestedAt: null, error: availability.error },
      signals: createTodaySignalAuthMap(required, 'unavailable'),
    };
  }

  const [requestedAt, lastResult] = await Promise.all([
    AsyncStorage.getItem(HEALTH_AUTH_REQUESTED_AT_KEY),
    AsyncStorage.getItem(HEALTH_AUTH_LAST_RESULT_KEY),
  ]);

  const selectedSignals = (Object.keys(required) as TodaySignalKey[]).filter((k) => Boolean(required[k]));
  if (selectedSignals.length === 0) {
    return {
      state: 'authorized',
      detail: {
        requestedAt: requestedAt || null,
        lastResult: lastResult || null,
        note: 'No today-signal types selected. Import will not pull any daily signals until enabled.',
      },
      signals: createTodaySignalAuthMap(required, 'notDetermined'),
    };
  }

  const requested = buildTodaySignalsPermissions(AppleHealthKit, required);
  const requestedRead = requested.permissions.read || [];
  if (requestedRead.length === 0) {
    return {
      state: 'unavailable',
      detail: {
        requestedAt: requestedAt || null,
        lastResult: lastResult || null,
        error: 'HealthKit permission identifiers unavailable. Native module may be misconfigured.',
      },
      signals: createTodaySignalAuthMap(required, 'unavailable'),
    };
  }

  const permissionBySignal = buildTodaySignalPermissionMap(AppleHealthKit, required);
  const authRes = await getAuthStatusForPermissions(AppleHealthKit, requested);
  if (!authRes.error) {
    const signals: TodaySignalAuthMap = {
      steps: required.steps ? readStatusCodeToAuthState(authRes.status.read[permissionBySignal.steps || '']) : 'disabled',
      activeEnergy: required.activeEnergy
        ? readStatusCodeToAuthState(authRes.status.read[permissionBySignal.activeEnergy || ''])
        : 'disabled',
      sleep: required.sleep ? readStatusCodeToAuthState(authRes.status.read[permissionBySignal.sleep || '']) : 'disabled',
      restingHeartRate: required.restingHeartRate
        ? readStatusCodeToAuthState(authRes.status.read[permissionBySignal.restingHeartRate || ''])
        : 'disabled',
    };

    const state = aggregateTodaySignalAuthState(signals);
    const deniedSignals = (Object.keys(signals) as TodaySignalKey[])
      .filter((k) => signals[k] === 'denied')
      .map(signalKeyLabel);
    const pendingSignals = (Object.keys(signals) as TodaySignalKey[])
      .filter((k) => signals[k] === 'notDetermined')
      .map(signalKeyLabel);
    const authorizedSignals = (Object.keys(signals) as TodaySignalKey[])
      .filter((k) => signals[k] === 'authorized')
      .map(signalKeyLabel);

    let note = 'All selected read types are authorized.';
    if (state === 'authorized' && (deniedSignals.length > 0 || pendingSignals.length > 0)) {
      note =
        `Partial authorization. Authorized: ${authorizedSignals.join(', ') || 'none'}. ` +
        `${deniedSignals.length ? `Denied: ${deniedSignals.join(', ')}. ` : ''}` +
        `${pendingSignals.length ? `Not determined: ${pendingSignals.join(', ')}.` : ''}`.trim();
    } else if (state === 'denied') {
      note = `Denied signals: ${deniedSignals.join(', ') || 'selected signals'}`;
    } else if (state === 'notDetermined') {
      note = `Not determined signals: ${pendingSignals.join(', ') || 'selected signals'}`;
    }

    return {
      state,
      detail: {
        requestedAt: requestedAt || null,
        lastResult: lastResult || null,
        note,
      },
      signals,
    };
  }

  // Fallback when native auth status call fails for any reason.
  let state: ZenithHealthAuthorizationState;
  if (!requestedAt) {
    state = 'notDetermined';
  } else if (typeof lastResult === 'string' && (lastResult.startsWith('denied:') || lastResult.startsWith('partial:'))) {
    state = 'denied';
  } else {
    state = 'authorized';
  }

  return {
    state,
    detail: {
      requestedAt: requestedAt || null,
      lastResult: lastResult || null,
      error: authRes.error,
      note: 'Unable to inspect per-type status; Zenith verifies access via actual reads.',
    },
    signals: createTodaySignalAuthMap(required, state === 'denied' ? 'denied' : state === 'authorized' ? 'authorized' : 'notDetermined'),
  };
}

type HealthReadCheck<T> = { ok: boolean; value: T; error?: string };

function healthErrToString(err: any): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  const message =
    (err as any)?.localizedDescription ||
    (err as any)?.message ||
    (err as any)?.errorMessage ||
    '';
  const domain = (err as any)?.domain || (err as any)?.errorDomain || '';
  const code = (err as any)?.code ?? (err as any)?.errorCode ?? '';
  const parts = [domain ? `domain=${domain}` : '', code !== '' ? `code=${code}` : '', message || ''];
  const compact = parts.filter(Boolean).join(' ');
  if (compact.trim().length > 0) return compact;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function mergeIntervalMinutes(intervals: Array<{ startMs: number; endMs: number }>): number {
  if (intervals.length === 0) return 0;
  const sorted = intervals
    .filter((it) => Number.isFinite(it.startMs) && Number.isFinite(it.endMs) && it.endMs > it.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  if (sorted.length === 0) return 0;

  let mergedStart = sorted[0].startMs;
  let mergedEnd = sorted[0].endMs;
  let totalMs = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    const next = sorted[i];
    if (next.startMs <= mergedEnd) {
      mergedEnd = Math.max(mergedEnd, next.endMs);
      continue;
    }
    totalMs += mergedEnd - mergedStart;
    mergedStart = next.startMs;
    mergedEnd = next.endMs;
  }
  totalMs += mergedEnd - mergedStart;
  return totalMs / 60000;
}

function toSleepQuality(totalMinutes: number): string {
  const hours = totalMinutes / 60;
  if (hours >= 7 && hours <= 9) return 'Excellent';
  if (hours >= 6 && hours < 7) return 'Good';
  if (hours >= 5 && hours < 6) return 'Fair';
  return 'Poor';
}

function aggregateSleepSamples(rows: any[]): { duration: number; quality: string } | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const sleepValues = new Set(['ASLEEP', 'CORE', 'DEEP', 'REM']);
  const inBedValues = new Set(['INBED']);
  const toIntervals = (filter: (sample: any) => boolean) =>
    rows
      .filter(filter)
      .map((sample) => ({
        startMs: Date.parse(String(sample?.startDate || '')),
        endMs: Date.parse(String(sample?.endDate || '')),
      }));

  const sleepMinutes = mergeIntervalMinutes(toIntervals((sample) => sleepValues.has(String(sample?.value || '').toUpperCase())));
  // If no staged/asleep intervals are present (older devices/sources), fall back to in-bed intervals.
  const totalMinutes = sleepMinutes > 0 ? sleepMinutes : mergeIntervalMinutes(toIntervals((sample) => inBedValues.has(String(sample?.value || '').toUpperCase())));
  if (totalMinutes <= 0) return null;
  return {
    duration: Math.round(totalMinutes),
    quality: toSleepQuality(totalMinutes),
  };
}

function buildSleepWindow(): { startDate: string; endDate: string } {
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 1);
  startDate.setHours(18, 0, 0, 0);
  return { startDate: startDate.toISOString(), endDate: endDate.toISOString() };
}

export async function tryGetDailyWorkoutSessions(date: Date = new Date()): Promise<HealthReadCheck<HealthWorkoutSession[]>> {
  const AppleHealthKit = getAppleHealthKit();
  if (!AppleHealthKit) return { ok: false, value: [], error: 'HealthKit native module unavailable.' };

  return new Promise((resolve) => {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    AppleHealthKit.getAnchoredWorkouts(
      {
        startDate: startOfDay.toISOString(),
        endDate: endOfDay.toISOString(),
        limit: 250,
        ascending: true,
      } as any,
      (err: any, results: any) => {
        if (err) return resolve({ ok: false, value: [], error: healthErrToString(err) || 'Workout read failed.' });
        const rows = Array.isArray(results?.data) ? results.data : [];
        const sessions: HealthWorkoutSession[] = rows
          .map((sample: any): HealthWorkoutSession | null => {
            const id = String(sample?.id || '').trim();
            const start = String(sample?.start || '').trim();
            const end = String(sample?.end || '').trim();
            const startMs = Date.parse(start);
            const endMs = Date.parse(end);
            if (!id || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
            const explicitDurationSec = Number(sample?.duration);
            const durationSec = Number.isFinite(explicitDurationSec) && explicitDurationSec > 0 ? explicitDurationSec : (endMs - startMs) / 1000;
            return {
              id,
              activityId: Number.isFinite(Number(sample?.activityId)) ? Number(sample?.activityId) : null,
              activityName: String(sample?.activityName || 'Workout'),
              calories: Math.max(0, Number(sample?.calories) || 0),
              durationMin: Math.max(1, Math.round(durationSec / 60)),
              distanceMiles: Math.max(0, Number(sample?.distance) || 0),
              sourceName: sample?.sourceName ? String(sample.sourceName) : undefined,
              sourceId: sample?.sourceId ? String(sample.sourceId) : undefined,
              tracked: typeof sample?.tracked === 'boolean' ? sample.tracked : undefined,
              metadata: sample?.metadata && typeof sample.metadata === 'object' ? (sample.metadata as Record<string, unknown>) : null,
              start,
              end,
            };
          })
          .filter((session: HealthWorkoutSession | null): session is HealthWorkoutSession => Boolean(session))
          .sort((a: HealthWorkoutSession, b: HealthWorkoutSession) => Date.parse(a.start) - Date.parse(b.start));
        resolve({ ok: true, value: sessions });
      }
    );
  });
}

export async function tryGetDailySteps(date: Date = new Date()): Promise<HealthReadCheck<number>> {
  const AppleHealthKit = getAppleHealthKit();
  if (!AppleHealthKit) return { ok: false, value: 0, error: 'HealthKit native module unavailable.' };

  return new Promise((resolve) => {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    AppleHealthKit.getStepCount(
      { startDate: startOfDay.toISOString(), endDate: endOfDay.toISOString() } as any,
      (err: any, results: HealthValue) => {
        if (err) return resolve({ ok: false, value: 0, error: healthErrToString(err) || 'Step read failed.' });
        resolve({ ok: true, value: Math.max(0, Math.round(Number((results as any)?.value) || 0)) });
      }
    );
  });
}

export async function tryGetDailyActiveEnergy(date: Date = new Date()): Promise<HealthReadCheck<number>> {
  const AppleHealthKit = getAppleHealthKit();
  if (!AppleHealthKit) return { ok: false, value: 0, error: 'HealthKit native module unavailable.' };

  return new Promise((resolve) => {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    AppleHealthKit.getActiveEnergyBurned(
      { startDate: startOfDay.toISOString(), endDate: endOfDay.toISOString(), ascending: true } as any,
      (err: any, results: HealthValue[]) => {
        if (err) return resolve({ ok: false, value: 0, error: healthErrToString(err) || 'Active energy read failed.' });
        const rows = Array.isArray(results) ? results : [];
        const total = rows.reduce((sum, sample) => sum + (Number((sample as any)?.value) || 0), 0);
        resolve({ ok: true, value: Math.max(0, Math.round(total)) });
      }
    );
  });
}

export async function tryGetSleepData(): Promise<HealthReadCheck<{ duration: number; quality: string } | null>> {
  const AppleHealthKit = getAppleHealthKit();
  if (!AppleHealthKit) return { ok: false, value: null, error: 'HealthKit native module unavailable.' };

  return new Promise((resolve) => {
    const window = buildSleepWindow();
    AppleHealthKit.getSleepSamples(
      { startDate: window.startDate, endDate: window.endDate } as any,
      (err: any, results: any[]) => {
        if (err) return resolve({ ok: false, value: null, error: healthErrToString(err) || 'Sleep read failed.' });
        resolve({ ok: true, value: aggregateSleepSamples(Array.isArray(results) ? results : []) });
      }
    );
  });
}

export async function tryGetRestingHeartRate(): Promise<HealthReadCheck<number | null>> {
  const AppleHealthKit = getAppleHealthKit();
  if (!AppleHealthKit) return { ok: false, value: null, error: 'HealthKit native module unavailable.' };

  return new Promise((resolve) => {
    const options = {
      startDate: new Date(Date.now() - 7 * 86400000).toISOString(),
      endDate: new Date().toISOString(),
    };

    AppleHealthKit.getRestingHeartRateSamples(options as any, (err: any, results: HealthValue[]) => {
      if (err) return resolve({ ok: false, value: null, error: healthErrToString(err) || 'Resting HR read failed.' });
      const rows = Array.isArray(results) ? results : [];
      if (rows.length === 0) return resolve({ ok: true, value: null });
      const avg = rows.reduce((sum, sample) => sum + (Number((sample as any)?.value) || 0), 0) / rows.length;
      resolve({ ok: true, value: Math.max(0, Math.round(avg)) });
    });
  });
}

// HR Zones based on max heart rate
export interface HeartRateZone {
  zone: 1 | 2 | 3 | 4 | 5;
  name: string;
  minBpm: number;
  maxBpm: number;
  color: string;
  percentage: string; // % of max HR
  benefit: string;
}

export interface HeartRateData {
  timestamp: number;
  bpm: number;
  source: string;
}

export interface LatestHeartRateSample {
  timestamp: number;
  bpm: number;
  source: string;
  ageSec: number;
}

export interface WorkoutSummary {
  avgHR: number;
  maxHR: number;
  minHR: number;
  timeInZones: {
    zone1: number; // seconds
    zone2: number;
    zone3: number;
    zone4: number;
    zone5: number;
  };
  hrData: HeartRateData[];
  calories: number;
  distance?: number;
}

/**
 * Calculate HR zones based on age
 * Uses Karvonen formula with resting HR
 */
export function calculateHRZones(age: number, restingHR: number = 60): HeartRateZone[] {
  const maxHR = 220 - age;
  const hrReserve = maxHR - restingHR;

  return [
    {
      zone: 1,
      name: 'Warm Up',
      minBpm: Math.round(restingHR + hrReserve * 0.5),
      maxBpm: Math.round(restingHR + hrReserve * 0.6),
      color: '#808080',
      percentage: '50-60%',
      benefit: 'Recovery & warm-up'
    },
    {
      zone: 2,
      name: 'Fat Burn',
      minBpm: Math.round(restingHR + hrReserve * 0.6),
      maxBpm: Math.round(restingHR + hrReserve * 0.7),
      color: '#00D9FF',
      percentage: '60-70%',
      benefit: 'Aerobic endurance'
    },
    {
      zone: 3,
      name: 'Cardio',
      minBpm: Math.round(restingHR + hrReserve * 0.7),
      maxBpm: Math.round(restingHR + hrReserve * 0.8),
      color: '#00FF88',
      percentage: '70-80%',
      benefit: 'Cardiovascular fitness'
    },
    {
      zone: 4,
      name: 'Peak',
      minBpm: Math.round(restingHR + hrReserve * 0.8),
      maxBpm: Math.round(restingHR + hrReserve * 0.9),
      color: '#FFD700',
      percentage: '80-90%',
      benefit: 'Performance & speed'
    },
    {
      zone: 5,
      name: 'Max',
      minBpm: Math.round(restingHR + hrReserve * 0.9),
      maxBpm: maxHR,
      color: '#FF4466',
      percentage: '90-100%',
      benefit: 'Maximum effort'
    }
  ];
}

/**
 * Get HR zone for a given BPM
 */
export function getHRZone(bpm: number, zones: HeartRateZone[]): HeartRateZone {
  for (const zone of zones) {
    if (bpm >= zone.minBpm && bpm <= zone.maxBpm) {
      return zone;
    }
  }
  // Default to zone 1 if below, zone 5 if above
  return bpm < zones[0].minBpm ? zones[0] : zones[4];
}

/**
 * Calculate time spent in each zone
 */
export function calculateTimeInZones(
  hrData: HeartRateData[],
  zones: HeartRateZone[]
): WorkoutSummary['timeInZones'] {
  const timeInZones = {
    zone1: 0,
    zone2: 0,
    zone3: 0,
    zone4: 0,
    zone5: 0
  };

  if (hrData.length < 2) return timeInZones;

  for (let i = 1; i < hrData.length; i++) {
    const duration = (hrData[i].timestamp - hrData[i - 1].timestamp) / 1000;
    const avgBpm = (hrData[i].bpm + hrData[i - 1].bpm) / 2;
    const zone = getHRZone(avgBpm, zones);

    switch (zone.zone) {
      case 1: timeInZones.zone1 += duration; break;
      case 2: timeInZones.zone2 += duration; break;
      case 3: timeInZones.zone3 += duration; break;
      case 4: timeInZones.zone4 += duration; break;
      case 5: timeInZones.zone5 += duration; break;
    }
  }

  return timeInZones;
}

/**
 * Request health permissions
 */
export async function requestHealthPermissions(
  request: HealthPermissionRequest = DEFAULT_PERMISSION_REQUEST,
  options: { allowPartialGrant?: boolean } = {}
): Promise<boolean> {
  const AppleHealthKit = getAppleHealthKit();
  if (!AppleHealthKit) {
    // iOS HealthKit bridge unavailable on this platform/runtime.
    // Android Health Connect wiring is handled by wearable import service gating.
    return false;
  }

  const availability = await isHealthKitAvailable();
  if (!availability.available) {
    await persistHealthAuthResult(`unavailable:${new Date().toISOString()}`);
    return false;
  }

  // Request only what Zenith needs for the specific user action.
  // Asking for extra types increases denial surface and can confuse users.
  const permissions = buildPermissionsRequest(AppleHealthKit, request);
  const readPerms = (permissions.permissions.read || []) as any[];
  const writePerms = (permissions.permissions.write || []) as any[];
  if (readPerms.length === 0 && writePerms.length === 0) {
    await persistHealthAuthResult(`unavailable:${new Date().toISOString()}`);
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('HealthKit permission constants missing. Native module may be misconfigured.');
    } else {
      void captureException('HealthKit permission constants missing', { feature: 'health', op: 'init_constants_missing' });
    }
    return false;
  }
  const requestedPermissions = permissions;

  try {
    await AsyncStorage.setItem(HEALTH_AUTH_REQUESTED_AT_KEY, new Date().toISOString());
  } catch {
    // ignore
  }

  let permissionsUsed = requestedPermissions;

  const initOnce = (perms: HealthKitPermissions) =>
    new Promise<{ ok: boolean; error?: string }>((resolve) => {
      if (typeof (AppleHealthKit as any).initHealthKit !== 'function') {
        return resolve({ ok: false, error: 'initHealthKit unavailable in this runtime.' });
      }
      AppleHealthKit.initHealthKit(perms, (error: string) => {
        if (error) return resolve({ ok: false, error: String(error) });
        resolve({ ok: true });
      });
    });

  // Primary init attempt.
  let initRes = await initOnce(permissionsUsed);

  // If init fails, retry with a minimal request (Workout read/write only).
  // This prevents "never registers in Health -> Apps" when one of the requested permission keys is unsupported/mis-mapped.
  if (!initRes.ok) {
    const minimal = buildPermissionsRequest(AppleHealthKit, { workouts: true });
    const minimalSame =
      JSON.stringify(minimal.permissions.read || []) === JSON.stringify(permissionsUsed.permissions.read || []) &&
      JSON.stringify(minimal.permissions.write || []) === JSON.stringify(permissionsUsed.permissions.write || []);
    if (!minimalSame) {
      const retry = await initOnce(minimal);
      if (retry.ok) {
        permissionsUsed = minimal;
        initRes = retry;
      }
    }
  }

  const initOk = initRes.ok;
  if (!initOk) {
    const err = initRes.error || 'init failed';
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('HealthKit init error:', err);
    } else {
      void captureException(err, { feature: 'health', op: 'init' });
    }
    await persistHealthAuthResult(`denied:${new Date().toISOString()}:${err}`);
  }

  // Do not trust init callback alone. Verify per-type status after the request returns.
  try {
    const authRes = await getAuthStatusForPermissions(AppleHealthKit, permissionsUsed);
    const status = authRes.status;
    const denied = Object.entries(status.read)
      .filter(([, code]) => code === 1)
      .map(([perm]) => perm)
      .concat(
        Object.entries(status.write)
          .filter(([, code]) => code === 1)
          .map(([perm]) => perm)
      );
    const notDetermined = Object.entries(status.read)
      .filter(([, code]) => code === 0)
      .map(([perm]) => perm)
      .concat(
        Object.entries(status.write)
          .filter(([, code]) => code === 0)
          .map(([perm]) => perm)
      );
    const allAuthorized =
      denied.length === 0 &&
      notDetermined.length === 0 &&
      Object.values(status.read).every((c) => c === 2) &&
      Object.values(status.write).every((c) => c === 2);

    if (allAuthorized) {
      await persistHealthAuthResult(`granted:${new Date().toISOString()}`);
      return true;
    }

    const hasAnyAuthorized =
      Object.values(status.read).some((c) => c === 2) ||
      Object.values(status.write).some((c) => c === 2);
    if (options.allowPartialGrant && hasAnyAuthorized) {
      const hint = [
        denied.length ? `denied=${denied.slice(0, 6).join(',')}` : '',
        notDetermined.length ? `pending=${notDetermined.slice(0, 6).join(',')}` : '',
      ]
        .filter(Boolean)
        .join(' ');
      await persistHealthAuthResult(`partial:${new Date().toISOString()}:${hint}`);
      return true;
    }

    const label = denied.length || notDetermined.length ? 'partial' : initOk ? 'unknown' : 'denied';
    const hint = [
      denied.length ? `denied=${denied.slice(0, 6).join(',')}` : '',
      notDetermined.length ? `pending=${notDetermined.slice(0, 6).join(',')}` : '',
      authRes.error ? `err=${String(authRes.error).slice(0, 120)}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    await persistHealthAuthResult(`${label}:${new Date().toISOString()}:${hint}`);
    return false;
  } catch (err) {
    if (!initOk) return false;
    // If init succeeded but auth inspection failed, treat it as granted but rely on proof-of-life/import to validate.
    await persistHealthAuthResult(`granted_unverified:${new Date().toISOString()}`);
    return true;
  }
}

/**
 * Get heart rate data for a workout
 */
export async function getWorkoutHeartRate(
  startDate: Date,
  endDate: Date
): Promise<HeartRateData[]> {
  const AppleHealthKit = getAppleHealthKit();
  if (!AppleHealthKit) return [];

  return new Promise((resolve) => {
    const options = {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      ascending: true,
      limit: 1000
    };

    AppleHealthKit.getHeartRateSamples(options, (err: Object, results: HealthValue[]) => {
      if (err) {
        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.log('Error fetching HR:', err);
        } else {
          void captureException(err, { feature: 'health', op: 'fetch_hr' });
        }
        resolve([]);
        return;
      }

      const hrData: HeartRateData[] = results.map(sample => ({
        timestamp: new Date(sample.startDate).getTime(),
        bpm: sample.value,
        source: (sample as any).sourceName || 'Unknown'
      }));

      resolve(hrData);
    });
  });
}

/**
 * Get the latest heart-rate sample within a recent lookback window.
 * Returns null when HealthKit is unavailable or no recent sample is present.
 */
export async function getLatestHeartRateSample(lookbackSec: number = 90): Promise<LatestHeartRateSample | null> {
  const AppleHealthKit = getAppleHealthKit();
  if (!AppleHealthKit) return null;

  const lookback = Math.max(15, Math.round(lookbackSec));
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - lookback * 1000);

  return new Promise((resolve) => {
    const options = {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      ascending: true,
      limit: 1000,
    };

    AppleHealthKit.getHeartRateSamples(options, (err: Object, results: HealthValue[]) => {
      if (err || !Array.isArray(results) || results.length === 0) {
        resolve(null);
        return;
      }

      let latest: HealthValue | null = null;
      for (const sample of results) {
        const value = Number(sample?.value);
        if (!Number.isFinite(value) || value <= 0) continue;
        const ts = new Date(sample.startDate).getTime();
        if (!Number.isFinite(ts)) continue;
        if (!latest || new Date(sample.startDate).getTime() > new Date(latest.startDate).getTime()) {
          latest = sample;
        }
      }

      if (!latest) {
        resolve(null);
        return;
      }

      const timestamp = new Date(latest.startDate).getTime();
      const bpm = Math.round(Number(latest.value));
      if (!Number.isFinite(timestamp) || !Number.isFinite(bpm) || bpm <= 0) {
        resolve(null);
        return;
      }

      resolve({
        timestamp,
        bpm,
        source: (latest as any).sourceName || 'Unknown',
        ageSec: Math.max(0, Math.round((Date.now() - timestamp) / 1000)),
      });
    });
  });
}

/**
 * Get resting heart rate (last 7 days average)
 */
export async function getRestingHeartRate(): Promise<number> {
  const AppleHealthKit = getAppleHealthKit();
  if (!AppleHealthKit) return 60;

  return new Promise((resolve) => {
    const options = {
      startDate: new Date(Date.now() - 7 * 86400000).toISOString(),
      endDate: new Date().toISOString()
    };

    AppleHealthKit.getRestingHeartRateSamples(options, (err: Object, results: HealthValue[]) => {
      if (err || !results || results.length === 0) {
        resolve(60); // Default
        return;
      }

      const avg = results.reduce((sum, sample) => sum + sample.value, 0) / results.length;
      resolve(Math.round(avg));
    });
  });
}

/**
 * Get HRV (Heart Rate Variability) - advanced metric
 */
export async function getHRV(): Promise<number | null> {
  const AppleHealthKit = getAppleHealthKit();
  if (!AppleHealthKit) return null;

  return new Promise((resolve) => {
    const options = {
      startDate: new Date(Date.now() - 86400000).toISOString(), // Last 24 hours
      endDate: new Date().toISOString()
    };

    AppleHealthKit.getHeartRateVariabilitySamples(options, (err: Object, results: HealthValue[]) => {
      if (err || !results || results.length === 0) {
        resolve(null);
        return;
      }

      const latest = results[results.length - 1];
      resolve(Math.round(latest.value));
    });
  });
}

/**
 * Get daily steps
 */
export async function getDailySteps(date: Date = new Date()): Promise<number> {
  const AppleHealthKit = getAppleHealthKit();
  if (!AppleHealthKit) return 0;

  return new Promise((resolve) => {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const options = {
      startDate: startOfDay.toISOString(),
      endDate: endOfDay.toISOString()
    };

    AppleHealthKit.getStepCount(options, (err: Object, results: HealthValue) => {
      if (err) {
        resolve(0);
        return;
      }
      resolve(Math.round(results.value));
    });
  });
}

/**
 * Get daily active energy (kcal)
 */
export async function getDailyActiveEnergy(date: Date = new Date()): Promise<number> {
  const AppleHealthKit = getAppleHealthKit();
  if (!AppleHealthKit) return 0;

  return new Promise((resolve) => {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const options = {
      startDate: startOfDay.toISOString(),
      endDate: endOfDay.toISOString(),
      ascending: true,
    };

    AppleHealthKit.getActiveEnergyBurned(options, (err: Object, results: HealthValue[]) => {
      if (err || !results || results.length === 0) {
        resolve(0);
        return;
      }

      const total = results.reduce((sum, sample) => sum + (Number(sample.value) || 0), 0);
      resolve(Math.round(total));
    });
  });
}

/**
 * Get sleep data (last night)
 */
export async function getSleepData(): Promise<{ duration: number; quality: string } | null> {
  const AppleHealthKit = getAppleHealthKit();
  if (!AppleHealthKit) return null;

  return new Promise((resolve) => {
    const options = buildSleepWindow();

    AppleHealthKit.getSleepSamples(options, (err: Object, results: any[]) => {
      if (err) {
        resolve(null);
        return;
      }
      resolve(aggregateSleepSamples(Array.isArray(results) ? results : []));
    });
  });
}

/**
 * Write workout to Health app
 */
export async function saveWorkoutToHealth(
  type: 'running' | 'cycling' | 'strength' | 'yoga' | 'hiit',
  startDate: Date,
  endDate: Date,
  calories: number,
  distance?: number
): Promise<boolean> {
  const AppleHealthKit = getAppleHealthKit();
  if (!AppleHealthKit) return false;

  const activityMap = {
    running: AppleHealthKit.Constants.Activities.Running,
    cycling: AppleHealthKit.Constants.Activities.Cycling,
    strength: AppleHealthKit.Constants.Activities.TraditionalStrengthTraining,
    yoga: AppleHealthKit.Constants.Activities.Yoga,
    hiit: AppleHealthKit.Constants.Activities.HighIntensityIntervalTraining,
  };

  return new Promise((resolve) => {
    const options = {
      type: activityMap[type],
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      energyBurned: calories,
      ...(distance && { distance })
    };

    AppleHealthKit.saveWorkout(options, (err: Object) => {
      if (err) {
        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.log('Error saving workout:', err);
        } else {
          void captureException(err, { feature: 'health', op: 'save_workout' });
        }
        resolve(false);
        return;
      }
      resolve(true);
    });
  });
}

/**
 * Analyze workout with HR data
 */
export async function analyzeWorkout(
  startDate: Date,
  endDate: Date,
  userAge: number,
  calories: number,
  distance?: number
): Promise<WorkoutSummary> {
  const hrData = await getWorkoutHeartRate(startDate, endDate);
  const restingHR = await getRestingHeartRate();
  const zones = calculateHRZones(userAge, restingHR);

  if (hrData.length === 0) {
    return {
      avgHR: 0,
      maxHR: 0,
      minHR: 0,
      timeInZones: { zone1: 0, zone2: 0, zone3: 0, zone4: 0, zone5: 0 },
      hrData: [],
      calories,
      distance
    };
  }

  const bpms = hrData.map(d => d.bpm);
  const avgHR = Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length);
  const maxHR = Math.max(...bpms);
  const minHR = Math.min(...bpms);
  const timeInZones = calculateTimeInZones(hrData, zones);

  return {
    avgHR,
    maxHR,
    minHR,
    timeInZones,
    hrData,
    calories,
    distance
  };
}

/**
 * Get recovery score (0-100) based on HRV and resting HR
 */
export async function getRecoveryScore(userAge: number): Promise<number | null> {
  const hrv = await getHRV();
  const restingHR = await getRestingHeartRate();
  
  if (!hrv) return null;

  // Simplified recovery calculation
  // Higher HRV = better recovery
  // Lower resting HR = better recovery
  const maxHR = 220 - userAge;
  const expectedRestingHR = maxHR * 0.35; // Rough estimate

  const hrvScore = Math.min(100, (hrv / 50) * 100); // 50ms+ HRV = 100
  const hrScore = Math.max(0, 100 - ((restingHR - expectedRestingHR) / expectedRestingHR) * 100);

  return Math.round((hrvScore + hrScore) / 2);
}
