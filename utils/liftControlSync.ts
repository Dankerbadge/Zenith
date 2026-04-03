import AsyncStorage from '@react-native-async-storage/async-storage';

export type LiftControlState =
  | 'idle'
  | 'recording'
  | 'paused'
  | 'endingConfirm'
  | 'ended'
  | 'saved'
  | 'discarded'
  | 'disconnected';

export type LiftSyncReason =
  | 'stateChange'
  | 'tick'
  | 'metricThreshold'
  | 'ackResponse'
  | 'sync'
  | 'manual';

export type LiftCommandType =
  | 'start'
  | 'pause'
  | 'resume'
  | 'requestEnd'
  | 'confirmEnd'
  | 'cancelEnd'
  | 'save'
  | 'discard';

export type LiftSnapshot = {
  sessionId: string;
  state: LiftControlState;
  needsRecovery?: boolean;
  recoveryVerified?: boolean;
  startedAtWatch: string;
  endedAtWatch: string | null;
  elapsedTimeSec: number;
  movingTimeSec: number;
  pausedTotalSec: number;
  totalCalories: number;
  setCount: number;
  intensityBand: 'low' | 'moderate' | 'high';
  lastUpdatedAtWatch: string;
  seq: number;
  sourceDevice: 'watch' | 'phone';
  reasonCode: LiftSyncReason;
};

export type LiftCommandRequest = {
  sessionId: string;
  commandType: LiftCommandType;
  clientCommandId: string;
  sentAtPhone: string;
  phoneLastSeqKnown: number;
};

export type LiftCommandAck = {
  clientCommandId: string;
  accepted: boolean;
  reasonCode?: string;
  snapshot?: LiftSnapshot;
  ackedAt: string;
};

const ACTIVE_LIFT_SNAPSHOT_KEY = 'activeLiftSnapshot';
const LIFT_COMMAND_QUEUE_KEY = 'liftCommandQueue';
const LIFT_COMMAND_ACKS_KEY = 'liftCommandAcks';

function safeParseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function createLiftSessionId() {
  return `lift_session_${Date.now()}_${Math.round(Math.random() * 100000)}`;
}

export function createLiftClientCommandId(commandType: LiftCommandType) {
  return `lift_${commandType}_${Date.now()}_${Math.round(Math.random() * 100000)}`;
}

export async function getActiveLiftSnapshot(): Promise<LiftSnapshot | null> {
  const raw = await AsyncStorage.getItem(ACTIVE_LIFT_SNAPSHOT_KEY);
  return safeParseJson<LiftSnapshot | null>(raw, null);
}

export async function upsertActiveLiftSnapshot(next: LiftSnapshot): Promise<boolean> {
  const current = await getActiveLiftSnapshot();
  if (current && current.sessionId === next.sessionId && next.seq <= current.seq) {
    return false;
  }
  await AsyncStorage.setItem(ACTIVE_LIFT_SNAPSHOT_KEY, JSON.stringify(next));
  return true;
}

export async function clearActiveLiftSnapshot() {
  await AsyncStorage.removeItem(ACTIVE_LIFT_SNAPSHOT_KEY);
}

export async function getQueuedLiftCommands(): Promise<LiftCommandRequest[]> {
  const raw = await AsyncStorage.getItem(LIFT_COMMAND_QUEUE_KEY);
  const parsed = safeParseJson<LiftCommandRequest[]>(raw, []);
  return Array.isArray(parsed) ? parsed : [];
}

export async function queueLiftCommand(request: LiftCommandRequest): Promise<void> {
  const queue = await getQueuedLiftCommands();
  if (queue.some((row) => row.clientCommandId === request.clientCommandId)) return;
  const next = [...queue, request];
  await AsyncStorage.setItem(LIFT_COMMAND_QUEUE_KEY, JSON.stringify(next));
}

export async function consumeLiftCommand(clientCommandId: string): Promise<void> {
  const queue = await getQueuedLiftCommands();
  const next = queue.filter((row) => row.clientCommandId !== clientCommandId);
  await AsyncStorage.setItem(LIFT_COMMAND_QUEUE_KEY, JSON.stringify(next));
}

export async function putLiftCommandAck(ack: LiftCommandAck): Promise<void> {
  const raw = await AsyncStorage.getItem(LIFT_COMMAND_ACKS_KEY);
  const map = safeParseJson<Record<string, LiftCommandAck>>(raw, {});
  map[ack.clientCommandId] = ack;
  await AsyncStorage.setItem(LIFT_COMMAND_ACKS_KEY, JSON.stringify(map));
}

export async function getLiftCommandAck(clientCommandId: string): Promise<LiftCommandAck | null> {
  const raw = await AsyncStorage.getItem(LIFT_COMMAND_ACKS_KEY);
  const map = safeParseJson<Record<string, LiftCommandAck>>(raw, {});
  return map[clientCommandId] || null;
}

export async function clearLiftCommandAck(clientCommandId: string): Promise<void> {
  const raw = await AsyncStorage.getItem(LIFT_COMMAND_ACKS_KEY);
  const map = safeParseJson<Record<string, LiftCommandAck>>(raw, {});
  if (!(clientCommandId in map)) return;
  delete map[clientCommandId];
  await AsyncStorage.setItem(LIFT_COMMAND_ACKS_KEY, JSON.stringify(map));
}
