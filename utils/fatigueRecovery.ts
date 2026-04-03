import { getDailyMetricsByDates } from './dailyMetrics';
import { getTrainingLoadSnapshot } from './trainingLoad';
import { todayKey } from './storageUtils';

export type FatigueRecoveryStatus = 'recovered' | 'balanced' | 'strained';

export type FatigueRecoverySnapshot = {
  date: string;
  fatigueScore: number;
  recoveryScore: number;
  balanceScore: number;
  status: FatigueRecoveryStatus;
  acuteLoad: number;
  chronicDailyLoad: number;
  acuteVsChronic: number;
  hydrationRate: number;
  proteinRate: number;
  recoveryWorkRate: number;
};

type CacheEntry = {
  signature: string;
  value: FatigueRecoverySnapshot;
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

function statusForScore(balanceScore: number): FatigueRecoveryStatus {
  if (balanceScore >= 62) return 'recovered';
  if (balanceScore >= 45) return 'balanced';
  return 'strained';
}

export async function getFatigueRecoverySnapshot(date = todayKey()): Promise<FatigueRecoverySnapshot> {
  const metricDates = buildDateRange(date, 7);
  const metricsByDate = await getDailyMetricsByDates(metricDates);
  const [acuteLoad, chronicLoad] = await Promise.all([
    getTrainingLoadSnapshot(date, { lookbackDays: 7 }),
    getTrainingLoadSnapshot(date, { lookbackDays: 28 }),
  ]);

  const signature = [
    date,
    acuteLoad.totalLoad,
    acuteLoad.baselineLoad,
    chronicLoad.totalLoad,
    ...metricDates.map((d) => {
      const m = metricsByDate[d];
      return [
        d,
        m?.water || 0,
        m?.waterTargetOz || 120,
        m?.protein || 0,
        m?.proteinTarget || 170,
        m?.restDone ? 1 : 0,
        m?.winningDay ? 1 : 0,
      ].join(':');
    }),
  ].join('|');

  const cached = cache.get(date);
  if (cached && cached.signature === signature) return cached.value;

  const points = metricDates.map((d) => metricsByDate[d]);
  const hydrationRate = clamp(
    points.length
      ? points.reduce((sum, p) => sum + clamp((Number(p?.water) || 0) / (Number(p?.waterTargetOz) || 120), 0, 1.3), 0) /
          points.length
      : 0,
    0,
    1.3
  );
  const proteinRate = clamp(
    points.length
      ? points.reduce((sum, p) => sum + clamp((Number(p?.protein) || 0) / (Number(p?.proteinTarget) || 170), 0, 1.3), 0) /
          points.length
      : 0,
    0,
    1.3
  );
  const recoveryWorkRate = clamp(
    points.length
      ? points.reduce((sum, p) => sum + ((p?.restDone || p?.winningDay) ? 1 : 0), 0) / points.length
      : 0,
    0,
    1
  );

  const acuteVsChronic = Number(
    (
      acuteLoad.totalLoad /
      Math.max(1, chronicLoad.totalLoad / Math.max(1, chronicLoad.lookbackDays)) /
      Math.max(1, acuteLoad.lookbackDays)
    ).toFixed(2)
  );

  // Higher ratio above 1 means recent load is heavier than chronic baseline.
  const fatigueScore = Math.round(clamp(35 + (acuteVsChronic - 1) * 55 + (acuteLoad.loadRatio - 1) * 25, 5, 95));

  const recoveryScore = Math.round(
    clamp(hydrationRate * 35 + proteinRate * 35 + recoveryWorkRate * 30, 5, 100)
  );

  const balanceScore = Math.round(clamp(50 + (recoveryScore - fatigueScore) * 0.65, 0, 100));

  const snapshot: FatigueRecoverySnapshot = {
    date,
    fatigueScore,
    recoveryScore,
    balanceScore,
    status: statusForScore(balanceScore),
    acuteLoad: acuteLoad.totalLoad,
    chronicDailyLoad: Math.round(chronicLoad.totalLoad / Math.max(1, chronicLoad.lookbackDays)),
    acuteVsChronic,
    hydrationRate: Number((hydrationRate * 100).toFixed(0)),
    proteinRate: Number((proteinRate * 100).toFixed(0)),
    recoveryWorkRate: Number((recoveryWorkRate * 100).toFixed(0)),
  };

  cache.set(date, { signature, value: snapshot });
  return snapshot;
}

export function clearFatigueRecoveryCache(date?: string) {
  if (date) {
    cache.delete(date);
    return;
  }
  cache.clear();
}
