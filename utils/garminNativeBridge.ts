import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

export type GarminNativeConnectionState = {
  state: 'disconnected' | 'connecting' | 'connected' | 'bridge_unavailable' | 'feature_disabled' | string;
  isListening: boolean;
  lastError?: string | null;
  timestamp?: string;
};

export type GarminNativeEvent = {
  state?: string;
  code?: string;
  message?: string;
  direction?: 'phone_to_watch' | 'ack' | 'native_signal' | string;
  payload?: Record<string, unknown>;
  type?: string;
  status?: string;
  reason?: string;
  timestamp?: string;
};

type GarminCompanionNativeModule = {
  startListening?: () => Promise<boolean>;
  stopListening?: () => Promise<boolean>;
  sendMessage?: (payload: Record<string, unknown>) => Promise<boolean>;
  requestEntitlementRefresh?: () => Promise<boolean>;
  getConnectionState?: () => Promise<GarminNativeConnectionState>;
};

const moduleRef = (NativeModules.GarminCompanionNativeBridge || {}) as GarminCompanionNativeModule;
const emitter =
  Platform.OS === 'ios' && NativeModules.GarminCompanionEventEmitter
    ? new NativeEventEmitter(NativeModules.GarminCompanionEventEmitter)
    : null;

export function hasGarminNativeBridge() {
  return Platform.OS === 'ios' && Boolean(NativeModules.GarminCompanionNativeBridge) && Boolean(NativeModules.GarminCompanionEventEmitter);
}

export async function startGarminNativeListening() {
  if (!hasGarminNativeBridge()) return false;
  return moduleRef.startListening ? moduleRef.startListening() : false;
}

export async function stopGarminNativeListening() {
  if (!hasGarminNativeBridge()) return false;
  return moduleRef.stopListening ? moduleRef.stopListening() : false;
}

export async function sendGarminNativeMessage(payload: Record<string, unknown>) {
  if (!hasGarminNativeBridge()) return false;
  return moduleRef.sendMessage ? moduleRef.sendMessage(payload) : false;
}

export async function requestGarminNativeEntitlementRefresh() {
  if (!hasGarminNativeBridge()) return false;
  return moduleRef.requestEntitlementRefresh ? moduleRef.requestEntitlementRefresh() : false;
}

export async function getGarminNativeConnectionState(): Promise<GarminNativeConnectionState> {
  if (!hasGarminNativeBridge()) {
    return {
      state: 'bridge_unavailable',
      isListening: false,
      lastError: 'Garmin native bridge unavailable on this platform/build.',
      timestamp: new Date().toISOString(),
    };
  }

  if (!moduleRef.getConnectionState) {
    return {
      state: 'bridge_unavailable',
      isListening: false,
      lastError: 'Garmin native bridge getConnectionState not implemented.',
      timestamp: new Date().toISOString(),
    };
  }

  return moduleRef.getConnectionState();
}

export function subscribeGarminNativeStateUpdates(onEvent: (event: GarminNativeEvent) => void): () => void {
  if (!emitter) return () => {};
  const sub = emitter.addListener('GarminCompanionStateUpdate', (event: GarminNativeEvent) => {
    onEvent(event || {});
  });
  return () => sub.remove();
}

export function subscribeGarminNativeMessages(onEvent: (event: GarminNativeEvent) => void): () => void {
  if (!emitter) return () => {};
  const sub = emitter.addListener('GarminCompanionMessage', (event: GarminNativeEvent) => {
    onEvent(event || {});
  });
  return () => sub.remove();
}

export function subscribeGarminNativeErrors(onEvent: (event: GarminNativeEvent) => void): () => void {
  if (!emitter) return () => {};
  const sub = emitter.addListener('GarminCompanionError', (event: GarminNativeEvent) => {
    onEvent(event || {});
  });
  return () => sub.remove();
}
