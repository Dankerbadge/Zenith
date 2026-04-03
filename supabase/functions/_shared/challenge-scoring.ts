import type { ChallengeRecord, ReasonCode, WorkoutRecord } from './challenge-types.ts';
import { bestEffortTimeForDistance, computeDistanceSplits } from './interpolation.ts';

export type EvaluationResult = {
  accepted: boolean;
  reasonCodes: ReasonCode[];
  score: number | null;
  completionState: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  scoringMeta: Record<string, unknown>;
};

function n(v: unknown, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function inWindow(ts: string, startTs: string, endTs: string) {
  const t = Date.parse(ts);
  const start = Date.parse(startTs);
  const end = Date.parse(endTs);
  return Number.isFinite(t) && Number.isFinite(start) && Number.isFinite(end) && t >= start && t <= end;
}

function mapLocation(v?: string | null) {
  const s = String(v || '').toLowerCase();
  if (s.includes('out')) return 'OUTDOOR';
  if (s.includes('in')) return 'INDOOR';
  return 'UNKNOWN';
}

function activityMatches(challengeActivity: string, workoutActivity: string) {
  return String(challengeActivity || '').trim().toUpperCase() === String(workoutActivity || '').trim().toUpperCase();
}

export function evaluateWorkoutForChallenge(challenge: ChallengeRecord, workout: WorkoutRecord): EvaluationResult {
  const reasons: ReasonCode[] = [];
  const rules = challenge.rules || {};
  const constraints = rules.constraints || {};
  const target = rules.target || {};

  if (!inWindow(String(workout.start_ts || ''), challenge.start_ts, challenge.end_ts)) reasons.push('OUT_OF_WINDOW');
  if (!activityMatches(challenge.activity_type, workout.activity_type)) reasons.push('WRONG_ACTIVITY');

  const locationReq = String(constraints.locationRequirement || 'EITHER');
  const workoutLoc = mapLocation(workout.location_type);
  if (locationReq === 'OUTDOOR_ONLY' && workoutLoc !== 'OUTDOOR') reasons.push('WRONG_LOCATION');
  if (locationReq === 'INDOOR_ONLY' && workoutLoc !== 'INDOOR') reasons.push('WRONG_LOCATION');

  const allowedSources = Array.isArray(constraints.allowedSources) ? constraints.allowedSources : ['WATCH', 'PHONE', 'IMPORT'];
  const source = String(workout.source || '').toUpperCase();
  if (allowedSources.length && source && !allowedSources.includes(source as any)) reasons.push('SOURCE_NOT_ALLOWED');

  if (constraints.requiresNonUserEntered !== false && Boolean(workout.was_user_entered)) reasons.push('USER_ENTERED_NOT_ALLOWED');

  const points = Array.isArray(workout.route_points) ? workout.route_points : [];
  if (Boolean(constraints.requiresRoute)) {
    if (!points.length) reasons.push('ROUTE_REQUIRED_MISSING');
  }

  const durationS = n(workout.duration_s, Math.max(0, Date.parse(String(workout.end_ts || '')) - Date.parse(String(workout.start_ts || ''))) / 1000);
  const distanceM = n(workout.distance_m, NaN);
  const minDurationS = constraints.minDurationS == null ? null : n(constraints.minDurationS, NaN);
  const minDistanceM = constraints.minDistanceM == null ? null : n(constraints.minDistanceM, NaN);
  if (Number.isFinite(minDurationS as number) && durationS < (minDurationS as number)) reasons.push('BELOW_MIN_DURATION');
  if (Number.isFinite(minDistanceM as number) && !Number.isFinite(distanceM)) reasons.push('DISTANCE_REQUIRED_MISSING');
  if (Number.isFinite(minDistanceM as number) && Number.isFinite(distanceM) && distanceM < (minDistanceM as number)) reasons.push('BELOW_MIN_DISTANCE');

  if (constraints.requiresHeartRate && !Number.isFinite(n(workout.avg_hr_bpm, NaN))) reasons.push('HR_REQUIRED_MISSING');

  if (reasons.length) {
    return {
      accepted: false,
      reasonCodes: reasons,
      score: null,
      completionState: 'FAILED',
      scoringMeta: {},
    };
  }

  let score: number | null = null;
  const distanceTarget = target.distanceM == null ? null : n(target.distanceM, NaN);
  const timeTarget = target.timeS == null ? null : n(target.timeS, NaN);
  const tolerancePct = n(constraints.distanceTolerancePct, 0.02);
  const hasDistance = Number.isFinite(distanceM);

  switch (challenge.score_type) {
    case 'FASTEST_TIME_FOR_DISTANCE':
      if (!Number.isFinite(distanceTarget as number) || !hasDistance) return { accepted: false, reasonCodes: ['DISTANCE_REQUIRED_MISSING'], score: null, completionState: 'FAILED', scoringMeta: {} };
      if (!Boolean(constraints.allowLongerWorkoutForDistanceGoal)) {
        const tol = (distanceTarget as number) * tolerancePct;
        if (Math.abs(distanceM - (distanceTarget as number)) > tol) {
          return { accepted: false, reasonCodes: ['DISTANCE_OUTSIDE_TOLERANCE'], score: null, completionState: 'FAILED', scoringMeta: {} };
        }
      } else {
        if (!Array.isArray(points) || points.length < 2) {
          return { accepted: false, reasonCodes: ['SPLITS_DATA_MISSING'], score: null, completionState: 'FAILED', scoringMeta: {} };
        }
        const best = bestEffortTimeForDistance(points as any, distanceTarget as number);
        if (!best) {
          return { accepted: false, reasonCodes: ['SPLITS_DATA_MISSING'], score: null, completionState: 'FAILED', scoringMeta: {} };
        }
        score = best.bestTimeS;
        const completeByTime = Number.isFinite(timeTarget as number) ? score >= (timeTarget as number) : true;
        const completeByDistance = true;
        return {
          accepted: true,
          reasonCodes: [],
          score,
          completionState: completeByDistance && completeByTime ? 'COMPLETED' : 'IN_PROGRESS',
          scoringMeta: { bestEffort: best, confidence: points.length < 20 ? 'MEDIUM' : 'HIGH' },
        };
      }
      score = durationS;
      break;
    case 'BEST_AVG_PACE_FOR_DISTANCE':
      if (!Number.isFinite(distanceTarget as number) || !hasDistance || distanceM <= 0) {
        return { accepted: false, reasonCodes: ['DISTANCE_REQUIRED_MISSING'], score: null, completionState: 'FAILED', scoringMeta: {} };
      }
      if (!Boolean(constraints.allowLongerWorkoutForDistanceGoal)) {
        const tol = (distanceTarget as number) * tolerancePct;
        if (Math.abs(distanceM - (distanceTarget as number)) > tol) {
          return { accepted: false, reasonCodes: ['DISTANCE_OUTSIDE_TOLERANCE'], score: null, completionState: 'FAILED', scoringMeta: {} };
        }
      }
      score = durationS / (distanceM / 1000);
      break;
    case 'LONGEST_DISTANCE':
    case 'MOST_DISTANCE_CUMULATIVE':
      if (!hasDistance) return { accepted: false, reasonCodes: ['DISTANCE_REQUIRED_MISSING'], score: null, completionState: 'FAILED', scoringMeta: {} };
      score = distanceM;
      break;
    case 'MOST_TIME_CUMULATIVE':
      score = durationS;
      break;
    case 'COMPLETION_ONLY': {
      const byDistance = Number.isFinite(distanceTarget as number) ? hasDistance && distanceM >= (distanceTarget as number) : true;
      const byTime = Number.isFinite(timeTarget as number) ? durationS >= (timeTarget as number) : true;
      const complete = Boolean(byDistance && byTime);
      return {
        accepted: complete,
        reasonCodes: complete ? [] : ['DISTANCE_OUTSIDE_TOLERANCE'],
        score: null,
        completionState: complete ? 'COMPLETED' : 'IN_PROGRESS',
        scoringMeta: {},
      };
    }
    case 'SPLITS_COMPLIANCE':
      if (!Array.isArray(points) || points.length < 2) {
        return { accepted: false, reasonCodes: ['SPLITS_DATA_MISSING'], score: null, completionState: 'FAILED', scoringMeta: {} };
      }
      {
        const splitCfg = target.splits;
        if (!splitCfg || splitCfg.splitType !== 'DISTANCE') {
          return { accepted: false, reasonCodes: ['SPLITS_DATA_MISSING'], score: null, completionState: 'FAILED', scoringMeta: {} };
        }
        const unitM = Number(splitCfg.splitUnitM || 0);
        const splitResult = computeDistanceSplits(points as any, unitM, {
          numSplits: Number(splitCfg.numSplits || 0) || null,
          targetDistanceM: Number(distanceTarget || 0) || null,
        });
        if (!splitResult) {
          return { accepted: false, reasonCodes: ['SPLITS_DATA_MISSING'], score: null, completionState: 'FAILED', scoringMeta: {} };
        }
        const toleranceS = Number(splitCfg.toleranceS ?? 2);
        const maxSplitTimeS = splitCfg.maxSplitTimeS == null ? null : Number(splitCfg.maxSplitTimeS);
        const maxPace = splitCfg.maxPaceSPerKm == null ? null : Number(splitCfg.maxPaceSPerKm);

        let failed = false;
        for (const splitTimeS of splitResult.splitTimesS) {
          if (Number.isFinite(maxSplitTimeS as number) && splitTimeS > (maxSplitTimeS as number) + toleranceS) failed = true;
          if (Number.isFinite(maxPace as number)) {
            const pace = splitTimeS / (unitM / 1000);
            if (pace > (maxPace as number) + toleranceS) failed = true;
          }
        }
        if (splitCfg.mustNegativeSplit) {
          const first = splitResult.splitTimesS[0];
          const last = splitResult.splitTimesS[splitResult.splitTimesS.length - 1];
          if (!(last <= first - toleranceS)) failed = true;
        }
        if (failed) {
          return {
            accepted: false,
            reasonCodes: ['SPLITS_RULE_FAILED'],
            score: null,
            completionState: 'FAILED',
            scoringMeta: { splitTimesS: splitResult.splitTimesS.slice(0, 50), splitCount: splitResult.splitTimesS.length },
          };
        }
        score = splitResult.splitTimesS.reduce((sum, x) => sum + x, 0);
        return {
          accepted: true,
          reasonCodes: [],
          score,
          completionState: 'COMPLETED',
          scoringMeta: {
            splitTimesS: splitResult.splitTimesS.slice(0, 50),
            splitCount: splitResult.splitTimesS.length,
            truncated: splitResult.splitTimesS.length > 50,
          },
        };
      }
    default:
      score = null;
      break;
  }

  const completeByDistance = Number.isFinite(distanceTarget as number) ? hasDistance && distanceM >= (distanceTarget as number) : true;
  const completeByTime = Number.isFinite(timeTarget as number) ? durationS >= (timeTarget as number) : true;
  const complete = Boolean(completeByDistance && completeByTime);

  return {
    accepted: true,
    reasonCodes: [],
    score,
    completionState: complete ? 'COMPLETED' : 'IN_PROGRESS',
    scoringMeta: { durationS, distanceM: hasDistance ? distanceM : null },
  };
}
