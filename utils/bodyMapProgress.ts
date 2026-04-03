import { getRecentDailyLogs, type WorkoutEntry } from './storageUtils';

export const BODY_MAP_LENSES = ['STIMULUS', 'SORENESS', 'PAIN', 'FATIGUE', 'COMPOSITE'] as const;
export type BodyMapLens = (typeof BODY_MAP_LENSES)[number];

export const BODY_MAP_TIMEFRAMES = ['SESSION', '7D', '28D'] as const;
export type BodyMapTimeframe = (typeof BODY_MAP_TIMEFRAMES)[number];

type RawScores = {
  stimulus: number;
  soreness: number;
  pain: number;
  fatigue: number;
};

export type BodyMapRegionScores = {
  stimulus: number;
  soreness: number;
  pain: number;
  fatigue: number;
  composite: number;
};

export type BodyMapRegionSnapshot = {
  id: number;
  key: string;
  label: string;
  scores: BodyMapRegionScores;
};

export type BodyMapHistoryPoint = {
  date: string;
  scores: BodyMapRegionScores;
};

export type BodyMapLensSummary = {
  lens: BodyMapLens;
  max: number;
  avg: number;
  topRegions: { id: number; key: string; label: string; score: number }[];
};

export type BodyMapComputedSnapshot = {
  timeframe: BodyMapTimeframe;
  generatedAt: string;
  regions: BodyMapRegionSnapshot[];
  lensSummaries: Record<BodyMapLens, BodyMapLensSummary>;
  historyByRegionId: Record<number, BodyMapHistoryPoint[]>;
};

const REGION_CATALOG: { id: number; key: string; label: string }[] = [
  { id: 1, key: 'CHEST_L', label: 'Chest (L)' },
  { id: 2, key: 'CHEST_R', label: 'Chest (R)' },
  { id: 3, key: 'DELTS_FRONT_L', label: 'Front Delts (L)' },
  { id: 4, key: 'DELTS_FRONT_R', label: 'Front Delts (R)' },
  { id: 5, key: 'DELTS_SIDE_L', label: 'Side Delts (L)' },
  { id: 6, key: 'DELTS_SIDE_R', label: 'Side Delts (R)' },
  { id: 7, key: 'DELTS_REAR_L', label: 'Rear Delts (L)' },
  { id: 8, key: 'DELTS_REAR_R', label: 'Rear Delts (R)' },
  { id: 9, key: 'BICEPS_L', label: 'Biceps (L)' },
  { id: 10, key: 'BICEPS_R', label: 'Biceps (R)' },
  { id: 11, key: 'TRICEPS_L', label: 'Triceps (L)' },
  { id: 12, key: 'TRICEPS_R', label: 'Triceps (R)' },
  { id: 13, key: 'FOREARMS_L', label: 'Forearms (L)' },
  { id: 14, key: 'FOREARMS_R', label: 'Forearms (R)' },
  { id: 15, key: 'UPPER_BACK_L', label: 'Upper Back (L)' },
  { id: 16, key: 'UPPER_BACK_R', label: 'Upper Back (R)' },
  { id: 17, key: 'LATS_L', label: 'Lats (L)' },
  { id: 18, key: 'LATS_R', label: 'Lats (R)' },
  { id: 19, key: 'TRAPS_L', label: 'Traps (L)' },
  { id: 20, key: 'TRAPS_R', label: 'Traps (R)' },
  { id: 21, key: 'ABS', label: 'Abs' },
  { id: 22, key: 'OBLIQUES_L', label: 'Obliques (L)' },
  { id: 23, key: 'OBLIQUES_R', label: 'Obliques (R)' },
  { id: 24, key: 'LOWER_BACK', label: 'Lower Back' },
  { id: 25, key: 'GLUTES_L', label: 'Glutes (L)' },
  { id: 26, key: 'GLUTES_R', label: 'Glutes (R)' },
  { id: 27, key: 'HIP_FLEXORS_L', label: 'Hip Flexors (L)' },
  { id: 28, key: 'HIP_FLEXORS_R', label: 'Hip Flexors (R)' },
  { id: 29, key: 'ADDUCTORS_L', label: 'Adductors (L)' },
  { id: 30, key: 'ADDUCTORS_R', label: 'Adductors (R)' },
  { id: 31, key: 'QUADS_L', label: 'Quads (L)' },
  { id: 32, key: 'QUADS_R', label: 'Quads (R)' },
  { id: 33, key: 'HAMSTRINGS_L', label: 'Hamstrings (L)' },
  { id: 34, key: 'HAMSTRINGS_R', label: 'Hamstrings (R)' },
  { id: 35, key: 'CALVES_L', label: 'Calves (L)' },
  { id: 36, key: 'CALVES_R', label: 'Calves (R)' },
  { id: 37, key: 'TIBIALIS_L', label: 'Tibialis (L)' },
  { id: 38, key: 'TIBIALIS_R', label: 'Tibialis (R)' },
  { id: 39, key: 'NECK', label: 'Neck' },
];

