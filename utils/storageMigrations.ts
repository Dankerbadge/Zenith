import AsyncStorage from '@react-native-async-storage/async-storage';
import { listCanonicalRuns, patchCanonicalRun, upsertCanonicalRunFromLegacy } from './canonicalRunService';
import { RUNNING_SCHEMA_VERSION } from './canonicalRunningSchema';
import { createRunMetricVersionSet } from './runMetricVersions';
import { createWorkoutMetricVersionSet } from './workoutMetricVersions';
import {
  getUserProfile,
  safeParseJson,
  setStorageItem,
  STORAGE_SCHEMA_VERSION,
  USER_PROFILE_KEY,
  WEIGHT_LOG_KEY,
} from './storageUtils';
import { getAuthenticatedUserId } from './authIdentity';

type LegacyProfile = {
  dailyCalorieTarget?: number;
  waterGoal?: number;
  calorieTarget?: number;
  [key: string]: unknown;
};

export async function runStorageMigrations() {
  try {
    const profile = (await getUserProfile()) as LegacyProfile & { _schemaVersion?: number; goals?: Record<string, unknown> };
    const hasProfile = Boolean(profile && Object.keys(profile).length > 0);

    if (hasProfile) {
      const currentVersion = Number(profile._schemaVersion || 0);
      if (currentVersion < STORAGE_SCHEMA_VERSION) {
        const nextProfile = { ...profile } as LegacyProfile & {
          _schemaVersion: number;
          goals: {
            proteinTarget?: number;
            waterTargetOz?: number;
            activeRestTargetMin?: number;
            caloriesTarget?: number;
          };
        };

        nextProfile.goals = {
          ...(typeof profile.goals === 'object' && profile.goals ? (profile.goals as Record<string, unknown>) : {}),
          waterTargetOz:
            Number((profile.goals as any)?.waterTargetOz) || Number(profile.waterGoal) || Number((profile.goals as any)?.waterTargetOz) || 120,
          activeRestTargetMin: Number((profile.goals as any)?.activeRestTargetMin) || 20,
          proteinTarget: Number((profile.goals as any)?.proteinTarget) || 170,
          caloriesTarget:
            Number((profile.goals as any)?.caloriesTarget) ||
            Number(profile.calorieTarget) ||
            Number(profile.dailyCalorieTarget) ||
            undefined,
        };
        nextProfile._schemaVersion = STORAGE_SCHEMA_VERSION;

        await setStorageItem(USER_PROFILE_KEY, nextProfile);
      }

      // Migrate legacy weightLogs -> weightLog (same top-level intent, canonical key).
      const canonicalWeightLog = await AsyncStorage.getItem(WEIGHT_LOG_KEY);
      if (!canonicalWeightLog) {
        const legacyWeightLogRaw = await AsyncStorage.getItem('weightLogs');
        const legacyWeightLog = safeParseJson<any[]>(legacyWeightLogRaw, []);
        if (Array.isArray(legacyWeightLog) && legacyWeightLog.length) {
          await AsyncStorage.setItem(WEIGHT_LOG_KEY, JSON.stringify(legacyWeightLog));
        }
      }
    }

    await migrateRunsHistorySchema();
    await migrateWorkoutEntriesSchema();
    await migrateLegacyRunsToCanonical();
    await migrateCanonicalRunSchemaV2();
    await migrateSegmentSchema();
    await migrateSegmentAttemptsSchema();
    await migrateChallengeSchema();
  } catch {
    // Non-blocking by design: app should remain usable if migration fails.
  }
}

async function migrateWorkoutEntriesSchema() {
  const keys = await AsyncStorage.getAllKeys();
  const dailyKeys = keys.filter((key) => key.startsWith('dailyLog_'));
  if (!dailyKeys.length) return;

  const pairs = await AsyncStorage.multiGet(dailyKeys);
  const nowIso = new Date().toISOString();
  const writes: Array<[string, string]> = [];

  pairs.forEach(([key, raw]) => {
    const log = safeParseJson<any>(raw, {});
    const workouts = Array.isArray(log?.workouts) ? log.workouts : [];
    if (!workouts.length) return;

    let changed = false;
    const migrated = workouts.map((workout: any) => {
      if (!workout || typeof workout !== 'object') return workout;
      const needsMetricVersions = !workout.metricVersions;
      const needsLock = !workout.metricsLock;
      if (!needsMetricVersions && !needsLock) return workout;

      changed = true;
      const lockedAt = String(
        workout?.metricsLock?.metricsLockedAtUtc ||
          workout?.loggedAtUtc ||
          workout?.importedAt ||
          workout?.ts ||
          nowIso
      );

      return {
        ...workout,
        metricVersions: workout.metricVersions || createWorkoutMetricVersionSet(),
        metricsLock:
          workout.metricsLock && typeof workout.metricsLock === 'object'
            ? {
                metricsImmutable: workout.metricsLock.metricsImmutable !== false,
                metricsLockedAtUtc: lockedAt,
                sessionIntegrityState: workout.metricsLock.sessionIntegrityState || 'finalized',
              }
            : {
                metricsImmutable: true,
                metricsLockedAtUtc: lockedAt,
                sessionIntegrityState: 'finalized',
              },
      };
    });

    if (changed) {
      writes.push([
        key,
        JSON.stringify({
          ...log,
          workouts: migrated,
        }),
      ]);
    }
  });

  if (writes.length) {
    await AsyncStorage.multiSet(writes);
  }
}

