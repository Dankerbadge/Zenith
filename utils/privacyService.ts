import { getSupabaseProjectRef, isSupabaseConfigured, supabase } from './supabaseClient';
import {
  type PrivacyConsentSnapshot,
  getDefaultPrivacyConsentSnapshot,
  getLocalPrivacyConsentSnapshot,
  setLocalPrivacyConsentSnapshot,
} from './privacyConsentStore';

export type PublicShareRecord = {
  shareId: string;
  objectType: 'recipe' | 'meal_template' | 'collection';
  objectId: string;
  shareStatus: 'active' | 'revoked' | 'pending';
  createdAt: string;
  revokedAt: string | null;
  provenance: Record<string, unknown>;
};

export type PrivacyDataCategory = {
  category: string;
  description: string;
  retention_days: number;
  last_purged_at: string | null;
  notes: Record<string, unknown> | null;
  updated_at: string;
};

export type PrivacyDataExplanationResponse = {
  ok: boolean;
  consent: PrivacyConsentSnapshot;
  retentionPolicies: Array<{
    category: string;
    retentionDays: number;
    purgeAction: 'delete' | 'archive' | string;
    enabled: boolean;
  }>;
  dataCategories: PrivacyDataCategory[];
  activePublicShares: PublicShareRecord[];
};

type ConsentUpdateInput = Partial<Pick<PrivacyConsentSnapshot, 'notifications' | 'analytics' | 'publicSharing' | 'notes'>>;

function normalizeConsent(raw: any): PrivacyConsentSnapshot {
  return {
    notifications: Boolean(raw?.notifications),
    analytics: Boolean(raw?.analytics),
    publicSharing: Boolean(raw?.publicSharing),
    consentUpdatedAt: String(raw?.consentUpdatedAt || new Date(0).toISOString()),
    notes: raw?.notes == null ? null : String(raw.notes),
  };
}

async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? String(token) : null;
}

async function authedFunctionFetch(functionName: string, path: string, method: 'GET' | 'POST', body?: unknown) {
  if (!isSupabaseConfigured) throw new Error('supabase_not_configured');

  const token = await getAccessToken();
  if (!token) throw new Error('missing_auth_token');

  const ref = getSupabaseProjectRef();
  if (!ref) throw new Error('supabase_project_ref_missing');

  const url = `https://${ref}.supabase.co/functions/v1/${functionName}${path}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(method === 'POST' ? { body: JSON.stringify(body || {}) } : {}),
  });

  const text = await response.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!response.ok) {
    const message = typeof parsed?.error === 'string' ? parsed.error : `function_${functionName}_failed`;
    throw new Error(message);
  }

  return parsed;
}

export async function getPrivacyConsent(): Promise<PrivacyConsentSnapshot> {
  if (!isSupabaseConfigured) return getLocalPrivacyConsentSnapshot();

  try {
    const data = await authedFunctionFetch('privacy-consent', '', 'GET');
    const consent = normalizeConsent(data?.consent || getDefaultPrivacyConsentSnapshot());
    await setLocalPrivacyConsentSnapshot(consent);
    return consent;
  } catch {
    return getLocalPrivacyConsentSnapshot();
  }
}

export async function updatePrivacyConsent(input: ConsentUpdateInput): Promise<PrivacyConsentSnapshot> {
  if (!isSupabaseConfigured) {
    const current = await getLocalPrivacyConsentSnapshot();
    const updated: PrivacyConsentSnapshot = normalizeConsent({
      ...current,
      ...input,
      consentUpdatedAt: new Date().toISOString(),
    });
    await setLocalPrivacyConsentSnapshot(updated);
    return updated;
  }

  const { data, error } = await supabase.functions.invoke('privacy-consent', {
    body: {
      notifications: input.notifications,
      analytics: input.analytics,
      publicSharing: input.publicSharing,
      notes: input.notes,
    },
  });
  if (error) throw error;

  const consent = normalizeConsent((data as any)?.consent || getDefaultPrivacyConsentSnapshot());
  await setLocalPrivacyConsentSnapshot(consent);
  return consent;
}

export async function listPrivacyPublicShares(): Promise<PublicShareRecord[]> {
  if (!isSupabaseConfigured) return [];
  const data = await authedFunctionFetch('privacy-public-shares', '', 'GET');
  return Array.isArray(data?.shares) ? (data.shares as PublicShareRecord[]) : [];
}

export async function activatePrivacyPublicShare(shareId: string): Promise<PublicShareRecord> {
  if (!isSupabaseConfigured) throw new Error('supabase_not_configured');
  const { data, error } = await supabase.functions.invoke('privacy-public-shares', {
    body: { shareId, action: 'activate' },
  });
  if (error) throw error;
  return (data as any)?.share as PublicShareRecord;
}

export async function revokePrivacyPublicShare(shareId: string): Promise<PublicShareRecord> {
  if (!isSupabaseConfigured) throw new Error('supabase_not_configured');
  const { data, error } = await supabase.functions.invoke('privacy-public-shares', {
    body: { shareId, action: 'revoke' },
  });
  if (error) throw error;
  return (data as any)?.share as PublicShareRecord;
}

export async function getPrivacyDataExplanation(): Promise<PrivacyDataExplanationResponse> {
  if (!isSupabaseConfigured) {
    return {
      ok: true,
      consent: await getLocalPrivacyConsentSnapshot(),
      retentionPolicies: [],
      dataCategories: [],
      activePublicShares: [],
    };
  }

  return (await authedFunctionFetch('privacy-data-explanation', '', 'GET')) as PrivacyDataExplanationResponse;
}

export async function isNotificationConsentGranted(): Promise<boolean> {
  const snapshot = await getLocalPrivacyConsentSnapshot();
  return snapshot.notifications === true;
}

export async function isAnalyticsConsentGranted(): Promise<boolean> {
  const snapshot = await getLocalPrivacyConsentSnapshot();
  return snapshot.analytics === true;
}

export async function isPublicSharingConsentGranted(): Promise<boolean> {
  const snapshot = await getLocalPrivacyConsentSnapshot();
  return snapshot.publicSharing === true;
}

