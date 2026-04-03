import { DailyLog, getDailyLogsByDates, getUserProfile, todayKey, type UserProfile } from './storageUtils';

export type AdaptiveTdeeSnapshot = {
  date: string;
  baselineTdee: number;
  adaptiveTdee: number;
  inferredTdee: number;
  avgIntake: number;
  confidence: number;
  confidenceLabel: 'low' | 'medium' | 'high';
  weightDeltaLbs: number;
  intakeDays: number;
  weightPoints: number;
  wearableDays: number;
  wearableCoverage: number;
  bandLow: number;
  bandHigh: number;
};

type CacheEntry = {
  signature: string;
  value: AdaptiveTdeeSnapshot;
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

function getBaselineTdee(profile: UserProfile): number {
  const goalsTarget = Number(profile.goals?.caloriesTarget);
  const profileTdee = Number((profile as any)?.tdee);
  if (Number.isFinite(profileTdee) && profileTdee > 1000) return profileTdee;
  if (Number.isFinite(goalsTarget) && goalsTarget > 1000) return goalsTarget;
  return 2200;
}

function linearSlope(points: Array<{ x: number; y: number }>): number {
  if (points.length < 2) return 0;
  const n = points.length;
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumXX = points.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

function confidenceLabel(score: number): 'low' | 'medium' | 'high' {
  if (score >= 0.72) return 'high';
  if (score >= 0.5) return 'medium';
  return 'low';
}

function buildSignature(date: string, profile: UserProfile, logsByDate: Record<string, DailyLog>) {
  const baseline = getBaselineTdee(profile);
  const goalsTarget = Number(profile.goals?.caloriesTarget) || '';
  const tokens = [date, baseline, goalsTarget];

  Object.keys(logsByDate)
    .sort()
    .forEach((key) => {
      const log = logsByDate[key] || {};
      tokens.push(
        key,
        log.updatedAt || '',
        String(Number(log.calories) || 0),
        typeof log.weight === 'number' ? String(log.weight) : '',
        String(Number(log.wearableSignals?.steps) || 0),
        String(Number(log.wearableSignals?.activeEnergy) || 0),
        String(Number(log.wearableSignals?.sleepMinutes) || 0),
        String(Number(log.wearableSignals?.restingHeartRate) || 0)
      );
    });

  return tokens.join('|');
}

function computeSnapshot(date: string, profile: UserProfile, logsByDate: Record<string, DailyLog>): AdaptiveTdeeSnapshot {
  const baselineTdee = getBaselineTdee(profile);
  const dates = Object.keys(logsByDate).sort();

  const intakeValues = dates
    .map((d) => Number(logsByDate[d]?.calories) || 0)
    .filter((cals) => cals > 0);

  const weights = dates
    .map((d, i) => ({ x: i, y: typeof logsByDate[d]?.weight === 'number' ? (logsByDate[d]?.weight as number) : NaN }))
    .filter((p) => Number.isFinite(p.y));
  const wearableDays = dates.filter((d) => {
    const ws = logsByDate[d]?.wearableSignals;
    return (
      (Number(ws?.steps) || 0) > 0 ||
      (Number(ws?.activeEnergy) || 0) > 0 ||
      (Number(ws?.sleepMinutes) || 0) > 0 ||
      (Number(ws?.restingHeartRate) || 0) > 0
    );
  }).length;

  const avgIntake = intakeValues.length
    ? intakeValues.reduce((sum, val) => sum + val, 0) / intakeValues.length
    : baselineTdee;

  const weightSlopePerDay = linearSlope(weights);
  const boundedWeightSlope = clamp(weightSlopePerDay, -0.2, 0.2);
  const inferredTdee = clamp(avgIntake - boundedWeightSlope * 3500, 1200, 4500);

  const intakeCoverage = clamp(intakeValues.length / 14, 0, 1);
  const weightCoverage = clamp(weights.length / 8, 0, 1);
  const wearableCoverage = clamp(wearableDays / dates.length, 0, 1);
  const rawConfidence = 0.2 + intakeCoverage * 0.45 + weightCoverage * 0.35;
  const wearableBoost = wearableCoverage * 0.15;
  const confidence = clamp(rawConfidence + wearableBoost, 0.2, 0.98);

  // Slow adaptation rule: move partially toward inferred value and cap single-step movement.
  const alpha = 0.1 + confidence * 0.2;
  const targetShift = (inferredTdee - baselineTdee) * alpha;
  const boundedShift = clamp(targetShift, -180, 180);
  const adaptiveTdee = Math.round(clamp(baselineTdee + boundedShift, 1200, 4500));

  const bandHalfWidth = Math.round(220 - confidence * 140);
  const bandLow = Math.max(1000, adaptiveTdee - bandHalfWidth);
  const bandHigh = adaptiveTdee + bandHalfWidth;

  const weightDeltaLbs =
    weights.length >= 2 ? Number((weights[weights.length - 1].y - weights[0].y).toFixed(2)) : 0;

  return {
    date,
    baselineTdee: Math.round(baselineTdee),
    adaptiveTdee,
    inferredTdee: Math.round(inferredTdee),
    avgIntake: Math.round(avgIntake),
    confidence: Number(confidence.toFixed(2)),
    confidenceLabel: confidenceLabel(confidence),
    weightDeltaLbs,
    intakeDays: intakeValues.length,
    weightPoints: weights.length,
    wearableDays,
    wearableCoverage: Number(wearableCoverage.toFixed(2)),
    bandLow,
    bandHigh,
  };
}

export async function getAdaptiveTdeeSnapshot(
  date = todayKey(),
  options?: { profile?: UserProfile; logsByDate?: Record<string, DailyLog>; lookbackDays?: number }
): Promise<AdaptiveTdeeSnapshot> {
  const lookbackDays = clamp(Number(options?.lookbackDays) || 28, 14, 42);
  const dates = buildDateRange(date, lookbackDays);
  const profile = options?.profile || (await getUserProfile());
  const logsByDate = options?.logsByDate || (await getDailyLogsByDates(dates));

  const signature = buildSignature(date, profile, logsByDate);
  const cached = cache.get(date);
  if (cached && cached.signature === signature) return cached.value;

  const snapshot = computeSnapshot(date, profile, logsByDate);
  cache.set(date, { signature, value: snapshot });
  return snapshot;
}

export function clearAdaptiveTdeeCache(date?: string) {
  if (date) {
    cache.delete(date);
    return;
  }
  cache.clear();
}
