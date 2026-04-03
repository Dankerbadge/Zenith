import { computeEffort, getXpWeightForEngine } from './effortEngine';
import { assignSessionDayKey } from './dayAssignment';
import { getDailyLog, saveDailyLog, todayKey, type WorkoutEntry } from './storageUtils';
import { createWorkoutMetricVersionSet } from './workoutMetricVersions';

export type LiftClassificationTag = 'strength' | 'hypertrophy' | 'conditioning' | 'mobility';

export type LiftTagSessionInput = {
  sessionId: string;
  startTimeUtc: string;
  endTimeUtc: string;
  activeCalories: number;
  avgHeartRate?: number;
  peakHeartRate?: number;
  setCount?: number;
  classificationTag?: LiftClassificationTag;
  importedSource?: 'apple_health' | 'health_connect' | 'garmin_watch';
  sourceAuthority?: 'watch' | 'phone' | 'import';
  xpEfficiency?: number;
  xpWeight?: number;
};

export type LiftTagSessionOutput = WorkoutEntry & {
  sessionId: string;
  durationSec: number;
  avgHeartRate?: number;
  peakHeartRate?: number;
};

function secondsBetween(startIso: string, endIso: string): number {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  const delta = Math.round((end - start) / 1000);
  return Number.isFinite(delta) ? Math.max(0, delta) : 0;
}

function mapIntensity(avgHeartRate?: number): 'easy' | 'moderate' | 'hard' {
  const hr = Number(avgHeartRate) || 0;
  if (hr >= 150) return 'hard';
  if (hr >= 120) return 'moderate';
  return 'easy';
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

export function buildLiftTagSession(input: LiftTagSessionInput): LiftTagSessionOutput {
  const durationSec = secondsBetween(input.startTimeUtc, input.endTimeUtc);
  const durationMin = Math.max(1, Math.round(durationSec / 60));
  const calories = Math.max(0, Math.round(Number(input.activeCalories) || 0));
  const intensity = mapIntensity(input.avgHeartRate);

  const effort = computeEffort({
    durationMin,
    activeCalories: calories,
    avgHeartRate: input.avgHeartRate,
    peakHeartRate: input.peakHeartRate,
    engine: 'strength',
    intensity,
    setCount: input.setCount,
  });
  const xpWeight = Math.max(0.75, Math.min(1.25, Number(input.xpWeight) || 1));
  const xpBase = Math.max(4, Math.round(4 + durationMin * 0.18 + effort.effortScore * 0.07 + (input.setCount || 0) * 0.5));
  const xpEfficiency = Math.max(0.5, Math.min(1, Number(input.xpEfficiency) || 1));
  const xpAwarded = Math.max(1, Math.round(xpBase * xpWeight * xpEfficiency));
  const finalizedAt = input.endTimeUtc || new Date().toISOString();

  return {
    id: `lift_${input.sessionId}`,
    sessionId: input.sessionId,
    ts: input.endTimeUtc,
    type: 'strength',
    intensity,
    durationMin,
    minutes: durationMin,
    caloriesBurned: calories,
    label: 'Lift Tag Session',
    note: 'Captured from authoritative strength workout session.',
    imported: input.importedSource != null,
    importedSource: input.importedSource,
    importedAt: input.importedSource ? new Date().toISOString() : undefined,
    sourceLabel:
      input.importedSource === 'apple_health'
        ? 'Apple Health'
        : input.importedSource === 'health_connect'
          ? 'Health Connect'
          : input.importedSource === 'garmin_watch'
            ? 'Garmin'
            : 'Zenith Watch',
    workoutClass: 'lift',
    engineType: 'strength',
    effortUnits: effort.effortUnits,
    effortScore: effort.effortScore,
    intensityBand: effort.intensityBand,
    effortConfidence: effort.confidence,
    verifiedEffort: true,
    setCount: input.setCount,
    classificationTag: input.classificationTag,
    sourceAuthority: input.sourceAuthority || (input.importedSource ? 'import' : 'watch'),
    ruleVersion: 'winning_day_v2',
    avgHeartRate: input.avgHeartRate,
    peakHeartRate: input.peakHeartRate,
    xpBase,
    xpWeight,
    xpEfficiency,
    xpAwarded,
    metricVersions: createWorkoutMetricVersionSet(),
    metricsLock: {
      metricsImmutable: true,
      metricsLockedAtUtc: finalizedAt,
      sessionIntegrityState: 'finalized',
    },
    durationSec,
  };
}

export async function saveLiftTagSession(
  input: LiftTagSessionInput,
  dateKey?: string
): Promise<LiftTagSessionOutput> {
  const xpWeight = await getXpWeightForEngine('strength');
  const entry = buildLiftTagSession({ ...input, xpWeight });
  const date = dateKey || assignSessionDayKey(input.startTimeUtc, input.endTimeUtc) || todayKey(new Date(entry.ts));
  const log = await getDailyLog(date);
  await saveDailyLog(date, {
    ...log,
    workouts: mergeWorkout(log, entry),
  });
  return entry;
}
