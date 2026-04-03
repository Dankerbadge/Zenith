import { getUserProfile, setStorageItem, USER_PROFILE_KEY } from './storageUtils';

export type TrackingPriorityMode = 'accuracy' | 'responsiveness';

const DEFAULT_TRACKING_PRIORITY: TrackingPriorityMode = 'accuracy';

function normalizePriority(value: unknown): TrackingPriorityMode {
  return value === 'responsiveness' ? 'responsiveness' : DEFAULT_TRACKING_PRIORITY;
}

export async function getTrackingPriorityPreference(): Promise<TrackingPriorityMode> {
  const profile = await getUserProfile();
  const prefs = (profile.preferences || {}) as Record<string, unknown>;
  return normalizePriority(prefs.trackingPriorityMode);
}

export async function setTrackingPriorityPreference(next: TrackingPriorityMode): Promise<TrackingPriorityMode> {
  const profile = await getUserProfile();
  const prefs = (profile.preferences || {}) as Record<string, unknown>;
  const resolved = normalizePriority(next);
  await setStorageItem(USER_PROFILE_KEY, {
    ...profile,
    preferences: {
      ...prefs,
      trackingPriorityMode: resolved,
    },
  });
  return resolved;
}

