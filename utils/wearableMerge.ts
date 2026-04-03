import { type DailyLog } from './storageUtils';

export type MergeSource = 'zenith' | 'wearable' | 'none';

export type MergedWearableSignals = {
  steps?: number;
  activeEnergy?: number;
  sleepMinutes?: number;
  restingHeartRate?: number;
  activityEnergyForMetrics: number;
  activityEnergySource: MergeSource;
  hasWearableSignals: boolean;
};

function asNumber(value: unknown): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

function sumZenithActivityEnergy(log: DailyLog): number {
  const workouts = Array.isArray(log.workouts) ? log.workouts : [];
  const activeRest = Array.isArray(log.activeRest) ? log.activeRest : [];

  const workoutEnergy = workouts.reduce((sum, session) => {
    const sessionEnergy = Number((session as any)?.caloriesBurned ?? (session as any)?.calories) || 0;
    return sum + sessionEnergy;
  }, 0);

  const restEnergy = activeRest.reduce((sum, entry) => {
    const entryEnergy = Number((entry as any)?.caloriesBurned) || 0;
    return sum + entryEnergy;
  }, 0);

  return Math.max(0, Math.round(workoutEnergy + restEnergy));
}

export function mergeDailyWearableSignals(log: DailyLog): MergedWearableSignals {
  const wearable = log.wearableSignals || {};

  const wearableSteps = asNumber(wearable.steps);
  const wearableActiveEnergy = asNumber(wearable.activeEnergy);
  const wearableSleepMinutes = asNumber(wearable.sleepMinutes);
  const wearableRestingHR = asNumber(wearable.restingHeartRate);

  const hasWearableSignals =
    (wearableSteps ?? 0) > 0 ||
    (wearableActiveEnergy ?? 0) > 0 ||
    (wearableSleepMinutes ?? 0) > 0 ||
    (wearableRestingHR ?? 0) > 0;

  const zenithActivityEnergy = sumZenithActivityEnergy(log);

  if (zenithActivityEnergy > 0) {
    return {
      steps: wearableSteps,
      activeEnergy: wearableActiveEnergy,
      sleepMinutes: wearableSleepMinutes,
      restingHeartRate: wearableRestingHR,
      activityEnergyForMetrics: zenithActivityEnergy,
      activityEnergySource: 'zenith',
      hasWearableSignals,
    };
  }

  if ((wearableActiveEnergy ?? 0) > 0) {
    return {
      steps: wearableSteps,
      activeEnergy: wearableActiveEnergy,
      sleepMinutes: wearableSleepMinutes,
      restingHeartRate: wearableRestingHR,
      activityEnergyForMetrics: Math.round(wearableActiveEnergy as number),
      activityEnergySource: 'wearable',
      hasWearableSignals,
    };
  }

  return {
    steps: wearableSteps,
    activeEnergy: wearableActiveEnergy,
    sleepMinutes: wearableSleepMinutes,
    restingHeartRate: wearableRestingHR,
    activityEnergyForMetrics: 0,
    activityEnergySource: 'none',
    hasWearableSignals,
  };
}
