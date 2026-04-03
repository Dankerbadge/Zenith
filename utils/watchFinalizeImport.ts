import { commitWatchFinalizedRun } from './runReviewService';
import { saveLiftTagSession } from './liftTagService';
import { flushCloudStateSyncQueue } from './cloudStateSync';
import { assignSessionDayKey } from './dayAssignment';
import { getDailyLog, saveDailyLog, type WorkoutEntry } from './storageUtils';

// Finalize events can legitimately arrive more than once (e.g. route preview follow-up).
// Guard against concurrent duplicate imports by sessionId.
const inflightRunImports = new Map<string, Promise<void>>();
const inflightWorkoutImports = new Map<string, Promise<void>>();

type WatchRunFinalizePayload = {
  sessionId: string;
  finalizeId?: string;
  startedAtUtc: string;
  endedAtUtc: string;
  elapsedTimeSec: number;
  movingTimeSec: number;
  pausedTotalSec: number;
  runEnvironment?: 'outdoor' | 'treadmill';
  rawDistanceMiles?: number | null;
  treadmillCalibrationFactorUsed?: number | null;
  totalDistanceMiles: number;
  paceMinPerMile?: number | null;
  totalCalories?: number | null;
  avgHrBpm?: number | null;
  maxHrBpm?: number | null;
  hrCoverageRatio?: number | null;
  hrAvailable?: boolean;
  hrConfidence?: number | null;
  route?: unknown[];
  routePreview?: unknown;
};

type WatchLiftFinalizePayload = {
  sessionId: string;
  startedAtUtc: string;
  endedAtUtc: string;
  elapsedTimeSec: number;
  movingTimeSec: number;
  pausedTotalSec: number;
  totalCalories: number;
  setCount: number;
  intensityBand?: string;
  hrAvailable?: boolean;
  avgHrBpm?: number | null;
  maxHrBpm?: number | null;
  hrCoverageRatio?: number | null;
  hrConfidence?: number | null;
};

type WatchWorkoutFinalizePayload = {
  sessionId: string;
  finalizeId?: string;
  planId?: string;
  workoutName?: string;
  hkActivityTypeRaw?: number;
  hkLocationType?: string;
  hkSwimmingLocationType?: string;
  poolLapLengthYards?: number;
  startedAtUtc: string;
  endedAtUtc: string;
  elapsedTimeSec: number;
  movingTimeSec: number;
  pausedTotalSec: number;
  totalDistanceMiles?: number | null;
  paceMinPerMile?: number | null;
  totalCalories?: number | null;
  hrAvailable?: boolean;
  avgHrBpm?: number | null;
  maxHrBpm?: number | null;
  hrCoverageRatio?: number | null;
  hrConfidence?: number | null;
};

function asNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asIso(value: unknown) {
  const s = typeof value === "string" ? value : "";
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? s : new Date().toISOString();
}

export async function importWatchFinalizedRun(raw: Record<string, unknown>): Promise<void> {
  const sessionId = String(raw.sessionId || "");
  if (!sessionId) return;

  // Serialize imports per sessionId to avoid duplicate XP/history writes under rapid back-to-back events.
  const previous = inflightRunImports.get(sessionId);
  if (previous) {
    try { await previous } catch { /* ignore */ }
  }

  const task = (async () => {
  const payload: WatchRunFinalizePayload = {
    sessionId,
    finalizeId: typeof raw.finalizeId === 'string' ? raw.finalizeId : undefined,
    startedAtUtc: asIso(raw.startedAtUtc),
    endedAtUtc: asIso(raw.endedAtUtc),
    elapsedTimeSec: Math.max(0, Math.round(asNumber(raw.elapsedTimeSec))),
    movingTimeSec: Math.max(0, Math.round(asNumber(raw.movingTimeSec))),
    pausedTotalSec: Math.max(0, Math.round(asNumber(raw.pausedTotalSec))),
    runEnvironment: raw.runEnvironment === 'treadmill' || raw.runEnvironment === 'outdoor' ? (raw.runEnvironment as any) : undefined,
    rawDistanceMiles: raw.rawDistanceMiles == null ? null : asNumber(raw.rawDistanceMiles),
    treadmillCalibrationFactorUsed:
      raw.treadmillCalibrationFactorUsed == null ? null : asNumber(raw.treadmillCalibrationFactorUsed),
    totalDistanceMiles: Math.max(0, asNumber(raw.totalDistanceMiles)),
    paceMinPerMile: raw.paceMinPerMile == null ? null : asNumber(raw.paceMinPerMile),
    totalCalories: raw.totalCalories == null ? null : Math.max(0, Math.round(asNumber(raw.totalCalories))),
    avgHrBpm: raw.avgHrBpm == null ? null : Math.max(0, Math.round(asNumber(raw.avgHrBpm))),
    maxHrBpm: raw.maxHrBpm == null ? null : Math.max(0, Math.round(asNumber(raw.maxHrBpm))),
    hrCoverageRatio: raw.hrCoverageRatio == null ? null : asNumber(raw.hrCoverageRatio),
    hrAvailable: typeof raw.hrAvailable === 'boolean' ? raw.hrAvailable : undefined,
    hrConfidence: raw.hrConfidence == null ? null : asNumber(raw.hrConfidence),
    route: Array.isArray(raw.route) ? raw.route : undefined,
    routePreview: raw.routePreview && typeof raw.routePreview === 'object' ? raw.routePreview : undefined,
  };
  await commitWatchFinalizedRun(payload);
  // Best-effort: push watch-imported state to cloud immediately when a session exists.
  void flushCloudStateSyncQueue('manual');
  })();

  inflightRunImports.set(sessionId, task);
  try {
    await task;
  } finally {
    if (inflightRunImports.get(sessionId) === task) {
      inflightRunImports.delete(sessionId);
    }
  }
}