const REGION_GROUPS: Record<string, string[]> = {
  chest: ['CHEST_L', 'CHEST_R'],
  shouldersFront: ['DELTS_FRONT_L', 'DELTS_FRONT_R'],
  shouldersSide: ['DELTS_SIDE_L', 'DELTS_SIDE_R'],
  shouldersRear: ['DELTS_REAR_L', 'DELTS_REAR_R'],
  biceps: ['BICEPS_L', 'BICEPS_R'],
  triceps: ['TRICEPS_L', 'TRICEPS_R'],
  forearms: ['FOREARMS_L', 'FOREARMS_R'],
  upperBack: ['UPPER_BACK_L', 'UPPER_BACK_R'],
  lats: ['LATS_L', 'LATS_R'],
  traps: ['TRAPS_L', 'TRAPS_R'],
  core: ['ABS', 'OBLIQUES_L', 'OBLIQUES_R'],
  lowerBack: ['LOWER_BACK'],
  glutes: ['GLUTES_L', 'GLUTES_R'],
  hipFlexors: ['HIP_FLEXORS_L', 'HIP_FLEXORS_R'],
  adductors: ['ADDUCTORS_L', 'ADDUCTORS_R'],
  quads: ['QUADS_L', 'QUADS_R'],
  hamstrings: ['HAMSTRINGS_L', 'HAMSTRINGS_R'],
  calves: ['CALVES_L', 'CALVES_R'],
  tibialis: ['TIBIALIS_L', 'TIBIALIS_R'],
  neck: ['NECK'],
};

