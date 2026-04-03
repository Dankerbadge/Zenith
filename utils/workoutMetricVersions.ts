export type WorkoutMetricVersionSet = {
  workoutComputationVersion: string;
  calorieModelVersion: string;
  effortModelVersion: string;
  xpModelVersion: string;
  authorityPolicyVersion: string;
};

export const WORKOUT_METRIC_VERSION_SET: WorkoutMetricVersionSet = {
  workoutComputationVersion: 'workout_compute_v1',
  calorieModelVersion: 'workout_calorie_v1',
  effortModelVersion: 'effort_engine_v1',
  xpModelVersion: 'xp_engine_v1',
  authorityPolicyVersion: 'authority_policy_v1',
};

export function createWorkoutMetricVersionSet(
  overrides: Partial<WorkoutMetricVersionSet> = {}
): WorkoutMetricVersionSet {
  return {
    ...WORKOUT_METRIC_VERSION_SET,
    ...overrides,
  };
}