export async function importWatchFinalizedLift(raw: Record<string, unknown>): Promise<void> {
  const payload: WatchLiftFinalizePayload = {
    sessionId: String(raw.sessionId || ""),
    startedAtUtc: asIso(raw.startedAtUtc),
    endedAtUtc: asIso(raw.endedAtUtc),
    elapsedTimeSec: Math.max(0, Math.round(asNumber(raw.elapsedTimeSec))),
    movingTimeSec: Math.max(0, Math.round(asNumber(raw.movingTimeSec))),
    pausedTotalSec: Math.max(0, Math.round(asNumber(raw.pausedTotalSec))),
    totalCalories: Math.max(0, Math.round(asNumber(raw.totalCalories))),
    setCount: Math.max(0, Math.round(asNumber(raw.setCount))),
    intensityBand: typeof raw.intensityBand === 'string' ? raw.intensityBand : undefined,
    hrAvailable: typeof raw.hrAvailable === 'boolean' ? raw.hrAvailable : undefined,
    avgHrBpm: raw.avgHrBpm == null ? null : Math.max(0, Math.round(asNumber(raw.avgHrBpm))),
    maxHrBpm: raw.maxHrBpm == null ? null : Math.max(0, Math.round(asNumber(raw.maxHrBpm))),
    hrCoverageRatio: raw.hrCoverageRatio == null ? null : asNumber(raw.hrCoverageRatio),
    hrConfidence: raw.hrConfidence == null ? null : asNumber(raw.hrConfidence),
  };
  if (!payload.sessionId) return;
  await saveLiftTagSession({
    sessionId: payload.sessionId,
    startTimeUtc: payload.startedAtUtc,
    endTimeUtc: payload.endedAtUtc,
    activeCalories: payload.totalCalories,
    avgHeartRate: payload.hrAvailable ? (payload.avgHrBpm ?? undefined) : undefined,
    peakHeartRate: payload.hrAvailable ? (payload.maxHrBpm ?? undefined) : undefined,
    setCount: payload.setCount,
    sourceAuthority: 'watch',
  });
  // Keep watch-imported lift signals aligned with cloud state when possible.
  void flushCloudStateSyncQueue('manual');
}

function mergeWorkout(log: any, next: WorkoutEntry): WorkoutEntry[] {
  const existing = Array.isArray(log?.workouts) ? [...log.workouts] : [];
  const idx = existing.findIndex((row: any) => String(row?.id || '') === String(next.id));
  if (idx >= 0) {
    existing[idx] = { ...existing[idx], ...next };
    return existing;
  }
  return [next, ...existing];
}

function inferWorkoutType(planId: string, activityRaw: number): WorkoutEntry['type'] {
  const p = String(planId || '');
  if (p.includes('strength') || p.includes('lift')) return 'strength';
  if (p === 'yoga' || p === 'pilates' || p === 'taiChi' || p === 'flexibility' || p === 'mindAndBody' || p === 'rolling' || p === 'cooldown') {
    return 'mobility';
  }
  // Default to cardio; HealthKit activity types are broad and can be re-mapped later.
  void activityRaw;
  return 'cardio';
}

function inferIntensity(avgHrBpm?: number | null): WorkoutEntry['intensity'] {
  const hr = Number(avgHrBpm) || 0;
  if (hr >= 150) return 'hard';
  if (hr >= 120) return 'moderate';
  return 'easy';
}

