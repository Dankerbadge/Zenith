import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getTodaySignalsAuthorizationState,
  tryGetDailyActiveEnergy,
  tryGetDailyWorkoutSessions,
  tryGetDailySteps,
  tryGetRestingHeartRate,
  tryGetSleepData,
} from './healthService';
import { getDailyLog, getUserProfile, saveDailyLog, setStorageItem, todayKey, USER_PROFILE_KEY, type WorkoutEntry } from './storageUtils';
import { computeEffort, resolveEngineFromWorkout } from './effortEngine';
import { settleBehaviorDay } from './behavioralCore';
import { createWorkoutMetricVersionSet } from './workoutMetricVersions';
import { captureException, captureMessage } from './crashReporter';
import { getHealthConnectPermissionStatus, readHealthConnectWorkouts } from './healthConnectService';
import { isSupabaseConfigured, supabase } from './supabaseClient';

export type WearableImportSnapshot = {
  date: string;
  imported: boolean;
  source: 'apple_health' | 'health_connect';
  steps: number;
  activeEnergy: number;
  sleepMinutes: number;
  restingHeartRate: number;
  importedAt: string;
  reason?: string;
};

export type WearableImportPreferences = {
  connected: boolean;
  autoSync: boolean;
  importSteps: boolean;
  importActiveEnergy: boolean;
  importSleep: boolean;
  importRestingHeartRate: boolean;
  lastSyncDate?: string;
};

const LAST_SUCCESSFUL_HEALTH_SYNC_AT_KEY = 'wearable:lastSuccessfulHealthSyncAt';
const HEALTH_SYNC_STALE_WINDOW_MS = 10 * 60 * 1000;

export async function getLastSuccessfulHealthSyncAt(): Promise<string | null> {
  try {
    return (await AsyncStorage.getItem(LAST_SUCCESSFUL_HEALTH_SYNC_AT_KEY)) || null;
  } catch {
    return null;
  }
}

async function setLastSuccessfulHealthSyncAt(ts: string) {
  try {
    await AsyncStorage.setItem(LAST_SUCCESSFUL_HEALTH_SYNC_AT_KEY, ts);
  } catch {
    // ignore
  }
}

function isStaleSync(lastSyncAt: string | null, dateKey: string) {
  if (!lastSyncAt) return true;
  const ms = new Date(lastSyncAt).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return true;
  const lastDate = lastSyncAt.slice(0, 10);
  if (lastDate !== dateKey) return true;
  return Date.now() - ms > HEALTH_SYNC_STALE_WINDOW_MS;
}

export async function getWearableImportPreferences(): Promise<WearableImportPreferences> {
  const profile = await getUserProfile();
  const prefs = (profile.preferences || {}) as any;
  const wearable = (prefs.wearableImport || {}) as Partial<WearableImportPreferences>;
  return {
    connected: Boolean(wearable.connected),
    autoSync: wearable.autoSync !== false,
    importSteps: wearable.importSteps !== false,
    importActiveEnergy: wearable.importActiveEnergy !== false,
    importSleep: wearable.importSleep !== false,
    importRestingHeartRate: wearable.importRestingHeartRate !== false,
    lastSyncDate: typeof wearable.lastSyncDate === 'string' ? wearable.lastSyncDate : undefined,
  };
}

export async function setWearableImportPreferences(next: Partial<WearableImportPreferences>): Promise<WearableImportPreferences> {
  const profile = await getUserProfile();
  const current = await getWearableImportPreferences();
  const merged: WearableImportPreferences = { ...current, ...next };
  await setStorageItem(USER_PROFILE_KEY, {
    ...profile,
    preferences: {
      ...(profile.preferences || {}),
      wearableImport: merged,
    },
  });
  return merged;
}

