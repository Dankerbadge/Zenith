import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import {
  getActiveRunSnapshot,
  upsertActiveRunSnapshot,
  type RunCommandRequest,
  type RunControlState,
  type RunSnapshot,
} from './runControlSync';

type RunControlNativeModule = {
  startLiveActivity?: (payload: Record<string, unknown>) => Promise<void>;
  updateLiveActivity?: (payload: Record<string, unknown>) => Promise<void>;
  endLiveActivity?: (payload?: Record<string, unknown>) => Promise<void>;
  sendWatchCommand?: (payload: Record<string, unknown>) => Promise<void>;
  sendTreadmillCalibrationFactor?: (factor: number) => Promise<void>;
  sendTreadmillCalibrationUpdate?: (payload: Record<string, unknown>) => Promise<void>;
  sendWatchWorkoutCarouselOrder?: (payload: Record<string, unknown>) => Promise<void>;
  getRoutePreviewDraft?: (sessionId: string) => Promise<Record<string, unknown> | null>;
};

type NativeCommandEvent = {
  sessionId?: string;
  commandType?: string;
  clientCommandId?: string;
  sentAtPhone?: string;
  phoneLastSeqKnown?: number;
};

type NativeStateEvent = {
  snapshot?: Record<string, unknown>;
  sessionId?: string;
  state?: string;
  runEnvironment?: string;
  startedAtWatch?: string;
  endedAtWatch?: string | null;
  elapsedTimeSec?: number;
  movingTimeSec?: number;
  pausedTotalSec?: number;
  totalDistanceMiles?: number;
  paceMinPerMile?: number | null;
  totalCalories?: number;
  avgHrBpm?: number;
  maxHrBpm?: number;
  lastUpdatedAtWatch?: string;
  seq?: number;
  sourceDevice?: 'watch' | 'phone';
  reasonCode?: string;
  clientCommandId?: string;
  accepted?: boolean;
};

type NativeConnectivityEvent = {
  connected?: boolean;
  message?: string;
  state?: number;
};

type NativeFinalizeEvent = {
  payload?: Record<string, unknown>;
  kind?: string;
  sessionId?: string;
};

type NativeCalibrationAckEvent = {
  factorApplied?: number;
  appliedAtUtc?: string;
  nonce?: string;
  status?: string;
};

type NativeRoutePreviewDraftEvent = {
  sessionId?: string;
  finalizeId?: string;
  pointCount?: number;
  hasGap?: boolean;
  pointsE6?: number[][];
  minLatE6?: number;
  minLonE6?: number;
  maxLatE6?: number;
  maxLonE6?: number;
  schemaVersion?: number;
};

export type NativeRunStateUpdate = {
  snapshot: RunSnapshot | null;
  clientCommandId?: string;
  accepted?: boolean;
  reasonCode?: string;
  connected?: boolean;
  message?: string;
};

const moduleRef = (NativeModules.RunControlNativeBridge || {}) as RunControlNativeModule;
const emitter = Platform.OS === 'ios' && NativeModules.RunControlEventEmitter ? new NativeEventEmitter(NativeModules.RunControlEventEmitter) : null;

export function hasRunNativeControlBridge() {
  return (
    Platform.OS === 'ios' &&
    Boolean(NativeModules.RunControlNativeBridge) &&
    Boolean(NativeModules.RunControlEventEmitter)
  );
}