async function migrateRunsHistorySchema() {
  const raw = await AsyncStorage.getItem('runsHistory');
  const runs = safeParseJson<any[]>(raw, []);
  if (!Array.isArray(runs) || !runs.length) return;

  let changed = false;
  const nowIso = new Date().toISOString();
  const migrated = runs.map((run) => {
    if (!run || typeof run !== 'object') return run;

    const timestamp = String(run.timestamp || '');
    const derivedRunId =
      String(run.runId || '').trim() ||
      (timestamp ? `run_${new Date(timestamp).getTime()}` : `run_${Date.now()}`);
    const lockTimestamp = String(run?.metricsLock?.metricsLockedAtUtc || run.loggedAtUtc || timestamp || nowIso);
    const hasMetricVersions = Boolean(run.metricVersions);
    const hasMetricsLock = Boolean(run.metricsLock?.metricsImmutable === true);
    const hasLoggedAt = typeof run.loggedAtUtc === 'string' && run.loggedAtUtc.length > 0;
    const hasXpEligibleByTime = typeof run.xpEligibleByTime === 'boolean';
    const hasLateLoggedFlag = typeof run.lateLoggedNoXP === 'boolean';

    const next = {
      ...run,
      runId: derivedRunId,
      metricVersions: run.metricVersions || createRunMetricVersionSet(),
      metricsLock:
        run.metricsLock && typeof run.metricsLock === 'object'
          ? {
              metricsImmutable: run.metricsLock.metricsImmutable !== false,
              metricsLockedAtUtc: lockTimestamp,
              sessionIntegrityState: run.metricsLock.sessionIntegrityState || 'finalized',
            }
          : {
              metricsImmutable: true,
              metricsLockedAtUtc: lockTimestamp,
              sessionIntegrityState: 'finalized',
            },
      loggedAtUtc: hasLoggedAt ? run.loggedAtUtc : lockTimestamp,
      xpEligibleByTime: hasXpEligibleByTime ? run.xpEligibleByTime : true,
      lateLoggedNoXP: hasLateLoggedFlag ? run.lateLoggedNoXP : false,
    };

    if (
      String(run.runId || '') !== derivedRunId ||
      !hasMetricVersions ||
      !hasMetricsLock ||
      !hasLoggedAt ||
      !hasXpEligibleByTime ||
      !hasLateLoggedFlag
    ) {
      changed = true;
    }

    return next;
  });

  if (changed) {
    await AsyncStorage.setItem('runsHistory', JSON.stringify(migrated));
  }
}

