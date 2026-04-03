import AsyncStorage from '@react-native-async-storage/async-storage';

export type TreadmillCalibrationState = {
  factor: number;
  samples: number;
  updatedAtUtc: string;
};

const CALIBRATION_KEY = 'treadmillCalibration_v1';
const TRAINED_RUN_KEY_PREFIX = 'treadmillCalibration_trained_run_';
const HANDLED_RUN_KEY_PREFIX = 'treadmillCorrection_handled_run_';
const PENDING_CORRECTION_KEY = 'treadmillCorrection_pending_v1';
const PENDING_FACTOR_SYNC_KEY = 'treadmillCalibration_pending_factor_sync_v1';

const DEFAULT_STATE: TreadmillCalibrationState = {
  factor: 1.0,
  samples: 0,
  updatedAtUtc: new Date(0).toISOString(),
};

export const TREADMILL_FACTOR_BOUNDS = {
  acceptMin: 0.85,
  acceptMax: 1.15,
  hardMin: 0.7,
  hardMax: 1.3,
} as const;

export const TREADMILL_RAW_DISTANCE_MIN_MILES = 0.125; // ~200m
export const TREADMILL_EMA_ALPHA = 0.2;

function safeParseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export async function getTreadmillCalibration(): Promise<TreadmillCalibrationState> {
  const raw = await AsyncStorage.getItem(CALIBRATION_KEY);
  const parsed = safeParseJson<Partial<TreadmillCalibrationState>>(raw, {});
  const factor = Number(parsed.factor);
  const samples = Number(parsed.samples);
  const updatedAtUtc = typeof parsed.updatedAtUtc === 'string' ? parsed.updatedAtUtc : DEFAULT_STATE.updatedAtUtc;
  return {
    factor:
      Number.isFinite(factor) && factor >= TREADMILL_FACTOR_BOUNDS.hardMin && factor <= TREADMILL_FACTOR_BOUNDS.hardMax
        ? factor
        : DEFAULT_STATE.factor,
    samples: Number.isFinite(samples) && samples >= 0 ? Math.floor(samples) : DEFAULT_STATE.samples,
    updatedAtUtc,
  };
}

export async function setTreadmillCalibration(next: TreadmillCalibrationState): Promise<void> {
  await AsyncStorage.setItem(CALIBRATION_KEY, JSON.stringify(next));
}

export async function hasTrainedOnRun(sessionId: string): Promise<boolean> {
  if (!sessionId) return false;
  const raw = await AsyncStorage.getItem(TRAINED_RUN_KEY_PREFIX + sessionId);
  return raw === '1';
}

export async function markTrainedOnRun(sessionId: string): Promise<void> {
  if (!sessionId) return;
  await AsyncStorage.setItem(TRAINED_RUN_KEY_PREFIX + sessionId, '1');
}

export async function getHandledTreadmillCorrection(sessionId: string): Promise<'saved' | 'skipped' | null> {
  if (!sessionId) return null;
  const raw = await AsyncStorage.getItem(HANDLED_RUN_KEY_PREFIX + sessionId);
  if (raw === 'saved' || raw === 'skipped') return raw;
  return null;
}

export async function markHandledTreadmillCorrection(sessionId: string, status: 'saved' | 'skipped'): Promise<void> {
  if (!sessionId) return;
  await AsyncStorage.setItem(HANDLED_RUN_KEY_PREFIX + sessionId, status);
}

export type PendingTreadmillCorrection = {
  sessionId: string;
  startedAtUtc: string;
  endedAtUtc: string;
  elapsedTimeSec: number;
  movingTimeSec: number;
  rawDistanceMiles: number;
  recordedDistanceMiles: number;
  createdAtUtc: string;
};

export async function getPendingTreadmillCorrection(): Promise<PendingTreadmillCorrection | null> {
  const raw = await AsyncStorage.getItem(PENDING_CORRECTION_KEY);
  const parsed = safeParseJson<PendingTreadmillCorrection | null>(raw, null);
  if (!parsed || typeof parsed !== 'object') return null;
  if (!parsed.sessionId) return null;
  return parsed;
}

export async function setPendingTreadmillCorrection(pending: PendingTreadmillCorrection): Promise<void> {
  if (!pending?.sessionId) return;
  await AsyncStorage.setItem(PENDING_CORRECTION_KEY, JSON.stringify(pending));
}

export async function clearPendingTreadmillCorrection(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_CORRECTION_KEY);
}

export type PendingTreadmillFactorSync = {
  factor: number;
  updatedAtUtc: string;
  nonce: string;
  status: 'pending' | 'blocked';
  lastSentAtUtc?: string | null;
};

