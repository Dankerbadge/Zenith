import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { APP_CONFIG } from './appConfig';
import { getSubscriptionStatus } from './monetizationService';
import {
  GARMIN_FREE_FEATURES,
  GARMIN_PREMIUM_FEATURES,
  GARMIN_PROTOCOL_VERSION,
  createGarminMessageId,
  type GarminConnectionState,
  type GarminEntitlementState,
  type GarminMessageEnvelope,
  type GarminWorkoutSummary,
} from './garminProtocol';
import { commitGarminFinalizedRun } from './runReviewService';
import { saveLiftTagSession } from './liftTagService';
import { assignSessionDayKey } from './dayAssignment';
import { clearDailyMetricCache } from './dailyMetrics';
import { settleBehaviorDay } from './behavioralCore';

const GARMIN_COMPANION_STATE_KEY = 'garminCompanionState';
const GARMIN_OUTBOUND_QUEUE_KEY = 'garminOutboundQueue';
const GARMIN_EVENT_LOG_KEY = 'garminEventLog';
const GARMIN_ENTITLEMENT_KEY = 'garminEntitlementCache';
const GARMIN_LINK_CODE_KEY = 'garminPendingLinkCode';
const GARMIN_PENDING_WORKOUTS_KEY = 'garminPendingWorkouts';
const GARMIN_IMPORTED_SESSION_IDS_KEY = 'garminImportedSessionIds_v1';

const MAX_QUEUE_SIZE = 100;
const MAX_EVENT_LOG = 250;
const MAX_PENDING_WORKOUTS = 50;
const MAX_IMPORTED_SESSION_IDS = 500;

export type GarminCompanionState = {
  watchAppInstallId: string | null;
  linkHandle: string | null;
  linked: boolean;
  connectionState: GarminConnectionState;
  lastHelloAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
};

const DEFAULT_STATE: GarminCompanionState = {
  watchAppInstallId: null,
  linkHandle: null,
  linked: false,
  connectionState: 'disconnected',
  lastHelloAt: null,
  lastSyncAt: null,
  lastError: null,
};

type GarminAvailability = {
  enabled: boolean;
  companionBridgeEnabled: boolean;
  platformSupported: boolean;
  state: 'ready' | 'feature_disabled' | 'unsupported_platform' | 'bridge_pending';
  reason: string;
};

function safeParseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function getGarminAvailability(): GarminAvailability {
  const enabled = APP_CONFIG.FEATURES.GARMIN_CONNECT_ENABLED;
  const platformSupported = Platform.OS === 'ios' || Platform.OS === 'android';
  const companionBridgeEnabled =
    Platform.OS === 'ios'
      ? APP_CONFIG.FEATURES.GARMIN_IOS_COMPANION_ENABLED
      : APP_CONFIG.FEATURES.GARMIN_ANDROID_COMPANION_ENABLED;

  if (!enabled) {
    return {
      enabled,
      companionBridgeEnabled,
      platformSupported,
      state: 'feature_disabled',
      reason: 'Garmin support is disabled in this build.',
    };
  }

  if (!platformSupported) {
    return {
      enabled,
      companionBridgeEnabled,
      platformSupported,
      state: 'unsupported_platform',
      reason: 'Garmin companion support is available only on iOS/Android builds.',
    };
  }

  if (!companionBridgeEnabled) {
    return {
      enabled,
      companionBridgeEnabled,
      platformSupported,
      state: 'bridge_pending',
      reason: 'Garmin companion bridge is staged but not enabled in this build.',
    };
  }

  return {
    enabled,
    companionBridgeEnabled,
    platformSupported,
    state: 'ready',
    reason: 'Garmin companion services are ready.',
  };
}

export async function getGarminCompanionState(): Promise<GarminCompanionState> {
  const raw = await AsyncStorage.getItem(GARMIN_COMPANION_STATE_KEY);
  return {
    ...DEFAULT_STATE,
    ...safeParseJson<Partial<GarminCompanionState>>(raw, {}),
  };
}

