import { getUserProfile, setStorageItem, USER_PROFILE_KEY } from './storageUtils';
import { type WatchWorkoutPlanId, WATCH_WORKOUT_PLANS } from './watchWorkoutPlanCatalog';

const PREF_KEY = 'watchWorkoutCarouselOrder_v1';

// Default is intentionally "useful" (not just the original 3 buttons), but still capped so the
// watch stays fast. Users can customize/reorder from the phone.
export const DEFAULT_WATCH_CAROUSEL_ORDER: WatchWorkoutPlanId[] = [
  'runOutdoor',
  'runTreadmill',
  'lift',
  'walk',
  'cycle',
  'hike',
  'row',
  'elliptical',
  'hiit',
  'yoga',
  'pilates',
  'climbing',
];

function normalizePlanId(value: unknown): WatchWorkoutPlanId | null {
  const s = String(value || '').trim();
  if (!s) return null;
  const exists = WATCH_WORKOUT_PLANS.some((p) => p.planId === (s as any));
  return exists ? (s as WatchWorkoutPlanId) : null;
}

export function normalizeWatchWorkoutCarouselOrder(values: unknown): WatchWorkoutPlanId[] {
  const raw = Array.isArray(values) ? values : [];
  const out: WatchWorkoutPlanId[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    const id = normalizePlanId(v);
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export async function getWatchWorkoutCarouselOrder(): Promise<WatchWorkoutPlanId[]> {
  const profile = await getUserProfile();
  const prefs = (profile?.preferences || {}) as any;
  const order = normalizeWatchWorkoutCarouselOrder(prefs?.[PREF_KEY]);
  // Migration: if the user never customized (old 3-item default), upgrade to the richer default.
  if (order.join('|') === 'runOutdoor|runTreadmill|lift') return DEFAULT_WATCH_CAROUSEL_ORDER;
  return order.length > 0 ? order : DEFAULT_WATCH_CAROUSEL_ORDER;
}

export async function setWatchWorkoutCarouselOrder(order: WatchWorkoutPlanId[]): Promise<void> {
  const nextOrder = normalizeWatchWorkoutCarouselOrder(order);
  const profile = await getUserProfile();
  const nextProfile = {
    ...profile,
    preferences: {
      ...(profile?.preferences || {}),
      [PREF_KEY]: nextOrder,
    },
  };
  await setStorageItem(USER_PROFILE_KEY, nextProfile);
}
