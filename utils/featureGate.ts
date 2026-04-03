import { hasAdvancedAnalyticsAccess } from './effortCurrencyService';
import { fetchBillingEntitlement } from './billingService';
import { getSubscriptionStatus, isStorePurchasingEnabled } from './monetizationService';

export type PremiumFeature =
  | 'trainingLoad'
  | 'routes'
  | 'offlineRoutes'
  | 'segments'
  | 'nutritionInsights'
  | 'readiness'
  | 'aiInsights'
  | 'dataExport';

export type FeatureLimit = {
  // trainingLoad: free preview window (days of history visible)
  trainingLoadHistoryDays?: number;
  // nutritionInsights: whether meal breakdown + timestamps are enabled
  nutritionMealBreakdown?: boolean;
  nutritionWeeklyDigest?: boolean;
};

export async function isProEntitled(): Promise<boolean> {
  const [ent, sub, currency] = await Promise.all([
    fetchBillingEntitlement(),
    getSubscriptionStatus(),
    hasAdvancedAnalyticsAccess(),
  ]);
  if (ent && ent.isPro) return true;
  if (!isStorePurchasingEnabled()) return true;
  return (sub.isActive && sub.tier === 'pro') || currency;
}

export async function isFeatureEnabled(feature: PremiumFeature): Promise<boolean> {
  const isPro = await isProEntitled();

  // Free previews:
  // - routes: view allowed free; creation/offline gated separately.
  // - segments: viewing PR history allowed free; matched activities / discovery is Pro (handled in UI).
  // - training load: 7-day history free; full history Pro (handled via getFeatureLimits).
  if (!isPro) {
    if (feature === 'routes') return true;
    if (feature === 'segments') return true;
    if (feature === 'trainingLoad') return true;
    if (feature === 'readiness') return true; // basic sleep-only readiness preview
    if (feature === 'nutritionInsights') return true; // daily totals preview
  }

  if (isPro) return true;

  // Pro-only
  return feature === 'routes' || feature === 'segments' || feature === 'trainingLoad' || feature === 'readiness' || feature === 'nutritionInsights';
}

export async function getFeatureLimits(): Promise<FeatureLimit> {
  const isPro = await isProEntitled();
  return {
    trainingLoadHistoryDays: isPro ? 180 : 7,
    nutritionMealBreakdown: isPro,
    nutritionWeeklyDigest: isPro,
  };
}
