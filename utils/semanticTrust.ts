import type { DailyLog } from './storageUtils';

export type DayConfidence = 'none' | 'partial' | 'good' | 'strong';

export const METRIC_INTENT: Record<string, string> = {
  calories: 'Energy intake on days food is logged.',
  workouts: 'Intentional training sessions.',
  runs: 'Tracked endurance efforts.',
  water: 'Hydration events, not compliance.',
  weight: 'Measurement points, not a daily obligation.',
};

export type ActiveDaySignals = {
  foodLogged: boolean;
  workoutLogged: boolean;
  runLogged: boolean;
  waterLogged: boolean;
  restLogged: boolean;
  weightLogged: boolean;
};

export function getActiveDaySignals(log: DailyLog): ActiveDaySignals {
  const foodEntries = Array.isArray(log?.foodEntries) ? log.foodEntries : [];
  const workouts = Array.isArray(log?.workouts) ? log.workouts : [];
  const activeRest = Array.isArray(log?.activeRest) ? log.activeRest : [];
  const calories = Number(log?.calories) || 0;
  const water = Number(log?.water) || 0;

  const isRealWorkout = (workout: any) => {
    const durationMin = Number(workout?.durationMin) || Number(workout?.duration) || Number(workout?.minutes) || 0;
    const sets = Number(workout?.totalSets) || Number(workout?.setCount) || 0;
    const distance = Number(workout?.distanceMiles) || Number(workout?.distance) || 0;
    return durationMin > 0 || sets > 0 || distance > 0;
  };

  return {
    foodLogged: foodEntries.length > 0 || calories > 0,
    // Streak/active-day doctrine: any logged workout counts as an active signal, even if it was late/no-XP.
    workoutLogged: workouts.some((w: any) => isRealWorkout(w)),
    runLogged: workouts.some((w: any) => isRealWorkout(w) && String(w?.type || '').toLowerCase() === 'running'),
    waterLogged: water > 0,
    restLogged: activeRest.length > 0,
    weightLogged: typeof log?.weight === 'number',
  };
}

export function isActiveDay(log: DailyLog): boolean {
  const s = getActiveDaySignals(log);
  return s.foodLogged || s.workoutLogged || s.runLogged || s.waterLogged || s.restLogged || s.weightLogged;
}

export function isTrainingDay(log: DailyLog): boolean {
  const s = getActiveDaySignals(log);
  return s.workoutLogged || s.runLogged;
}

export function getDayConfidence(log: DailyLog): DayConfidence {
  const s = getActiveDaySignals(log);
  const activeSignals = [s.foodLogged, s.workoutLogged || s.runLogged, s.waterLogged, s.restLogged, s.weightLogged].filter(Boolean).length;

  if (activeSignals === 0) return 'none';
  if ((s.foodLogged && (s.workoutLogged || s.runLogged)) || ((s.workoutLogged || s.runLogged) && s.waterLogged && s.restLogged)) {
    return 'strong';
  }
  if (activeSignals >= 2) return 'good';
  return 'partial';
}

export function getRangeConfidence(logs: DailyLog[]): DayConfidence {
  if (!Array.isArray(logs) || logs.length === 0) return 'none';
  const rank = { none: 0, partial: 1, good: 2, strong: 3 } as const;
  const total = logs.reduce((sum, log) => sum + rank[getDayConfidence(log)], 0);
  const avg = total / logs.length;
  if (avg >= 2.6) return 'strong';
  if (avg >= 1.8) return 'good';
  if (avg >= 0.8) return 'partial';
  return 'none';
}
