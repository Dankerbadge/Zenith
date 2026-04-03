import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getTodaySignalsAuthorizationState,
  tryGetDailyActiveEnergy,
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

const DEFAULT_WEARABLE_PREFS: WearableImportPreferences = {
  connected: false,
  autoSync: true,
  importSteps: true,
  importActiveEnergy: true,
  importSleep: true,
  importRestingHeartRate: true,
  lastSyncDate: undefined,
};

const LAST_SUCCESSFUL_HEALTH_SYNC_AT_KEY = 'wearable:lastSuccessfulHealthSyncAt';
const HEALTH_SYNC_STALE_WINDOW_MS = 30 * 60 * 1000;

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

function mergeImportedWorkout(log: any, importedWorkout: WorkoutEntry | null): WorkoutEntry[] {
  const existingWorkouts = Array.isArray(log?.workouts) ? [...log.workouts] : [];
  const importedIds = new Set(existingWorkouts.filter((w: any) => Boolean(w?.imported)).map((w: any) => String(w?.id || '')));
  const hasUserLoggedWorkout = existingWorkouts.some((w: any) => !w?.imported);

  // Never overwrite user-logged workouts.
  if (hasUserLoggedWorkout) {
    return existingWorkouts.filter((w: any) => !w?.imported || importedIds.has(String(w?.id || '')));
  }

  if (!importedWorkout) {
    return existingWorkouts.filter((w: any) => !w?.imported);
  }

  const idx = existingWorkouts.findIndex((w: any) => String(w?.id || '') === importedWorkout.id);
  if (idx >= 0) {
    existingWorkouts[idx] = {
      ...existingWorkouts[idx],
      ...importedWorkout,
    };
    return existingWorkouts;
  }

  return [...existingWorkouts.filter((w: any) => !w?.imported), importedWorkout];
}

