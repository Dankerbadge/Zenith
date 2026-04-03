import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from './supabaseClient';

const ENTITLEMENT_CACHE_KEY = 'billing:entitlement:v1';

export type BillingEntitlement = {
  isPro: boolean;
  status: string;
  plan?: string | null;
  platform?: string | null;
  productId?: string | null;
  currentPeriodEnd?: string | null;
  lastVerifiedAt?: string | null;
};

function normalizeEntitlement(row: any): BillingEntitlement {
  return {
    isPro: Boolean(row?.is_pro ?? row?.isPro),
    status: String(row?.status || 'inactive'),
    plan: row?.plan ?? null,
    platform: row?.platform ?? null,
    productId: row?.product_id ?? row?.productId ?? null,
    currentPeriodEnd: row?.current_period_end ?? row?.currentPeriodEnd ?? null,
    lastVerifiedAt: row?.last_verified_at ?? row?.lastVerifiedAt ?? null,
  };
}

export async function getCachedBillingEntitlement(): Promise<BillingEntitlement | null> {
  try {
    const raw = await AsyncStorage.getItem(ENTITLEMENT_CACHE_KEY);
    if (!raw) return null;
    return normalizeEntitlement(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function setCachedBillingEntitlement(ent: BillingEntitlement | null): Promise<void> {
  try {
    if (!ent) {
      await AsyncStorage.removeItem(ENTITLEMENT_CACHE_KEY);
      return;
    }
    await AsyncStorage.setItem(ENTITLEMENT_CACHE_KEY, JSON.stringify(ent));
  } catch {
    // ignore cache failures
  }
}

export async function fetchBillingEntitlement(): Promise<BillingEntitlement | null> {
  if (!isSupabaseConfigured) return getCachedBillingEntitlement();
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id) return getCachedBillingEntitlement();
    const { data, error } = await supabase.from('iap_entitlements').select('*').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    const ent = data ? normalizeEntitlement(data) : null;
    await setCachedBillingEntitlement(ent);
    return ent;
  } catch {
    return getCachedBillingEntitlement();
  }
}

export async function verifyBillingPurchase(input: {
  platform: 'ios' | 'android';
  productId: string;
  ios?: {
    transactionId?: string | null;
    originalTransactionId?: string | null;
    appAccountToken?: string | null;
    transactionReceipt?: string | null;
    environment?: 'Sandbox' | 'Production' | null;
  };
  android?: {
    packageName: string;
    purchaseToken: string;
  };
}): Promise<BillingEntitlement> {
  const { data, error } = await supabase.functions.invoke('billing-verify', { body: input });
  if (error) throw new Error(String(error.message || 'billing_verify_failed'));
  const ent = normalizeEntitlement(data || {});
  await setCachedBillingEntitlement(ent);
  return ent;
}

export async function restoreBillingPurchases(input: {
  platform: 'ios' | 'android';
  purchases: any[];
  productId?: string;
  packageName?: string;
}): Promise<BillingEntitlement> {
  const { data, error } = await supabase.functions.invoke('billing-restore', { body: input });
  if (error) throw new Error(String(error.message || 'billing_restore_failed'));
  const ent = normalizeEntitlement(data || {});
  await setCachedBillingEntitlement(ent);
  return ent;
}