async function migrateCanonicalRunSchemaV2() {
  const runs = await listCanonicalRuns();
  if (!runs.length) return;

  for (const run of runs) {
    const needsMetricVersions = !run.metricVersions;
    const needsConfidenceSummary = !run.confidenceSummary;
    const hasLegacyHrConfidence = typeof (run as any)?.confidenceSummary?.hrConfidence === 'number';
    const needsHrAvailability = typeof (run as any)?.hrAvailable !== 'boolean';
    const needsLock = !run.metricsLock;
    const schemaStale = Number(run.schemaVersion || 0) < RUNNING_SCHEMA_VERSION;
    const needsGaps = !Array.isArray(run.gapSegments);
    if (!needsMetricVersions && !needsConfidenceSummary && !hasLegacyHrConfidence && !needsHrAvailability && !needsLock && !schemaStale && !needsGaps) continue;

    const lockedAt = run.metricsLock?.metricsLockedAtUtc || run.updatedAtUtc || new Date().toISOString();
    const hrAvailable = (run as any)?.hrAvailable === true;
    await patchCanonicalRun(
      run.runId,
      {
        metricVersions: run.metricVersions || createRunMetricVersionSet(),
        hrAvailable,
        confidenceSummary: run.confidenceSummary
          ? {
              ...run.confidenceSummary,
              // P0 truthfulness: keep HR confidence only when HR was actually recorded.
              hrConfidence: hrAvailable ? (run as any)?.confidenceSummary?.hrConfidence ?? null : null,
            }
          : {
              distanceConfidence: run.gpsQuality === 'low' ? 45 : run.gpsQuality === 'high' ? 85 : 65,
              paceConfidence: run.gpsQuality === 'low' ? 40 : run.gpsQuality === 'high' ? 82 : 62,
              hrConfidence: null,
            },
        metricsLock: run.metricsLock || {
          metricsImmutable: true,
          metricsLockedAtUtc: lockedAt,
          sessionIntegrityState: 'finalized',
        },
        gapSegments: Array.isArray(run.gapSegments) ? run.gapSegments : [],
        estimatedDistanceMeters: Number(run.estimatedDistanceMeters || 0),
        schemaVersion: RUNNING_SCHEMA_VERSION,
      },
      { allowMetricPatch: true }
    );
  }
}

async function migrateLegacyRunsToCanonical() {
  const authenticatedUserId = await getAuthenticatedUserId();
  if (!authenticatedUserId) return;
  const existing = await listCanonicalRuns();
  const existingIds = new Set(existing.map((run) => run.runId));
  const runsHistoryRaw = await AsyncStorage.getItem('runsHistory');
  const runsHistory = safeParseJson<any[]>(runsHistoryRaw, []);
  if (!Array.isArray(runsHistory) || !runsHistory.length) return;

  for (const run of runsHistory) {
    const timestamp = String(run?.timestamp || '');
    if (!timestamp) continue;
    const runId = String(run?.runId || `run_${new Date(timestamp).getTime()}`);
    if (existingIds.has(runId)) continue;
    const duration = Math.max(0, Number(run?.duration) || 0);
    const end = new Date(timestamp);
    const start = new Date(end.getTime() - duration * 1000);
    await upsertCanonicalRunFromLegacy({
      runId,
      userId: authenticatedUserId,
      startTimeUtc: start.toISOString(),
      endTimeUtc: end.toISOString(),
      elapsedTimeSec: duration,
      pausedTimeSec: Math.max(0, Number(run?.pausedTimeSec) || 0),
      distanceMiles: Math.max(0, Number(run?.distance) || 0),
      avgPaceSecPerMile: Math.max(0, Number(run?.averagePace) || 0),
      route: Array.isArray(run?.route) ? run.route : [],
      gpsQuality: Array.isArray(run?.route) && run.route.length ? 'medium' : 'unknown',
      xpAwarded: Math.max(0, Number(run?.xpEarned) || 0),
      notes: typeof run?.notes === 'string' ? run.notes : undefined,
    });
  }
}

async function migrateSegmentSchema() {
  const raw = await AsyncStorage.getItem('runSegments');
  const segments = safeParseJson<any[]>(raw, []);
  if (!Array.isArray(segments) || !segments.length) return;

  let changed = false;
  const migrated = segments.map((segment) => {
    if (!segment || typeof segment !== 'object') return segment;
    const isPrivate = segment.isPrivate !== false;
    const visibility = segment.visibility || (isPrivate ? 'private' : 'friends');
    const distanceMiles = Number(segment.distanceMiles) || 0;
    const next = {
      ...segment,
      visibility,
      direction: segment.direction || 'forward',
      schemaVersion: Number(segment.schemaVersion) || RUNNING_SCHEMA_VERSION,
      distanceMetersApprox:
        typeof segment.distanceMetersApprox === 'number'
          ? segment.distanceMetersApprox
          : Number((distanceMiles * 1609.344).toFixed(2)),
      startMarker:
        segment.startMarker ||
        (segment.startPoint
          ? { lat: Number(segment.startPoint.latitude), lon: Number(segment.startPoint.longitude), toleranceRadiusMeters: 35 }
          : undefined),
      endMarker:
        segment.endMarker ||
        (segment.endPoint
          ? { lat: Number(segment.endPoint.latitude), lon: Number(segment.endPoint.longitude), toleranceRadiusMeters: 35 }
          : undefined),
      updatedAt: new Date().toISOString(),
    };
    if (
      segment.visibility !== next.visibility ||
      segment.direction !== next.direction ||
      Number(segment.schemaVersion) !== Number(next.schemaVersion) ||
      typeof segment.distanceMetersApprox !== 'number' ||
      !segment.startMarker ||
      !segment.endMarker
    ) {
      changed = true;
    }
    return next;
  });

  if (changed) {
    await AsyncStorage.setItem('runSegments', JSON.stringify(migrated));
  }
}

