import { getDailyLog, saveDailyLog, type WorkoutEntry } from './storageUtils';

export type WorkoutDuplicateCandidate = {
  importedWorkoutId: string;
  existingWorkoutId: string;
  importedLabel: string;
  existingLabel: string;
  reason: string;
  score: number;
};

function minutesOf(workout: any): number {
  return Math.max(0, Number(workout?.durationMin) || Number(workout?.minutes) || Number(workout?.duration) || 0);
}

function distanceMilesOf(workout: any): number | null {
  const value = Number(workout?.distance);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function caloriesOf(workout: any): number {
  return Math.max(0, Number(workout?.caloriesBurned) || Number(workout?.calories) || 0);
}

function labelOf(workout: any): string {
  const label = String(workout?.label || workout?.type || 'Workout').trim();
  return label || 'Workout';
}

function scorePair(imported: any, existing: any): { score: number; reason: string } {
  const importedMinutes = minutesOf(imported);
  const existingMinutes = minutesOf(existing);
  const importedCalories = caloriesOf(imported);
  const existingCalories = caloriesOf(existing);
  const importedDistance = distanceMilesOf(imported);
  const existingDistance = distanceMilesOf(existing);

  let score = 0;
  const reasons: string[] = [];

  if (importedMinutes > 0 && existingMinutes > 0) {
    const deltaMin = Math.abs(importedMinutes - existingMinutes);
    if (deltaMin <= 10) {
      score += 2;
      reasons.push('duration closely matches');
    } else if (deltaMin <= 20) {
      score += 1;
      reasons.push('duration is similar');
    }
  }

  if (importedCalories > 0 && existingCalories > 0) {
    const deltaCal = Math.abs(importedCalories - existingCalories);
    if (deltaCal <= 120) {
      score += 2;
      reasons.push('calories closely match');
    } else if (deltaCal <= 250) {
      score += 1;
      reasons.push('calories are similar');
    }
  }

  if (importedDistance !== null && existingDistance !== null) {
    const deltaDistance = Math.abs(importedDistance - existingDistance);
    if (deltaDistance <= 0.25) {
      score += 2;
      reasons.push('distance closely matches');
    } else if (deltaDistance <= 0.75) {
      score += 1;
      reasons.push('distance is similar');
    }
  }

  return {
    score,
    reason: reasons.join(', ') || 'timing and load look similar',
  };
}

export async function detectWorkoutDuplicates(date: string): Promise<WorkoutDuplicateCandidate[]> {
  const log = await getDailyLog(date);
  const workouts = Array.isArray(log?.workouts) ? log.workouts : [];
  const imported = workouts.filter((w: any) => Boolean(w?.imported));
  const userLogged = workouts.filter((w: any) => !w?.imported);

  const candidates: WorkoutDuplicateCandidate[] = [];

  for (const imp of imported) {
    const impId = String((imp as any)?.id || '').trim();
    if (!impId) continue;

    for (const existing of userLogged) {
      const existingId = String((existing as any)?.id || '').trim();
      if (!existingId) continue;

      const { score, reason } = scorePair(imp, existing);
      if (score < 2) continue;

      candidates.push({
        importedWorkoutId: impId,
        existingWorkoutId: existingId,
        importedLabel: labelOf(imp),
        existingLabel: labelOf(existing),
        reason,
        score,
      });
    }
  }

  return candidates.sort((a, b) => b.score - a.score);
}

export async function resolveWorkoutDuplicate(date: string, input: {
  importedWorkoutId: string;
  resolution: 'merge' | 'keep_both';
}): Promise<void> {
  if (input.resolution === 'keep_both') return;

  const log = await getDailyLog(date);
  const workouts = Array.isArray(log?.workouts) ? log.workouts : [];
  const nextWorkouts = workouts.filter((w: WorkoutEntry) => String(w?.id || '') !== input.importedWorkoutId);
  if (nextWorkouts.length === workouts.length) return;

  await saveDailyLog(date, {
    ...log,
    workouts: nextWorkouts,
  });
}
