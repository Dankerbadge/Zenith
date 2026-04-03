import { getDailyMetricsByDates } from './dailyMetrics';
import { todayKey } from './storageUtils';

export type NutritionSufficiencyStatus = 'low' | 'moderate' | 'strong';

export type NutritionSufficiencySnapshot = {
  date: string;
  lookbackDays: number;
  proteinRate: number;
  hydrationRate: number;
  calorieConsistencyRate: number;
  overallScore: number;
  status: NutritionSufficiencyStatus;
  proteinDaysHit: number;
  hydrationDaysHit: number;
  calorieDaysInWindow: number;
};

type CacheEntry = {
  signature: string;
  value: NutritionSufficiencySnapshot;
};

const cache = new Map<string, CacheEntry>();

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function buildDateRange(endDate: string, days: number): string[] {
  const end = parseDateKey(endDate);
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const dt = new Date(end.getTime() - i * 24 * 60 * 60 * 1000);
    out.push(todayKey(dt));
  }
  return out;
}

function statusForScore(score: number): NutritionSufficiencyStatus {
  if (score >= 75) return 'strong';
  if (score >= 50) return 'moderate';
  return 'low';
}

export async function getNutritionSufficiencySnapshot(
  date = todayKey(),
  options?: { lookbackDays?: number }
): Promise<NutritionSufficiencySnapshot> {
  const lookbackDays = clamp(Number(options?.lookbackDays) || 14, 7, 42);
  const dates = buildDateRange(date, lookbackDays);
  const metricsByDate = await getDailyMetricsByDates(dates);

  const signature = [
    date,
    lookbackDays,
    ...dates.map((d) => {
      const m = metricsByDate[d];
      return [
        d,
        m?.protein || 0,
        m?.proteinTarget || 170,
        m?.water || 0,
        m?.waterTargetOz || 120,
        m?.calories || 0,
        m?.caloriesTarget || 0,
      ].join(':');
    }),
  ].join('|');

  const cacheKey = `${date}:${lookbackDays}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.signature === signature) return cached.value;

  let proteinDaysHit = 0;
  let hydrationDaysHit = 0;
  let calorieDaysInWindow = 0;
  let proteinRateSum = 0;
  let hydrationRateSum = 0;

  dates.forEach((d) => {
    const m = metricsByDate[d];
    const protein = Number(m?.protein) || 0;
    const proteinTarget = Number(m?.proteinTarget) || 170;
    const water = Number(m?.water) || 0;
    const waterTarget = Number(m?.waterTargetOz) || 120;
    const calories = Number(m?.calories) || 0;
    const caloriesTarget = Number(m?.caloriesTarget) || 0;

    const proteinRatio = clamp(protein / Math.max(1, proteinTarget), 0, 1.25);
    const hydrationRatio = clamp(water / Math.max(1, waterTarget), 0, 1.25);

    proteinRateSum += proteinRatio;
    hydrationRateSum += hydrationRatio;

    if (proteinRatio >= 1) proteinDaysHit += 1;
    if (hydrationRatio >= 1) hydrationDaysHit += 1;

    if (caloriesTarget > 0 && Math.abs(calories - caloriesTarget) <= 200) {
      calorieDaysInWindow += 1;
    }
  });

  const proteinRate = Number(((proteinRateSum / lookbackDays) * 100).toFixed(0));
  const hydrationRate = Number(((hydrationRateSum / lookbackDays) * 100).toFixed(0));
  const calorieConsistencyRate = Number(((calorieDaysInWindow / lookbackDays) * 100).toFixed(0));

  const overallScore = Math.round(
    clamp(proteinRate * 0.4 + hydrationRate * 0.35 + calorieConsistencyRate * 0.25, 0, 100)
  );

  const snapshot: NutritionSufficiencySnapshot = {
    date,
    lookbackDays,
    proteinRate,
    hydrationRate,
    calorieConsistencyRate,
    overallScore,
    status: statusForScore(overallScore),
    proteinDaysHit,
    hydrationDaysHit,
    calorieDaysInWindow,
  };

  cache.set(cacheKey, { signature, value: snapshot });
  return snapshot;
}

export function clearNutritionSufficiencyCache(date?: string, lookbackDays?: number) {
  if (date && lookbackDays) {
    cache.delete(`${date}:${lookbackDays}`);
    return;
  }
  if (date) {
    Array.from(cache.keys()).forEach((key) => {
      if (key.startsWith(`${date}:`)) cache.delete(key);
    });
    return;
  }
  cache.clear();
}
