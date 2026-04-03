import { DailyLog, getDailyLog, getDailyLogsByDates, getUserProfile, type UserProfile } from './storageUtils';
import { mergeDailyWearableSignals, type MergeSource } from './wearableMerge';
import { evaluateWinningDay } from './winningSystem';
import { computeRecommendedTargets, hasScienceProfileInputs, type RecommendationConfidence } from './nutritionRecommendations';

export type DailyMetric = {
  date: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  water: number;
  weight?: number;
  workoutsCount: number;
  workoutMinutes: number;
  totalSets: number;
  totalVolume: number;
  activeRestEntries: number;
  activeRestMinutes: number;
  foodEntries: number;
  steps?: number;
  sleepMinutes?: number;
  restingHeartRate?: number;
  activityEnergy: number;
  activityEnergySource: MergeSource;
  hasWearableSignals: boolean;
  caloriesTarget?: number;
  proteinTarget?: number;
  waterTargetOz?: number;
  activeRestTargetMin: number;
  recommended: {
    caloriesTargetKcal?: number;
    proteinTargetG?: number;
    waterTargetOz?: number;
    confidence: RecommendationConfidence;
    warnings: string[];
  };
  workoutDone: boolean;
  restDone: boolean;
  caloriesInWindow: boolean;
  winningDay: boolean;
};

type CacheEntry = {
  signature: string;
  metric: DailyMetric;
};

const dailyMetricCache = new Map<string, CacheEntry>();

function metricDefaults(date: string): DailyMetric {
  return {
    date,
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    water: 0,
    weight: undefined,
    workoutsCount: 0,
    workoutMinutes: 0,
    totalSets: 0,
    totalVolume: 0,
    activeRestEntries: 0,
    activeRestMinutes: 0,
    foodEntries: 0,
    steps: undefined,
    sleepMinutes: undefined,
    restingHeartRate: undefined,
    activityEnergy: 0,
    activityEnergySource: 'none',
    hasWearableSignals: false,
    caloriesTarget: undefined,
    proteinTarget: undefined,
    waterTargetOz: undefined,
    activeRestTargetMin: 20,
    recommended: {
      caloriesTargetKcal: undefined,
      proteinTargetG: undefined,
      waterTargetOz: undefined,
      confidence: 'LOW',
      warnings: [],
    },
    workoutDone: false,
    restDone: false,
    caloriesInWindow: false,
    winningDay: false,
  };
}

function normalizeGoals(profile: UserProfile) {
  const goals = profile.goals || {};
  const scienceReady = hasScienceProfileInputs(profile);
  const recommended = computeRecommendedTargets(profile);
  const fallbackProtein = Number(goals.proteinTarget);
  const fallbackWater = Number(goals.waterTargetOz);
  const fallbackCalories = Number(goals.caloriesTarget);

  const proteinTarget = scienceReady
    ? recommended.proteinTargetG
    : Number.isFinite(fallbackProtein) && fallbackProtein > 0
    ? fallbackProtein
    : 170;
  const waterTargetOz = scienceReady
    ? recommended.waterTargetOz
    : Number.isFinite(fallbackWater) && fallbackWater > 0
    ? fallbackWater
    : 120;
  const caloriesTarget = scienceReady
    ? recommended.caloriesTargetKcal
    : Number.isFinite(fallbackCalories) && fallbackCalories > 0
    ? fallbackCalories
    : undefined;

  return {
    proteinTarget,
    waterTargetOz,
    activeRestTargetMin: Number(goals.activeRestTargetMin) || 20,
    caloriesTarget,
    recommended: {
      caloriesTargetKcal: recommended.caloriesTargetKcal,
      proteinTargetG: recommended.proteinTargetG,
      waterTargetOz: recommended.waterTargetOz,
      confidence: recommended.meta.confidence,
      warnings: recommended.meta.warnings,
    },
    scienceReady,
  };
}

function buildSignature(date: string, log: DailyLog, profile: UserProfile): string {
  const workouts = Array.isArray(log.workouts) ? log.workouts : [];
  const activeRest = Array.isArray(log.activeRest) ? log.activeRest : [];
  const foodEntries = Array.isArray(log.foodEntries) ? log.foodEntries : [];

  const workoutMinutes = workouts.reduce(
    (sum, session) => sum + (Number(session?.durationMin) || Number(session?.minutes) || Number((session as any)?.duration) || 0),
    0
  );
  const totalSets = workouts.reduce((sum, session) => sum + (Number(session?.totalSets) || 0), 0);
  const totalVolume = workouts.reduce((sum, session) => sum + (Number(session?.totalVolume) || 0), 0);
  const activeRestMinutes = activeRest.reduce((sum, entry) => sum + (Number(entry?.minutes) || 0), 0);
  const wearableMerged = mergeDailyWearableSignals(log);
  const goals = normalizeGoals(profile);

  return [
    date,
    log.updatedAt || '',
    Number(log.calories) || 0,
    Number(log.macros?.protein) || 0,
    Number(log.macros?.carbs) || 0,
    Number(log.macros?.fat) || 0,
    Number(log.water) || 0,
    typeof log.weight === 'number' ? log.weight : '',
    workouts.length,
    workoutMinutes,
    totalSets,
    totalVolume,
    activeRest.length,
    activeRestMinutes,
    foodEntries.length,
    wearableMerged.steps ?? '',
    wearableMerged.sleepMinutes ?? '',
    wearableMerged.restingHeartRate ?? '',
    wearableMerged.activityEnergyForMetrics,
    wearableMerged.activityEnergySource,
    wearableMerged.hasWearableSignals ? 1 : 0,
    goals.proteinTarget,
    goals.waterTargetOz,
    goals.activeRestTargetMin,
    goals.caloriesTarget || '',
    goals.recommended.confidence,
    goals.recommended.warnings.join('||'),
    goals.scienceReady ? '1' : '0',
  ].join('|');
}

