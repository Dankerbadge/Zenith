export type ActivityType =
  | 'RUN_OUTDOOR'
  | 'RUN_TREADMILL'
  | 'WALK_OUTDOOR'
  | 'WALK_INDOOR'
  | 'CYCLE_OUTDOOR'
  | 'CYCLE_INDOOR'
  | 'HIKE'
  | 'SWIM_POOL'
  | 'SWIM_OPEN_WATER'
  | 'ROW_INDOOR'
  | 'ROW_OUTDOOR'
  | 'ELLIPTICAL'
  | 'STRENGTH'
  | 'HIIT';

export type ChallengeMode = 'SINGLE_SESSION' | 'CUMULATIVE';
export type ScoreType =
  | 'FASTEST_TIME_FOR_DISTANCE'
  | 'LONGEST_DISTANCE'
  | 'MOST_DISTANCE_CUMULATIVE'
  | 'MOST_TIME_CUMULATIVE'
  | 'BEST_AVG_PACE_FOR_DISTANCE'
  | 'COMPLETION_ONLY'
  | 'SPLITS_COMPLIANCE';

export type ReasonCode =
  | 'OUT_OF_WINDOW'
  | 'WRONG_ACTIVITY'
  | 'WRONG_LOCATION'
  | 'SOURCE_NOT_ALLOWED'
  | 'USER_ENTERED_NOT_ALLOWED'
  | 'ROUTE_REQUIRED_MISSING'
  | 'DISTANCE_REQUIRED_MISSING'
  | 'HR_REQUIRED_MISSING'
  | 'BELOW_MIN_DURATION'
  | 'BELOW_MIN_DISTANCE'
  | 'DISTANCE_OUTSIDE_TOLERANCE'
  | 'SPLITS_DATA_MISSING'
  | 'SPLITS_RULE_FAILED';

export type ChallengeRules = {
  target?: {
    distanceM?: number | null;
    timeS?: number | null;
    paceSPerKm?: number | null;
    splits?: {
      splitType: 'DISTANCE' | 'TIME';
      splitUnitM?: number | null;
      numSplits?: number | null;
      maxSplitTimeS?: number | null;
      maxPaceSPerKm?: number | null;
      mustNegativeSplit?: boolean | null;
      toleranceS?: number | null;
    } | null;
  };
  constraints?: {
    locationRequirement?: 'OUTDOOR_ONLY' | 'INDOOR_ONLY' | 'EITHER';
    requiresRoute?: boolean;
    requiresHeartRate?: boolean;
    requiresNonUserEntered?: boolean;
    allowedSources?: Array<'WATCH' | 'PHONE' | 'IMPORT'>;
    minDurationS?: number | null;
    minDistanceM?: number | null;
    distanceTolerancePct?: number | null;
    allowLongerWorkoutForDistanceGoal?: boolean;
  };
  attemptPolicy?: {
    attemptsAllowed?: 'UNLIMITED' | 'FIRST_ONLY' | 'BEST_ONLY';
    bestBy?: 'TIME_ASC' | 'DIST_DESC' | 'PACE_ASC';
  };
};

export type ChallengeRecord = {
  id: string;
  activity_type: ActivityType;
  mode: ChallengeMode;
  score_type: ScoreType;
  rules: ChallengeRules;
  start_ts: string;
  end_ts: string;
};

export type WorkoutRecord = {
  id: string;
  user_id: string;
  start_ts: string;
  end_ts: string;
  activity_type: string;
  location_type?: string | null;
  duration_s?: number | null;
  distance_m?: number | null;
  source?: string | null;
  was_user_entered?: boolean | null;
  route_points?: unknown[] | null;
  avg_hr_bpm?: number | null;
};

