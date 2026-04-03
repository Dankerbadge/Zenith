import { getUserProfile, setStorageItem, todayKey, USER_PROFILE_KEY } from './storageUtils';
import type { AiInsight, AiRuntimeState, AiSettings, AiSurface } from './aiTypes';

const ALLOWED_SURFACES: Record<AiSurface, boolean> = {
  home: true,
  stats: true,
  post_run: true,
  weekly_recap: true,
};

const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: false,
  frequency: 'minimal',
  categories: {
    consistency: true,
    running: true,
    nutrition: true,
    hydration: true,
    challenges: true,
  },
  neverDuringActivity: true,
};

const DEFAULT_RUNTIME_STATE: AiRuntimeState = {
  shownBySurfaceDay: {},
  dismissedBySurfaceDay: {},
  recentInsights: [],
};

type RawPrefs = {
  aiOverlayEnabled?: boolean;
  aiInsightFrequency?: AiSettings['frequency'];
  aiInsightCategories?: Partial<AiSettings['categories']>;
  aiNeverDuringActivity?: boolean;
  aiRuntimeState?: Partial<AiRuntimeState>;
};

function normalizeSettings(raw: RawPrefs): AiSettings {
  const rawCategories = raw.aiInsightCategories || {};
  return {
    enabled: Boolean(raw.aiOverlayEnabled),
    frequency: raw.aiInsightFrequency === 'standard' ? 'standard' : 'minimal',
    categories: {
      consistency: rawCategories.consistency !== false,
      running: rawCategories.running !== false,
      nutrition: rawCategories.nutrition !== false,
      hydration: rawCategories.hydration !== false,
      challenges: rawCategories.challenges !== false,
    },
    neverDuringActivity: raw.aiNeverDuringActivity !== false,
  };
}

function normalizeRuntimeState(raw: RawPrefs): AiRuntimeState {
  const runtime = raw.aiRuntimeState || {};
  const recent = Array.isArray(runtime.recentInsights) ? runtime.recentInsights : [];
  return {
    shownBySurfaceDay: runtime.shownBySurfaceDay || {},
    dismissedBySurfaceDay: runtime.dismissedBySurfaceDay || {},
    recentInsights: recent
      .filter((item) => item && typeof item.insightType === 'string' && typeof item.fingerprint === 'string' && typeof item.shownDate === 'string')
      .slice(-100),
  };
}

export async function getAiSettings(): Promise<AiSettings> {
  const profile = await getUserProfile();
  const prefs = (profile.preferences || {}) as RawPrefs;
  return normalizeSettings(prefs);
}

export async function setAiSettings(next: Partial<AiSettings>): Promise<void> {
  const profile = await getUserProfile();
  const prefs = (profile.preferences || {}) as RawPrefs;
  const merged = {
    ...normalizeSettings(prefs),
    ...next,
    categories: {
      ...normalizeSettings(prefs).categories,
      ...(next.categories || {}),
    },
  } satisfies AiSettings;

  await setStorageItem(USER_PROFILE_KEY, {
    ...profile,
    preferences: {
      ...(profile.preferences || {}),
      aiOverlayEnabled: merged.enabled,
      aiInsightFrequency: merged.frequency,
      aiInsightCategories: merged.categories,
      aiNeverDuringActivity: merged.neverDuringActivity,
    },
  });
}

export async function isAiOverlayEnabled(): Promise<boolean> {
  const settings = await getAiSettings();
  return settings.enabled;
}

export async function setAiOverlayEnabled(enabled: boolean): Promise<void> {
  await setAiSettings({ enabled: Boolean(enabled) });
}

export async function canRenderAiSurface(surface: AiSurface, opts?: { duringActivity?: boolean }): Promise<boolean> {
  if (!ALLOWED_SURFACES[surface]) return false;
  const settings = await getAiSettings();
  if (!settings.enabled) return false;
  if (opts?.duringActivity && settings.neverDuringActivity) return false;
  return true;
}

export async function getAiRuntimeState(): Promise<AiRuntimeState> {
  const profile = await getUserProfile();
  const prefs = (profile.preferences || {}) as RawPrefs;
  return normalizeRuntimeState(prefs);
}

async function writeRuntimeState(runtime: AiRuntimeState): Promise<void> {
  const profile = await getUserProfile();
  await setStorageItem(USER_PROFILE_KEY, {
    ...profile,
    preferences: {
      ...(profile.preferences || {}),
      aiRuntimeState: {
        shownBySurfaceDay: runtime.shownBySurfaceDay,
        dismissedBySurfaceDay: runtime.dismissedBySurfaceDay,
        recentInsights: runtime.recentInsights.slice(-100),
      },
    },
  });
}

export async function dismissAiForToday(surface: AiSurface): Promise<void> {
  const runtime = await getAiRuntimeState();
  runtime.dismissedBySurfaceDay[surface] = todayKey();
  await writeRuntimeState(runtime);
}

export async function wasAiDismissedToday(surface: AiSurface): Promise<boolean> {
  const runtime = await getAiRuntimeState();
  return runtime.dismissedBySurfaceDay[surface] === todayKey();
}

export async function markAiInsightShown(surface: AiSurface, insight: Pick<AiInsight, 'insightType' | 'fingerprint'>): Promise<void> {
  const runtime = await getAiRuntimeState();
  const day = todayKey();
  runtime.shownBySurfaceDay[surface] = day;
  runtime.recentInsights = [...runtime.recentInsights, { ...insight, shownDate: day }].slice(-100);
  await writeRuntimeState(runtime);
}

export async function hasShownAiToday(surface: AiSurface): Promise<boolean> {
  const runtime = await getAiRuntimeState();
  return runtime.shownBySurfaceDay[surface] === todayKey();
}

export async function hasRecentMatchingInsight(insightType: string, fingerprint: string, days = 7): Promise<boolean> {
  const runtime = await getAiRuntimeState();
  const today = todayKey();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - Math.max(1, days));

  return runtime.recentInsights.some((item) => {
    if (item.insightType !== insightType || item.fingerprint !== fingerprint) return false;
    if (item.shownDate === today) return false;
    const [y, m, d] = String(item.shownDate).split('-').map(Number);
    const shown =
      Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d) ? new Date(y, m - 1, d, 0, 0, 0, 0) : new Date(NaN);
    return shown >= cutoff;
  });
}

export const AI_DEFAULT_SETTINGS = DEFAULT_AI_SETTINGS;
export const AI_DEFAULT_RUNTIME_STATE = DEFAULT_RUNTIME_STATE;
