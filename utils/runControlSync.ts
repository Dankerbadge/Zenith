import AsyncStorage from '@react-native-async-storage/async-storage';

export type RunControlState =
  | 'idle'
  | 'recording'
  | 'paused'
  | 'endingConfirm'
  | 'ended'
  | 'saved'
  | 'discarded'
  | 'disconnected';

export type RunSyncReason =
  | 'stateChange'
  | 'tick'
  | 'metricThreshold'
  | 'ackResponse'
  | 'sync'
  | 'manual';

export type RunCommandType =
  | 'start'
  | 'pause'
  | 'resume'
  | 'requestEnd'
  | 'confirmEnd'
  | 'cancelEnd'
  | 'save'
  | 'discard';

export type RunSnapshot = {
  sessionId: string;
  state: RunControlState;
  // Truth-first: when the watch cannot verify a live HKWorkoutSession after recovery,
  // it marks the session as needing attention. UI must not present Recording/Paused as trustworthy.
  needsRecovery?: boolean;
  recoveryVerified?: boolean;
  runEnvironment?: 'outdoor' | 'treadmill';
  rawDistanceMiles?: number;
  treadmillCalibrationFactorUsed?: number;
  startedAtWatch: string;
  endedAtWatch: string | null;
  elapsedTimeSec: number;
  movingTimeSec: number;
  pausedTotalSec: number;
  totalDistanceMiles: number;
  paceMinPerMile: number | null;
  // Optional live telemetry (available from Apple Watch; may be absent for phone-recorded runs).
  totalCalories?: number;
  avgHrBpm?: number;
  maxHrBpm?: number;
  lastUpdatedAtWatch: string;
  seq: number;
  sourceDevice: 'watch' | 'phone';
  reasonCode: RunSyncReason;
};

export type RunCommandRequest = {
  sessionId: string;
  commandType: RunCommandType;
  clientCommandId: string;
  sentAtPhone: string;
  phoneLastSeqKnown: number;
};

export type RunCommandAck = {
  clientCommandId: string;
  accepted: boolean;
  reasonCode?: string;
  snapshot?: RunSnapshot;
  ackedAt: string;
};

const ACTIVE_RUN_SNAPSHOT_KEY = 'activeRunSnapshot';
const RUN_COMMAND_QUEUE_KEY = 'runCommandQueue';
const RUN_COMMAND_ACKS_KEY = 'runCommandAcks';
const ORPHAN_RUN_RESOLUTION_INTENT_KEY = 'orphanRunResolutionIntent';

export type OrphanRunResolutionIntent = 'end' | 'discard';

export function logRunSyncEvent(event: string, payload?: Record<string, unknown>) {
  if (!__DEV__) return;
  const stamp = new Date().toISOString();
  if (payload) {
    console.debug(`[run-sync] ${stamp} ${event}`, payload);
    return;
  }
  console.debug(`[run-sync] ${stamp} ${event}`);
}

function safeParseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function createSessionId() {
  return `session_${Date.now()}_${Math.round(Math.random() * 100000)}`;
}

export function createClientCommandId(commandType: RunCommandType) {
  return `${commandType}_${Date.now()}_${Math.round(Math.random() * 100000)}`;
}

export async function getActiveRunSnapshot(): Promise<RunSnapshot | null> {
  const raw = await AsyncStorage.getItem(ACTIVE_RUN_SNAPSHOT_KEY);
  return safeParseJson<RunSnapshot | null>(raw, null);
}

export async function upsertActiveRunSnapshot(next: RunSnapshot): Promise<boolean> {
  const current = await getActiveRunSnapshot();
  if (current && current.sessionId === next.sessionId && next.seq <= current.seq) {
    return false;
  }
  await AsyncStorage.setItem(ACTIVE_RUN_SNAPSHOT_KEY, JSON.stringify(next));
  return true;
}

export async function clearActiveRunSnapshot() {
  await AsyncStorage.removeItem(ACTIVE_RUN_SNAPSHOT_KEY);
}

export async function getQueuedRunCommands(): Promise<RunCommandRequest[]> {
  const raw = await AsyncStorage.getItem(RUN_COMMAND_QUEUE_KEY);
  const parsed = safeParseJson<RunCommandRequest[]>(raw, []);
  return Array.isArray(parsed) ? parsed : [];
}

export async function queueRunCommand(request: RunCommandRequest): Promise<void> {
  const queue = await getQueuedRunCommands();
  if (queue.some((row) => row.clientCommandId === request.clientCommandId)) return;
  const next = [...queue, request];
  await AsyncStorage.setItem(RUN_COMMAND_QUEUE_KEY, JSON.stringify(next));
}

export async function consumeRunCommand(clientCommandId: string): Promise<void> {
  const queue = await getQueuedRunCommands();
  const next = queue.filter((row) => row.clientCommandId !== clientCommandId);
  await AsyncStorage.setItem(RUN_COMMAND_QUEUE_KEY, JSON.stringify(next));
}

export async function putRunCommandAck(ack: RunCommandAck): Promise<void> {
  const raw = await AsyncStorage.getItem(RUN_COMMAND_ACKS_KEY);
  const map = safeParseJson<Record<string, RunCommandAck>>(raw, {});
  map[ack.clientCommandId] = ack;
  await AsyncStorage.setItem(RUN_COMMAND_ACKS_KEY, JSON.stringify(map));
}

export async function getRunCommandAck(clientCommandId: string): Promise<RunCommandAck | null> {
  const raw = await AsyncStorage.getItem(RUN_COMMAND_ACKS_KEY);
  const map = safeParseJson<Record<string, RunCommandAck>>(raw, {});
  return map[clientCommandId] || null;
}

export async function clearRunCommandAck(clientCommandId: string): Promise<void> {
  const raw = await AsyncStorage.getItem(RUN_COMMAND_ACKS_KEY);
  const map = safeParseJson<Record<string, RunCommandAck>>(raw, {});
  if (!(clientCommandId in map)) return;
  delete map[clientCommandId];
  await AsyncStorage.setItem(RUN_COMMAND_ACKS_KEY, JSON.stringify(map));
}

export async function setOrphanRunResolutionIntent(intent: OrphanRunResolutionIntent): Promise<void> {
  await AsyncStorage.setItem(ORPHAN_RUN_RESOLUTION_INTENT_KEY, intent);
}

export async function consumeOrphanRunResolutionIntent(): Promise<OrphanRunResolutionIntent | null> {
  const raw = await AsyncStorage.getItem(ORPHAN_RUN_RESOLUTION_INTENT_KEY);
  await AsyncStorage.removeItem(ORPHAN_RUN_RESOLUTION_INTENT_KEY);
  if (raw === 'end' || raw === 'discard') return raw;
  return null;
}

export async function clearOrphanRunResolutionIntent(): Promise<void> {
  await AsyncStorage.removeItem(ORPHAN_RUN_RESOLUTION_INTENT_KEY);
}