function asNumber(value: unknown, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function asState(value: unknown): RunControlState | null {
  const next = String(value || '');
  if (
    next === 'idle' ||
    next === 'recording' ||
    next === 'paused' ||
    next === 'endingConfirm' ||
    next === 'ended' ||
    next === 'saved' ||
    next === 'discarded' ||
    next === 'disconnected'
  ) {
    return next;
  }
  return null;
}

function normalizeSnapshot(payload: Record<string, unknown> | undefined): RunSnapshot | null {
  if (!payload) return null;
  const state = asState(payload.state);
  const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : '';
  if (!sessionId || !state) return null;

  const runEnvironmentRaw = typeof payload.runEnvironment === 'string' ? payload.runEnvironment : '';
  const runEnvironment =
    runEnvironmentRaw === 'treadmill' || runEnvironmentRaw === 'outdoor' ? (runEnvironmentRaw as RunSnapshot['runEnvironment']) : undefined;
  const rawDistanceMiles =
    payload.rawDistanceMiles === null || payload.rawDistanceMiles === undefined ? undefined : asNumber(payload.rawDistanceMiles, 0);
  const treadmillCalibrationFactorUsed =
    payload.treadmillCalibrationFactorUsed === null || payload.treadmillCalibrationFactorUsed === undefined
      ? undefined
      : asNumber(payload.treadmillCalibrationFactorUsed, 0);

  const totalCaloriesRaw = payload.totalCalories;
  const totalCalories =
    totalCaloriesRaw === null || totalCaloriesRaw === undefined ? undefined : Math.max(0, Math.round(asNumber(totalCaloriesRaw)));

  const avgHrRaw = payload.avgHrBpm;
  const avgHrBpm =
    avgHrRaw === null || avgHrRaw === undefined ? undefined : Math.max(0, Math.round(asNumber(avgHrRaw)));

  const maxHrRaw = payload.maxHrBpm;
  const maxHrBpm =
    maxHrRaw === null || maxHrRaw === undefined ? undefined : Math.max(0, Math.round(asNumber(maxHrRaw)));

  return {
    sessionId,
    state,
    needsRecovery: typeof payload.needsRecovery === 'boolean' ? payload.needsRecovery : undefined,
    recoveryVerified: typeof payload.recoveryVerified === 'boolean' ? payload.recoveryVerified : undefined,
    runEnvironment,
    rawDistanceMiles,
    treadmillCalibrationFactorUsed,
    startedAtWatch:
      typeof payload.startedAtWatch === 'string' ? payload.startedAtWatch : new Date().toISOString(),
    endedAtWatch: payload.endedAtWatch ? String(payload.endedAtWatch) : null,
    elapsedTimeSec: asNumber(payload.elapsedTimeSec),
    movingTimeSec: asNumber(payload.movingTimeSec),
    pausedTotalSec: asNumber(payload.pausedTotalSec),
    totalDistanceMiles: asNumber(payload.totalDistanceMiles),
    paceMinPerMile:
      payload.paceMinPerMile === null || payload.paceMinPerMile === undefined
        ? null
        : asNumber(payload.paceMinPerMile),
    totalCalories,
    avgHrBpm,
    maxHrBpm,
    lastUpdatedAtWatch:
      typeof payload.lastUpdatedAtWatch === 'string'
        ? payload.lastUpdatedAtWatch
        : new Date().toISOString(),
    seq: asNumber(payload.seq, 0),
    sourceDevice: payload.sourceDevice === 'phone' ? 'phone' : 'watch',
    reasonCode:
      payload.reasonCode === 'stateChange' ||
      payload.reasonCode === 'tick' ||
      payload.reasonCode === 'metricThreshold' ||
      payload.reasonCode === 'ackResponse' ||
      payload.reasonCode === 'sync' ||
      payload.reasonCode === 'manual'
        ? payload.reasonCode
        : 'sync',
  };
}

function toLiveActivityPayload(snapshot: RunSnapshot): Record<string, unknown> {
  return {
    sessionId: snapshot.sessionId,
    state: snapshot.state,
    elapsedTimeSec: snapshot.elapsedTimeSec,
    movingTimeSec: snapshot.movingTimeSec,
    pausedTotalSec: snapshot.pausedTotalSec,
    totalDistanceMiles: snapshot.totalDistanceMiles,
    paceMinPerMile: snapshot.paceMinPerMile,
    seq: snapshot.seq,
    lastUpdatedAtWatch: snapshot.lastUpdatedAtWatch,
  };
}

export async function syncLiveActivityWithSnapshot(snapshot: RunSnapshot | null): Promise<void> {
  if (!hasRunNativeControlBridge()) return;
  if (!snapshot) {
    await moduleRef.endLiveActivity?.({});
    return;
  }
  if (snapshot.state === 'saved' || snapshot.state === 'discarded' || snapshot.state === 'idle') {
    await moduleRef.endLiveActivity?.({ sessionId: snapshot.sessionId, state: snapshot.state });
    return;
  }
  if (snapshot.seq <= 1 && snapshot.state === 'recording') {
    await moduleRef.startLiveActivity?.(toLiveActivityPayload(snapshot));
    return;
  }
  await moduleRef.updateLiveActivity?.(toLiveActivityPayload(snapshot));
}

export function subscribeNativeRunCommands(onCommand: (request: RunCommandRequest) => void): () => void {
  if (!emitter) return () => {};
  const sub = emitter.addListener('RunControlCommandRequest', (event: NativeCommandEvent) => {
    if (!event?.sessionId || !event?.commandType || !event?.clientCommandId) return;
    onCommand({
      sessionId: String(event.sessionId),
      commandType: event.commandType as RunCommandRequest['commandType'],
      clientCommandId: String(event.clientCommandId),
      sentAtPhone: String(event.sentAtPhone || new Date().toISOString()),
      phoneLastSeqKnown: Number(event.phoneLastSeqKnown) || 0,
    });
  });
  return () => sub.remove();
}

export function subscribeNativeRunStateUpdates(onUpdate: (update: NativeRunStateUpdate) => void): () => void {
  if (!emitter) return () => {};

  const stateSub = emitter.addListener('RunControlStateUpdate', (event: NativeStateEvent) => {
    const source = (event.snapshot || event) as Record<string, unknown>;
    const snapshot = normalizeSnapshot(source);
    if (snapshot) {
      void upsertActiveRunSnapshot(snapshot);
    }
    onUpdate({
      snapshot,
      clientCommandId: typeof event.clientCommandId === 'string' ? event.clientCommandId : undefined,
      accepted: typeof event.accepted === 'boolean' ? event.accepted : undefined,
      reasonCode: typeof event.reasonCode === 'string' ? event.reasonCode : undefined,
    });
  });

  const connectivitySub = emitter.addListener('RunControlConnectivity', (event: NativeConnectivityEvent) => {
    const connected = Boolean(event.connected);
    if (!connected) {
      void getActiveRunSnapshot().then((active) => {
        if (!active) return;
        if (active.state === 'saved' || active.state === 'discarded' || active.state === 'idle') return;
        const disconnectedSnapshot: RunSnapshot = {
          ...active,
          state: 'disconnected',
          seq: active.seq + 1,
          sourceDevice: 'watch',
          reasonCode: 'sync',
          lastUpdatedAtWatch: new Date().toISOString(),
        };
        void upsertActiveRunSnapshot(disconnectedSnapshot);
        onUpdate({
          snapshot: disconnectedSnapshot,
          connected: false,
          message: event.message || 'Apple Watch not connected.',
        });
      });
      return;
    }
    onUpdate({
      snapshot: null,
      connected: true,
      message: event.message,
    });
  });

  return () => {
    stateSub.remove();
    connectivitySub.remove();
  };
}

export function subscribeNativeRunFinalize(onFinalize: (payload: Record<string, unknown>) => void): () => void {
  if (!emitter) return () => {};
  const sub = emitter.addListener('RunControlFinalize', (event: NativeFinalizeEvent) => {
    const payload = (event?.payload || event) as Record<string, unknown>;
    if (!payload || typeof payload !== 'object') return;
    onFinalize(payload);
  });
  return () => sub.remove();
}

export function subscribeNativeRoutePreviewDrafts(
  onDraft: (draft: NativeRoutePreviewDraftEvent) => void
): () => void {
  if (!emitter) return () => {};
  const sub = emitter.addListener('RunControlRoutePreviewDraft', (event: NativeRoutePreviewDraftEvent) => {
    onDraft(event || {});
  });
  return () => sub.remove();
}

export async function getNativeRoutePreviewDraft(sessionId: string): Promise<NativeRoutePreviewDraftEvent | null> {
  if (!hasRunNativeControlBridge()) return null;
  if (!moduleRef.getRoutePreviewDraft) return null;
  if (!sessionId) return null;
  try {
    const raw = await moduleRef.getRoutePreviewDraft(sessionId);
    if (!raw || typeof raw !== 'object') return null;
    return raw as NativeRoutePreviewDraftEvent;
  } catch {
    return null;
  }
}

export function subscribeTreadmillCalibrationAcks(
  onAck: (ack: { factorApplied: number; appliedAtUtc: string; nonce: string; status: string }) => void
): () => void {
  if (!emitter) return () => {};
  const sub = emitter.addListener('RunControlCalibrationAck', (event: NativeCalibrationAckEvent) => {
    const nonce = typeof event?.nonce === 'string' ? event.nonce : '';
    const status = typeof event?.status === 'string' ? event.status : '';
    const appliedAtUtc = typeof event?.appliedAtUtc === 'string' ? event.appliedAtUtc : new Date().toISOString();
    const factorApplied = Number(event?.factorApplied);
    if (!nonce || !status || !Number.isFinite(factorApplied) || factorApplied <= 0) return;
    onAck({ nonce, status, appliedAtUtc, factorApplied });
  });
  return () => sub.remove();
}

export async function sendCommandToWatch(request: RunCommandRequest): Promise<void> {
  if (!hasRunNativeControlBridge()) return;
  await moduleRef.sendWatchCommand?.({
    kind: 'run',
    sessionId: request.sessionId,
    commandType: request.commandType,
    clientCommandId: request.clientCommandId,
    sentAtPhone: request.sentAtPhone,
    phoneLastSeqKnown: request.phoneLastSeqKnown,
  });
}

export async function pushTreadmillCalibrationFactorToWatch(factor: number): Promise<void> {
  if (!hasRunNativeControlBridge()) return;
  if (!Number.isFinite(factor) || factor < 0.7 || factor > 1.3) return;
  await moduleRef.sendTreadmillCalibrationFactor?.(factor);
}

export async function pushTreadmillCalibrationUpdateToWatch(input: {
  factor: number;
  updatedAtUtc: string;
  nonce: string;
  sourceSessionId?: string;
}): Promise<void> {
  if (!hasRunNativeControlBridge()) return;
  if (!Number.isFinite(input.factor) || input.factor < 0.7 || input.factor > 1.3) return;
  if (!input.nonce) return;
  await moduleRef.sendTreadmillCalibrationUpdate?.({
    factor: input.factor,
    updatedAtUtc: input.updatedAtUtc,
    nonce: input.nonce,
    sourceSessionId: input.sourceSessionId,
  });
}

export async function pushWatchWorkoutCarouselOrderToWatch(order: string[]): Promise<void> {
  if (!hasRunNativeControlBridge()) return;
  const normalized = Array.isArray(order) ? order.map((v) => String(v || '').trim()).filter(Boolean) : [];
  // Keep payload small; the watch carousel is not meant to be dozens of pages.
  const capped = normalized.slice(0, 12);
  await moduleRef.sendWatchWorkoutCarouselOrder?.({ order: capped });
}