export async function setGarminCompanionState(next: Partial<GarminCompanionState>): Promise<GarminCompanionState> {
  const current = await getGarminCompanionState();
  const merged: GarminCompanionState = {
    ...current,
    ...next,
  };
  await AsyncStorage.setItem(GARMIN_COMPANION_STATE_KEY, JSON.stringify(merged));
  return merged;
}

export async function resetGarminCompanionState(): Promise<void> {
  await AsyncStorage.multiRemove([
    GARMIN_COMPANION_STATE_KEY,
    GARMIN_OUTBOUND_QUEUE_KEY,
    GARMIN_EVENT_LOG_KEY,
    GARMIN_ENTITLEMENT_KEY,
    GARMIN_LINK_CODE_KEY,
    GARMIN_PENDING_WORKOUTS_KEY,
  ]);
}

export async function queueGarminOutboundMessage(payload: GarminMessageEnvelope): Promise<void> {
  const raw = await AsyncStorage.getItem(GARMIN_OUTBOUND_QUEUE_KEY);
  const queue = safeParseJson<GarminMessageEnvelope[]>(raw, []);
  if (queue.some((entry) => entry.messageId === payload.messageId)) return;
  const next = [...queue, payload].slice(-MAX_QUEUE_SIZE);
  await AsyncStorage.setItem(GARMIN_OUTBOUND_QUEUE_KEY, JSON.stringify(next));
}

export async function getGarminOutboundQueue(): Promise<GarminMessageEnvelope[]> {
  const raw = await AsyncStorage.getItem(GARMIN_OUTBOUND_QUEUE_KEY);
  const queue = safeParseJson<GarminMessageEnvelope[]>(raw, []);
  return Array.isArray(queue) ? queue : [];
}

export async function consumeGarminOutboundMessage(messageId: string): Promise<void> {
  const queue = await getGarminOutboundQueue();
  const next = queue.filter((entry) => entry.messageId !== messageId);
  await AsyncStorage.setItem(GARMIN_OUTBOUND_QUEUE_KEY, JSON.stringify(next));
}

export async function appendGarminEventLog(message: string): Promise<void> {
  const raw = await AsyncStorage.getItem(GARMIN_EVENT_LOG_KEY);
  const items = safeParseJson<Array<{ at: string; message: string }>>(raw, []);
  items.push({ at: new Date().toISOString(), message });
  await AsyncStorage.setItem(GARMIN_EVENT_LOG_KEY, JSON.stringify(items.slice(-MAX_EVENT_LOG)));
}

export async function getGarminEventLog(): Promise<Array<{ at: string; message: string }>> {
  const raw = await AsyncStorage.getItem(GARMIN_EVENT_LOG_KEY);
  return safeParseJson<Array<{ at: string; message: string }>>(raw, []);
}

export async function getGarminEntitlementCache(): Promise<GarminEntitlementState> {
  const raw = await AsyncStorage.getItem(GARMIN_ENTITLEMENT_KEY);
  const cached = safeParseJson<GarminEntitlementState | null>(raw, null);
  if (cached) return cached;
  return {
    isPremium: false,
    source: 'unknown',
    serverTimestamp: new Date().toISOString(),
    expiresAt: null,
    featuresEnabled: GARMIN_FREE_FEATURES,
  };
}

export async function setGarminEntitlementCache(next: GarminEntitlementState): Promise<void> {
  await AsyncStorage.setItem(GARMIN_ENTITLEMENT_KEY, JSON.stringify(next));
}

