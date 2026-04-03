import type { ReasonCode } from './workoutChallengesApi';

export function reasonCodeToMessage(code: ReasonCode | string): string {
  switch (code) {
    case 'OUT_OF_WINDOW':
      return 'Workout was outside the challenge date window.';
    case 'WRONG_ACTIVITY':
      return 'Workout activity type does not match challenge rules.';
    case 'WRONG_LOCATION':
      return 'Workout indoor/outdoor setting does not match challenge rules.';
    case 'SOURCE_NOT_ALLOWED':
      return 'Workout source is not allowed for this challenge.';
    case 'USER_ENTERED_NOT_ALLOWED':
      return 'Manually entered workouts are not allowed for this challenge.';
    case 'ROUTE_REQUIRED_MISSING':
      return 'A GPS route is required for this challenge.';
    case 'DISTANCE_REQUIRED_MISSING':
      return 'Workout distance is missing and required for this challenge.';
    case 'HR_REQUIRED_MISSING':
      return 'Heart-rate data is required for this challenge.';
    case 'BELOW_MIN_DURATION':
      return 'Workout duration was below the challenge minimum.';
    case 'BELOW_MIN_DISTANCE':
      return 'Workout distance was below the challenge minimum.';
    case 'DISTANCE_OUTSIDE_TOLERANCE':
      return 'Workout distance did not meet the challenge target tolerance.';
    case 'SPLITS_DATA_MISSING':
      return 'Split data is missing for this splits challenge.';
    case 'SPLITS_RULE_FAILED':
      return 'Workout splits did not satisfy the required split rule.';
    default:
      return 'Workout did not match challenge rules.';
  }
}
