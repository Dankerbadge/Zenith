import AsyncStorage from '@react-native-async-storage/async-storage';
import { isSupabaseConfigured, supabase } from './supabaseClient';
import { APP_CONFIG } from './appConfig';
import { captureException } from './crashReporter';

const CLOUD_STATE_QUEUE_KEY = 'cloud_state_sync_queue_v1';
const CLOUD_STATE_LAST_FLUSH_AT_KEY = 'cloud_state_last_flush_at_v1';
const CLOUD_STATE_LAST_RESULT_KEY = 'cloud_state_last_result_v1';
const CLOUD_STATE_LAST_PARITY_KEY = 'cloud_state_last_parity_v1';
const DAILY_LOG_PREFIX = 'dailyLog_';
const USER_PROFILE_PREFIX = 'userProfile:';
const LEGACY_USER_PROFILE_KEY = 'userProfile';
const WEIGHT_LOG_KEY = 'weightLog';

type QueuePayload = Record<string, string | null>;
type CloudSyncLastResult = {
  at: string;
  flushed: number;
  skipped: boolean;
  reason: string;
};
type CloudSyncParityResult = {
  at: string;
  attempted: number;
  succeeded: number;
  failed: number;
  failureKeys: string[];
  parityRate: number;
};
export type CloudStateSyncDiagnostics = {
  enabled: boolean;
  queueSize: number;
  queuedKeys: string[];
  lastFlushAt: string | null;
  lastResult: CloudSyncLastResult | null;
  lastParity: CloudSyncParityResult | null;
};

