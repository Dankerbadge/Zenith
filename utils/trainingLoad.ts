import { getDailyLogsByDates, todayKey, type DailyLog } from './storageUtils';

export type TrainingLoadStatus = 'low' | 'balanced' | 'high';

export type TrainingLoadSnapshot = {
  date: string;
  lookbackDays: number;
  strengthLoad: number;
  runningLoad: number;
  activeRestLoad: number;
  totalLoad: number;
  baselineLoad: number;
  loadRatio: number;
  status: TrainingLoadStatus;
  strengthSessions: number;
  runningSessions: number;
  activeRestSessions: number;
};

type CacheEntry = {
  signature: string;
  value: TrainingLoadSnapshot;
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

function asNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function intensityMultiplier(value: unknown): number {
  const intensity = String(value || '').toLowerCase();
  if (intensity === 'hard') return 1.2;
  if (intensity === 'easy') return 0.85;
  return 1;
}

function classifyWorkout(session: Record<string, unknown>) {
  const type = String(session.type || '').toLowerCase();
  const distance = asNumber(session.distance);
  const pace = asNumber(session.pace);
  const isRunning = type.includes('run') || distance > 0 || pace > 0;
  const isStrength = type.includes('strength') || type.includes('lift');
  return { isRunning, isStrength };
}

function buildSignature(date: string, lookbackDays: number, logsByDate: Record<string, DailyLog>) {
  const tokens = [date, lookbackDays];
  Object.keys(logsByDate)
    .sort()
    .forEach((day) => {
      const log = logsByDate[day] || {};
      const workouts = Array.isArray(log.workouts) ? log.workouts : [];
      const rest = Array.isArray(log.activeRest) ? log.activeRest : [];
      tokens.push(day, log.updatedAt || '', workouts.length, rest.length);
    });
  return tokens.join('|');
}

function computeWindowLoad(logsByDate: Record<string, DailyLog>, dates: string[]) {
  let strengthLoad = 0;
  let runningLoad = 0;
  let activeRestLoad = 0;
  let strengthSessions = 0;
  let runningSessions = 0;
  let activeRestSessions = 0;

  dates.forEach((date) => {
    const log = logsByDate[date] || {};
    const workouts = Array.isArray(log.workouts) ? log.workouts : [];
    const activeRest = Array.isArray(log.activeRest) ? log.activeRest : [];

    workouts.forEach((sessionRaw) => {
      const session = (sessionRaw || {}) as Record<string, unknown>;
      const { isRunning, isStrength } = classifyWorkout(session);
      const duration = asNumber(session.durationMin) || asNumber(session.minutes) || asNumber(session.duration);
      const totalSets = asNumber(session.totalSets);
      const totalVolume = asNumber(session.totalVolume);
      const exerciseCount = asNumber(session.exerciseCount);
      const calories = asNumber(session.caloriesBurned) || asNumber(session.calories);
      const distance = asNumber(session.distance);
      const baseIntensity = intensityMultiplier(session.intensity);

      if (isRunning) {
        const load = distance * 42 + duration * 1.8 * baseIntensity + calories * 0.12;
        runningLoad += Math.max(0, load);
        runningSessions += 1;
        return;
      }

      if (isStrength) {
        const load = totalVolume / 120 + totalSets * 2.2 + exerciseCount * 1.5 + duration * 1.1 * baseIntensity;
        strengthLoad += Math.max(0, load);
        strengthSessions += 1;
        return;
      }

      // Non-running/non-strength workouts still count as low-grade training stress.
      const mixedLoad = duration * 1.2 * baseIntensity + calories * 0.08;
      strengthLoad += Math.max(0, mixedLoad);
      strengthSessions += 1;
    });

    activeRest.forEach((entryRaw) => {
      const entry = (entryRaw || {}) as Record<string, unknown>;
      const minutes = asNumber(entry.minutes);
      const intensity = intensityMultiplier(entry.intensity);
      const load = minutes * 0.9 * intensity;
      activeRestLoad += Math.max(0, load);
      activeRestSessions += 1;
    });
  });

  return {
    strengthLoad,
    runningLoad,
    activeRestLoad,
    totalLoad: strengthLoad + runningLoad + activeRestLoad,
    strengthSessions,
    runningSessions,
    activeRestSessions,
  };
}

function classifyStatus(loadRatio: number): TrainingLoadStatus {
  if (loadRatio < 0.8) return 'low';
  if (loadRatio > 1.25) return 'high';
  return 'balanced';
}

export async function getTrainingLoadSnapshot(
  date = todayKey(),
  options?: { lookbackDays?: number }
): Promise<TrainingLoadSnapshot> {
  const lookbackDays = clamp(Number(options?.lookbackDays) || 7, 7, 42);
  const currentDates = buildDateRange(date, lookbackDays);

  const previousEnd = todayKey(new Date(parseDateKey(currentDates[0]).getTime() - 24 * 60 * 60 * 1000));
  const previousDates = buildDateRange(previousEnd, lookbackDays);

  const allDates = Array.from(new Set([...currentDates, ...previousDates]));
  const logsByDate = await getDailyLogsByDates(allDates);

  const signature = buildSignature(date, lookbackDays, logsByDate);
  const cacheKey = `${date}:${lookbackDays}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.signature === signature) return cached.value;

  const current = computeWindowLoad(logsByDate, currentDates);
  const previous = computeWindowLoad(logsByDate, previousDates);

  const totalLoad = Math.round(current.totalLoad);
  const baselineLoad = Math.max(1, Math.round(previous.totalLoad || totalLoad));
  const loadRatio = Number((totalLoad / baselineLoad).toFixed(2));

  const snapshot: TrainingLoadSnapshot = {
    date,
    lookbackDays,
    strengthLoad: Math.round(current.strengthLoad),
    runningLoad: Math.round(current.runningLoad),
    activeRestLoad: Math.round(current.activeRestLoad),
    totalLoad,
    baselineLoad,
    loadRatio,
    status: classifyStatus(loadRatio),
    strengthSessions: current.strengthSessions,
    runningSessions: current.runningSessions,
    activeRestSessions: current.activeRestSessions,
  };

  cache.set(cacheKey, { signature, value: snapshot });
  return snapshot;
}

export function clearTrainingLoadCache(date?: string, lookbackDays?: number) {
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