export function buildDailyMetric(date: string, log: DailyLog, profile: UserProfile): DailyMetric {
  const base = metricDefaults(date);
  const goals = normalizeGoals(profile);
  const workouts = Array.isArray(log.workouts) ? log.workouts : [];
  const activeRest = Array.isArray(log.activeRest) ? log.activeRest : [];
  const foodEntries = Array.isArray(log.foodEntries) ? log.foodEntries : [];

  const workoutMinutes = workouts.reduce(
    (sum, session) => sum + (Number(session?.durationMin) || Number(session?.minutes) || Number((session as any)?.duration) || 0),
    0
  );
  const totalSets = workouts.reduce((sum, session) => sum + (Number(session?.totalSets) || 0), 0);
  const totalVolume = workouts.reduce((sum, session) => sum + (Number(session?.totalVolume) || 0), 0);
  const activeRestMinutes = activeRest.reduce((sum, entry) => sum + (Number(entry?.minutes) || 0), 0);
  const wearableMerged = mergeDailyWearableSignals(log);

  const winning = evaluateWinningDay(log, {
    activeRestTargetMin: goals.activeRestTargetMin,
    caloriesTarget: goals.caloriesTarget,
  });

  return {
    ...base,
    calories: Number(log.calories) || 0,
    protein: Number(log.macros?.protein) || 0,
    carbs: Number(log.macros?.carbs) || 0,
    fat: Number(log.macros?.fat) || 0,
    water: Number(log.water) || 0,
    weight: typeof log.weight === 'number' ? log.weight : undefined,
    workoutsCount: workouts.length,
    workoutMinutes,
    totalSets,
    totalVolume,
    activeRestEntries: activeRest.length,
    activeRestMinutes,
    foodEntries: foodEntries.length,
    steps: wearableMerged.steps,
    sleepMinutes: wearableMerged.sleepMinutes,
    restingHeartRate: wearableMerged.restingHeartRate,
    activityEnergy: wearableMerged.activityEnergyForMetrics,
    activityEnergySource: wearableMerged.activityEnergySource,
    hasWearableSignals: wearableMerged.hasWearableSignals,
    caloriesTarget: goals.caloriesTarget,
    proteinTarget: goals.proteinTarget,
    waterTargetOz: goals.waterTargetOz,
    activeRestTargetMin: goals.activeRestTargetMin,
    recommended: goals.recommended,
    workoutDone: winning.workoutDone,
    restDone: winning.restDone,
    caloriesInWindow: winning.caloriesInWindow,
    winningDay: winning.winningDay,
  };
}

export async function getDailyMetric(date: string, options?: { log?: DailyLog; profile?: UserProfile }): Promise<DailyMetric> {
  const log = options?.log || (await getDailyLog(date));
  const profile = options?.profile || (await getUserProfile());
  const signature = buildSignature(date, log, profile);
  const cached = dailyMetricCache.get(date);
  if (cached && cached.signature === signature) {
    return cached.metric;
  }

  const metric = buildDailyMetric(date, log, profile);
  dailyMetricCache.set(date, { signature, metric });
  return metric;
}

export async function getDailyMetricsByDates(
  dates: string[],
  options?: { logsByDate?: Record<string, DailyLog>; profile?: UserProfile }
): Promise<Record<string, DailyMetric>> {
  if (!dates.length) return {};

  const profile = options?.profile || (await getUserProfile());
  const logsByDate = options?.logsByDate || (await getDailyLogsByDates(dates));

  const metricsByDate: Record<string, DailyMetric> = {};
  dates.forEach((date) => {
    const log = logsByDate[date] || {};
    const signature = buildSignature(date, log, profile);
    const cached = dailyMetricCache.get(date);
    if (cached && cached.signature === signature) {
      metricsByDate[date] = cached.metric;
      return;
    }

    const metric = buildDailyMetric(date, log, profile);
    dailyMetricCache.set(date, { signature, metric });
    metricsByDate[date] = metric;
  });

  return metricsByDate;
}

export function clearDailyMetricCache(date?: string): void {
  if (date) {
    dailyMetricCache.delete(date);
    return;
  }
  dailyMetricCache.clear();
}