function asDate(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function buildImportedWorkoutEntry(input: {
  date: string;
  source: 'apple_health' | 'health_connect';
  activeEnergy: number;
  importedAt: string;
}): WorkoutEntry | null {
  const activeEnergy = Math.max(0, Math.round(Number(input.activeEnergy) || 0));
  if (activeEnergy <= 0) return null;

  const estimatedDurationMin = Math.max(10, Math.min(180, Math.round(activeEnergy / 8)));
  const id = `imported_workout_${input.source}_${input.date}`;
  const ts = `${input.date}T12:00:00.000Z`;

  const engineType = resolveEngineFromWorkout({ type: 'cardio', label: 'Imported wearable activity' });
  const effort = computeEffort({
    durationMin: estimatedDurationMin,
    activeCalories: activeEnergy,
    engine: engineType,
    intensity: 'moderate',
  });

  return {
    id,
    ts,
    type: 'cardio',
    intensity: 'moderate',
    durationMin: estimatedDurationMin,
    minutes: estimatedDurationMin,
    caloriesBurned: activeEnergy,
    label: 'Imported wearable activity',
    note: 'Imported from connected wearable source.',
    imported: true,
    importedSource: input.source,
    importedAt: input.importedAt,
    sourceLabel: input.source === 'apple_health' ? 'Apple Health' : 'Health Connect',
    workoutClass: 'wearable_import',
    engineType,
    effortUnits: effort.effortUnits,
    effortScore: effort.effortScore,
    intensityBand: effort.intensityBand,
    effortConfidence: effort.confidence,
    verifiedEffort: true,
    sourceAuthority: 'import',
    metricVersions: createWorkoutMetricVersionSet(),
    metricsLock: {
      metricsImmutable: true,
      metricsLockedAtUtc: input.importedAt,
      sessionIntegrityState: 'finalized',
    },
  };
}

function normalizeActivityLabel(activityName: string): string {
  const raw = String(activityName || 'Workout').trim();
  if (!raw) return 'Workout';
  return raw
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim();
}

function mapAppleActivityToWorkoutType(activityName: string): WorkoutEntry['type'] {
  const normalized = activityName.toLowerCase();
  if (
    normalized.includes('strength') ||
    normalized.includes('weight') ||
    normalized.includes('lifting') ||
    normalized.includes('resistance')
  ) {
    return 'strength';
  }
  if (
    normalized.includes('yoga') ||
    normalized.includes('pilates') ||
    normalized.includes('tai chi') ||
    normalized.includes('mind') ||
    normalized.includes('flexibility') ||
    normalized.includes('cooldown') ||
    normalized.includes('recovery') ||
    normalized.includes('mobility')
  ) {
    return 'mobility';
  }
  return 'cardio';
}

function inferWorkoutIntensity(durationMin: number, calories: number): WorkoutEntry['intensity'] {
  const caloriesPerMinute = durationMin > 0 ? calories / durationMin : 0;
  if (caloriesPerMinute >= 9) return 'hard';
  if (caloriesPerMinute >= 5) return 'moderate';
  return 'easy';
}

function buildAppleImportedWorkoutEntry(
  session: {
    id: string;
    activityName: string;
    calories: number;
    durationMin: number;
    sourceName?: string;
    start: string;
  },
  importedAt: string
): WorkoutEntry {
  const durationMin = Math.max(1, Math.round(Number(session.durationMin) || 0));
  const calories = Math.max(0, Math.round(Number(session.calories) || 0));
  const type = mapAppleActivityToWorkoutType(session.activityName);
  const label = normalizeActivityLabel(session.activityName);
  const intensity = inferWorkoutIntensity(durationMin, calories);
  const engineType = resolveEngineFromWorkout({ type, label });
  const effort = computeEffort({
    durationMin,
    activeCalories: calories,
    engine: engineType,
    intensity,
  });

  return {
    id: `imported_workout_apple_health_${session.id}`,
    ts: session.start,
    type,
    intensity,
    durationMin,
    minutes: durationMin,
    caloriesBurned: calories,
    label,
    note: `Imported from Apple Health workout session${session.sourceName ? ` (${session.sourceName})` : ''}.`,
    imported: true,
    importedSource: 'apple_health',
    importedAt,
    sourceLabel: session.sourceName ? `Apple Health · ${session.sourceName}` : 'Apple Health',
    workoutClass: 'wearable_import',
    engineType,
    effortUnits: effort.effortUnits,
    effortScore: effort.effortScore,
    intensityBand: effort.intensityBand,
    effortConfidence: effort.confidence,
    verifiedEffort: true,
    sourceAuthority: 'import',
    metricVersions: createWorkoutMetricVersionSet(),
    metricsLock: {
      metricsImmutable: true,
      metricsLockedAtUtc: importedAt,
      sessionIntegrityState: 'finalized',
    },
  };
}

function mergeImportedWorkouts(
  log: any,
  source: 'apple_health' | 'health_connect',
  importedWorkouts: WorkoutEntry[],
  mode: 'replace' | 'upsert'
): WorkoutEntry[] {
  const existingWorkouts = Array.isArray(log?.workouts) ? [...log.workouts] : [];
  if (mode === 'replace') {
    const preserved = existingWorkouts.filter((w: any) => !(w?.imported && w?.importedSource === source));
    return [...preserved, ...importedWorkouts];
  }

  if (importedWorkouts.length === 0) return existingWorkouts;
  const next = [...existingWorkouts];
  for (const imported of importedWorkouts) {
    const idx = next.findIndex((w: any) => String(w?.id || '') === imported.id);
    if (idx >= 0) {
      next[idx] = { ...next[idx], ...imported };
    } else {
      next.push(imported);
    }
  }
  return next;
}

export async function importWearableDailySignals(
  date = todayKey(),
  options: { updateLastSync?: boolean; force?: boolean } = {}
): Promise<WearableImportSnapshot> {
  const isIos = Platform.OS === 'ios';
  const source: WearableImportSnapshot['source'] = isIos ? 'apple_health' : 'health_connect';
  const wearablePrefs = await getWearableImportPreferences();

  if (!isIos) {
    const perm = await getHealthConnectPermissionStatus();
    if (perm === 'denied') {
      return {
        date,
        imported: false,
        source,
        steps: 0,
        activeEnergy: 0,
        sleepMinutes: 0,
        restingHeartRate: 0,
        importedAt: new Date().toISOString(),
        reason: 'Health Connect permissions are not granted.',
      };
    }

    const startTs = `${date}T00:00:00.000Z`;
    const endTs = `${date}T23:59:59.999Z`;
    const workouts = await readHealthConnectWorkouts(startTs, endTs);
    const aggregateKcal = workouts.reduce((sum, w) => sum + (Number(w?.activeKcal) || 0), 0);
    const aggregateSteps = workouts.reduce((sum, w) => sum + Math.max(0, Math.round((Number(w?.distanceM) || 0) / 0.78)), 0);

    if (isSupabaseConfigured) {
      try {
        await supabase.functions.invoke('wearables-sync', {
          body: {
            source: 'HEALTH_CONNECT',
            workouts,
            dailyTotals: [{ date, steps: aggregateSteps, activeKcal: aggregateKcal }],
          },
        });
      } catch (err) {
        void captureException(err, { feature: 'wearable_import', op: 'wearables_sync_android' });
      }
    }

    return {
      date,
      imported: workouts.length > 0,
      source,
      steps: aggregateSteps,
      activeEnergy: aggregateKcal,
      sleepMinutes: 0,
      restingHeartRate: 0,
      importedAt: new Date().toISOString(),
      reason: workouts.length ? undefined : 'No Health Connect workouts found for this date.',
    };
  }

  const auth = await getTodaySignalsAuthorizationState({
    required: {
      steps: wearablePrefs.importSteps,
      activeEnergy: wearablePrefs.importActiveEnergy,
      sleep: wearablePrefs.importSleep,
      restingHeartRate: wearablePrefs.importRestingHeartRate,
    },
  });
  if (auth.state === 'unavailable') {
    return {
      date,
      imported: false,
      source,
      steps: 0,
      activeEnergy: 0,
      sleepMinutes: 0,
      restingHeartRate: 0,
      importedAt: new Date().toISOString(),
      reason: 'Apple Health is unavailable in this runtime.',
    };
  }

  const targetDate = asDate(date);
  const [stepsRes, energyRes, sleepRes, rhrRes, workoutsRes] = await Promise.all([
    wearablePrefs.importSteps ? tryGetDailySteps(targetDate) : Promise.resolve({ ok: true, value: 0 as number, error: undefined as string | undefined }),
    wearablePrefs.importActiveEnergy
      ? tryGetDailyActiveEnergy(targetDate)
      : Promise.resolve({ ok: true, value: 0 as number, error: undefined as string | undefined }),
    wearablePrefs.importSleep ? tryGetSleepData() : Promise.resolve({ ok: true, value: null as any, error: undefined as string | undefined }),
    wearablePrefs.importRestingHeartRate
      ? tryGetRestingHeartRate()
      : Promise.resolve({ ok: true, value: null as any, error: undefined as string | undefined }),
    tryGetDailyWorkoutSessions(targetDate),
  ]);

  const failures: { label: string; error?: string }[] = [];
  if (wearablePrefs.importSteps && !stepsRes.ok) failures.push({ label: 'Steps', error: stepsRes.error });
  if (wearablePrefs.importActiveEnergy && !energyRes.ok) failures.push({ label: 'Active energy', error: energyRes.error });
  if (wearablePrefs.importSleep && !sleepRes.ok) failures.push({ label: 'Sleep', error: sleepRes.error });
  if (wearablePrefs.importRestingHeartRate && !rhrRes.ok) failures.push({ label: 'Resting HR', error: rhrRes.error });
  if (!workoutsRes.ok) failures.push({ label: 'Workout sessions', error: workoutsRes.error });

  const selectedSteps = wearablePrefs.importSteps ? Number(stepsRes.value) || 0 : 0;
  const selectedActiveEnergy = wearablePrefs.importActiveEnergy ? Number(energyRes.value) || 0 : 0;
  const selectedSleepMinutes = wearablePrefs.importSleep ? Number((sleepRes.value as any)?.duration) || 0 : 0;
  const selectedRestingHeartRate = wearablePrefs.importRestingHeartRate ? Number(rhrRes.value) || 0 : 0;
  const importedAt = new Date().toISOString();

  const importedSignalReads =
    (wearablePrefs.importSteps && stepsRes.ok ? 1 : 0) +
    (wearablePrefs.importActiveEnergy && energyRes.ok ? 1 : 0) +
    (wearablePrefs.importSleep && sleepRes.ok ? 1 : 0) +
    (wearablePrefs.importRestingHeartRate && rhrRes.ok ? 1 : 0);

  const importedWorkoutEntries = workoutsRes.ok
    ? workoutsRes.value.map((session) => buildAppleImportedWorkoutEntry(session, importedAt))
    : [];
  const fallbackWorkout = buildImportedWorkoutEntry({
    date,
    source,
    activeEnergy: selectedActiveEnergy,
    importedAt,
  });
  const workoutEntriesForMerge =
    importedWorkoutEntries.length > 0
      ? importedWorkoutEntries
      : fallbackWorkout
      ? [fallbackWorkout]
      : [];
  const importedWorkoutReads = workoutEntriesForMerge.length > 0 ? 1 : 0;
  const importedAny = importedSignalReads > 0 || importedWorkoutReads > 0;

  const failureSummary = failures
    .slice(0, 3)
    .map((f) => `${f.label}${f.error ? ` (${f.error})` : ''}`)
    .join(', ');
  const allSignalsDisabled =
    !wearablePrefs.importSteps && !wearablePrefs.importActiveEnergy && !wearablePrefs.importSleep && !wearablePrefs.importRestingHeartRate;

  const snapshot: WearableImportSnapshot = {
    date,
    imported: importedAny,
    source,
    steps: selectedSteps,
    activeEnergy: selectedActiveEnergy,
    sleepMinutes: selectedSleepMinutes,
    restingHeartRate: selectedRestingHeartRate,
    importedAt,
    reason: !importedAny
      ? allSignalsDisabled
        ? 'No wearable signals are enabled for import.'
        : failureSummary
        ? `No data imported. Read failed for: ${failureSummary}.`
        : auth.state === 'notDetermined'
        ? 'Apple Health is not connected yet.'
        : auth.state === 'denied'
        ? 'Apple Health access is off for selected data types. Enable access in Health settings.'
        : 'No Apple Health data found for this date.'
      : failureSummary
      ? `Imported with partial data. Failed: ${failureSummary}.`
      : undefined,
  };

  const log = await getDailyLog(date);
  const shouldPersist = importedSignalReads > 0 || workoutsRes.ok || importedWorkoutReads > 0;
  if (shouldPersist) {
    const currentWearableSignals = (log?.wearableSignals || {}) as any;
    const mergedWorkouts = workoutsRes.ok
      ? mergeImportedWorkouts(log, source, workoutEntriesForMerge, 'replace')
      : mergeImportedWorkouts(log, source, workoutEntriesForMerge, 'upsert');
    await saveDailyLog(date, {
      ...log,
      wearableSignals: {
        source,
        importedAt: snapshot.importedAt,
        steps: wearablePrefs.importSteps ? (stepsRes.ok ? snapshot.steps : currentWearableSignals.steps) : undefined,
        activeEnergy: wearablePrefs.importActiveEnergy
          ? energyRes.ok
            ? snapshot.activeEnergy
            : currentWearableSignals.activeEnergy
          : undefined,
        sleepMinutes: wearablePrefs.importSleep ? (sleepRes.ok ? snapshot.sleepMinutes : currentWearableSignals.sleepMinutes) : undefined,
        restingHeartRate: wearablePrefs.importRestingHeartRate
          ? rhrRes.ok
            ? snapshot.restingHeartRate
            : currentWearableSignals.restingHeartRate
          : undefined,
      },
      workouts: mergedWorkouts,
    });
    await settleBehaviorDay(date);
    if (importedAny || workoutsRes.ok) {
      await setLastSuccessfulHealthSyncAt(snapshot.importedAt);
    }
    if (options.updateLastSync !== false && (importedAny || workoutsRes.ok)) {
      await setWearableImportPreferences({
        connected: true,
        lastSyncDate: date,
      });
    }
  }

  if (failures.length > 0) {
    void captureMessage('health_sync_partial_or_failed', {
      reasonCode: importedAny ? 'sync_partial_success' : 'sync_failed_read_error',
      date,
      failures: failures.map((f) => ({ label: f.label, error: f.error })),
      imported: importedAny,
      importedWorkoutCount: workoutEntriesForMerge.length,
    });
  } else {
    void captureMessage('health_sync_success', {
      reasonCode: 'sync_success',
      date,
      importedAt: snapshot.importedAt,
      steps: snapshot.steps,
      activeEnergy: snapshot.activeEnergy,
      sleepMinutes: snapshot.sleepMinutes,
      restingHeartRate: snapshot.restingHeartRate,
      importedWorkoutCount: workoutEntriesForMerge.length,
    });
  }

  return snapshot;
}

export async function syncWearableSignalsIfEnabled(
  date = todayKey(),
  options: { force?: boolean } = {}
): Promise<WearableImportSnapshot | null> {
  const prefs = await getWearableImportPreferences();
  if (!prefs.connected || !prefs.autoSync) return null;
  const lastSyncAt = await getLastSuccessfulHealthSyncAt();
  if (!options.force && !isStaleSync(lastSyncAt, date)) {
    void captureMessage('health_sync_skipped_fresh', {
      reasonCode: 'sync_skipped_fresh',
      date,
      lastSuccessfulSyncAt: lastSyncAt,
    });
    return null;
  }

  if (Platform.OS !== 'ios') {
    try {
      return await importWearableDailySignals(date, { updateLastSync: true, force: Boolean(options.force) });
    } catch (error) {
      void captureException(error, { feature: 'health_sync', op: 'auto_sync_android', date, lastSuccessfulSyncAt: lastSyncAt });
      return {
        date,
        imported: false,
        source: 'health_connect',
        steps: 0,
        activeEnergy: 0,
        sleepMinutes: 0,
        restingHeartRate: 0,
        importedAt: new Date().toISOString(),
        reason: 'Health Connect sync failed due to a runtime error.',
      };
    }
  }

  const auth = await getTodaySignalsAuthorizationState({
    required: {
      steps: prefs.importSteps,
      activeEnergy: prefs.importActiveEnergy,
      sleep: prefs.importSleep,
      restingHeartRate: prefs.importRestingHeartRate,
    },
  });
  if (auth.state === 'unavailable' || (auth.state !== 'authorized' && !options.force)) {
    void captureMessage('health_sync_skipped_not_authorized', {
      reasonCode: 'sync_skipped_not_authorized',
      date,
      lastSuccessfulSyncAt: lastSyncAt,
      authState: auth.state,
      authDetail: auth.detail,
      force: Boolean(options.force),
    });
    return null;
  }

  try {
    return await importWearableDailySignals(date, { updateLastSync: true, force: Boolean(options.force) });
  } catch (error) {
    void captureException(error, { feature: 'health_sync', op: 'auto_sync', date, lastSuccessfulSyncAt: lastSyncAt });
    void captureMessage('health_sync_failed_runtime_error', {
      reasonCode: 'sync_failed_runtime_error',
      date,
      lastSuccessfulSyncAt: lastSyncAt,
      authState: auth.state,
    });
    return {
      date,
      imported: false,
      source: Platform.OS === 'ios' ? 'apple_health' : 'health_connect',
      steps: 0,
      activeEnergy: 0,
      sleepMinutes: 0,
      restingHeartRate: 0,
      importedAt: new Date().toISOString(),
      reason: 'Sync failed due to a runtime error.',
    };
  }
}
