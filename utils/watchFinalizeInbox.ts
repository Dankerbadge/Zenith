import { NativeModules, Platform } from 'react-native';

type FinalizeInboxRow = {
  kind?: string;
  finalizeId?: string;
  sessionId?: string;
  storedAt?: string;
  runEnvironment?: string;
  routeStatus?: 'none' | 'summary_only' | 'complete' | string;
  needsRoutePreview?: boolean;
  routePointCount?: number;
  hasRoutePoints?: boolean;
};

type FinalizeInboxSummaryResult =
  | { ok: true; rows: FinalizeInboxRow[] }
  | { ok: false; reason: 'unsupported' | 'native_unavailable' | 'error'; message?: string };

type FinalizeInboxReemitResult =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; reason: 'unsupported' | 'native_unavailable' | 'error'; message?: string };

type FinalizeInboxActionResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'native_unavailable' | 'error'; message?: string };

type RunControlNativeModule = {
  getFinalizeInboxSummary?: () => Promise<FinalizeInboxRow[]>;
  reemitFinalizeInbox?: () => Promise<Record<string, unknown>>;
  requestWatchFinalizeResend?: (payload: Record<string, unknown>) => Promise<boolean>;
  requestWatchRoutePreview?: (payload: Record<string, unknown>) => Promise<boolean>;
};

const moduleRef = (NativeModules.RunControlNativeBridge || {}) as RunControlNativeModule;

export async function getFinalizeInboxSummary(): Promise<FinalizeInboxSummaryResult> {
  if (Platform.OS !== 'ios') return { ok: false, reason: 'unsupported' };
  if (!NativeModules.RunControlNativeBridge || !moduleRef.getFinalizeInboxSummary) {
    return { ok: false, reason: 'native_unavailable' };
  }
  try {
    const rows = await moduleRef.getFinalizeInboxSummary();
    return { ok: true, rows: Array.isArray(rows) ? rows : [] };
  } catch (err: any) {
    return { ok: false, reason: 'error', message: String(err?.message || err) };
  }
}

export async function reemitFinalizeInbox(): Promise<FinalizeInboxReemitResult> {
  if (Platform.OS !== 'ios') return { ok: false, reason: 'unsupported' };
  if (!NativeModules.RunControlNativeBridge || !moduleRef.reemitFinalizeInbox) {
    return { ok: false, reason: 'native_unavailable' };
  }
  try {
    const result = await moduleRef.reemitFinalizeInbox();
    return { ok: true, result: result || {} };
  } catch (err: any) {
    return { ok: false, reason: 'error', message: String(err?.message || err) };
  }
}

export async function requestWatchFinalizeResend(input: { sessionId: string; finalizeId: string }): Promise<FinalizeInboxActionResult> {
  if (Platform.OS !== 'ios') return { ok: false, reason: 'unsupported' };
  if (!NativeModules.RunControlNativeBridge || !moduleRef.requestWatchFinalizeResend) {
    return { ok: false, reason: 'native_unavailable' };
  }
  try {
    await moduleRef.requestWatchFinalizeResend({ sessionId: input.sessionId, finalizeId: input.finalizeId });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: 'error', message: String(err?.message || err) };
  }
}

export async function requestWatchRoutePreview(input: { sessionId: string; finalizeId: string }): Promise<FinalizeInboxActionResult> {
  if (Platform.OS !== 'ios') return { ok: false, reason: 'unsupported' };
  if (!NativeModules.RunControlNativeBridge || !moduleRef.requestWatchRoutePreview) {
    return { ok: false, reason: 'native_unavailable' };
  }
  try {
    await moduleRef.requestWatchRoutePreview({ sessionId: input.sessionId, finalizeId: input.finalizeId });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: 'error', message: String(err?.message || err) };
  }
}
