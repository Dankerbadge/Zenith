import { calculateCurrentRank } from '../constants/ranks';
import { DailyLog, getAllDailyLogs, getDailyLog, getUserProfile, todayKey } from './storageUtils';
import { getActiveDaySignals, isActiveDay } from './semanticTrust';
import { WINNING_THRESHOLDS } from './winningThresholds';

export type WinningEval = {
  winningDay: boolean;
  activeDay: boolean;
  workoutDone: boolean;
  restDone: boolean;
  caloriesInWindow: boolean;
  restMinutes: number;
};

export type WinningHistoryRow = {
  date: string;
  winningDay: boolean;
  activeDay: boolean;
  workoutDone: boolean;
  restDone: boolean;
  caloriesInWindow: boolean;
  restMinutes: number;
};

export type WinningSnapshot = {
  today: WinningEval;
  totalWinningDays: number;
  currentStreak: number;
  bestStreak: number;
  history: WinningHistoryRow[];
};

export function evaluateWinningDay(
  log: DailyLog,
  _goals: {
    activeRestTargetMin?: number;
    caloriesTarget?: number;
    runWinningMinDistanceMiles?: number;
    runWinningMinDurationMin?: number;
  }
): WinningEval {
  const workouts = Array.isArray(log.workouts) ? log.workouts : [];
  const activeRest = Array.isArray(log.activeRest) ? log.activeRest : [];
  const restMinutes = activeRest.reduce((sum, entry) => sum + (Number(entry?.minutes) || 0), 0);
  const signals = getActiveDaySignals(log);
  const activeRestTargetMin = Math.max(0, Math.round(Number(_goals.activeRestTargetMin) || 0));

  const workoutDone = workouts.some((workout: any) => {
    const durationMin = Number(workout?.durationMin) || Number(workout?.duration) || Number(workout?.minutes) || 0;
    const sets = Number(workout?.totalSets) || Number(workout?.setCount) || 0;
    const distance = Number(workout?.distanceMiles) || Number(workout?.distance) || 0;
    return durationMin > 0 || sets > 0 || distance > 0;
  });

  const restMinTarget = activeRestTargetMin > 0 ? activeRestTargetMin : WINNING_THRESHOLDS.recovery.minDurationMin;
  const restDone = restMinutes >= restMinTarget;

  const activeDay = isActiveDay(log);
  // P0 streak doctrine: "Winning Day" is the same as "active day" (any meaningful daily log action).
  // This avoids truth leaks where the UI claims you're not progressing after you log.
  const caloriesInWindow = false;

  return {
    winningDay: activeDay,
    activeDay,
    workoutDone: workoutDone || signals.workoutLogged,
    restDone,
    caloriesInWindow,
    restMinutes,
  };
}

export async function getWinningSnapshot(limitDays?: number): Promise<WinningSnapshot> {
  const profile = await getUserProfile();
  const goals = profile.goals || {};

  const rows = await getAllDailyLogs();
  const sortedRows = rows
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date))
    .sort((a, b) => a.date.localeCompare(b.date));

  const logsByDate: Record<string, DailyLog> = {};
  sortedRows.forEach((row) => {
    logsByDate[row.date] = row.log;
  });

  const parseLocalDay = (key: string) => {
    const [y, m, d] = String(key).split('-').map(Number);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
    return new Date(y, m - 1, d);
  };

  const shiftDayKey = (key: string, deltaDays: number) => {
    const dt = parseLocalDay(key);
    if (!dt) return key;
    dt.setDate(dt.getDate() + deltaDays);
    return todayKey(dt);
  };

  const dayDiff = (a: string, b: string) => {
    const da = parseLocalDay(a);
    const db = parseLocalDay(b);
    if (!da || !db) return NaN;
    const ms = db.getTime() - da.getTime();
    return Math.round(ms / (24 * 60 * 60 * 1000));
  };

  const historyDates: string[] = (() => {
    if (typeof limitDays === 'number' && limitDays > 0) {
      const endKey = todayKey();
      const end = parseLocalDay(endKey);
      if (!end) return [];
      const days = Math.max(1, Math.floor(limitDays));
      const out: string[] = [];
      for (let i = days - 1; i >= 0; i -= 1) {
        const dt = new Date(end);
        dt.setDate(end.getDate() - i);
        out.push(todayKey(dt));
      }
      return out;
    }
    return sortedRows.map((row) => row.date);
  })();

  const history: WinningHistoryRow[] = historyDates.map((date) => {
    const evaluated = evaluateWinningDay(logsByDate[date] || {}, goals);
    return {
      date,
      winningDay: evaluated.winningDay,
      activeDay: evaluated.activeDay,
      workoutDone: evaluated.workoutDone,
      restDone: evaluated.restDone,
      caloriesInWindow: evaluated.caloriesInWindow,
      restMinutes: evaluated.restMinutes,
    };
  });

  const totalWinningDays = sortedRows.reduce((sum, row) => sum + (evaluateWinningDay(row.log, goals).winningDay ? 1 : 0), 0);

  const todayKeyStr = todayKey();
  const todayEval = evaluateWinningDay(logsByDate[todayKeyStr] || {}, goals);
  const yesterdayKeyStr = shiftDayKey(todayKeyStr, -1);
  const yesterdayEval = evaluateWinningDay(logsByDate[yesterdayKeyStr] || {}, goals);
  const anchor = todayEval.activeDay ? todayKeyStr : yesterdayEval.activeDay ? yesterdayKeyStr : null;

  let currentStreak = 0;
  if (anchor) {
    let cursor = anchor;
    while (true) {
      const evaluated = evaluateWinningDay(logsByDate[cursor] || {}, goals);
      if (!evaluated.activeDay) break;
      currentStreak += 1;
      cursor = shiftDayKey(cursor, -1);
    }
  }

  let bestStreak = 0;
  let running = 0;
  let prev: string | null = null;
  let prevWinning = false;
  sortedRows.forEach((row) => {
    const win = evaluateWinningDay(row.log, goals).activeDay;
    if (prev) {
      const delta = dayDiff(prev, row.date);
      if (delta !== 1) {
        running = 0;
        prevWinning = false;
      }
    }

    if (win) {
      running = prev && prevWinning && dayDiff(prev, row.date) === 1 ? running + 1 : 1;
      bestStreak = Math.max(bestStreak, running);
    } else {
      running = 0;
    }
    prevWinning = win;
    prev = row.date;
  });

  const todayLog = await getDailyLog(todayKeyStr);
  const today = evaluateWinningDay(todayLog, goals);

  return {
    today,
    totalWinningDays,
    currentStreak,
    bestStreak,
    history,
  };
}

export function getConsistencyRank(totalWinningDays: number) {
  // Deterministic rank from canonical rank table using days-driven synthetic XP.
  const syntheticXp = totalWinningDays * 350;
  return calculateCurrentRank(syntheticXp, totalWinningDays);
}
