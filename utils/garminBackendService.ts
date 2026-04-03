import { API_ENDPOINTS } from './appConfig';
import { getGarminEntitlementCache, setGarminEntitlementCache } from './garminCompanionService';
import type { GarminEntitlementState, GarminWorkoutSummary } from './garminProtocol';
import Constants from 'expo-constants';

type GarminBackendResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number };

export type GarminLinkTokenResponse = {
  linkToken: string;
  expiresAt: string;
};

export type GarminLinkStatusResponse = {
  linked: boolean;
  watchAppInstallId: string;
  linkHandle: string;
};

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 400;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const CONFIGURED_GARMIN_BASE = process.env.EXPO_PUBLIC_GARMIN_API_BASE_URL?.trim();

function readExtra(key: string): string {
  const extra =
    (Constants.expoConfig as any)?.extra ||
    (Constants.manifest2 as any)?.extra ||
    (Constants.manifest as any)?.extra ||
    null;
  const value = extra ? (extra as any)[key] : undefined;
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return String(value);
}

const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL || readExtra('EXPO_PUBLIC_SUPABASE_URL') || '').trim();
const SUPABASE_ANON_KEY = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || readExtra('EXPO_PUBLIC_SUPABASE_ANON_KEY') || '').trim();

type GarminBackendMode = 'rest_api' | 'supabase_edge' | 'unconfigured';

function isPlaceholder(value: string) {
  return value.includes('placeholder') || value.includes('example');
}

function getBackendMode(): GarminBackendMode {
  if (CONFIGURED_GARMIN_BASE && !isPlaceholder(CONFIGURED_GARMIN_BASE)) return 'rest_api';
  if (SUPABASE_URL && !isPlaceholder(SUPABASE_URL)) return 'supabase_edge';
  const fallback = API_ENDPOINTS.BASE_URL;
  if (fallback && fallback.startsWith('http') && !isPlaceholder(fallback)) return 'rest_api';
  return 'unconfigured';
}

function getBaseUrl() {
  const mode = getBackendMode();
  if (mode === 'rest_api') {
    return CONFIGURED_GARMIN_BASE && !isPlaceholder(CONFIGURED_GARMIN_BASE) ? CONFIGURED_GARMIN_BASE : API_ENDPOINTS.BASE_URL;
  }
  if (mode === 'supabase_edge' && SUPABASE_URL) {
    return `${SUPABASE_URL}/functions/v1`;
  }
  return '';
}

function isBackendConfigured() {
  return getBackendMode() !== 'unconfigured';
}

function resolvePath(path: string) {
  if (getBackendMode() === 'supabase_edge') {
    if (path === '/wearables/garmin/entitlement') return '/garmin-entitlement';
    if (path === '/wearables/garmin/link-token') return '/garmin-link-token';
    if (path === '/wearables/garmin/link-confirm') return '/garmin-link-confirm';
    if (path === '/wearables/garmin/workouts/upsert') return '/garmin-workout-upsert';
  }
  return path;
}