export async function refreshGarminEntitlementFromSubscription(): Promise<GarminEntitlementState> {
  const sub = await getSubscriptionStatus();
  const isPremium = Boolean(APP_CONFIG.FEATURES.GARMIN_PREMIUM_SYNC_ENABLED && sub.isActive && sub.tier === 'pro');
  const next: GarminEntitlementState = {
    isPremium,
    source: 'mobile_cache',
    serverTimestamp: new Date().toISOString(),
    expiresAt: sub.expiresAt,
    featuresEnabled: isPremium
      ? [...GARMIN_FREE_FEATURES, ...GARMIN_PREMIUM_FEATURES]
      : [...GARMIN_FREE_FEATURES],
  };
  await setGarminEntitlementCache(next);
  return next;
}

export function buildGarminFeatureSplit() {
  return {
    freeOnWatch: [
      'Start / pause / resume / end workouts',
      'Basic live metrics (time, distance, HR, calories where available)',
      'Workout summary sync to mobile app',
    ],
    premiumViaMobileEntitlement: [
      'Advanced analytics and deeper trends',
      'Coaching insights and enhanced recovery context',
      'Advanced Garmin config profiles and extended history views',
    ],
  };
}

export async function generateGarminLinkCode(): Promise<string> {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  await AsyncStorage.setItem(
    GARMIN_LINK_CODE_KEY,
    JSON.stringify({ code, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() })
  );
  return code;
}

export async function getGarminLinkCode(): Promise<{ code: string; expiresAt: string } | null> {
  const raw = await AsyncStorage.getItem(GARMIN_LINK_CODE_KEY);
  const parsed = safeParseJson<{ code: string; createdAt: string; expiresAt: string } | null>(raw, null);
  if (!parsed) return null;
  if (new Date(parsed.expiresAt).getTime() <= Date.now()) {
    await AsyncStorage.removeItem(GARMIN_LINK_CODE_KEY);
    return null;
  }
  return { code: parsed.code, expiresAt: parsed.expiresAt };
}

export async function setGarminLinkCode(code: string, expiresAt: string): Promise<void> {
  await AsyncStorage.setItem(
    GARMIN_LINK_CODE_KEY,
    JSON.stringify({
      code: String(code || '').trim(),
      createdAt: new Date().toISOString(),
      expiresAt,
    })
  );
}

export async function clearGarminLinkCode(): Promise<void> {
  await AsyncStorage.removeItem(GARMIN_LINK_CODE_KEY);
}

export async function queuePendingGarminWorkout(summary: GarminWorkoutSummary): Promise<void> {
  const raw = await AsyncStorage.getItem(GARMIN_PENDING_WORKOUTS_KEY);
  const items = safeParseJson<GarminWorkoutSummary[]>(raw, []);
  const existingIndex = items.findIndex((row) => row.localSessionId === summary.localSessionId);
  if (existingIndex >= 0) {
    items[existingIndex] = summary;
  } else {
    items.push(summary);
  }
  await AsyncStorage.setItem(GARMIN_PENDING_WORKOUTS_KEY, JSON.stringify(items.slice(-MAX_PENDING_WORKOUTS)));
}

export async function getPendingGarminWorkouts(): Promise<GarminWorkoutSummary[]> {
  const raw = await AsyncStorage.getItem(GARMIN_PENDING_WORKOUTS_KEY);
  return safeParseJson<GarminWorkoutSummary[]>(raw, []);
}

export async function consumePendingGarminWorkout(localSessionId: string): Promise<void> {
  const items = await getPendingGarminWorkouts();
  const next = items.filter((row) => row.localSessionId !== localSessionId);
  await AsyncStorage.setItem(GARMIN_PENDING_WORKOUTS_KEY, JSON.stringify(next));
}

export async function stageGarminHelloMessage(params: {
  watchAppInstallId: string;
  lastKnownEntitlementState: GarminEntitlementState;
}): Promise<GarminMessageEnvelope> {
  const envelope: GarminMessageEnvelope = {
    messageId: createGarminMessageId('HELLO'),
    protocolVersion: GARMIN_PROTOCOL_VERSION,
    messageType: 'HELLO',
    sentAt: new Date().toISOString(),
    source: 'watch',
    watchAppInstallId: params.watchAppInstallId,
    payload: {
      appVersion: APP_CONFIG.APP_VERSION,
      deviceInfo: Platform.OS,
      lastKnownEntitlementState: params.lastKnownEntitlementState,
      timestamp: new Date().toISOString(),
    },
  };
  await queueGarminOutboundMessage(envelope);
  return envelope;
}

