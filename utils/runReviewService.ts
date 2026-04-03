import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearDailyMetricCache } from './dailyMetrics';
import { assignSessionDayKey } from './dayAssignment';
import { type LocationPoint, type Reaction } from './gpsService';
import { simplifyRoute } from './routeUtils';
import { calculateRunningXPAward } from './xpSystem';
import { patchCanonicalRun, upsertCanonicalRunFromLegacy } from './canonicalRunService';
import { type RunKind } from './canonicalRunningSchema';
import { getXpWeightForEngine } from './effortEngine';
import { getBehaviorMultipliers, settleBehaviorDay } from './behavioralCore';
import { createRunMetricVersionSet, type RunMetricVersionSet } from './runMetricVersions';
import { getDailyLog, saveDailyLog } from './storageUtils';
import { getAuthenticatedUserId } from './authIdentity';

const PENDING_RUN_KEY = 'pendingRunReview';

type PendingRun = {
  runId?: string;
  kind?: RunKind;
  lifecycleState?: 'ended' | 'saved' | 'discarded';
  pausedTimeSec?: number;
  pauseEvents?: Array<{ pauseAtUtc: string; resumeAtUtc?: string }>;
  title?: string;
  notes?: string;
  intensityLabel?: 'easy' | 'moderate' | 'hard';
  // P0 truthfulness: HR must never be implied unless explicitly recorded.
  hrAvailable?: boolean;
  distance: number;
  duration: number;
  averagePace: number;
  calories: number;
  xpEarned: number;
  route: LocationPoint[];
  reactions: Reaction[];
  refinement?: {
    applied: boolean;
    distanceBefore?: number;
    distanceAfter?: number;
    caloriesBefore?: number;
    caloriesAfter?: number;
    note?: string;
  };
  diagnostics?: {
    samples: number;
    confidence: { high: number; medium: number; low: number };
    paceStates: {
      live_confident: number;
      live_estimated: number;
      acquiring: number;
      unavailable: number;
      paused: number;
    };
    sourceTags: { gps: number; fused: number; estimated: number };
    gpsStates?: {
      good: number;
      degraded: number;
      lost: number;
      recovered: number;
    };
    gpsGapSeconds?: number;
    estimatedGapDistanceMiles?: number;
  };
  gapSegments?: Array<{
    gapId: string;
    startTimeUtc: string;
    endTimeUtc: string;
    type: 'degraded_gap' | 'lost_gap';
    // Keep legacy values for backward compatibility with existing stored runs.
    estimatorUsed: 'none' | 'gps_low_confidence' | 'watch_motion' | 'interpolate' | 'hybrid';
    estimatedDistanceMiles: number;
    confidenceScore: number;
  }>;
  confidenceSummary?: {
    distanceConfidence: number;
    paceConfidence: number;
    // P0 truthfulness: null when HR samples/metrics are not present.
    hrConfidence: number | null;
  };
  metricVersions?: RunMetricVersionSet;
  metricsLock?: {
    metricsImmutable: boolean;
    metricsLockedAtUtc: string;
    sessionIntegrityState: 'pending' | 'finalized';
  };
  loggedAtUtc?: string;
  xpEligibleByTime?: boolean;
  lateLoggedNoXP?: boolean;
  timestamp: string;
};

const IMMUTABLE_HISTORY_METRIC_FIELDS = [
  'distance',
  'duration',
  'averagePace',
  'calories',
  'route',
  'splits',
  'gapSegments',
] as const;

function safeParseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function loadDailyLogNormalized(dayKey: string): Promise<any> {
  const raw = await getDailyLog(dayKey);
  const log = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  log.workouts = Array.isArray(log.workouts) ? log.workouts : [];
  log.activeRest = Array.isArray(log.activeRest) ? log.activeRest : [];
  log.foodEntries = Array.isArray(log.foodEntries) ? log.foodEntries : [];
  log.calories = Number(log.calories) || 0;
  log.water = Number(log.water) || 0;
  log.dailyXP = Number(log.dailyXP) || 0;
  return log;
}

function getDayEndPlus24hMs(dayKey: string): number {
  const [y, m, d] = String(dayKey).split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return Number.POSITIVE_INFINITY;
  // Use the numeric Date constructor so this is always local time (no ISO parsing ambiguity).
  const dayEndLocal = new Date(y, m - 1, d, 23, 59, 59, 999);
  const dayEndMs = dayEndLocal.getTime();
  if (!Number.isFinite(dayEndMs)) return Number.POSITIVE_INFINITY;
  return dayEndMs + 24 * 60 * 60 * 1000;
}

function isXpEligibleBySettlement(dayKey: string, loggedAtUtc: string): boolean {
  const loggedAtMs = new Date(loggedAtUtc).getTime();
  if (!Number.isFinite(loggedAtMs)) return false;
  return loggedAtMs <= getDayEndPlus24hMs(dayKey);
}

export async function stagePendingRun(run: PendingRun): Promise<void> {
  const nowIso = new Date().toISOString();
  const hrAvailable = run.hrAvailable === true;
  const confidenceSummary = run.confidenceSummary
    ? {
        ...run.confidenceSummary,
        hrConfidence: hrAvailable ? run.confidenceSummary.hrConfidence ?? null : null,
      }
    : undefined;
  const normalized: PendingRun = {
    ...run,
    hrAvailable,
    confidenceSummary,
    runId: run.runId || `run_${Date.now()}`,
    kind: run.kind || (run.route?.length ? 'gps_outdoor' : 'manual_treadmill'),
    lifecycleState: run.lifecycleState || 'ended',
    pausedTimeSec: Math.max(0, Math.round(Number(run.pausedTimeSec) || 0)),
    metricVersions: run.metricVersions || createRunMetricVersionSet(),
    metricsLock: run.metricsLock || {
      metricsImmutable: false,
      metricsLockedAtUtc: nowIso,
      sessionIntegrityState: 'pending',
    },
  };
  await AsyncStorage.setItem(PENDING_RUN_KEY, JSON.stringify(normalized));
}