export function isCloudSyncEnabled(): boolean {
  return Boolean(APP_CONFIG.FEATURES.CLOUD_SYNC_ENABLED);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isCloudStateSyncKey(key: string): boolean {
  if (!key) return false;
  return (
    key.startsWith(DAILY_LOG_PREFIX) ||
    key.startsWith(USER_PROFILE_PREFIX) ||
    key === LEGACY_USER_PROFILE_KEY ||
    key === WEIGHT_LOG_KEY
  );
}

function serializeStateValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

async function readQueue(): Promise<QueuePayload> {
  try {
    const raw = await AsyncStorage.getItem(CLOUD_STATE_QUEUE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return isObject(parsed) ? (parsed as QueuePayload) : {};
  } catch {
    return {};
  }
}

async function writeQueue(queue: QueuePayload): Promise<void> {
  try {
    if (Object.keys(queue).length === 0) {
      await AsyncStorage.removeItem(CLOUD_STATE_QUEUE_KEY);
      return;
    }
    await AsyncStorage.setItem(CLOUD_STATE_QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // ignore
  }
}

async function writeLastResult(result: CloudSyncLastResult): Promise<void> {
  try {
    await AsyncStorage.setItem(CLOUD_STATE_LAST_RESULT_KEY, JSON.stringify(result));
  } catch (error) {
    if (!__DEV__) void captureException(error, { feature: 'cloud_sync', op: 'write_last_result' });
  }
}

async function writeLastParity(result: CloudSyncParityResult): Promise<void> {
  try {
    await AsyncStorage.setItem(CLOUD_STATE_LAST_PARITY_KEY, JSON.stringify(result));
  } catch (error) {
    if (!__DEV__) void captureException(error, { feature: 'cloud_sync', op: 'write_last_parity' });
  }
}

function parseDayFromStateKey(stateKey: string): string | null {
  const match = String(stateKey || '').match(/^dailyLog_(\d{4}-\d{2}-\d{2})$/);
  return match ? match[1] : null;
}

function stableHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function buildClientEventId(stateKey: string, raw: string | null): string {
  const source = `${stateKey}|${String(raw || '')}`;
  return `${stateKey}:${stableHash(source)}`;
}

export async function enqueueCloudStateSyncWrite(key: string, value: unknown): Promise<void> {
  if (!isCloudStateSyncKey(key)) return;
  const serialized = serializeStateValue(value);
  const queue = await readQueue();
  queue[key] = serialized;
  await writeQueue(queue);
}

export async function enqueueCloudStateSyncRemove(key: string): Promise<void> {
  if (!isCloudStateSyncKey(key)) return;
  const queue = await readQueue();
  queue[key] = null;
  await writeQueue(queue);
}

export async function flushCloudStateSyncQueue(
  reason: 'open' | 'foreground' | 'background' | 'interval' | 'manual' = 'manual'
): Promise<{ flushed: number; skipped: boolean; reason: string }> {
  if (!isCloudSyncEnabled()) {
    const result = { flushed: 0, skipped: true, reason: 'feature_disabled' };
    await writeLastResult({ at: new Date().toISOString(), ...result });
    return result;
  }
  if (!isSupabaseConfigured) {
    const result = { flushed: 0, skipped: true, reason: 'supabase_not_configured' };
    await writeLastResult({ at: new Date().toISOString(), ...result });
    return result;
  }

  const queue = await readQueue();
  const keys = Object.keys(queue);
  if (keys.length === 0) {
    const result = { flushed: 0, skipped: true, reason: 'empty_queue' };
    await writeLastResult({ at: new Date().toISOString(), ...result });
    return result;
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData.session?.user?.id) {
    const result = { flushed: 0, skipped: true, reason: 'no_session' };
    await writeLastResult({ at: new Date().toISOString(), ...result });
    return result;
  }
  const userId = sessionData.session.user.id;

  const prepared = keys.map((stateKey) => {
    const raw = queue[stateKey];
    let parsed: unknown = null;
    if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = { raw };
      }
    }
    return {
      stateKey,
      raw,
      parsed,
    };
  });

  const rows = prepared.map((entry) => ({
      user_id: userId,
      state_key: entry.stateKey,
      state_value: entry.parsed,
      updated_at: new Date().toISOString(),
    }));

  const { error: upsertError } = await supabase.from('user_state_snapshots').upsert(rows, {
    onConflict: 'user_id,state_key',
  });
  if (upsertError) {
    const result = { flushed: 0, skipped: true, reason: `upsert_failed:${String(upsertError.message || 'unknown')}` };
    await writeLastResult({ at: new Date().toISOString(), ...result });
    return result;
  }

  const parityFailures: string[] = [];
  let parityAttempts = 0;
  let paritySuccess = 0;
  for (const entry of prepared) {
    if (!entry.stateKey.startsWith(DAILY_LOG_PREFIX)) continue;
    if (!entry.parsed || typeof entry.parsed !== 'object') continue;
    parityAttempts += 1;
    const clientEventId = buildClientEventId(entry.stateKey, entry.raw);
    const day = parseDayFromStateKey(entry.stateKey);
    const { data, error } = await supabase.functions.invoke('food-log-v2-write', {
      body: {
        clientEventId,
        stateKey: entry.stateKey,
        day,
        payload: entry.parsed,
        loggedAt: new Date().toISOString(),
      },
    });
    const writeOk = !error && Boolean((data as any)?.ok);
    if (writeOk) paritySuccess += 1;
    else parityFailures.push(entry.stateKey);
  }

  await writeLastParity({
    at: new Date().toISOString(),
    attempted: parityAttempts,
    succeeded: paritySuccess,
    failed: parityFailures.length,
    failureKeys: parityFailures.slice(0, 20),
    parityRate: parityAttempts > 0 ? paritySuccess / parityAttempts : 1,
  });
  if (parityFailures.length > 0) {
    const result = { flushed: 0, skipped: true, reason: `v2_write_failed:${parityFailures.length}` };
    await writeLastResult({ at: new Date().toISOString(), ...result });
    return result;
  }

  await writeQueue({});
  try {
    await AsyncStorage.setItem(CLOUD_STATE_LAST_FLUSH_AT_KEY, new Date().toISOString());
  } catch {
    // ignore
  }

  if (__DEV__) {
    console.log('[cloud-sync] flushed', { flushed: keys.length, reason });
  }
  const result = { flushed: keys.length, skipped: false, reason };
  await writeLastResult({ at: new Date().toISOString(), ...result });
  return result;
}

export async function restoreCloudStateIfLocalMissing(): Promise<{ restored: number; skipped: boolean; reason: string }> {
  if (!isCloudSyncEnabled()) return { restored: 0, skipped: true, reason: 'feature_disabled' };
  if (!isSupabaseConfigured) return { restored: 0, skipped: true, reason: 'supabase_not_configured' };

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData.session?.user?.id) return { restored: 0, skipped: true, reason: 'no_session' };
  const userId = sessionData.session.user.id;

  const localKeys = await AsyncStorage.getAllKeys();
  const hasCoreLocalData = localKeys.some(
    (key) => key.startsWith(DAILY_LOG_PREFIX) || key.startsWith(USER_PROFILE_PREFIX) || key === WEIGHT_LOG_KEY || key === LEGACY_USER_PROFILE_KEY
  );
  if (hasCoreLocalData) {
    return { restored: 0, skipped: true, reason: 'local_present' };
  }

  const { data, error } = await supabase
    .from('user_state_snapshots')
    .select('state_key,state_value,updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1000);

  if (error || !Array.isArray(data) || data.length === 0) {
    return { restored: 0, skipped: true, reason: error ? 'query_failed' : 'no_remote_rows' };
  }

  const writes: Array<[string, string]> = [];
  for (const row of data) {
    const stateKey = String((row as any)?.state_key || '');
    if (!isCloudStateSyncKey(stateKey)) continue;
    const stateValue = (row as any)?.state_value;
    if (stateValue == null) continue;
    try {
      writes.push([stateKey, JSON.stringify(stateValue)]);
    } catch {
      // ignore invalid rows
    }
  }

  if (writes.length > 0) {
    await AsyncStorage.multiSet(writes);
  }
  return { restored: writes.length, skipped: false, reason: 'ok' };
}

export async function clearCloudStateSyncQueue(): Promise<void> {
  await writeQueue({});
}

export async function getCloudStateSyncDiagnostics(): Promise<CloudStateSyncDiagnostics> {
  const [queue, lastFlushAt, lastResultRaw, lastParityRaw] = await Promise.all([
    readQueue(),
    AsyncStorage.getItem(CLOUD_STATE_LAST_FLUSH_AT_KEY),
    AsyncStorage.getItem(CLOUD_STATE_LAST_RESULT_KEY),
    AsyncStorage.getItem(CLOUD_STATE_LAST_PARITY_KEY),
  ]);
  let lastResult: CloudSyncLastResult | null = null;
  let lastParity: CloudSyncParityResult | null = null;
  try {
    const parsed = lastResultRaw ? JSON.parse(lastResultRaw) : null;
    if (isObject(parsed)) {
      lastResult = {
        at: String((parsed as any).at || ''),
        flushed: Number((parsed as any).flushed || 0),
        skipped: Boolean((parsed as any).skipped),
        reason: String((parsed as any).reason || ''),
      };
    }
  } catch {
    lastResult = null;
  }
  try {
    const parsed = lastParityRaw ? JSON.parse(lastParityRaw) : null;
    if (isObject(parsed)) {
      lastParity = {
        at: String((parsed as any).at || ''),
        attempted: Number((parsed as any).attempted || 0),
        succeeded: Number((parsed as any).succeeded || 0),
        failed: Number((parsed as any).failed || 0),
        failureKeys: Array.isArray((parsed as any).failureKeys)
          ? ((parsed as any).failureKeys as unknown[]).map((value) => String(value || '')).filter(Boolean)
          : [],
        parityRate: Number((parsed as any).parityRate || 0),
      };
    }
  } catch {
    lastParity = null;
  }
  const queuedKeys = Object.keys(queue);
  return {
    enabled: isCloudSyncEnabled(),
    queueSize: queuedKeys.length,
    queuedKeys: queuedKeys.slice(0, 50),
    lastFlushAt: lastFlushAt || null,
    lastResult,
    lastParity,
  };
}