export async function importWatchFinalizedWorkout(raw: Record<string, unknown>): Promise<void> {
  const sessionId = String(raw.sessionId || '');
  if (!sessionId) return;

  const previous = inflightWorkoutImports.get(sessionId);
  if (previous) {
    try { await previous } catch { /* ignore */ }
  }

  const task = (async () => {
    const payload: WatchWorkoutFinalizePayload = {
      sessionId,
      finalizeId: typeof raw.finalizeId === 'string' ? raw.finalizeId : undefined,
      planId: typeof raw.planId === 'string' ? raw.planId : undefined,
      workoutName: typeof raw.workoutName === 'string' ? raw.workoutName : undefined,
      hkActivityTypeRaw: raw.hkActivityTypeRaw == null ? undefined : Math.round(asNumber(raw.hkActivityTypeRaw)),
      hkLocationType: typeof raw.hkLocationType === 'string' ? raw.hkLocationType : undefined,
      hkSwimmingLocationType: typeof raw.hkSwimmingLocationType === 'string' ? raw.hkSwimmingLocationType : undefined,
      poolLapLengthYards: raw.poolLapLengthYards == null ? undefined : Math.round(asNumber(raw.poolLapLengthYards)),
      startedAtUtc: asIso(raw.startedAtUtc),
      endedAtUtc: asIso(raw.endedAtUtc),
      elapsedTimeSec: Math.max(0, Math.round(asNumber(raw.elapsedTimeSec))),
      movingTimeSec: Math.max(0, Math.round(asNumber(raw.movingTimeSec))),
      pausedTotalSec: Math.max(0, Math.round(asNumber(raw.pausedTotalSec))),
      totalDistanceMiles: raw.totalDistanceMiles == null ? null : Math.max(0, asNumber(raw.totalDistanceMiles)),
      paceMinPerMile: raw.paceMinPerMile == null ? null : asNumber(raw.paceMinPerMile),
      totalCalories: raw.totalCalories == null ? null : Math.max(0, Math.round(asNumber(raw.totalCalories))),
      hrAvailable: typeof raw.hrAvailable === 'boolean' ? raw.hrAvailable : undefined,
      avgHrBpm: raw.avgHrBpm == null ? null : Math.max(0, Math.round(asNumber(raw.avgHrBpm))),
      maxHrBpm: raw.maxHrBpm == null ? null : Math.max(0, Math.round(asNumber(raw.maxHrBpm))),
      hrCoverageRatio: raw.hrCoverageRatio == null ? null : asNumber(raw.hrCoverageRatio),
      hrConfidence: raw.hrConfidence == null ? null : asNumber(raw.hrConfidence),
    };

    const dateKey = assignSessionDayKey(payload.startedAtUtc, payload.endedAtUtc);
    const log = await getDailyLog(dateKey);

    const durationSec = Math.max(0, payload.movingTimeSec || payload.elapsedTimeSec || 0);
    const durationMin = Math.max(1, Math.round(durationSec / 60));
    const planId = String(payload.planId || '');
    const activityRaw = Number(payload.hkActivityTypeRaw) || 0;

    const type = inferWorkoutType(planId, activityRaw);
    const intensity = inferIntensity(payload.avgHrBpm);

    const entry: WorkoutEntry = {
      id: `workout_watch_${payload.sessionId}`,
      ts: payload.endedAtUtc,
      type,
      intensity,
      durationMin,
      minutes: durationMin,
      caloriesBurned: payload.totalCalories != null ? payload.totalCalories : undefined,
      avgHeartRate: payload.hrAvailable ? (payload.avgHrBpm ?? undefined) : undefined,
      peakHeartRate: payload.hrAvailable ? (payload.maxHrBpm ?? undefined) : undefined,
      label: payload.workoutName || (planId ? planId : 'Workout'),
      note: planId ? `Apple Watch workout plan: ${planId}` : undefined,
      sourceAuthority: 'watch',
      workoutClass: 'wearable_import',
      imported: false,
      sourceLabel: 'Zenith Watch',
      importedAt: undefined,
      importedSource: undefined,
      metricsLock: {
        metricsImmutable: true,
        metricsLockedAtUtc: payload.endedAtUtc,
        sessionIntegrityState: 'finalized',
      },
    };

    const next = { ...log, workouts: mergeWorkout(log, entry), updatedAt: new Date().toISOString() };
    await saveDailyLog(dateKey, next);

    void flushCloudStateSyncQueue('manual');
  })();

  inflightWorkoutImports.set(sessionId, task);
  try {
    await task;
  } finally {
    if (inflightWorkoutImports.get(sessionId) === task) {
      inflightWorkoutImports.delete(sessionId);
    }
  }
}