export async function getPendingRun(): Promise<PendingRun | null> {
  const raw = await AsyncStorage.getItem(PENDING_RUN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingRun;
  } catch {
    return null;
  }
}

export async function clearPendingRun(finalState: 'saved' | 'discarded' = 'discarded'): Promise<void> {
  const raw = await AsyncStorage.getItem(PENDING_RUN_KEY);
  const pending = safeParseJson<PendingRun | null>(raw, null);
  if (pending?.runId) {
    await AsyncStorage.setItem(
      `runDraftState_${pending.runId}`,
      JSON.stringify({ state: finalState, updatedAtUtc: new Date().toISOString() })
    );
  }
  await AsyncStorage.removeItem(PENDING_RUN_KEY);
}

export async function updatePendingRun(patch: Partial<PendingRun>): Promise<void> {
  const pending = await getPendingRun();
  if (!pending) return;
  const next = {
    ...pending,
    ...patch,
  };
  await AsyncStorage.setItem(PENDING_RUN_KEY, JSON.stringify(next));
}

export async function updateRunHistoryEntry(
  target: string | { timestamp?: string; runId?: string },
  patch: Record<string, unknown>,
  options?: { allowMetricPatch?: boolean }
): Promise<void> {
  const targetTimestamp =
    typeof target === 'string' ? target : typeof target?.timestamp === 'string' ? target.timestamp : '';
  const targetRunId = typeof target === 'object' && typeof target?.runId === 'string' ? target.runId : '';
  if (!targetTimestamp && !targetRunId) return;
  const runsHistory = await AsyncStorage.getItem('runsHistory');
  const runs = safeParseJson<any[]>(runsHistory, []);
  if (!Array.isArray(runs) || !runs.length) return;

  let updated = false;
  const nextRuns = runs.map((run: any) => {
    if (updated) return run;
    const matchesRunId = targetRunId ? String(run?.runId || '') === targetRunId : false;
    const matchesTimestamp = targetTimestamp ? String(run?.timestamp || '') === targetTimestamp : false;
    if (!matchesRunId && !matchesTimestamp) return run;
    const lockActive = run?.metricsLock?.metricsImmutable !== false;
    const patchCopy: Record<string, unknown> = { ...patch };
    if (lockActive && !options?.allowMetricPatch) {
      IMMUTABLE_HISTORY_METRIC_FIELDS.forEach((field) => {
        if (field in patchCopy) {
          delete patchCopy[field];
        }
      });
    }
    updated = true;
    return { ...run, ...patchCopy };
  });

  if (updated) {
    await AsyncStorage.setItem('runsHistory', JSON.stringify(nextRuns));
  }
}

export async function applyTreadmillDistanceCorrectionToWatchRun(input: {
  sessionId: string;
  startedAtUtc: string;
  endedAtUtc: string;
  elapsedTimeSec: number;
  movingTimeSec: number;
  rawDistanceMiles: number;
  treadmillDistanceMiles: number;
}): Promise<{
  accepted: boolean;
  reasonCode?: string;
  runId?: string;
  correctedDistanceMiles?: number;
  treadmillScaleFactor?: number;
}> {
  const sessionId = String(input.sessionId || '').trim();
  if (!sessionId) return { accepted: false, reasonCode: 'missing_session' };
  const runId = `run_watch_${sessionId}`;

  const rawDistanceMiles = Number(input.rawDistanceMiles);
  const treadmillDistanceMiles = Number(input.treadmillDistanceMiles);
  if (!Number.isFinite(treadmillDistanceMiles) || treadmillDistanceMiles <= 0) {
    return { accepted: false, reasonCode: 'invalid_treadmill_distance' };
  }
  if (!Number.isFinite(rawDistanceMiles) || rawDistanceMiles <= 0) {
    return { accepted: false, reasonCode: 'invalid_raw_distance' };
  }

  const treadmillScaleFactor = treadmillDistanceMiles / rawDistanceMiles;
  const correctedDistanceMiles = treadmillDistanceMiles;

  const movingTimeSec = Math.max(0, Math.round(Number(input.movingTimeSec) || 0));
  const correctedAveragePace =
    correctedDistanceMiles > 0 && movingTimeSec > 0 ? (movingTimeSec / 60) / correctedDistanceMiles : 0;

  await updateRunHistoryEntry(
    { runId },
    {
      distance: correctedDistanceMiles,
      averagePace: correctedAveragePace,
      runEnvironment: 'treadmill',
      rawDistanceMiles,
      treadmillEnteredDistanceMiles: treadmillDistanceMiles,
      treadmillScaleFactor,
      treadmillCorrectedAtUtc: new Date().toISOString(),
    },
    { allowMetricPatch: true }
  );

  // Patch daily log entry for the session day to keep "Today" surfaces consistent.
  const startedAtUtc = String(input.startedAtUtc || '');
  const endedAtUtc = String(input.endedAtUtc || '');
  const startTime = new Date(startedAtUtc);
  const endTime = new Date(endedAtUtc);
  const startIso = Number.isFinite(startTime.getTime()) ? startTime.toISOString() : new Date().toISOString();
  const endIso = Number.isFinite(endTime.getTime()) ? endTime.toISOString() : new Date().toISOString();
  const dayKey = assignSessionDayKey(startIso, endIso);
  const day = await loadDailyLogNormalized(dayKey);
  const workouts = Array.isArray(day.workouts) ? day.workouts : [];

  let patchedWorkout = false;
  const nextWorkouts = workouts.map((w: any) => {
    if (patchedWorkout) return w;
    const isRun = String(w?.type || '').toLowerCase() === 'running';
    const matchesTime = String(w?.time || '') === endIso;
    const source = String(w?.sourceAuthority || '');
    const likelyMatch = isRun && matchesTime && (source === 'watch' || source === '');
    if (!likelyMatch) return w;
    patchedWorkout = true;
    return {
      ...w,
      distance: correctedDistanceMiles,
      pace: correctedAveragePace,
      notes: String(w?.notes || '').includes('Corrected')
        ? w.notes
        : `${String(w?.notes || 'Recorded on Apple Watch.').trim()} (Corrected treadmill distance.)`,
    };
  });
  if (patchedWorkout) {
    await saveDailyLog(dayKey, { ...day, workouts: nextWorkouts } as any);
    clearDailyMetricCache(dayKey);
  }

  // Patch canonical run metrics (locked runs require explicit override).
  await patchCanonicalRun(
    runId,
    {
      kind: 'manual_treadmill',
      distanceMeters: Math.max(0, Number((correctedDistanceMiles * 1609.344).toFixed(2))),
      distanceSource: 'user_entered',
      avgPaceSecPerMile: correctedAveragePace > 0 ? Number((correctedAveragePace * 60).toFixed(2)) : null,
      avgPaceSecPerKm: correctedAveragePace > 0 ? Number((correctedAveragePace * (60 / 1.609344)).toFixed(2)) : null,
      paceSource: 'derived_from_user_entry',
      measuredLabel: 'user_entered',
    },
    { allowMetricPatch: true }
  );

  return {
    accepted: true,
    runId,
    correctedDistanceMiles,
    treadmillScaleFactor,
  };
}