async function migrateSegmentAttemptsSchema() {
  const raw = await AsyncStorage.getItem('segmentAttempts');
  const attempts = safeParseJson<any[]>(raw, []);
  if (!Array.isArray(attempts) || !attempts.length) return;

  let changed = false;
  const migrated = attempts.map((attempt) => {
    if (!attempt || typeof attempt !== 'object') return attempt;
    const score = Number(attempt.score) || 0;
    const quality = attempt.quality || (score >= 0.82 ? 'high' : score >= 0.7 ? 'medium' : 'low');
    const next = {
      ...attempt,
      quality,
      qualityReasons: Array.isArray(attempt.qualityReasons) ? attempt.qualityReasons : quality === 'low' ? ['low_match_score'] : [],
      startSampleIndex: Number.isFinite(Number(attempt.startSampleIndex)) ? Number(attempt.startSampleIndex) : Number(attempt.startIndex) || 0,
      endSampleIndex: Number.isFinite(Number(attempt.endSampleIndex)) ? Number(attempt.endSampleIndex) : Number(attempt.endIndex) || 0,
      detectionVersionId: attempt.detectionVersionId || 'segment_detect_v1',
      updatedAt: attempt.updatedAt || new Date().toISOString(),
      schemaVersion: Number(attempt.schemaVersion) || RUNNING_SCHEMA_VERSION,
    };
    if (
      attempt.quality !== next.quality ||
      !Array.isArray(attempt.qualityReasons) ||
      !attempt.detectionVersionId ||
      typeof attempt.startSampleIndex !== 'number' ||
      typeof attempt.endSampleIndex !== 'number' ||
      Number(attempt.schemaVersion) !== Number(next.schemaVersion)
    ) {
      changed = true;
    }
    return next;
  });

  if (changed) {
    await AsyncStorage.setItem('segmentAttempts', JSON.stringify(migrated));
  }
}

async function migrateChallengeSchema() {
  const definitionsRaw = await AsyncStorage.getItem('canonicalChallenges');
  const participantsRaw = await AsyncStorage.getItem('canonicalChallengeParticipants');
  const definitions = safeParseJson<any[]>(definitionsRaw, []);
  const participants = safeParseJson<any[]>(participantsRaw, []);

  if (Array.isArray(definitions) && definitions.length) {
    const migratedDefinitions = definitions.map((row) => ({
      visibility: 'private',
      status: 'draft',
      rewardXp: 0,
      penaltyXp: 0,
      penaltyRule: 'none',
      eligibleRunKinds: ['gps_outdoor', 'manual_treadmill'],
      grantsWinningDayCredit: false,
      evaluationMode: 'best_attempt_in_window',
      tieBreakPolicy: 'fastest_time',
      createdAtUtc: new Date().toISOString(),
      ...row,
      updatedAtUtc: new Date().toISOString(),
      schemaVersion: Number(row?.schemaVersion) || RUNNING_SCHEMA_VERSION,
    }));
    const needsUpdate = definitions.some((row) => !row?.schemaVersion || !row?.eligibleRunKinds || !row?.evaluationMode);
    if (needsUpdate) {
      await AsyncStorage.setItem('canonicalChallenges', JSON.stringify(migratedDefinitions));
    }
  }

  if (Array.isArray(participants) && participants.length) {
    const migratedParticipants = participants.map((row) => ({
      acceptanceStatus: 'pending',
      outcomeStatus: 'no_attempt',
      outcomeReasonCodes: [],
      linkedRunIds: [],
      linkedAttemptIds: [],
      minQualityRequired: 'medium',
      invalidationReasons: [],
      xpSettlementDelta: 0,
      xpSettlementAppliedAtUtc: null,
      createdAtUtc: new Date().toISOString(),
      ...row,
      updatedAtUtc: new Date().toISOString(),
      schemaVersion: Number(row?.schemaVersion) || RUNNING_SCHEMA_VERSION,
    }));
    const needsUpdate = participants.some((row) => !row?.schemaVersion || !Array.isArray(row?.linkedRunIds));
    if (needsUpdate) {
      await AsyncStorage.setItem('canonicalChallengeParticipants', JSON.stringify(migratedParticipants));
    }
  }
}