function normalizeHeaders(input?: HeadersInit) {
  const out: Record<string, string> = {};
  if (!input) return out;
  const headers = new Headers(input);
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

async function fetchJson<T>(path: string, options: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<GarminBackendResult<T>> {
  if (!isBackendConfigured()) {
    return { ok: false, error: 'Garmin backend endpoint is not configured.' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...normalizeHeaders(options.headers),
  };
  if (getBackendMode() === 'supabase_edge' && SUPABASE_ANON_KEY && !isPlaceholder(SUPABASE_ANON_KEY)) {
    headers.apikey = SUPABASE_ANON_KEY;
  }

  try {
    const response = await fetch(`${getBaseUrl()}${resolvePath(path)}`, {
      ...options,
      signal: controller.signal,
      headers,
    });

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const message =
        typeof (payload as any)?.error === 'string'
          ? (payload as any).error
          : `Request failed with status ${response.status}`;
      return { ok: false, error: message, status: response.status };
    }

    return { ok: true, data: payload as T };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { ok: false, error: 'Network request timed out.' };
    }
    if (error instanceof Error && error.message) {
      return { ok: false, error: error.message };
    }
    return { ok: false, error: 'Network request failed.' };
  } finally {
    clearTimeout(timer);
  }
}

export function isRetryableGarminBackendError<T>(result: GarminBackendResult<T>) {
  if (result.ok) return false;
  if (typeof result.status === 'number' && RETRYABLE_STATUS.has(result.status)) return true;
  const message = String(result.error || '').toLowerCase();
  return message.includes('timeout') || message.includes('network') || message.includes('temporarily');
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withGarminBackendRetry<T>(
  operation: () => Promise<GarminBackendResult<T>>,
  options?: { attempts?: number; baseDelayMs?: number }
): Promise<GarminBackendResult<T>> {
  const attempts = Math.max(1, Math.floor(options?.attempts ?? DEFAULT_RETRY_ATTEMPTS));
  const baseDelayMs = Math.max(100, Math.floor(options?.baseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS));

  let last: GarminBackendResult<T> | null = null;
  for (let i = 0; i < attempts; i += 1) {
    const result = await operation();
    if (result.ok) return result;
    last = result;
    if (i >= attempts - 1 || !isRetryableGarminBackendError(result)) break;
    await delay(baseDelayMs * (i + 1));
  }
  return (
    last || {
      ok: false,
      error: 'Unknown backend error.',
    }
  );
}

function authHeader(token: string) {
  return {
    Authorization: `Bearer ${token}`,
  };
}

export async function fetchGarminEntitlementFromBackend(accessToken: string): Promise<GarminBackendResult<GarminEntitlementState>> {
  const result = await fetchJson<GarminEntitlementState>('/wearables/garmin/entitlement', {
    method: 'GET',
    headers: authHeader(accessToken),
  });

  if (result.ok) {
    await setGarminEntitlementCache({
      ...result.data,
      source: 'backend',
    });
  }

  return result;
}

export async function getGarminEntitlementSafe(accessToken?: string | null): Promise<GarminEntitlementState> {
  if (accessToken) {
    const remote = await fetchGarminEntitlementFromBackend(accessToken);
    if (remote.ok) return { ...remote.data, source: 'backend' };
  }
  return getGarminEntitlementCache();
}

export async function requestGarminLinkToken(input: {
  accessToken: string;
  watchAppInstallId: string;
}): Promise<GarminBackendResult<GarminLinkTokenResponse>> {
  return fetchJson<GarminLinkTokenResponse>('/wearables/garmin/link-token', {
    method: 'POST',
    headers: authHeader(input.accessToken),
    body: JSON.stringify({ watchAppInstallId: input.watchAppInstallId }),
  });
}

export async function confirmGarminLink(input: {
  accessToken: string;
  watchAppInstallId: string;
  linkToken: string;
}): Promise<GarminBackendResult<GarminLinkStatusResponse>> {
  return fetchJson<GarminLinkStatusResponse>('/wearables/garmin/link-confirm', {
    method: 'POST',
    headers: authHeader(input.accessToken),
    body: JSON.stringify({ watchAppInstallId: input.watchAppInstallId, linkToken: input.linkToken }),
  });
}

export async function upsertGarminWorkoutSummary(input: {
  accessToken: string;
  summary: GarminWorkoutSummary;
}): Promise<GarminBackendResult<{ upserted: boolean; localSessionId: string }>> {
  return fetchJson<{ upserted: boolean; localSessionId: string }>('/wearables/garmin/workouts/upsert', {
    method: 'POST',
    headers: authHeader(input.accessToken),
    body: JSON.stringify(input.summary),
  });
}

export async function upsertGarminWorkoutSummaryWithRetry(
  input: {
    accessToken: string;
    summary: GarminWorkoutSummary;
  },
  options?: { attempts?: number; baseDelayMs?: number }
): Promise<GarminBackendResult<{ upserted: boolean; localSessionId: string }>> {
  return withGarminBackendRetry(() => upsertGarminWorkoutSummary(input), options);
}

export function getGarminBackendReadiness() {
  return {
    configured: isBackendConfigured(),
    mode: getBackendMode(),
    baseUrl: getBaseUrl(),
  };
}
