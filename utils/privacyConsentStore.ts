import AsyncStorage from '@react-native-async-storage/async-storage';

export const PRIVACY_CONSENT_MIRROR_KEY = 'privacyConsentMirrorV1';

export type PrivacyConsentSnapshot = {
  notifications: boolean;
  analytics: boolean;
  publicSharing: boolean;
  consentUpdatedAt: string;
  notes?: string | null;
};

const DEFAULT_CONSENT_SNAPSHOT: PrivacyConsentSnapshot = {
  notifications: false,
  analytics: false,
  publicSharing: false,
  consentUpdatedAt: new Date(0).toISOString(),
  notes: null,
};

let cache: PrivacyConsentSnapshot | null = null;
let cacheAtMs = 0;
const CACHE_TTL_MS = 60_000;

function normalizeConsent(input: any): PrivacyConsentSnapshot {
  return {
    notifications: Boolean(input?.notifications),
    analytics: Boolean(input?.analytics),
    publicSharing: Boolean(input?.publicSharing),
    consentUpdatedAt: String(input?.consentUpdatedAt || DEFAULT_CONSENT_SNAPSHOT.consentUpdatedAt),
    notes: input?.notes == null ? null : String(input.notes),
  };
}

export async function getLocalPrivacyConsentSnapshot(): Promise<PrivacyConsentSnapshot> {
  const now = Date.now();
  if (cache && now - cacheAtMs <= CACHE_TTL_MS) return cache;

  try {
    const raw = await AsyncStorage.getItem(PRIVACY_CONSENT_MIRROR_KEY);
    if (!raw) {
      cache = { ...DEFAULT_CONSENT_SNAPSHOT };
      cacheAtMs = now;
      return cache;
    }
    const parsed = JSON.parse(raw);
    cache = normalizeConsent(parsed);
    cacheAtMs = now;
    return cache;
  } catch {
    cache = { ...DEFAULT_CONSENT_SNAPSHOT };
    cacheAtMs = now;
    return cache;
  }
}

export async function setLocalPrivacyConsentSnapshot(snapshot: PrivacyConsentSnapshot): Promise<void> {
  const normalized = normalizeConsent(snapshot);
  cache = normalized;
  cacheAtMs = Date.now();
  await AsyncStorage.setItem(PRIVACY_CONSENT_MIRROR_KEY, JSON.stringify(normalized));
}

export async function clearLocalPrivacyConsentSnapshot(): Promise<void> {
  cache = { ...DEFAULT_CONSENT_SNAPSHOT };
  cacheAtMs = Date.now();
  await AsyncStorage.removeItem(PRIVACY_CONSENT_MIRROR_KEY);
}

export function getDefaultPrivacyConsentSnapshot(): PrivacyConsentSnapshot {
  return { ...DEFAULT_CONSENT_SNAPSHOT };
}

