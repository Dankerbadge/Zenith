import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import type { LocationPoint, TrackingSampleProfile } from './gpsService';
import { APP_CONFIG } from './appConfig';
import { captureException } from './crashReporter';

const RUN_BACKGROUND_LOCATION_TASK = 'zenith-run-background-location-v1';
const RUN_BACKGROUND_ACTIVE_SESSION_KEY = 'runBackgroundLocationActiveSession';
const RUN_BACKGROUND_QUEUE_KEY = 'runBackgroundLocationQueueV1';
const MAX_QUEUED_POINTS = 3000;

type QueuedLocation = {
  sessionId: string;
  point: LocationPoint;
};

function safeParseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toLocationPoint(location: any): LocationPoint | null {
  const latitude = Number(location?.coords?.latitude);
  const longitude = Number(location?.coords?.longitude);
  const timestamp = Number(location?.timestamp || Date.now());
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    latitude,
    longitude,
    timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
    altitude: Number.isFinite(Number(location?.coords?.altitude)) ? Number(location.coords.altitude) : null,
    accuracy: Number.isFinite(Number(location?.coords?.accuracy)) ? Number(location.coords.accuracy) : null,
    speed: Number.isFinite(Number(location?.coords?.speed)) ? Number(location.coords.speed) : null,
  };
}

function optionsForProfile(profile: TrackingSampleProfile): Location.LocationTaskOptions {
  const sampling = APP_CONFIG.LIVE_TRACKING.RUN.SAMPLING;
  const base =
    profile === 'precision'
      ? {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: sampling.PRECISION.TIME_INTERVAL_MS,
          distanceInterval: sampling.PRECISION.DISTANCE_INTERVAL_M,
        }
      : profile === 'eco'
      ? {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: sampling.ECO.TIME_INTERVAL_MS,
          distanceInterval: sampling.ECO.DISTANCE_INTERVAL_M,
        }
      : {
          accuracy: Location.Accuracy.High,
          timeInterval: sampling.BALANCED.TIME_INTERVAL_MS,
          distanceInterval: sampling.BALANCED.DISTANCE_INTERVAL_M,
        };

  return {
    ...base,
    activityType: Location.ActivityType.Fitness,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    deferredUpdatesInterval: base.timeInterval,
    foregroundService: {
      notificationTitle: 'Zenith run tracking active',
      notificationBody: 'Location tracking is active in the background for your run.',
    },
  };
}

const canDefineBackgroundTask =
  typeof (TaskManager as any).defineTask === 'function' &&
  typeof (TaskManager as any).isTaskDefined === 'function';

if (canDefineBackgroundTask && !TaskManager.isTaskDefined(RUN_BACKGROUND_LOCATION_TASK)) {
  TaskManager.defineTask(RUN_BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
    if (error) {
      void captureException(error, { feature: 'run_background_location', op: 'task_error' });
      return;
    }

    try {
      const sessionId = String((await AsyncStorage.getItem(RUN_BACKGROUND_ACTIVE_SESSION_KEY)) || '').trim();
      if (!sessionId) return;

      const rawLocations = Array.isArray((data as any)?.locations) ? ((data as any).locations as any[]) : [];
      if (!rawLocations.length) return;

      const points: LocationPoint[] = rawLocations
        .map(toLocationPoint)
        .filter((row): row is LocationPoint => Boolean(row));
      if (!points.length) return;

      const currentRaw = await AsyncStorage.getItem(RUN_BACKGROUND_QUEUE_KEY);
      const current = safeParseJson<QueuedLocation[]>(currentRaw, []);
      const next = [
        ...current,
        ...points.map((point) => ({
          sessionId,
          point,
        })),
      ];
      const trimmed = next.length > MAX_QUEUED_POINTS ? next.slice(next.length - MAX_QUEUED_POINTS) : next;
      await AsyncStorage.setItem(RUN_BACKGROUND_QUEUE_KEY, JSON.stringify(trimmed));
    } catch (taskErr) {
      void captureException(taskErr, { feature: 'run_background_location', op: 'task_persist_queue' });
    }
  });
}

