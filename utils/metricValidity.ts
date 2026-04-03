export type MetricDefinition = {
  key: string;
  title: string;
  formula: string;
  requires: string;
  approximation?: string;
};

const DEFINITIONS: Record<string, MetricDefinition> = {
  calories: {
    key: 'calories',
    title: 'Calories',
    formula: 'Total calories / logged calorie days (or calendar days when selected).',
    requires: 'Food logs or calories field for at least one day.',
  },
  protein: {
    key: 'protein',
    title: 'Protein',
    formula: 'Total protein grams / logged protein days (or calendar days when selected).',
    requires: 'Protein values from food logs.',
  },
  water: {
    key: 'water',
    title: 'Water',
    formula: 'Total water ounces / logged hydration days (or calendar days when selected).',
    requires: 'Water logs for at least one day.',
  },
  weight: {
    key: 'weight',
    title: 'Weight',
    formula: 'Average across weigh-ins only. Trend uses first and last weigh-in in range.',
    requires: 'At least one weigh-in.',
  },
  training: {
    key: 'training',
    title: 'Training',
    formula: 'Workout day flag + active rest minutes normalized to rest target.',
    requires: 'Workout logs and/or active rest logs.',
    approximation: 'Active rest is normalized using your rest target.',
  },
  'winning-rate': {
    key: 'winning-rate',
    title: 'Winning Day Rate',
    formula: 'Winning days / denominator days (logged or calendar mode).',
    requires: 'Winning day evaluation from logs.',
  },
  streaks: {
    key: 'streaks',
    title: 'Streaks',
    formula: 'Consecutive winning days in sequence.',
    requires: 'Winning day history in selected range.',
  },
  tdee: {
    key: 'tdee',
    title: 'Adaptive TDEE',
    formula: 'Baseline TDEE adjusted by observed weight trend and activity signals.',
    requires: 'Weight points + intake/activity history.',
    approximation: 'Confidence decreases with sparse logs or missing wearables.',
  },
  running_pace: {
    key: 'running_pace',
    title: 'Running Pace',
    formula: 'Total run time / total run distance.',
    requires: 'Run time and distance both present.',
  },
};

export function getMetricDefinition(metric: string): MetricDefinition {
  return DEFINITIONS[metric] || {
    key: metric,
    title: metric,
    formula: 'Derived from logged values only.',
    requires: 'At least one valid log value for this metric.',
  };
}
