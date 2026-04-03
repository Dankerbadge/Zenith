import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import {
  getActiveLiftSnapshot,
  upsertActiveLiftSnapshot,
  type LiftCommandRequest,
  type LiftControlState,
  type LiftSnapshot,
} from './liftControlSync';

type LiftControlNativeModule = {
  startLiftLiveActivity?: (payload: Record<string, unknown>) => Promise<void>;
  updateLiftLiveActivity?: (payload: Record<string, unknown>) => Promise<void>;
  endLiftLiveActivity?: (payload?: Record<string, unknown>) => Promise<void>;
  sendLiftWatchCommand?: (payload: Record<string, unknown>) => Promise<void>;
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
  startedAtWatch?: string;
  endedAtWatch?: string | null;
  elapsedTimeSec?: number;
  movingTimeSec?: number;
  pausedTotalSec?: number;
  totalCalories?: number;
  setCount?: number;
  intensityBand?: string;
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
};

type NativeFinalizeEvent = {
  payload?: Record<string, unknown>;
  kind?: string;
  sessionId?: string;
};

export type NativeLiftStateUpdate = {
  snapshot: LiftSnapshot | null;
  clientCommandId?: string;
  accepted?: boolean;
  reasonCode?: string;
  connected?: boolean;
  message?: string;
};

const moduleRef = (NativeModules.LiftControlNativeBridge || {}) as LiftControlNativeModule;
const emitter = Platform.OS === 'ios' && NativeModules.LiftControlEventEmitter ? new NativeEventEmitter(NativeModules.LiftControlEventEmitter) : null;

export function hasLiftNativeControlBridge() {
  return (
    Platform.OS === 'ios' &&
    Boolean(NativeModules.LiftControlNativeBridge) &&
    Boolean(NativeModules.LiftControlEventEmitter)
  );
}