export async function commitPendingRun(): Promise<PendingRun | null> {
  const run = await getPendingRun();
  if (!run) return null;
  const simplifiedRoute = simplifyRoute(run.route);
  const finalizedAt = new Date().toISOString();
  const normalizedRun = {
    ...run,
    route: simplifiedRoute,
    lifecycleState: 'saved' as const,
    loggedAtUtc: finalizedAt,
    metricVersions: run.metricVersions || createRunMetricVersionSet(),
    metricsLock: {
      metricsImmutable: true,
      metricsLockedAtUtc: finalizedAt,
      sessionIntegrityState: 'finalized' as const,
    },
  };
  const normalizedRunId = normalizedRun.runId || `run_${new Date(normalizedRun.timestamp).getTime()}`;

  const runsHistory = await AsyncStorage.getItem('runsHistory');
  const runs = safeParseJson<any[]>(runsHistory, []);
  const existing = Array.isArray(runs) ? runs.find((entry: any) => String(entry?.runId || '') === String(normalizedRunId)) : null;
  if (existing) {
    await clearPendingRun('saved');
    return existing as PendingRun;
  }
  runs.push(normalizedRun);
  await AsyncStorage.setItem('runsHistory', JSON.stringify(runs));

  const endTime = new Date(normalizedRun.timestamp || new Date().toISOString());
  const startTime = new Date(endTime.getTime() - Math.max(0, Math.round(normalizedRun.duration || 0)) * 1000);
  const today = assignSessionDayKey(startTime.toISOString(), endTime.toISOString());
  const xpEligibleByTime = isXpEligibleBySettlement(today, finalizedAt);
  const lateLoggedNoXP = !xpEligibleByTime;
  const parsed = await loadDailyLogNormalized(today);

  parsed.workouts.push({
    id: normalizedRunId,
    ts: normalizedRun.timestamp,
    runId: normalizedRunId,
    type: 'Running',
    icon: '🏃',
    met: 9.8,
    duration: Math.floor(run.duration / 60),
    calories: run.calories,
    xp: 0,
    distance: normalizedRun.distance,
    pace: normalizedRun.averagePace,
    time: normalizedRun.timestamp,
    notes: normalizedRun.notes,
    label: normalizedRun.title,
    intensity: normalizedRun.intensityLabel || 'moderate',
    loggedAtUtc: finalizedAt,
    xpEligibleByTime,
    lateLoggedNoXP,
  });

  const runningXpToday = (Array.isArray(parsed.workouts) ? parsed.workouts : []).reduce((sum: number, workout: any) => {
    const type = String(workout?.type || '').toLowerCase();
    const workoutClass = String(workout?.workoutClass || '').toLowerCase();
    if (type !== 'running' && workoutClass !== 'run') return sum;
    return sum + (Number(workout?.xp) || 0);
  }, 0);

  const xpAward = calculateRunningXPAward({
    distanceMiles: normalizedRun.distance,
    currentDailyXP: Number(parsed.dailyXP) || 0,
    currentRunningXP: runningXpToday,
  });
  const enduranceWeight = await getXpWeightForEngine('endurance');
  const behaviorMultipliers = await getBehaviorMultipliers(today);
  const weightedBase = Math.max(0, Math.round((xpAward.baseXP || 0) * enduranceWeight));
  const weightedAwarded = Math.max(
    0,
    Math.round((xpAward.awardedXP || 0) * enduranceWeight * behaviorMultipliers.xpEfficiency)
  );
  const awardedBeforeTimePolicy = Math.min(weightedAwarded, xpAward.globalRemaining);
  const awardedXP = xpEligibleByTime ? awardedBeforeTimePolicy : 0;

  const lastWorkoutIndex = parsed.workouts.length - 1;
  if (lastWorkoutIndex >= 0) {
    parsed.workouts[lastWorkoutIndex] = {
      ...parsed.workouts[lastWorkoutIndex],
      xp: awardedXP,
      xpBase: weightedBase,
      xpRunningRemaining: xpAward.runningRemaining,
      xpDailyRemaining: xpAward.globalRemaining,
      xpWeight: enduranceWeight,
      xpEfficiency: behaviorMultipliers.xpEfficiency,
      workoutClass: 'run',
      engineType: 'endurance',
      verifiedEffort: true,
      sourceAuthority: 'phone',
      ruleVersion: 'winning_day_v2',
      loggedAtUtc: finalizedAt,
      xpEligibleByTime,
      lateLoggedNoXP,
    };
  }

  parsed.dailyXP = (parsed.dailyXP || 0) + awardedXP;

  await saveDailyLog(today, parsed as any);
  clearDailyMetricCache(today);
  await settleBehaviorDay(today);

  const progressData = await AsyncStorage.getItem('userProgress');
  const progress = safeParseJson<any>(progressData, {
        totalXP: 0,
        totalWinningDays: 0,
        currentStreak: 0,
        longestStreak: 0,
        lastWinningDate: null,
      });
  progress.totalXP = (progress.totalXP || 0) + awardedXP;
  await AsyncStorage.setItem('userProgress', JSON.stringify(progress));

  await updateRunHistoryEntry({ timestamp: normalizedRun.timestamp, runId: normalizedRunId }, {
    xpEarned: awardedXP,
    loggedAtUtc: finalizedAt,
    xpEligibleByTime,
    lateLoggedNoXP,
  });

  const canonicalUserId = await getAuthenticatedUserId();
  if (canonicalUserId) {
    await upsertCanonicalRunFromLegacy({
      runId: normalizedRunId,
      userId: canonicalUserId,
      kind: normalizedRun.kind,
      startTimeUtc: startTime.toISOString(),
      endTimeUtc: endTime.toISOString(),
      elapsedTimeSec: normalizedRun.duration,
      pausedTimeSec: Math.max(0, Math.round(normalizedRun.pausedTimeSec || 0)),
      distanceMiles: normalizedRun.distance,
      avgPaceSecPerMile: normalizedRun.averagePace,
      route: normalizedRun.route,
      gpsQuality: normalizedRun.route?.length ? 'medium' : 'unknown',
      xpAwarded: awardedXP,
      notes: normalizedRun.notes,
    });
  }

  await patchCanonicalRun(
    normalizedRunId,
    {
      hrAvailable: normalizedRun.hrAvailable === true,
      gapSegments: (normalizedRun.gapSegments || []).map((gap) => ({
        gapId: gap.gapId,
        startTimeUtc: gap.startTimeUtc,
        endTimeUtc: gap.endTimeUtc,
        type: gap.type,
        estimatorUsed: gap.estimatorUsed,
        estimatedDistanceMeters: Number((Math.max(0, Number(gap.estimatedDistanceMiles) || 0) * 1609.344).toFixed(2)),
        confidenceScore: Math.round(Number(gap.confidenceScore) || 0),
      })),
      estimatedDistanceMeters: Number((Math.max(0, Number(normalizedRun.diagnostics?.estimatedGapDistanceMiles) || 0) * 1609.344).toFixed(2)),
      confidenceSummary: normalizedRun.confidenceSummary,
      metricVersions: normalizedRun.metricVersions,
      metricsLock: normalizedRun.metricsLock,
      winningDayContribution: {
        eligible: !lateLoggedNoXP && (Number(normalizedRun.distance) >= 0.5 || Number(normalizedRun.duration) >= 600),
        reasonCodes: lateLoggedNoXP ? ['late_logged_no_xp'] : [],
      },
      gpsSignalState:
        normalizedRun.diagnostics?.gpsGapSeconds && normalizedRun.diagnostics.gpsGapSeconds > 0 ? 'recovered' : 'good',
      dataQualityNotes: [
        ...(normalizedRun.diagnostics?.gpsGapSeconds && normalizedRun.diagnostics.gpsGapSeconds > 0 ? ['gps_gap_detected'] : []),
        ...(lateLoggedNoXP ? ['late_logged_no_xp'] : []),
      ],
    },
    { allowMetricPatch: true }
  );

  await AsyncStorage.setItem(
    `runMetricLock_${normalizedRunId}`,
    JSON.stringify({
      runId: normalizedRunId,
      metricsImmutable: true,
      metricsLockedAtUtc: finalizedAt,
      metricVersions: normalizedRun.metricVersions,
    })
  );

  await AsyncStorage.setItem(
    `runDraftState_${normalizedRunId}`,
    JSON.stringify({ state: 'saved', updatedAtUtc: new Date().toISOString() })
  );

  await clearPendingRun('saved');
  return {
    ...normalizedRun,
    xpEarned: awardedXP,
    loggedAtUtc: finalizedAt,
    xpEligibleByTime,
    lateLoggedNoXP,
  };
}

