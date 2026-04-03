import { todayKey } from './storageUtils';

function toLocalMidnightAfter(start: Date): Date {
  const midnight = new Date(start);
  midnight.setHours(24, 0, 0, 0);
  return midnight;
}

export function assignSessionDayKey(startIsoUtc: string, endIsoUtc: string): string {
  const start = new Date(startIsoUtc);
  const end = new Date(endIsoUtc);
  const startMs = start.getTime();
  const endMs = end.getTime();

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return todayKey(start);
  }

  const totalMs = endMs - startMs;
  const nextMidnight = toLocalMidnightAfter(start);
  const nextMidnightMs = nextMidnight.getTime();

  if (endMs <= nextMidnightMs) {
    return todayKey(start);
  }

  const afterMidnightMs = Math.max(0, endMs - nextMidnightMs);
  const afterRatio = afterMidnightMs / totalMs;
  if (afterRatio > 0.6) {
    return todayKey(end);
  }

  return todayKey(start);
}