const MATCHERS: { pattern: RegExp; groups: string[] }[] = [
  { pattern: /bench|chest|press-up|push\s*up|incline|fly/, groups: ['chest', 'shouldersFront', 'triceps'] },
  { pattern: /shoulder|overhead\s*press|arnold|lateral\s*raise|rear\s*delt/, groups: ['shouldersFront', 'shouldersSide', 'shouldersRear', 'traps'] },
  { pattern: /row|pull\s*up|lat\s*pull|pulldown|back\s*day|deadlift/, groups: ['upperBack', 'lats', 'traps', 'biceps', 'forearms'] },
  { pattern: /bicep|curl|chin\s*up/, groups: ['biceps', 'forearms'] },
  { pattern: /tricep|dip|skull\s*crusher|pushdown/, groups: ['triceps'] },
  { pattern: /squat|lunge|leg\s*press|leg\s*extension|quad/, groups: ['quads', 'glutes', 'adductors'] },
  { pattern: /hamstring|rdl|romanian|good\s*morning|leg\s*curl/, groups: ['hamstrings', 'glutes', 'lowerBack'] },
  { pattern: /calf|jump\s*rope|plyo/, groups: ['calves', 'tibialis'] },
  { pattern: /run|jog|sprint|walk|cycle|bike|cardio|interval/, groups: ['quads', 'hamstrings', 'calves', 'glutes', 'hipFlexors'] },
  { pattern: /core|abs|plank|oblique|hollow/, groups: ['core', 'hipFlexors'] },
  { pattern: /yoga|mobility|stretch|recovery/, groups: ['core', 'hipFlexors', 'lowerBack', 'neck'] },
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function emptyRawScores(): RawScores {
  return { stimulus: 0, soreness: 0, pain: 0, fatigue: 0 };
}

function emptyRegionScores(): BodyMapRegionScores {
  return { stimulus: 0, soreness: 0, pain: 0, fatigue: 0, composite: 0 };
}

function getDaysForTimeframe(timeframe: BodyMapTimeframe): number {
  if (timeframe === 'SESSION') return 1;
  if (timeframe === '28D') return 28;
  return 7;
}

function workoutText(workout: WorkoutEntry): string {
  const exerciseText = Array.isArray(workout.exercises)
    ? workout.exercises
        .map((block) => String(block?.name || '').trim())
        .filter(Boolean)
        .join(' ')
    : '';

  return [
    String(workout.label || ''),
    String(workout.note || ''),
    String(workout.type || ''),
    String(workout.workoutClass || ''),
    exerciseText,
  ]
    .join(' ')
    .toLowerCase();
}

function uniqueRegions(input: string[]): string[] {
  return Array.from(new Set(input.filter(Boolean)));
}

function regionsForGroups(groups: string[]): string[] {
  const regions: string[] = [];
  for (const group of groups) {
    const keys = REGION_GROUPS[group] || [];
    regions.push(...keys);
  }
  return uniqueRegions(regions);
}

function inferWorkoutRegions(workout: WorkoutEntry): string[] {
  const text = workoutText(workout);
  const matchedGroups: string[] = [];

  for (const matcher of MATCHERS) {
    if (matcher.pattern.test(text)) {
      matchedGroups.push(...matcher.groups);
    }
  }

  if (matchedGroups.length > 0) {
    return regionsForGroups(matchedGroups);
  }

  if (workout.type === 'strength') {
    return regionsForGroups(['chest', 'upperBack', 'shouldersFront', 'triceps', 'biceps']);
  }
  if (workout.type === 'mobility') {
    return regionsForGroups(['core', 'hipFlexors', 'lowerBack', 'neck']);
  }

  return regionsForGroups(['quads', 'hamstrings', 'calves', 'glutes', 'hipFlexors']);
}

function intensityMultiplier(workout: WorkoutEntry): number {
  const intensity = String(workout.intensity || 'moderate').toLowerCase();
  if (intensity === 'hard') return 1.25;
  if (intensity === 'easy') return 0.78;
  return 1;
}

function workoutBaseLoad(workout: WorkoutEntry): number {
  const duration = Math.max(0, Number(workout.durationMin) || Number(workout.minutes) || 0);
  const calories = Math.max(0, Number(workout.caloriesBurned) || 0);
  const effort = Math.max(0, Number(workout.effortUnits) || Number(workout.effortScore) || 0);
  const distance = Math.max(0, Number((workout as any)?.distance) || 0);

  const raw = Math.max(duration * 1.35, calories * 0.32, effort * 2.5, distance * 14, 12);
  return raw * intensityMultiplier(workout);
}

function painSignal(workout: WorkoutEntry): number {
  const text = `${String(workout.label || '')} ${String(workout.note || '')}`.toLowerCase();
  if (/(pain|hurt|injur|strain|tweak|ache)/.test(text)) return 34;
  const intensity = String(workout.intensity || '').toLowerCase();
  if (intensity === 'hard') return 8;
  return 2;
}

function parseLocalDateKey(dateKey: string): Date {
  const [yearRaw, monthRaw, dayRaw] = dateKey.split('-');
  const year = Number(yearRaw) || 1970;
  const month = Number(monthRaw) || 1;
  const day = Number(dayRaw) || 1;
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function diffDays(fromDate: Date, toDate: Date): number {
  return Math.max(0, Math.round((toDate.getTime() - fromDate.getTime()) / 86400000));
}

function initRawMap(): Record<string, RawScores> {
  const map: Record<string, RawScores> = {};
  for (const region of REGION_CATALOG) {
    map[region.key] = emptyRawScores();
  }
  return map;
}

function normalizeRawMap(rawMap: Record<string, RawScores>): Record<string, BodyMapRegionScores> {
  const maxStimulus = Math.max(0, ...Object.values(rawMap).map((entry) => entry.stimulus));
  const maxSoreness = Math.max(0, ...Object.values(rawMap).map((entry) => entry.soreness));
  const maxPain = Math.max(0, ...Object.values(rawMap).map((entry) => entry.pain));
  const maxFatigue = Math.max(0, ...Object.values(rawMap).map((entry) => entry.fatigue));

  const normalized: Record<string, BodyMapRegionScores> = {};
  for (const region of REGION_CATALOG) {
    const raw = rawMap[region.key] || emptyRawScores();
    const stimulus = maxStimulus > 0 ? Math.round(clamp((raw.stimulus / maxStimulus) * 100, 0, 100)) : 0;
    const soreness = maxSoreness > 0 ? Math.round(clamp((raw.soreness / maxSoreness) * 100, 0, 100)) : 0;
    const pain = maxPain > 0 ? Math.round(clamp((raw.pain / maxPain) * 100, 0, 100)) : 0;
    const fatigue = maxFatigue > 0 ? Math.round(clamp((raw.fatigue / maxFatigue) * 100, 0, 100)) : 0;
    const composite = Math.round(clamp(stimulus * 0.45 + soreness * 0.18 + pain * 0.15 + fatigue * 0.22, 0, 100));

    normalized[region.key] = {
      stimulus,
      soreness,
      pain,
      fatigue,
      composite,
    };
  }
  return normalized;
}

function valueForLens(scores: BodyMapRegionScores, lens: BodyMapLens): number {
  switch (lens) {
    case 'SORENESS':
      return scores.soreness;
    case 'PAIN':
      return scores.pain;
    case 'FATIGUE':
      return scores.fatigue;
    case 'COMPOSITE':
      return scores.composite;
    default:
      return scores.stimulus;
  }
}

function lensSummary(regions: BodyMapRegionSnapshot[], lens: BodyMapLens): BodyMapLensSummary {
  const values = regions.map((region) => valueForLens(region.scores, lens));
  const max = values.length ? Math.max(...values) : 0;
  const avg = values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
  const topRegions = regions
    .map((region) => ({
      id: region.id,
      key: region.key,
      label: region.label,
      score: valueForLens(region.scores, lens),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return {
    lens,
    max,
    avg,
    topRegions,
  };
}

export function getBodyMapRegionCatalog(): { id: number; key: string; label: string }[] {
  return REGION_CATALOG.slice();
}

export async function computeBodyMapSnapshot(timeframe: BodyMapTimeframe): Promise<BodyMapComputedSnapshot> {
  const days = getDaysForTimeframe(timeframe);
  const recentLogs = await getRecentDailyLogs(days);
  const now = new Date();

  const aggregateRaw = initRawMap();
  const dailyRawByDate: Record<string, Record<string, RawScores>> = {};

  for (const row of recentLogs) {
    const dateKey = String(row?.date || '').trim();
    if (!dateKey) continue;

    if (!dailyRawByDate[dateKey]) {
      dailyRawByDate[dateKey] = initRawMap();
    }

    const workouts = Array.isArray(row?.log?.workouts) ? (row.log.workouts as WorkoutEntry[]) : [];
    const daysAgo = diffDays(parseLocalDateKey(dateKey), now);
    const sorenessDecay = Math.exp(-daysAgo / 2.2);
    const fatigueDecay = Math.exp(-daysAgo / 5.2);
    const painDecay = Math.exp(-daysAgo / 6.3);

    for (const workout of workouts) {
      const regions = inferWorkoutRegions(workout);
      if (!regions.length) continue;

      const perRegionFactor = 1 / regions.length;
      const baseLoad = workoutBaseLoad(workout);
      const painBase = painSignal(workout);

      const stimulusLoad = baseLoad * perRegionFactor;
      const sorenessLoad = baseLoad * 0.62 * sorenessDecay * perRegionFactor;
      const fatigueLoad = baseLoad * 0.78 * fatigueDecay * perRegionFactor;
      const painLoad = painBase * painDecay * perRegionFactor;

      for (const regionKey of regions) {
        if (!aggregateRaw[regionKey]) continue;
        aggregateRaw[regionKey].stimulus += stimulusLoad;
        aggregateRaw[regionKey].soreness += sorenessLoad;
        aggregateRaw[regionKey].fatigue += fatigueLoad;
        aggregateRaw[regionKey].pain += painLoad;

        dailyRawByDate[dateKey][regionKey].stimulus += stimulusLoad;
        dailyRawByDate[dateKey][regionKey].soreness += sorenessLoad;
        dailyRawByDate[dateKey][regionKey].fatigue += fatigueLoad;
        dailyRawByDate[dateKey][regionKey].pain += painLoad;
      }
    }
  }

  const normalized = normalizeRawMap(aggregateRaw);
  const regions: BodyMapRegionSnapshot[] = REGION_CATALOG.map((region) => ({
    id: region.id,
    key: region.key,
    label: region.label,
    scores: normalized[region.key] || emptyRegionScores(),
  }));

  const lensSummaries: Record<BodyMapLens, BodyMapLensSummary> = {
    STIMULUS: lensSummary(regions, 'STIMULUS'),
    SORENESS: lensSummary(regions, 'SORENESS'),
    PAIN: lensSummary(regions, 'PAIN'),
    FATIGUE: lensSummary(regions, 'FATIGUE'),
    COMPOSITE: lensSummary(regions, 'COMPOSITE'),
  };

  const historyByRegionId: Record<number, BodyMapHistoryPoint[]> = {};
  const orderedDates = recentLogs.map((row) => String(row.date || '')).filter(Boolean);
  for (const region of REGION_CATALOG) {
    historyByRegionId[region.id] = [];
  }

  for (const dateKey of orderedDates) {
    const dayRaw = dailyRawByDate[dateKey] || initRawMap();
    const dayNormalized = normalizeRawMap(dayRaw);
    for (const region of REGION_CATALOG) {
      historyByRegionId[region.id].push({
        date: dateKey,
        scores: dayNormalized[region.key] || emptyRegionScores(),
      });
    }
  }

  return {
    timeframe,
    generatedAt: new Date().toISOString(),
    regions,
    lensSummaries,
    historyByRegionId,
  };
}