export async function importWearableDailySignals(
  date = todayKey(),
  options: { updateLastSync?: boolean } = {}
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
  if (auth.state !== 'authorized') {
    return {
      date,
      imported: false,
      source,
      steps: 0,
      activeEnergy: 0,
      sleepMinutes: 0,
      restingHeartRate: 0,
      importedAt: new Date().toISOString(),
      reason:
        auth.state === 'notDetermined'
          ? 'Apple Health is not connected yet.'
          : auth.state === 'denied'
          ? 'Apple Health access is off. Enable it in Settings > Health > Data Access.'
          : 'Apple Health is unavailable in this runtime.',
    };
  }

  const targetDate = asDate(date);
  const [stepsRes, energyRes, sleepRes, rhrRes] = await Promise.all([
    wearablePrefs.importSteps ? tryGetDailySteps(targetDate) : Promise.resolve({ ok: true, value: 0 as number, error: undefined as string | undefined }),
    wearablePrefs.importActiveEnergy
      ? tryGetDailyActiveEnergy(targetDate)
      : Promise.resolve({ ok: true, value: 0 as number, error: undefined as string | undefined }),
    wearablePrefs.importSleep ? tryGetSleepData() : Promise.resolve({ ok: true, value: null as any, error: undefined as string | undefined }),
    wearablePrefs.importRestingHeartRate
      ? tryGetRestingHeartRate()
      : Promise.resolve({ ok: true, value: null as any, error: undefined as string | undefined }),
  ]);

  const failures: { label: string; error?: string }[] = [];
  if (wearablePrefs.importSteps && !stepsRes.ok) failures.push({ label: 'Steps', error: stepsRes.error });
  if (wearablePrefs.importActiveEnergy && !energyRes.ok) failures.push({ label: 'Active energy', error: energyRes.error });
  if (wearablePrefs.importSleep && !sleepRes.ok) failures.push({ label: 'Sleep', error: sleepRes.error });
  if (wearablePrefs.importRestingHeartRate && !rhrRes.ok) failures.push({ label: 'Resting HR', error: rhrRes.error });

  if (failures.length > 0) {
    void captureMessage('health_sync_failed_read_error', {
      reasonCode: 'sync_failed_read_error',
      date,
      failures: failures.map((f) => ({ label: f.label, error: f.error })),
    });

    // Drop "connected" on read failures so auto-sync stops until the user fixes permissions.
    if (options.updateLastSync !== false) {
      await setWearableImportPreferences({ connected: false });
    }

    const reasonParts = failures
      .slice(0, 3)
      .map((f) => `${f.label}${f.error ? ` (${f.error})` : ''}`);
    return {
      date,
      imported: false,
      source,
      steps: 0,
      activeEnergy: 0,
      sleepMinutes: 0,
      restingHeartRate: 0,
      importedAt: new Date().toISOString(),
      reason:
        `Apple Health read failed for: ${reasonParts.join(', ')}. ` +
        `Enable access in Health → Profile → Apps → Zenith (or Settings → Health → Data Access & Devices → Zenith), then try again.`,
    };
  }

  const selectedSteps = wearablePrefs.importSteps ? Number(stepsRes.value) || 0 : 0;
  const selectedActiveEnergy = wearablePrefs.importActiveEnergy ? Number(energyRes.value) || 0 : 0;
  const selectedSleepMinutes = wearablePrefs.importSleep ? Number((sleepRes.value as any)?.duration) || 0 : 0;
  const selectedRestingHeartRate = wearablePrefs.importRestingHeartRate ? Number(rhrRes.value) || 0 : 0;

  const snapshot: WearableImportSnapshot = {
    date,
    imported: true,
    source,
    steps: selectedSteps,
    activeEnergy: selectedActiveEnergy,
    sleepMinutes: selectedSleepMinutes,
    restingHeartRate: selectedRestingHeartRate,
    importedAt: new Date().toISOString(),
  };

  const log = await getDailyLog(date);
  const importedWorkout = buildImportedWorkoutEntry({
    date,
    source,
    activeEnergy: snapshot.activeEnergy,
    importedAt: snapshot.importedAt,
  });
  const mergedWorkouts = mergeImportedWorkout(log, importedWorkout);
  await saveDailyLog(date, {
    ...log,
    wearableSignals: {
      source,
      importedAt: snapshot.importedAt,
      steps: wearablePrefs.importSteps ? snapshot.steps : undefined,
      activeEnergy: wearablePrefs.importActiveEnergy ? snapshot.activeEnergy : undefined,
      sleepMinutes: wearablePrefs.importSleep ? snapshot.sleepMinutes : undefined,
      restingHeartRate: wearablePrefs.importRestingHeartRate ? snapshot.restingHeartRate : undefined,
    },
    workouts: mergedWorkouts,
  });
  await settleBehaviorDay(date);
  await setLastSuccessfulHealthSyncAt(snapshot.importedAt);
  if (options.updateLastSync !== false) {
    await setWearableImportPreferences({
      connected: true,
      lastSyncDate: date,
    });
  }

  void captureMessage('health_sync_success', {
    reasonCode: 'sync_success',
    date,
    importedAt: snapshot.importedAt,
    steps: snapshot.steps,
    activeEnergy: snapshot.activeEnergy,
    sleepMinutes: snapshot.sleepMinutes,
    restingHeartRate: snapshot.restingHeartRate,
  });

  return snapshot;
}

export async function syncWearableSignalsIfEnabled(date = todayKey()): Promise<WearableImportSnapshot | null> {
  const prefs = await getWearableImportPreferences();
  if (!prefs.connected || !prefs.autoSync) return null;
  const lastSyncAt = await getLastSuccessfulHealthSyncAt();
  if (!isStaleSync(lastSyncAt, date)) {
    void captureMessage('health_sync_skipped_fresh', {
      reasonCode: 'sync_skipped_fresh',
      date,
      lastSuccessfulSyncAt: lastSyncAt,
    });
    return null;
  }

  const auth = await getTodaySignalsAuthorizationState({
    required: {
      steps: prefs.importSteps,
      activeEnergy: prefs.importActiveEnergy,
      sleep: prefs.importSleep,
      restingHeartRate: prefs.importRestingHeartRate,
    },
  });
  if (auth.state !== 'authorized') {
    void captureMessage('health_sync_skipped_not_authorized', {
      reasonCode: 'sync_skipped_not_authorized',
      date,
      lastSuccessfulSyncAt: lastSyncAt,
      authState: auth.state,
      authDetail: auth.detail,
    });
    return null;
  }

  try {
    return await importWearableDailySignals(date, { updateLastSync: true });
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