// P0 Apple Watch: import a watch-authoritative run finalize payload into the same local-first ledger
// used by phone-recorded runs (runsHistory + dailyLog workouts + behavior settlement).
// This must be idempotent by sessionId-derived runId.
export async function commitWatchFinalizedRun(input: {
  sessionId: string;
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
  hrAvailable?: boolean;
  avgHrBpm?: number | null;
  maxHrBpm?: number | null;
  hrCoverageRatio?: number | null;
  hrConfidence?: number | null;
  route?: unknown[];
  routePreview?: unknown;
}) {
  const runId = `run_watch_${String(input.sessionId)}`;
  if (!input.sessionId) return;

  const runsHistory = await AsyncStorage.getItem('runsHistory');
  const runs = safeParseJson<any[]>(runsHistory, []);
  const existing = Array.isArray(runs) ? runs.find((row: any) => String(row?.runId || '') === runId) : null;

  const finalizedAt = new Date().toISOString();
  const startIso = String(input.startedAtUtc || finalizedAt);
  const endIso = String(input.endedAtUtc || finalizedAt);
  const endTime = new Date(endIso);
  const startTime = new Date(startIso);
  const timestamp = endTime.toISOString();

  const duration = Math.max(0, Math.round(Number(input.elapsedTimeSec) || 0));
  const pausedTimeSec = Math.max(0, Math.round(Number(input.pausedTotalSec) || 0));
  const movingTimeSec = Math.max(0, Math.round(Number(input.movingTimeSec) || Math.max(0, duration - pausedTimeSec)));
  const distance = Math.max(0, Number(input.totalDistanceMiles || 0));
  const rawDistanceMiles =
    input.rawDistanceMiles != null && Number.isFinite(Number(input.rawDistanceMiles))
      ? Math.max(0, Number(input.rawDistanceMiles))
      : null;
  const runEnvironment =
    input.runEnvironment === 'treadmill' || input.runEnvironment === 'outdoor' ? input.runEnvironment : undefined;
  const treadmillCalibrationFactorUsed =
    input.treadmillCalibrationFactorUsed != null && Number.isFinite(Number(input.treadmillCalibrationFactorUsed))
      ? Math.max(0, Number(input.treadmillCalibrationFactorUsed))
      : null;
  const averagePace = input.paceMinPerMile != null && Number(input.paceMinPerMile) > 0
    ? Number(input.paceMinPerMile)
    : (distance > 0 && movingTimeSec > 0 ? (movingTimeSec / 60) / distance : 0);

  const calories =
    input.totalCalories != null && Number.isFinite(Number(input.totalCalories))
      ? Math.max(0, Math.round(Number(input.totalCalories)))
      : 0;

  const hrAvailable = input.hrAvailable === true;
  const hrConfidence =
    hrAvailable && input.hrConfidence != null && Number.isFinite(Number(input.hrConfidence))
      ? Math.max(0, Math.min(100, Math.round(Number(input.hrConfidence))))
      : null;
  const avgHeartRateBpm =
    hrAvailable && input.avgHrBpm != null && Number.isFinite(Number(input.avgHrBpm)) && Number(input.avgHrBpm) > 0
      ? Math.round(Number(input.avgHrBpm))
      : null;
  const maxHeartRateBpm =
    hrAvailable && input.maxHrBpm != null && Number.isFinite(Number(input.maxHrBpm)) && Number(input.maxHrBpm) > 0
      ? Math.round(Number(input.maxHrBpm))
      : null;
  const hrCoverageRatio =
    hrAvailable && input.hrCoverageRatio != null && Number.isFinite(Number(input.hrCoverageRatio))
      ? Math.max(0, Math.min(1, Number(input.hrCoverageRatio)))
      : null;

  // Route previews are timestamp-free; we synthesize per-point timestamps for rendering only.
  // Any splits derived from this geometry must be marked as estimated.
  let splitTimeSource: 'estimated_route_preview' | undefined = undefined;
  const routePoints: LocationPoint[] = (() => {
    const preview = input.routePreview && typeof input.routePreview === 'object' ? (input.routePreview as any) : null;
    const pointsE6 = Array.isArray(preview?.pointsE6) ? (preview.pointsE6 as any[]) : null;
    if (pointsE6 && pointsE6.length >= 2) {
      splitTimeSource = 'estimated_route_preview';
      const startMs = startTime.getTime();
      const endMs = endTime.getTime();
      const spanMs = Math.max(1_000, Number.isFinite(endMs - startMs) ? (endMs - startMs) : 1_000);
      const denom = Math.max(1, pointsE6.length - 1);
      return pointsE6
        .flatMap((pair: any, idx: number) => {
          const latE6 = Number(Array.isArray(pair) ? pair[0] : pair?.latE6);
          const lonE6 = Number(Array.isArray(pair) ? pair[1] : pair?.lonE6);
          if (!Number.isFinite(latE6) || !Number.isFinite(lonE6)) return [];
          const latitude = latE6 / 1e6;
          const longitude = lonE6 / 1e6;
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
          if (latitude < -90 || latitude > 90) return [];
          if (longitude < -180 || longitude > 180) return [];
          const point: LocationPoint = {
            latitude,
            longitude,
            timestamp: Math.round(startMs + (spanMs * idx) / denom),
            altitude: null,
            accuracy: null,
            speed: null,
          };
          return [point];
        })
        .sort((a, b) => a.timestamp - b.timestamp);
    }

    if (Array.isArray(input.route)) {
      return input.route
        .flatMap((raw: any) => {
          const latitude = Number(raw?.latitude);
          const longitude = Number(raw?.longitude);
          const timestamp = Number(raw?.timestamp);
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(timestamp)) return [];
          const altitude = raw?.altitude == null ? null : Number(raw.altitude);
          const accuracy = raw?.accuracy == null ? null : Number(raw.accuracy);
          const speed = raw?.speed == null ? null : Number(raw.speed);
          const point: LocationPoint = {
            latitude,
            longitude,
            timestamp: Math.round(timestamp),
            altitude: Number.isFinite(altitude) ? altitude : null,
            accuracy: Number.isFinite(accuracy) ? accuracy : null,
            speed: Number.isFinite(speed) ? speed : null,
          };
          return [point];
        })
        .sort((a, b) => a.timestamp - b.timestamp);
    }
    return [];
  })();

  if (existing) {
    const patch: Record<string, unknown> = {};

    const existingRoute = Array.isArray(existing?.route) ? (existing.route as any[]) : [];
    const canPatchRoute = existingRoute.length < 2 && routePoints.length >= 2;
    if (canPatchRoute) {
      patch.route = routePoints;
      patch.splitTimeSource = splitTimeSource;
    }

    // Patch in calories/HR when older builds stored zeros but the watch now provides authoritative values.
    const existingCalories = Math.max(0, Math.round(Number(existing?.calories) || 0));
    if (existingCalories <= 0 && calories > 0) {
      patch.calories = calories;
    }

    const existingAvgHr = Math.max(0, Math.round(Number(existing?.avgHeartRate) || 0));
    if (existingAvgHr <= 0 && avgHeartRateBpm && avgHeartRateBpm > 0) {
      patch.avgHeartRate = avgHeartRateBpm;
    }

    const existingMaxHr = Math.max(0, Math.round(Number(existing?.maxHeartRate) || 0));
    if (existingMaxHr <= 0 && maxHeartRateBpm && maxHeartRateBpm > 0) {
      patch.maxHeartRate = maxHeartRateBpm;
    }

    const existingCoverage = Number(existing?.hrCoverageRatio);
    if ((!Number.isFinite(existingCoverage) || existingCoverage <= 0) && hrCoverageRatio != null && hrCoverageRatio > 0) {
      patch.hrCoverageRatio = hrCoverageRatio;
    }

    if (hrAvailable && existing?.hrAvailable !== true) {
      patch.hrAvailable = true;
    }

    const prevConfidence =
      existing?.confidenceSummary && typeof existing.confidenceSummary === 'object' ? (existing.confidenceSummary as any) : null;
    const nextConfidenceSummary = (() => {
      const base = prevConfidence && typeof prevConfidence === 'object' ? prevConfidence : { distanceConfidence: 50, paceConfidence: 50, hrConfidence: null };
      const merged = {
        distanceConfidence: base.distanceConfidence,
        paceConfidence: base.paceConfidence,
        hrConfidence: base.hrConfidence ?? null,
      };
      if (canPatchRoute) {
        merged.distanceConfidence = 80;
        merged.paceConfidence = 80;
      }
      if (hrConfidence != null) {
        merged.hrConfidence = hrConfidence;
      }
      return merged;
    })();

    if (canPatchRoute || 'calories' in patch || 'avgHeartRate' in patch || 'maxHeartRate' in patch || 'hrCoverageRatio' in patch || 'hrAvailable' in patch) {
      patch.confidenceSummary = nextConfidenceSummary;
    }

    if (!Object.keys(patch).length) return;

    await updateRunHistoryEntry({ runId }, patch, { allowMetricPatch: true });

    if (canPatchRoute) {
      const lats = routePoints.map((p) => p.latitude);
      const lons = routePoints.map((p) => p.longitude);
      if (lats.length && lons.length) {
        await patchCanonicalRun(
          runId,
          {
            polylineBounds: {
              minLat: Math.min(...lats),
              minLon: Math.min(...lons),
              maxLat: Math.max(...lats),
              maxLon: Math.max(...lons),
            },
            samplesSummary: {
              totalSamples: routePoints.length,
              samplingStrategyId: 'watch_route_preview_v1',
            } as any,
            gpsSignalState: 'good',
          } as any,
          { allowMetricPatch: true }
        );
      }
    }
    return;
  }

  const today = assignSessionDayKey(startTime.toISOString(), endTime.toISOString());
  const xpEligibleByTime = isXpEligibleBySettlement(today, finalizedAt);
  const lateLoggedNoXP = !xpEligibleByTime;

  const parsed = await loadDailyLogNormalized(today);

  parsed.workouts.push({
    id: runId,
    ts: timestamp,
    runId,
    type: 'Running',
    icon: '🏃',
    met: 9.8,
    duration: Math.floor(duration / 60),
    calories,
    xp: 0,
    distance,
    pace: averagePace,
    time: timestamp,
    notes: 'Recorded on Apple Watch.',
    label: 'Apple Watch Run',
    intensity: 'moderate',
    avgHeartRate: avgHeartRateBpm,
    maxHeartRate: maxHeartRateBpm,
    hrCoverageRatio,
    loggedAtUtc: finalizedAt,
    xpEligibleByTime,
    lateLoggedNoXP,
  });

  const runningXpToday = (Array.isArray(parsed.workouts) ? parsed.workouts : []).reduce((sum: number, workout: any) => {
    const type = String(workout?.type || '').toLowerCase();
    const workoutClass = String(workout?.workoutClass || '').toLowerCase();
    if (type !== 'running' && workoutClass !== 'run') return sum;
    return sum + (Number(workout?.xp) || 0);
  }, 0);

  const xpAward = calculateRunningXPAward({
    distanceMiles: distance,
    currentDailyXP: Number(parsed.dailyXP) || 0,
    currentRunningXP: runningXpToday,
  });
  const enduranceWeight = await getXpWeightForEngine('endurance');
  const behaviorMultipliers = await getBehaviorMultipliers(today);
  const weightedBase = Math.max(0, Math.round((xpAward.baseXP || 0) * enduranceWeight));
  const weightedAwarded = Math.max(0, Math.round((xpAward.awardedXP || 0) * enduranceWeight * behaviorMultipliers.xpEfficiency));
  const awardedBeforeTimePolicy = Math.min(weightedAwarded, xpAward.globalRemaining);
  const awardedXP = xpEligibleByTime ? awardedBeforeTimePolicy : 0;

  const lastWorkoutIndex = parsed.workouts.length - 1;
  if (lastWorkoutIndex >= 0) {
    parsed.workouts[lastWorkoutIndex] = {
      ...parsed.workouts[lastWorkoutIndex],
      xp: awardedXP,
      xpBase: weightedBase,
      xpRunningRemaining: xpAward.runningRemaining,
      xpDailyRemaining: xpAward.globalRemaining,
      xpWeight: enduranceWeight,
      xpEfficiency: behaviorMultipliers.xpEfficiency,
      workoutClass: 'run',
      engineType: 'endurance',
      verifiedEffort: true,
      sourceAuthority: 'watch',
      ruleVersion: 'winning_day_v2',
      loggedAtUtc: finalizedAt,
      xpEligibleByTime,
      lateLoggedNoXP,
    };
  }

  parsed.dailyXP = (parsed.dailyXP || 0) + awardedXP;
  await saveDailyLog(today, parsed as any);
  clearDailyMetricCache(today);
  await settleBehaviorDay(today);

  const progressData = await AsyncStorage.getItem('userProgress');
  const progress = safeParseJson<any>(progressData, {
    totalXP: 0,
    totalWinningDays: 0,
    currentStreak: 0,
    longestStreak: 0,
    lastWinningDate: null,
  });
  progress.totalXP = (progress.totalXP || 0) + awardedXP;
  await AsyncStorage.setItem('userProgress', JSON.stringify(progress));

  const runRow = {
    runId,
    timestamp,
    distance,
    rawDistanceMiles,
    runEnvironment,
    treadmillCalibrationFactorUsed,
    treadmillEnteredDistanceMiles: null,
    treadmillScaleFactor: null,
    duration,
    pausedTimeSec,
    averagePace,
    calories,
    xpEarned: awardedXP,
    route: routePoints,
    splitTimeSource,
    reactions: [],
    title: 'Apple Watch Run',
    notes: 'Recorded on Apple Watch.',
    intensityLabel: 'moderate',
    metricVersions: createRunMetricVersionSet(),
    metricsLock: {
      metricsImmutable: true,
      metricsLockedAtUtc: finalizedAt,
      sessionIntegrityState: 'finalized',
    },
    hrAvailable,
    confidenceSummary: {
      distanceConfidence: routePoints.length ? 80 : 50,
      paceConfidence: routePoints.length ? 80 : 50,
      hrConfidence,
    },
    avgHeartRate: avgHeartRateBpm,
    maxHeartRate: maxHeartRateBpm,
    hrCoverageRatio,
    loggedAtUtc: finalizedAt,
    xpEligibleByTime,
    lateLoggedNoXP,
  };
  runs.push(runRow);
  await AsyncStorage.setItem('runsHistory', JSON.stringify(runs));

  // Also backfill canonical run storage for newer features.
  const canonicalUserId = await getAuthenticatedUserId();
  if (canonicalUserId) {
    await upsertCanonicalRunFromLegacy({
      runId,
      userId: canonicalUserId,
      kind:
        runEnvironment === 'outdoor'
          ? 'gps_outdoor'
          : runEnvironment === 'treadmill'
          ? 'manual_treadmill'
          : routePoints.length
          ? 'gps_outdoor'
          : 'manual_treadmill',
      startTimeUtc: startTime.toISOString(),
      endTimeUtc: endTime.toISOString(),
      elapsedTimeSec: duration,
      pausedTimeSec,
      distanceMiles: distance,
      avgPaceSecPerMile: averagePace,
      route: routePoints,
      gpsQuality: routePoints.length ? 'unknown' : 'unknown',
      xpAwarded: awardedXP,
      notes: 'Recorded on Apple Watch.',
      hrAvailable,
      hrConfidence,
    });
  }
}

