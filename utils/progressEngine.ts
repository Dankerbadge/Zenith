import AsyncStorage from '@react-native-async-storage/async-storage';
import { calculateCurrentRank, type Rank } from '../constants/ranks';
import { DAILY_XP_CAP } from './xpSystem';
import { todayKey } from './storageUtils';

export type ProgressEventType = 'workout' | 'food' | 'weight' | string;

export type RecordEventResult = {
  xpAdded: number;
  dailyXPTotal: number;
  becameWinningDay: boolean;
  didRankUp: boolean;
  newRankName?: string;
  newRankColor?: string;
};

type StoredProgressV1 = {
  totalXP: number;
  dailyByDate: Record<string, number>;
  currentRankId: string;
  updatedAtIso: string;
};

const STORAGE_KEY = 'zenith:progressEngine:v1';

function clampInt(value: number, min: number, max: number) {
  const n = Number.isFinite(value) ? Math.floor(value) : 0;
  return Math.max(min, Math.min(max, n));
}

function baseXpForEvent(type: ProgressEventType, payload: any): number {
  const t = String(type || '').toLowerCase();
  if (t === 'workout') {
    const duration = clampInt(Number(payload?.duration), 0, 600);
    // 10 XP base + up to 10 XP from duration (capped).
    return clampInt(10 + Math.round(duration / 6), 0, 20);
  }
  if (t === 'food') return 5;
  if (t === 'weight') return 3;
  return 2;
}

function emptyProgress(): StoredProgressV1 {
  const initialRank: Rank = calculateCurrentRank(0, 0);
  return {
    totalXP: 0,
    dailyByDate: {},
    currentRankId: initialRank.id,
    updatedAtIso: new Date().toISOString(),
  };
}

async function readProgress(): Promise<StoredProgressV1> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyProgress();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return emptyProgress();
    const totalXP = clampInt(Number((parsed as any).totalXP), 0, 1_000_000_000);
    const dailyByDate = (parsed as any).dailyByDate && typeof (parsed as any).dailyByDate === 'object' ? (parsed as any).dailyByDate : {};
    const currentRankId = String((parsed as any).currentRankId || calculateCurrentRank(totalXP, 0).id);
    return {
      totalXP,
      dailyByDate: dailyByDate as Record<string, number>,
      currentRankId,
      updatedAtIso: String((parsed as any).updatedAtIso || new Date().toISOString()),
    };
  } catch {
    return emptyProgress();
  }
}

async function writeProgress(next: StoredProgressV1) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

/**
 * Minimal, deterministic progress engine used by legacy log modals.
 * Awards capped daily XP, tracks total XP, and emits a rank-up signal when crossing a threshold.
 */
export async function recordEvent(type: ProgressEventType, payload?: any): Promise<RecordEventResult> {
  const date = todayKey();
  const progress = await readProgress();

  const beforeRank = calculateCurrentRank(progress.totalXP, 0);
  const dailyBefore = clampInt(Number(progress.dailyByDate[date] || 0), 0, DAILY_XP_CAP);

  const base = clampInt(baseXpForEvent(type, payload), 0, DAILY_XP_CAP);
  const remaining = clampInt(DAILY_XP_CAP - dailyBefore, 0, DAILY_XP_CAP);
  const xpAdded = clampInt(Math.min(base, remaining), 0, DAILY_XP_CAP);

  const dailyXPTotal = clampInt(dailyBefore + xpAdded, 0, DAILY_XP_CAP);
  // Winning day parity: first meaningful logged event of the day should trigger the toast once.
  const becameWinningDay = dailyBefore <= 0 && dailyXPTotal > 0;
  const totalXP = clampInt(progress.totalXP + xpAdded, 0, 1_000_000_000);
  const afterRank = calculateCurrentRank(totalXP, 0);

  const didRankUp = afterRank.id !== beforeRank.id;

  const next: StoredProgressV1 = {
    totalXP,
    dailyByDate: { ...progress.dailyByDate, [date]: dailyXPTotal },
    currentRankId: afterRank.id,
    updatedAtIso: new Date().toISOString(),
  };
  await writeProgress(next);

  return {
    xpAdded,
    dailyXPTotal,
    becameWinningDay,
    didRankUp,
    newRankName: didRankUp ? afterRank.name : undefined,
    newRankColor: didRankUp ? afterRank.color : undefined,
  };
}