function safeNumber(value: unknown, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeIso(value: unknown) {
  const s = typeof value === 'string' ? value : '';
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? s : new Date().toISOString();
}

function garminImportLedgerKey(localSessionId: string, sportType: string): string {
  return `garmin:${String(sportType || '').trim().toLowerCase()}:${String(localSessionId || '').trim()}`;
}

async function hasImportedGarminSession(localSessionId: string, sportType: string): Promise<boolean> {
  if (!localSessionId) return false;
  const raw = await AsyncStorage.getItem(GARMIN_IMPORTED_SESSION_IDS_KEY);
  const rows = safeParseJson<string[]>(raw, []);
  if (!Array.isArray(rows) || rows.length === 0) return false;
  return rows.includes(garminImportLedgerKey(localSessionId, sportType));
}

async function markImportedGarminSession(localSessionId: string, sportType: string): Promise<void> {
  if (!localSessionId) return;
  const raw = await AsyncStorage.getItem(GARMIN_IMPORTED_SESSION_IDS_KEY);
  const rows = safeParseJson<string[]>(raw, []);
  const next = Array.isArray(rows) ? [...rows] : [];
  const key = garminImportLedgerKey(localSessionId, sportType);
  if (next.includes(key)) return;
  next.push(key);
  // Cap the ledger so it can't grow unbounded.
  const capped = next.length > MAX_IMPORTED_SESSION_IDS ? next.slice(next.length - MAX_IMPORTED_SESSION_IDS) : next;
  await AsyncStorage.setItem(GARMIN_IMPORTED_SESSION_IDS_KEY, JSON.stringify(capped));
}

export type GarminLocalImportResult =
  | { ok: true; kind: 'run' | 'lift'; localSessionId: string }
  | { ok: false; error: string };

// Garmin P0-prep: local-first import of a saved workout summary (summary-only, no route polyline).
// This does not require Supabase and is safe to use as a simulator entry point.
export async function importGarminWorkoutSummaryLocal(summary: GarminWorkoutSummary): Promise<GarminLocalImportResult> {
  const localSessionId = String(summary?.localSessionId || '').trim();
  const sportType = String(summary?.sportType || '').trim().toLowerCase();
  if (!localSessionId) return { ok: false, error: 'Missing localSessionId.' };
  if (!sportType) return { ok: false, error: 'Missing sportType.' };

  // Idempotency ledger (P0): prevents double-awarding even if history shapes change later.
  if (await hasImportedGarminSession(localSessionId, sportType)) {
    await appendGarminEventLog(`Ignored duplicate Garmin import (${localSessionId}).`);
    if (sportType === 'run' || sportType === 'running') return { ok: true, kind: 'run', localSessionId };
    if (sportType === 'lift' || sportType === 'strength' || sportType === 'traditional_strength')
      return { ok: true, kind: 'lift', localSessionId };
    return { ok: false, error: `Unsupported sportType: ${sportType}` };
  }

  await queuePendingGarminWorkout({
    ...summary,
    localSessionId,
    sportType,
    startTimestamp: safeIso(summary.startTimestamp),
    endTimestamp: safeIso(summary.endTimestamp),
    elapsedTimeSeconds: Math.max(0, Math.round(safeNumber(summary.elapsedTimeSeconds, 0))),
    distanceMeters: summary.distanceMeters == null ? null : Math.max(0, safeNumber(summary.distanceMeters, 0)),
    avgHeartRate: summary.avgHeartRate == null ? null : Math.max(0, Math.round(safeNumber(summary.avgHeartRate, 0))),
    calories: summary.calories == null ? null : Math.max(0, Math.round(safeNumber(summary.calories, 0))),
    fitFileSaved: Boolean(summary.fitFileSaved),
    source: 'garmin_watch',
  });

  try {
    if (sportType === 'run' || sportType === 'running') {
      await commitGarminFinalizedRun({
        localSessionId,
        startTimestamp: safeIso(summary.startTimestamp),
        endTimestamp: safeIso(summary.endTimestamp),
        elapsedTimeSeconds: Math.max(0, Math.round(safeNumber(summary.elapsedTimeSeconds, 0))),
        distanceMeters: summary.distanceMeters == null ? null : Math.max(0, safeNumber(summary.distanceMeters, 0)),
        calories: summary.calories == null ? null : Math.max(0, Math.round(safeNumber(summary.calories, 0))),
        sessionRecovered: summary.sessionRecovered === true,
        recoveryReason: summary.recoveryReason == null ? null : String(summary.recoveryReason),
        recoveryDetectedAt: summary.recoveryDetectedAt == null ? null : safeIso(summary.recoveryDetectedAt),
        recoveryNotes: summary.recoveryNotes == null ? null : String(summary.recoveryNotes),
        hrAvailable: summary.hrAvailable,
        avgHeartRateBpm:
          summary.avgHeartRate == null ? null : Math.max(0, Math.round(safeNumber(summary.avgHeartRate, 0))),
        maxHeartRateBpm:
          summary.maxHeartRate == null ? null : Math.max(0, Math.round(safeNumber(summary.maxHeartRate, 0))),
        hrCoverageRatio:
          summary.hrCoverageRatio == null ? null : Math.max(0, Math.min(1, safeNumber(summary.hrCoverageRatio, 0))),
      });
      const dayKey = assignSessionDayKey(safeIso(summary.startTimestamp), safeIso(summary.endTimestamp));
      clearDailyMetricCache(dayKey);
      await settleBehaviorDay(dayKey);
      await markImportedGarminSession(localSessionId, sportType);
      await consumePendingGarminWorkout(localSessionId);
      await appendGarminEventLog(`Imported Garmin run summary locally (${localSessionId}).`);
      return { ok: true, kind: 'run', localSessionId };
    }

    if (sportType === 'lift' || sportType === 'strength' || sportType === 'traditional_strength') {
      await saveLiftTagSession({
        sessionId: localSessionId,
        startTimeUtc: safeIso(summary.startTimestamp),
        endTimeUtc: safeIso(summary.endTimestamp),
        activeCalories: summary.calories == null ? 0 : Math.max(0, Math.round(safeNumber(summary.calories, 0))),
        avgHeartRate:
          summary.hrAvailable === true && summary.avgHeartRate != null
            ? Math.max(0, Math.round(safeNumber(summary.avgHeartRate, 0)))
            : undefined,
        peakHeartRate: undefined,
        setCount: undefined,
        sourceAuthority: 'import',
        importedSource: 'garmin_watch',
      });
      const dayKey = assignSessionDayKey(safeIso(summary.startTimestamp), safeIso(summary.endTimestamp));
      clearDailyMetricCache(dayKey);
      await settleBehaviorDay(dayKey);
      await markImportedGarminSession(localSessionId, sportType);
      await consumePendingGarminWorkout(localSessionId);
      await appendGarminEventLog(`Imported Garmin lift summary locally (${localSessionId}).`);
      return { ok: true, kind: 'lift', localSessionId };
    }

    await appendGarminEventLog(`Skipped Garmin summary import: unsupported sportType=${sportType} (${localSessionId}).`);
    return { ok: false, error: `Unsupported sportType: ${sportType}` };
  } catch (err: any) {
    const message = String(err?.message || err || 'Unknown import error');
    await appendGarminEventLog(`Garmin local import failed (${localSessionId}): ${message}`);
    return { ok: false, error: message };
  }
}