// Garmin P0 (summary-only): import a Garmin-watch authoritative workout summary into the local-first run ledger.
// This is intentionally conservative:
// - no route polyline (summary-only)
// - HR treated as unavailable in core run surfaces until we implement a stream-backed HR model
// - idempotent by localSessionId-derived runId
export async function commitGarminFinalizedRun(input: {
  localSessionId: string;
  startTimestamp: string;
  endTimestamp: string;
  elapsedTimeSeconds: number;
  distanceMeters: number | null;
  calories: number | null;
  sessionRecovered?: boolean;
  recoveryReason?: string | null;
  recoveryDetectedAt?: string | null;
  recoveryNotes?: string | null;
  // Optional HR fields (summary-only). We store the metrics if provided,
  // but never imply HR confidence without a real sample-backed stream model.
  hrAvailable?: boolean;
  avgHeartRateBpm?: number | null;
  maxHeartRateBpm?: number | null;
  // Present in Garmin summary payloads but not used yet for confidence in v1.
  // Stored for future HR stream parity; never used to imply HR availability.
  hrCoverageRatio?: number | null;
}) {
  const runId = `run_garmin_${String(input.localSessionId || '')}`;
  if (!input.localSessionId) return;

  const runsHistory = await AsyncStorage.getItem('runsHistory');
  const runs = safeParseJson<any[]>(runsHistory, []);
  const existing = Array.isArray(runs) ? runs.find((row: any) => String(row?.runId || '') === runId) : null;
  if (existing) return;

  const finalizedAt = new Date().toISOString();
  const startIso = String(input.startTimestamp || finalizedAt);
  const endIso = String(input.endTimestamp || finalizedAt);
  const endTime = new Date(endIso);
  const startTime = new Date(startIso);
  const timestamp = endTime.toISOString();

  const duration = Math.max(0, Math.round(Number(input.elapsedTimeSeconds) || 0));
  const pausedTimeSec = 0;
  const movingTimeSec = duration;
  const distanceMiles = Math.max(0, (Number(input.distanceMeters || 0) || 0) / 1609.344);
  const averagePace =
    distanceMiles > 0 && movingTimeSec > 0 ? (movingTimeSec / 60) / distanceMiles : 0;
  const calories = input.calories == null ? 0 : Math.max(0, Math.round(Number(input.calories) || 0));
  const hrAvailable =
    input.hrAvailable === true &&
    input.avgHeartRateBpm != null &&
    Number.isFinite(Number(input.avgHeartRateBpm)) &&
    Number(input.avgHeartRateBpm) > 0;
  const avgHeartRateBpm = hrAvailable ? Math.round(Number(input.avgHeartRateBpm)) : null;
  const maxHeartRateBpm =
    hrAvailable && input.maxHeartRateBpm != null && Number.isFinite(Number(input.maxHeartRateBpm))
      ? Math.round(Number(input.maxHeartRateBpm))
      : null;
  const hrCoverageRatio =
    hrAvailable && input.hrCoverageRatio != null && Number.isFinite(Number(input.hrCoverageRatio))
      ? Math.max(0, Math.min(1, Number(input.hrCoverageRatio)))
      : null;

  const today = assignSessionDayKey(startTime.toISOString(), endTime.toISOString());
  // Time policy: XP eligibility is evaluated against the session timestamp, not import time.
  const xpEligibleByTime = isXpEligibleBySettlement(today, endIso);
  const lateLoggedNoXP = !xpEligibleByTime;

  const parsed = await loadDailyLogNormalized(today);
  const sessionRecovered = input.sessionRecovered === true;
  const importNotes = sessionRecovered
    ? 'Imported from Garmin summary (recovered session; may be partial).'
    : 'Imported from Garmin summary.';
  const recoveryReason =
    sessionRecovered && typeof input.recoveryReason === 'string' && input.recoveryReason.trim()
      ? input.recoveryReason.trim()
      : sessionRecovered
      ? 'unknown'
      : null;
  const recoveryDetectedAt =
    sessionRecovered && typeof input.recoveryDetectedAt === 'string' && Number.isFinite(new Date(input.recoveryDetectedAt).getTime())
      ? input.recoveryDetectedAt
      : sessionRecovered
      ? finalizedAt
      : null;
  const recoveryNotesDevice =
    sessionRecovered && typeof input.recoveryNotes === 'string' && input.recoveryNotes.trim()
      ? input.recoveryNotes.trim()
      : null;

  parsed.workouts.push({
    id: runId,
    ts: timestamp,
    runId,
    type: 'Running',
    icon: '🏃',
    met: 9.8,
    duration: Math.floor(duration / 60),
    calories,
    xp: 0,
    distance: distanceMiles,
    pace: averagePace,
    time: timestamp,
    notes: importNotes,
    note: importNotes,
    label: 'Garmin Run',
    intensity: 'moderate',
    avgHeartRate: avgHeartRateBpm,
    maxHeartRate: maxHeartRateBpm,
    hrCoverageRatio,
    sessionRecovered,
    recoveryReason: sessionRecovered ? recoveryReason : undefined,
    recoveryDetectedAt: sessionRecovered ? recoveryDetectedAt : undefined,
    recoveryNotes: sessionRecovered ? (recoveryNotesDevice || importNotes) : undefined,
    loggedAtUtc: endIso,
    importedAtUtc: finalizedAt,
    xpEligibleByTime,
    lateLoggedNoXP,
  });

  const runningXpToday = (Array.isArray(parsed.workouts) ? parsed.workouts : []).reduce((sum: number, workout: any) => {
    const type = String(workout?.type || '').toLowerCase();
    const workoutClass = String(workout?.workoutClass || '').toLowerCase();
    if (type !== 'running' && workoutClass !== 'run') return sum;
    return sum + (Number(workout?.xp) || 0);
  }, 0);

  const xpAward = calculateRunningXPAward({
    distanceMiles,
    currentDailyXP: Number(parsed.dailyXP) || 0,
    currentRunningXP: runningXpToday,
  });
  const enduranceWeight = await getXpWeightForEngine('endurance');
  const behaviorMultipliers = await getBehaviorMultipliers(today);
  const weightedBase = Math.max(0, Math.round((xpAward.baseXP || 0) * enduranceWeight));
  const weightedAwarded = Math.max(0, Math.round((xpAward.awardedXP || 0) * enduranceWeight * behaviorMultipliers.xpEfficiency));
  const awardedBeforeTimePolicy = Math.min(weightedAwarded, xpAward.globalRemaining);
  const awardedXP = xpEligibleByTime ? awardedBeforeTimePolicy : 0;

  const lastWorkoutIndex = parsed.workouts.length - 1;
  if (lastWorkoutIndex >= 0) {
    parsed.workouts[lastWorkoutIndex] = {
      ...parsed.workouts[lastWorkoutIndex],
      xp: awardedXP,
      xpBase: weightedBase,
      xpRunningRemaining: xpAward.runningRemaining,
      xpDailyRemaining: xpAward.globalRemaining,
      xpWeight: enduranceWeight,
      xpEfficiency: behaviorMultipliers.xpEfficiency,
      workoutClass: 'run',
      engineType: 'endurance',
      verifiedEffort: true,
      sourceAuthority: 'import',
      sourceLabel: 'Garmin',
      ruleVersion: 'winning_day_v2',
      loggedAtUtc: endIso,
      importedAtUtc: finalizedAt,
      xpEligibleByTime,
      lateLoggedNoXP,
    };
  }

  parsed.dailyXP = (parsed.dailyXP || 0) + awardedXP;
  await saveDailyLog(today, parsed as any);
  clearDailyMetricCache(today);
  await settleBehaviorDay(today);

  const progressData = await AsyncStorage.getItem('userProgress');
  const progress = safeParseJson<any>(progressData, {
    totalXP: 0,
    totalWinningDays: 0,
    currentStreak: 0,
    longestStreak: 0,
    lastWinningDate: null,
  });
  progress.totalXP = (progress.totalXP || 0) + awardedXP;
  await AsyncStorage.setItem('userProgress', JSON.stringify(progress));

	  const runRow = {
	    runId,
	    timestamp,
	    distance: distanceMiles,
	    duration,
	    pausedTimeSec,
	    averagePace,
	    calories,
	    xpEarned: awardedXP,
	    route: [],
	    reactions: [],
	    title: 'Garmin Run',
	    notes: importNotes,
	    intensityLabel: 'moderate',
		    metricVersions: createRunMetricVersionSet(),
		    metricsLock: {
		      metricsImmutable: true,
		      metricsLockedAtUtc: finalizedAt,
		      sessionIntegrityState: 'finalized',
		    },
		    // HR truth: we may store HR metrics if provided by Garmin,
		    // but we never imply confidence without a real sample-backed stream model.
		    hrAvailable,
		    confidenceSummary: {
		      distanceConfidence: distanceMiles > 0 ? 60 : 40,
		      paceConfidence: distanceMiles > 0 ? 60 : 40,
		      hrConfidence: null,
		    },
		    avgHeartRate: avgHeartRateBpm,
		    maxHeartRate: maxHeartRateBpm,
		    hrCoverageRatio,
		    sessionRecovered,
		    recoveryReason: sessionRecovered ? recoveryReason : null,
		    recoveryDetectedAt: sessionRecovered ? recoveryDetectedAt : null,
		    recoveryNotes: sessionRecovered ? (recoveryNotesDevice || importNotes) : null,
		    loggedAtUtc: endIso,
		    importedAtUtc: finalizedAt,
		    xpEligibleByTime,
		    lateLoggedNoXP,
		  };
  runs.push(runRow);
  await AsyncStorage.setItem('runsHistory', JSON.stringify(runs));

  await upsertCanonicalRunFromLegacy({
    runId,
    userId: 'local_user',
    kind: distanceMiles > 0 ? 'gps_outdoor' : 'manual_treadmill',
    startTimeUtc: startTime.toISOString(),
    endTimeUtc: endTime.toISOString(),
    elapsedTimeSec: duration,
    pausedTimeSec,
    distanceMiles,
    avgPaceSecPerMile: averagePace,
    route: [],
	  gpsQuality: 'unknown',
	  xpAwarded: awardedXP,
	  notes: 'Imported from Garmin summary.',
	  hrAvailable,
	  hrConfidence: null,
	});
}