export async function getPendingTreadmillFactorSync(): Promise<PendingTreadmillFactorSync | null> {
  const raw = await AsyncStorage.getItem(PENDING_FACTOR_SYNC_KEY);
  const parsed = safeParseJson<PendingTreadmillFactorSync | null>(raw, null);
  if (!parsed || typeof parsed !== 'object') return null;
  const factor = Number(parsed.factor);
  if (!Number.isFinite(factor)) return null;
  if (factor < TREADMILL_FACTOR_BOUNDS.hardMin || factor > TREADMILL_FACTOR_BOUNDS.hardMax) return null;
  const updatedAtUtc = typeof parsed.updatedAtUtc === 'string' ? parsed.updatedAtUtc : '';
  const nonce = typeof parsed.nonce === 'string' ? parsed.nonce : '';
  const status = parsed.status === 'blocked' ? 'blocked' : 'pending';
  const lastSentAtUtc = typeof parsed.lastSentAtUtc === 'string' ? parsed.lastSentAtUtc : null;
  if (!nonce || !updatedAtUtc) return null;
  return { factor, updatedAtUtc, nonce, status, lastSentAtUtc };
}

export async function setPendingTreadmillFactorSync(next: PendingTreadmillFactorSync): Promise<void> {
  if (!next?.nonce || !next?.updatedAtUtc) return;
  const factor = Number(next.factor);
  if (!Number.isFinite(factor)) return;
  if (factor < TREADMILL_FACTOR_BOUNDS.hardMin || factor > TREADMILL_FACTOR_BOUNDS.hardMax) return;
  await AsyncStorage.setItem(PENDING_FACTOR_SYNC_KEY, JSON.stringify({ ...next, factor }));
}

export async function clearPendingTreadmillFactorSync(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_FACTOR_SYNC_KEY);
}

export async function patchPendingTreadmillFactorSync(patch: Partial<PendingTreadmillFactorSync>): Promise<void> {
  const current = await getPendingTreadmillFactorSync();
  if (!current) return;
  await setPendingTreadmillFactorSync({ ...current, ...patch });
}

export function computeNewFactor(input: { rawDistanceMiles: number; treadmillDistanceMiles: number }): number | null {
  const raw = Number(input.rawDistanceMiles);
  const entered = Number(input.treadmillDistanceMiles);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  if (!Number.isFinite(entered) || entered <= 0) return null;
  return entered / raw;
}

export async function applyTreadmillDistanceCorrectionToCalibration(input: {
  sessionId: string;
  rawDistanceMiles: number;
  treadmillDistanceMiles: number;
}): Promise<{
  accepted: boolean;
  reasonCode?: string;
  newFactor?: number;
  previousFactor?: number;
  nextFactor?: number;
  trainedThisRun?: boolean;
}> {
  const raw = Number(input.rawDistanceMiles);
  if (!Number.isFinite(raw) || raw < TREADMILL_RAW_DISTANCE_MIN_MILES) {
    return { accepted: false, reasonCode: 'raw_distance_too_small' };
  }

  const newFactor = computeNewFactor(input);
  if (newFactor == null) return { accepted: false, reasonCode: 'invalid_input' };
  if (newFactor < TREADMILL_FACTOR_BOUNDS.hardMin || newFactor > TREADMILL_FACTOR_BOUNDS.hardMax) {
    return { accepted: false, reasonCode: 'factor_out_of_hard_bounds' };
  }

  const prev = await getTreadmillCalibration();
  const alreadyTrained = await hasTrainedOnRun(input.sessionId);
  if (alreadyTrained) {
    return {
      accepted: true,
      newFactor,
      previousFactor: prev.factor,
      nextFactor: prev.factor,
      trainedThisRun: false,
    };
  }

  const alpha = clamp(TREADMILL_EMA_ALPHA, 0.01, 0.6);
  const nextFactor = (prev.factor * (1 - alpha)) + (newFactor * alpha);
  const boundedNextFactor = clamp(nextFactor, TREADMILL_FACTOR_BOUNDS.hardMin, TREADMILL_FACTOR_BOUNDS.hardMax);

  await setTreadmillCalibration({
    factor: boundedNextFactor,
    samples: prev.samples + 1,
    updatedAtUtc: new Date().toISOString(),
  });
  await markTrainedOnRun(input.sessionId);

  return {
    accepted: true,
    newFactor,
    previousFactor: prev.factor,
    nextFactor: boundedNextFactor,
    trainedThisRun: true,
  };
}