function asNumber(value: unknown, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function asState(value: unknown): LiftControlState | null {
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

function normalizeSnapshot(payload: Record<string, unknown> | undefined): LiftSnapshot | null {
  if (!payload) return null;
  const state = asState(payload.state);
  const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : '';
  if (!sessionId || !state) return null;

  const intensityBandRaw = String(payload.intensityBand || '').toLowerCase();
  const intensityBand: LiftSnapshot['intensityBand'] =
    intensityBandRaw === 'high' ? 'high' : intensityBandRaw === 'moderate' ? 'moderate' : 'low';

  return {
    sessionId,
    state,
    needsRecovery: typeof payload.needsRecovery === 'boolean' ? payload.needsRecovery : undefined,
    recoveryVerified: typeof payload.recoveryVerified === 'boolean' ? payload.recoveryVerified : undefined,
    startedAtWatch: typeof payload.startedAtWatch === 'string' ? payload.startedAtWatch : new Date().toISOString(),
    endedAtWatch: payload.endedAtWatch ? String(payload.endedAtWatch) : null,
    elapsedTimeSec: asNumber(payload.elapsedTimeSec),
    movingTimeSec: asNumber(payload.movingTimeSec),
    pausedTotalSec: asNumber(payload.pausedTotalSec),
    totalCalories: asNumber(payload.totalCalories),
    setCount: Math.max(0, Math.round(asNumber(payload.setCount))),
    intensityBand,
    lastUpdatedAtWatch: typeof payload.lastUpdatedAtWatch === 'string' ? payload.lastUpdatedAtWatch : new Date().toISOString(),
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

function toLiveActivityPayload(snapshot: LiftSnapshot): Record<string, unknown> {
  return {
    sessionId: snapshot.sessionId,
    state: snapshot.state,
    elapsedTimeSec: snapshot.elapsedTimeSec,
    movingTimeSec: snapshot.movingTimeSec,
    pausedTotalSec: snapshot.pausedTotalSec,
    totalCalories: snapshot.totalCalories,
    setCount: snapshot.setCount,
    intensityBand: snapshot.intensityBand,
    seq: snapshot.seq,
    lastUpdatedAtWatch: snapshot.lastUpdatedAtWatch,
  };
}

export async function syncLiftLiveActivityWithSnapshot(snapshot: LiftSnapshot | null): Promise<void> {
  if (!hasLiftNativeControlBridge()) return;
  if (!snapshot) {
    await moduleRef.endLiftLiveActivity?.({});
    return;
  }
  if (snapshot.state === 'saved' || snapshot.state === 'discarded' || snapshot.state === 'idle') {
    await moduleRef.endLiftLiveActivity?.({ sessionId: snapshot.sessionId, state: snapshot.state });
    return;
  }
  if (snapshot.seq <= 1 && snapshot.state === 'recording') {
    await moduleRef.startLiftLiveActivity?.(toLiveActivityPayload(snapshot));
    return;
  }
  await moduleRef.updateLiftLiveActivity?.(toLiveActivityPayload(snapshot));
}

export function subscribeNativeLiftCommands(onCommand: (request: LiftCommandRequest) => void): () => void {
  if (!emitter) return () => {};
  const sub = emitter.addListener('LiftControlCommandRequest', (event: NativeCommandEvent) => {
    if (!event?.sessionId || !event?.commandType || !event?.clientCommandId) return;
    onCommand({
      sessionId: String(event.sessionId),
      commandType: event.commandType as LiftCommandRequest['commandType'],
      clientCommandId: String(event.clientCommandId),
      sentAtPhone: String(event.sentAtPhone || new Date().toISOString()),
      phoneLastSeqKnown: Number(event.phoneLastSeqKnown) || 0,
    });
  });
  return () => sub.remove();
}

export function subscribeNativeLiftStateUpdates(onUpdate: (update: NativeLiftStateUpdate) => void): () => void {
  if (!emitter) return () => {};

  const stateSub = emitter.addListener('LiftControlStateUpdate', (event: NativeStateEvent) => {
    const source = (event.snapshot || event) as Record<string, unknown>;
    const snapshot = normalizeSnapshot(source);
    if (snapshot) void upsertActiveLiftSnapshot(snapshot);
    onUpdate({
      snapshot,
      clientCommandId: typeof event.clientCommandId === 'string' ? event.clientCommandId : undefined,
      accepted: typeof event.accepted === 'boolean' ? event.accepted : undefined,
      reasonCode: typeof event.reasonCode === 'string' ? event.reasonCode : undefined,
    });
  });

  const connectivitySub = emitter.addListener('LiftControlConnectivity', (event: NativeConnectivityEvent) => {
    const connected = Boolean(event.connected);
    if (!connected) {
      void getActiveLiftSnapshot().then((active) => {
        if (!active) return;
        if (active.state === 'saved' || active.state === 'discarded' || active.state === 'idle') return;
        const disconnectedSnapshot: LiftSnapshot = {
          ...active,
          state: 'disconnected',
          seq: active.seq + 1,
          sourceDevice: 'watch',
          reasonCode: 'sync',
          lastUpdatedAtWatch: new Date().toISOString(),
        };
        void upsertActiveLiftSnapshot(disconnectedSnapshot);
        onUpdate({ snapshot: disconnectedSnapshot, connected: false, message: event.message || 'Apple Watch not connected.' });
      });
      return;
    }
    onUpdate({ snapshot: null, connected: true, message: event.message });
  });

  return () => {
    stateSub.remove();
    connectivitySub.remove();
  };
}

export function subscribeNativeLiftFinalize(onFinalize: (payload: Record<string, unknown>) => void): () => void {
  if (!emitter) return () => {};
  const sub = emitter.addListener('LiftControlFinalize', (event: NativeFinalizeEvent) => {
    const payload = (event?.payload || event) as Record<string, unknown>;
    if (!payload || typeof payload !== 'object') return;
    onFinalize(payload);
  });
  return () => sub.remove();
}

export async function sendLiftCommandToWatch(request: LiftCommandRequest): Promise<void> {
  if (!hasLiftNativeControlBridge()) return;
  await moduleRef.sendLiftWatchCommand?.({
    kind: 'lift',
    sessionId: request.sessionId,
    commandType: request.commandType,
    clientCommandId: request.clientCommandId,
    sentAtPhone: request.sentAtPhone,
    phoneLastSeqKnown: request.phoneLastSeqKnown,
  });
}
