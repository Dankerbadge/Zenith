import type { DayConfidence } from './semanticTrust';

export type HomeTruthInput = {
  dateKey: string;
  dayConfidence: DayConfidence;
  winningDay: boolean;
  workoutsCount: number;
  restMinutes: number;
  activeRestTargetMin: number;
  water: number;
  waterTargetOz: number;
  protein: number;
  proteinTarget: number;
  pendingChallenges: number;
};

export type HomeTruth = HomeTruthInput & {
  activityGapMin: number;
  waterGapOz: number;
  proteinGapG: number;
};

export type StatsTruthInput = {
  dateKey: string;
  dayConfidence: DayConfidence;
  daysWithAnyLog: number;
  avgProtein: number | null;
  avgWater: number | null;
  proteinTarget: number;
  waterTargetOz: number;
  rangeLabel: string;
  averageMode: 'logged' | 'calendar';
};

export type StatsTruth = StatsTruthInput & {
  proteinGapG: number;
  waterGapOz: number;
};

export type PostRunTruthInput = {
  dateKey: string;
  runId: string;
  distanceMiles: number;
  durationSec: number;
  avgPaceSecPerMile: number;
  routePrHit: boolean;
  segmentPrHits: number;
  winningDayAfter: boolean;
  streakAfter: number;
};

export type PostRunTruth = PostRunTruthInput;

export function buildHomeTruth(input: HomeTruthInput): HomeTruth {
  return {
    ...input,
    activityGapMin: Math.max(0, Math.round(input.activeRestTargetMin - input.restMinutes)),
    waterGapOz: Math.max(0, Math.round(input.waterTargetOz - input.water)),
    proteinGapG: Math.max(0, Math.round(input.proteinTarget - input.protein)),
  };
}

export function buildStatsTruth(input: StatsTruthInput): StatsTruth {
  return {
    ...input,
    proteinGapG: Math.max(0, Math.round((input.proteinTarget || 0) - (input.avgProtein || 0))),
    waterGapOz: Math.max(0, Math.round((input.waterTargetOz || 0) - (input.avgWater || 0))),
  };
}

export function buildPostRunTruth(input: PostRunTruthInput): PostRunTruth {
  return { ...input };
}