export async function requestRunBackgroundLocationPermission(): Promise<boolean> {
  try {
    const current = await Location.getBackgroundPermissionsAsync();
    if (current.status === 'granted') return true;
    const next = await Location.requestBackgroundPermissionsAsync();
    return next.status === 'granted';
  } catch (err) {
    void captureException(err, { feature: 'run_background_location', op: 'request_background_permission' });
    return false;
  }
}

export async function startRunBackgroundLocationTracking(input: {
  sessionId: string;
  profile?: TrackingSampleProfile;
}): Promise<boolean> {
  const sessionId = String(input.sessionId || '').trim();
  if (!sessionId) return false;

  try {
    await AsyncStorage.setItem(RUN_BACKGROUND_ACTIVE_SESSION_KEY, sessionId);
    const hasPermission = await requestRunBackgroundLocationPermission();
    if (!hasPermission) return false;

    const profile = input.profile || 'balanced';
    const started = await Location.hasStartedLocationUpdatesAsync(RUN_BACKGROUND_LOCATION_TASK);
    if (started) {
      await Location.stopLocationUpdatesAsync(RUN_BACKGROUND_LOCATION_TASK);
    }
    await Location.startLocationUpdatesAsync(RUN_BACKGROUND_LOCATION_TASK, optionsForProfile(profile));
    return true;
  } catch (err) {
    void captureException(err, { feature: 'run_background_location', op: 'start_tracking' });
    return false;
  }
}

export async function stopRunBackgroundLocationTracking(options?: { clearActiveSession?: boolean }): Promise<void> {
  try {
    const started = await Location.hasStartedLocationUpdatesAsync(RUN_BACKGROUND_LOCATION_TASK);
    if (started) {
      await Location.stopLocationUpdatesAsync(RUN_BACKGROUND_LOCATION_TASK);
    }
  } catch (err) {
    void captureException(err, { feature: 'run_background_location', op: 'stop_tracking' });
  } finally {
    if (options?.clearActiveSession !== false) {
      try {
        await AsyncStorage.removeItem(RUN_BACKGROUND_ACTIVE_SESSION_KEY);
      } catch {
        // ignore
      }
    }
  }
}

export async function consumeRunBackgroundLocationQueue(sessionId: string): Promise<LocationPoint[]> {
  const targetSessionId = String(sessionId || '').trim();
  if (!targetSessionId) return [];
  try {
    const raw = await AsyncStorage.getItem(RUN_BACKGROUND_QUEUE_KEY);
    const rows = safeParseJson<QueuedLocation[]>(raw, []);
    if (!Array.isArray(rows) || rows.length === 0) return [];

    const matched: LocationPoint[] = [];
    const remainder: QueuedLocation[] = [];
    rows.forEach((row) => {
      if (String(row?.sessionId || '') === targetSessionId && row?.point) {
        matched.push(row.point);
      } else if (row?.sessionId && row?.point) {
        remainder.push(row);
      }
    });

    await AsyncStorage.setItem(RUN_BACKGROUND_QUEUE_KEY, JSON.stringify(remainder));
    matched.sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
    return matched;
  } catch (err) {
    void captureException(err, { feature: 'run_background_location', op: 'consume_queue' });
    return [];
  }
}

export async function clearRunBackgroundLocationQueue(sessionId?: string): Promise<void> {
  const targetSessionId = String(sessionId || '').trim();
  try {
    if (!targetSessionId) {
      await AsyncStorage.removeItem(RUN_BACKGROUND_QUEUE_KEY);
      return;
    }
    const raw = await AsyncStorage.getItem(RUN_BACKGROUND_QUEUE_KEY);
    const rows = safeParseJson<QueuedLocation[]>(raw, []);
    const remainder = Array.isArray(rows)
      ? rows.filter((row) => String(row?.sessionId || '') !== targetSessionId)
      : [];
    await AsyncStorage.setItem(RUN_BACKGROUND_QUEUE_KEY, JSON.stringify(remainder));
  } catch (err) {
    void captureException(err, { feature: 'run_background_location', op: 'clear_queue' });
  }
}
