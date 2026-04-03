// Monetization Service
// Exercise packs with in-app purchases
// Free tier + 3 premium packs: Lifting, Running (Pro), Calisthenics

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as StoreReview from 'expo-store-review';
import { fetchBillingEntitlement, restoreBillingPurchases, verifyBillingPurchase } from './billingService';
import { hasAdvancedAnalyticsAccess } from './effortCurrencyService';
import { APP_CONFIG } from './appConfig';
import { captureException } from './crashReporter';
import { purchasePackNative, restorePurchasesNative, type NativeBillingArtifact } from './nativeBillingService';

function reportMonetizationError(op: string, error: unknown) {
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log(`[monetization] ${op} error:`, error);
    return;
  }
  void captureException(error, { feature: 'monetization', op });
}

export interface ExercisePack {
  id: string;
  name: string;
  icon: string;
  price: number;
  priceMonthly?: number;
  priceYearly?: number;
  description: string;
  features: string[];
  exercises?: Exercise[];
  isPurchased: boolean;
  isFree: boolean;
  isSubscription?: boolean;
}

export interface SubscriptionStatus {
  isActive: boolean;
  tier: 'free' | 'pro';
  expiresAt: string | null;
  isTrialing: boolean;
  trialEndsAt: string | null;
}

export type PurchaseFlowState = 'success' | 'pending' | 'cancelled' | 'duplicate' | 'failed';

export interface PurchasePackResult {
  state: PurchaseFlowState;
  packId: string;
  productId: string | null;
  purchasedPackIds: string[];
  verificationAttempted: boolean;
  code: string;
  message: string;
}

export interface RestorePurchasesResult {
  state: PurchaseFlowState;
  purchasedPackIds: string[];
  restoredProductIds: string[];
  verificationAttempted: boolean;
  code: string;
  message: string;
}

let purchaseVerificationInFlight = false;
let restoreVerificationInFlight = false;

export interface Exercise {
  id: string;
  name: string;
  category: string;
  muscleGroup: string[];
  equipment: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  instructions: string[];
  tips: string[];
  videoUrl?: string;
  imageUrl?: string;
}

export interface WorkoutTemplate {
  id: string;
  name: string;
  packId: string;
  description: string;
  duration: number; // minutes
  exercises: {
    exerciseId: string;
    sets: number;
    reps: string; // e.g. "8-12" or "AMRAP"
    rest: number; // seconds
    notes?: string;
  }[];
  difficulty: 'beginner' | 'intermediate' | 'advanced';
}

export function isStorePurchasingEnabled() {
  return (
    APP_CONFIG.FEATURES.MONETIZATION_ENABLED &&
    (APP_CONFIG.FEATURES.SUBSCRIPTION_ENABLED || APP_CONFIG.FEATURES.ONE_TIME_PACKS_ENABLED)
  );
}

/**
 * Exercise Pack Catalog
 */
export const EXERCISE_PACKS: Omit<ExercisePack, 'isPurchased'>[] = [
  {
    id: 'free',
    name: 'Free Tier',
    icon: '⚡',
    price: 0,
    description: 'Essential fitness tracking',
    isFree: true,
    features: [
      'Basic workout logging (6 types)',
      'Food & calorie tracking',
      'Weight tracking (basic)',
      'Achievements (26 badges)',
      'Rank progression (27 ranks)',
      'Basic stats & progress',
      'GPS running (distance, pace, time)'
    ]
  },
  {
    id: 'zenith_pro',
    name: 'Zenith Pro',
    icon: '👑',
    price: 49.99,
    priceMonthly: 6.99,
    priceYearly: 49.99,
    description: 'Ultimate fitness experience',
    isFree: false,
    isSubscription: true,
    features: [
      '🎁 All 3 Exercise Packs Included',
      '❤️ Heart Rate Zone Analytics',
      '📊 Recovery Score & HRV Tracking',
      '💪 Advanced Workout Analytics',
      '📈 Progressive Overload Tracking',
      '🏆 Personal Record (PR) System',
      '🔨 Custom Workout Builder',
      '⚡ Training Load & Volume Analytics',
      '🧠 AI Coaching Insights',
      '🔔 Smart Notifications (Recovery, Suggestions)',
      '☁️ Cloud Sync (Coming Soon)',
      '📤 Export Data (CSV/PDF)',
      '🎯 Priority Support',
      '🚫 Ad-Free Experience',
      '⭐ Early Access to New Features'
    ]
  },
  {
    id: 'lifting_pack',
    name: 'Lifting Pack',
    icon: '💪',
    price: 4.99,
    description: 'Strength training essentials',
    isFree: false,
    features: [
      '150+ exercises with instructions',
      '20+ pre-built workout templates',
      'Exercise library with form tips',
      'Rest timer & plate calculator',
      'Muscle group targeting'
    ]
  },
  {
    id: 'running_pack',
    name: 'Running Pack',
    icon: '🏃',
    price: 4.99,
    description: 'Advanced running features',
    isFree: false,
    features: [
      'Training plans (5K, 10K, Half, Full)',
      'Race predictor calculator',
      'Interval & tempo run builder',
      'Running form tips',
      'Personal bests tracker'
    ]
  },
  {
    id: 'calisthenics_pack',
    name: 'Calisthenics Pack',
    icon: '🤸',
    price: 4.99,
    description: 'Bodyweight mastery',
    isFree: false,
    features: [
      '80+ calisthenics exercises',
      'Skill progression tracking',
      'Form checks & technique tips',
      'Strength standards calculator',
      'Progression guides'
    ]
  }
];

/**
 * Sample exercises for Lifting Pack
 */
export const LIFTING_EXERCISES: Exercise[] = [
  // CHEST
  {
    id: 'bench_press',
    name: 'Barbell Bench Press',
    category: 'Strength',
    muscleGroup: ['Chest', 'Triceps', 'Shoulders'],
    equipment: 'Barbell',
    difficulty: 'intermediate',
    instructions: [
      'Lie flat on bench with feet firmly planted',
      'Grip bar slightly wider than shoulder width',
      'Unrack and lower bar to mid-chest with control',
      'Press back up to starting position',
      'Keep shoulder blades retracted throughout'
    ],
    tips: [
      'Touch chest, don\'t bounce',
      'Maintain natural arch in lower back',
      'Breathe in on descent, out on press'
    ]
  },
  {
    id: 'dumbbell_press',
    name: 'Dumbbell Bench Press',
    category: 'Strength',
    muscleGroup: ['Chest', 'Triceps', 'Shoulders'],
    equipment: 'Dumbbells',
    difficulty: 'beginner',
    instructions: [
      'Lie on bench holding dumbbells at chest level',
      'Press dumbbells up until arms are extended',
      'Lower with control back to starting position',
      'Palms can face forward or towards each other'
    ],
    tips: [
      'Greater range of motion than barbell',
      'Focus on squeezing chest at top',
      'Don\'t let dumbbells drift apart'
    ]
  },
  
  // BACK
  {
    id: 'deadlift',
    name: 'Conventional Deadlift',
    category: 'Strength',
    muscleGroup: ['Back', 'Glutes', 'Hamstrings', 'Core'],
    equipment: 'Barbell',
    difficulty: 'advanced',
    instructions: [
      'Stand with feet hip-width, bar over mid-foot',
      'Bend down and grip bar just outside legs',
      'Chest up, back flat, engage lats',
      'Drive through heels, extend hips and knees',
      'Stand tall, then reverse the movement'
    ],
    tips: [
      'Keep bar close to body entire lift',
      'Neutral spine - don\'t round back',
      'Hip hinge, not squat movement'
    ]
  },
  {
    id: 'pullup',
    name: 'Pull-Up',
    category: 'Strength',
    muscleGroup: ['Back', 'Biceps'],
    equipment: 'Pull-up Bar',
    difficulty: 'intermediate',
    instructions: [
      'Hang from bar with hands shoulder-width apart',
      'Pull yourself up until chin is over bar',
      'Lower yourself with control to full hang',
      'Avoid kipping or swinging'
    ],
    tips: [
      'Engage lats before pulling',
      'Full range of motion crucial',
      'Use assisted variations if needed'
    ]
  },

  // LEGS
  {
    id: 'squat',
    name: 'Barbell Back Squat',
    category: 'Strength',
    muscleGroup: ['Quads', 'Glutes', 'Core'],
    equipment: 'Barbell',
    difficulty: 'intermediate',
    instructions: [
      'Bar rests on upper back/traps',
      'Feet shoulder-width, toes slightly out',
      'Descend by breaking at hips and knees',
      'Go to parallel or below',
      'Drive through heels to stand'
    ],
    tips: [
      'Knees track over toes',
      'Keep chest up throughout',
      'Core tight, neutral spine'
    ]
  },
  {
    id: 'romanian_deadlift',
    name: 'Romanian Deadlift',
    category: 'Strength',
    muscleGroup: ['Hamstrings', 'Glutes', 'Lower Back'],
    equipment: 'Barbell',
    difficulty: 'intermediate',
    instructions: [
      'Stand holding bar at hip level',
      'Slight knee bend maintained throughout',
      'Hinge at hips, pushing them back',
      'Lower bar along legs until hamstring stretch',
      'Reverse movement by thrusting hips forward'
    ],
    tips: [
      'This is NOT a squat or regular deadlift',
      'Feel stretch in hamstrings',
      'Keep bar close to legs'
    ]
  },

  // SHOULDERS
  {
    id: 'overhead_press',
    name: 'Standing Overhead Press',
    category: 'Strength',
    muscleGroup: ['Shoulders', 'Triceps', 'Core'],
    equipment: 'Barbell',
    difficulty: 'intermediate',
    instructions: [
      'Stand with bar at shoulder height',
      'Grip just outside shoulders',
      'Press bar overhead to lockout',
      'Lower with control back to shoulders',
      'Keep core tight, avoid excessive back arch'
    ],
    tips: [
      'Bar path should be straight up',
      'Tuck chin as bar passes face',
      'Full lockout at top'
    ]
  },

  // ARMS
  {
    id: 'barbell_curl',
    name: 'Barbell Curl',
    category: 'Isolation',
    muscleGroup: ['Biceps'],
    equipment: 'Barbell',
    difficulty: 'beginner',
    instructions: [
      'Stand holding bar with underhand grip',
      'Curl bar up by flexing elbows',
      'Keep elbows stationary at sides',
      'Squeeze biceps at top',
      'Lower with control'
    ],
    tips: [
      'No swinging or momentum',
      'Full range of motion',
      'Controlled tempo both directions'
    ]
  }
];

/**
 * Sample workout templates
 */
export const WORKOUT_TEMPLATES: WorkoutTemplate[] = [
  {
    id: 'push_day',
    name: 'Push Day (Chest, Shoulders, Triceps)',
    packId: 'lifting_pack',
    description: 'Classic push workout for upper body',
    duration: 60,
    difficulty: 'intermediate',
    exercises: [
      { exerciseId: 'bench_press', sets: 4, reps: '6-8', rest: 180 },
      { exerciseId: 'overhead_press', sets: 3, reps: '8-10', rest: 120 },
      { exerciseId: 'dumbbell_press', sets: 3, reps: '10-12', rest: 90 },
    ]
  },
  {
    id: 'pull_day',
    name: 'Pull Day (Back, Biceps)',
    packId: 'lifting_pack',
    description: 'Complete back and bicep training',
    duration: 60,
    difficulty: 'intermediate',
    exercises: [
      { exerciseId: 'deadlift', sets: 4, reps: '5-6', rest: 240 },
      { exerciseId: 'pullup', sets: 4, reps: '8-10', rest: 120 },
      { exerciseId: 'barbell_curl', sets: 3, reps: '10-12', rest: 60 },
    ]
  },
  {
    id: 'leg_day',
    name: 'Leg Day',
    packId: 'lifting_pack',
    description: 'Lower body strength and hypertrophy',
    duration: 70,
    difficulty: 'advanced',
    exercises: [
      { exerciseId: 'squat', sets: 5, reps: '5-8', rest: 180 },
      { exerciseId: 'romanian_deadlift', sets: 4, reps: '8-10', rest: 120 },
    ]
  }
];

/**
 * Get current subscription status
 */
export async function getSubscriptionStatus(): Promise<SubscriptionStatus> {
  try {
    const ent = await fetchBillingEntitlement();
    const expiry = ent?.currentPeriodEnd || null;
    const active = Boolean(ent?.isPro) && (!!expiry ? new Date(expiry) > new Date() : true);
    return {
      isActive: active,
      tier: active ? 'pro' : 'free',
      expiresAt: expiry,
      isTrialing: false,
      trialEndsAt: null,
    };
  } catch (error) {
    reportMonetizationError('get_subscription_status', error);
    return {
      isActive: false,
      tier: 'free',
      expiresAt: null,
      isTrialing: false,
      trialEndsAt: null
    };
  }
}

/**
 * Start subscription (with optional trial)
 */
export async function startSubscription(
  billingPeriod: 'monthly' | 'yearly',
  startTrial: boolean = false
): Promise<boolean> {
  try {
    void billingPeriod;
    void startTrial;
    if (!APP_CONFIG.FEATURES.SUBSCRIPTION_ENABLED) return false;
    // Subscriptions must be confirmed from the production entitlement backend.
    const ent = await fetchBillingEntitlement();
    return Boolean(ent?.isPro);
  } catch (error) {
    reportMonetizationError('start_subscription', error);
    return false;
  }
}

/**
 * Cancel subscription (mark for non-renewal)
 */
export async function cancelSubscription(): Promise<boolean> {
  try {
    if (!APP_CONFIG.FEATURES.SUBSCRIPTION_ENABLED) return false;
    // Cancellation is managed by App Store / Play Store. We only refresh backend truth.
    await fetchBillingEntitlement();
    return false;
  } catch (error) {
    reportMonetizationError('cancel_subscription', error);
    return false;
  }
}

/**
 * Check if user has access to premium features
 * Returns true if subscribed OR owns specific pack
 */
export async function hasFeatureAccess(feature: 'hr_analytics' | 'recovery' | 'pr_tracking' | 'custom_workouts' | 'advanced_notifications'): Promise<boolean> {
  try {
    const subStatus = await getSubscriptionStatus();
    const hasCurrencyAnalytics = await hasAdvancedAnalyticsAccess();
    
    // Zenith Pro subscribers have access to everything
    if (subStatus.isActive && subStatus.tier === 'pro') {
      return true;
    }
    
    // Check individual pack ownership for specific features
    switch (feature) {
      case 'hr_analytics':
      case 'recovery':
      case 'advanced_notifications':
        // These are Pro-only
        return hasCurrencyAnalytics;
      
      case 'pr_tracking':
      case 'custom_workouts':
        // Can access with Lifting Pack OR Pro
        return await hasPurchasedPack('lifting_pack');
      
      default:
        return false;
    }
  } catch (error) {
    reportMonetizationError('has_feature_access', error);
    return false;
  }
}

/**
 * Get days remaining in trial
 */
export async function getTrialDaysRemaining(): Promise<number> {
  try {
    const status = await getSubscriptionStatus();
    if (!status.isTrialing || !status.trialEndsAt) return 0;
    
    const now = new Date();
    const trialEnd = new Date(status.trialEndsAt);
    const diff = trialEnd.getTime() - now.getTime();
    const days = Math.ceil(diff / (24 * 60 * 60 * 1000));
    
    return Math.max(0, days);
  } catch (error) {
    return 0;
  }
}

function mapEntitlementToPackIds(ent: Awaited<ReturnType<typeof fetchBillingEntitlement>>): string[] {
  const out = new Set<string>(['free']);
  if (!ent) return Array.from(out);

  const productId = String(ent.productId || '').toLowerCase();
  if (ent.isPro || productId.includes('zenith_pro') || productId.includes('pro')) {
    out.add('zenith_pro');
    out.add('lifting_pack');
    out.add('running_pack');
    out.add('calisthenics_pack');
    return Array.from(out);
  }

  if (productId.includes('lifting')) out.add('lifting_pack');
  if (productId.includes('running')) out.add('running_pack');
  if (productId.includes('calisthenics')) out.add('calisthenics_pack');
  return Array.from(out);
}

/**
 * Check if user has purchased a pack
 */
export async function hasPurchasedPack(packId: string): Promise<boolean> {
  try {
    if (packId === 'free') return true;
    const purchased = await getPurchasedPacks();
    return purchased.includes(packId);
  } catch (error) {
    reportMonetizationError('has_purchased_pack', error);
    return false;
  }
}

/**
 * Get all purchased packs
 */
export async function getPurchasedPacks(): Promise<string[]> {
  try {
    const ent = await fetchBillingEntitlement();
    return mapEntitlementToPackIds(ent);
  } catch (error) {
    reportMonetizationError('get_purchased_packs', error);
    return ['free'];
  }
}

/**
 * Map native store product hints to pack IDs while backend verification catches up.
 */
function mapProductHintsToPackIds(productIds: string[]): string[] {
  const out = new Set<string>(['free']);
  productIds.forEach((productId) => {
    const normalized = String(productId || '').toLowerCase();
    if (!normalized) return;
    if (normalized.includes('zenith_pro') || normalized.includes('pro')) {
      out.add('zenith_pro');
      out.add('lifting_pack');
      out.add('running_pack');
      out.add('calisthenics_pack');
      return;
    }
    if (normalized.includes('lifting')) out.add('lifting_pack');
    if (normalized.includes('running')) out.add('running_pack');
    if (normalized.includes('calisthenics')) out.add('calisthenics_pack');
  });
  return Array.from(out);
}

function summarizeSensitive(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return `len:${trimmed.length}`;
}

function logBillingDebug(event: string, payload: Record<string, unknown>) {
  if (!__DEV__) return;
  const safePayload = { ...payload };
  if (typeof safePayload.transactionReceipt === 'string') {
    safePayload.transactionReceipt = summarizeSensitive(safePayload.transactionReceipt);
  }
  if (typeof safePayload.purchaseToken === 'string') {
    safePayload.purchaseToken = summarizeSensitive(safePayload.purchaseToken);
  }
  // eslint-disable-next-line no-console
  console.log(`[billing] ${event}`, safePayload);
}

function classifyVerificationFailure(error: unknown): {
  state: Extract<PurchaseFlowState, 'pending' | 'duplicate' | 'failed'>;
  code: string;
  message: string;
} {
  const raw = String((error as { message?: string } | null)?.message || error || 'billing_verification_failed');
  const lower = raw.toLowerCase();
  if (lower.includes('duplicate') || lower.includes('already')) {
    return {
      state: 'duplicate',
      code: 'duplicate_verification_request',
      message: 'Purchase verification is already being processed. Pull to refresh in a moment.',
    };
  }
  if (
    lower.includes('missing_ios_transaction_receipt') ||
    lower.includes('missing_android_purchase_token') ||
    lower.includes('apple_latest_receipt_missing') ||
    lower.includes('google_subscriptionsv2_failed_404') ||
    lower.includes('google_subscriptionsv2_failed_410')
  ) {
    return {
      state: 'pending',
      code: 'verification_artifact_incomplete',
      message: 'Checkout completed, but backend verification is still pending store artifacts.',
    };
  }
  return {
    state: 'failed',
    code: 'verification_failed',
    message: raw,
  };
}

function buildVerifyPayloadFromArtifact(artifact: NativeBillingArtifact): Parameters<typeof verifyBillingPurchase>[0] | null {
  if (artifact.platform === 'ios') {
    return {
      platform: 'ios',
      productId: artifact.productId,
      ios: {
        transactionId: artifact.transactionId,
        originalTransactionId: artifact.originalTransactionId,
        appAccountToken: artifact.appAccountToken,
        transactionReceipt: artifact.transactionReceipt,
        environment: artifact.environment,
      },
    };
  }

  if (!artifact.purchaseToken || !artifact.packageName) return null;
  return {
    platform: 'android',
    productId: artifact.productId,
    android: {
      packageName: artifact.packageName,
      purchaseToken: artifact.purchaseToken,
    },
  };
}

/**
 * Build restore payload from captured native artifacts.
 */
function buildRestorePayloadFromArtifacts(
  artifacts: NativeBillingArtifact[]
): Parameters<typeof restoreBillingPurchases>[0] | null {
  if (!artifacts.length) return null;
  const platform = artifacts[0].platform;
  if (platform === 'ios') {
    const purchases = artifacts
      .map((artifact) => ({
        productId: artifact.productId,
        transactionReceipt: artifact.transactionReceipt,
        transactionId: artifact.transactionId,
        originalTransactionId: artifact.originalTransactionId,
        appAccountToken: artifact.appAccountToken,
        environment: artifact.environment,
      }))
      .filter((row) => Boolean(row.productId && (row.transactionReceipt || row.transactionId || row.originalTransactionId)));
    if (!purchases.length) return null;
    return {
      platform: 'ios',
      purchases,
      productId: purchases[0]?.productId,
    };
  }

  const purchases = artifacts
    .map((artifact) => ({
      productId: artifact.productId,
      purchaseToken: artifact.purchaseToken,
      packageName: artifact.packageName,
    }))
    .filter((row) => Boolean(row.productId && row.purchaseToken && row.packageName));
  if (!purchases.length) return null;
  return {
    platform: 'android',
    purchases,
    productId: purchases[0]?.productId,
    packageName: purchases[0]?.packageName || undefined,
  };
}

/**
 * Purchase pack using native checkout + backend verification.
 * Backend entitlement remains canonical.
 */
export async function purchasePack(packId: string): Promise<PurchasePackResult> {
  let verificationAttempted = false;
  try {
    if (!isStorePurchasingEnabled()) {
      return {
        state: 'failed',
        packId,
        productId: null,
        purchasedPackIds: ['free'],
        verificationAttempted,
        code: 'store_disabled',
        message: 'Store purchasing is disabled for this build.',
      };
    }

    const purchased = await getPurchasedPacks();
    if (purchased.includes(packId)) {
      return {
        state: 'success',
        packId,
        productId: null,
        purchasedPackIds: purchased,
        verificationAttempted,
        code: 'already_owned',
        message: 'Pack already unlocked.',
      };
    }

    if (purchaseVerificationInFlight) {
      return {
        state: 'duplicate',
        packId,
        productId: null,
        purchasedPackIds: purchased,
        verificationAttempted,
        code: 'purchase_in_flight',
        message: 'A purchase is already in progress.',
      };
    }
    purchaseVerificationInFlight = true;

    const native = await purchasePackNative(packId);
    if (native.state === 'cancelled') {
      return {
        state: 'cancelled',
        packId,
        productId: native.productId,
        purchasedPackIds: purchased,
        verificationAttempted,
        code: native.code,
        message: native.message,
      };
    }

    if (native.state === 'failed') {
      return {
        state: 'failed',
        packId,
        productId: native.productId,
        purchasedPackIds: purchased,
        verificationAttempted,
        code: native.code,
        message: native.message,
      };
    }

    if (!native.artifact) {
      return {
        state: 'pending',
        packId,
        productId: native.productId,
        purchasedPackIds: purchased,
        verificationAttempted,
        code: 'missing_native_artifact',
        message: 'Checkout finished, but no transaction artifact was returned yet.',
      };
    }

    logBillingDebug('purchase_artifact_captured', {
      platform: native.artifact.platform,
      productId: native.artifact.productId,
      transactionId: native.artifact.transactionId,
      originalTransactionId: native.artifact.originalTransactionId,
      transactionReceipt: native.artifact.transactionReceipt,
      purchaseToken: native.artifact.purchaseToken,
    });

    const verifyPayload = buildVerifyPayloadFromArtifact(native.artifact);
    if (!verifyPayload) {
      return {
        state: 'pending',
        packId,
        productId: native.artifact.productId,
        purchasedPackIds: purchased,
        verificationAttempted,
        code: 'missing_verification_artifact',
        message: 'Checkout completed, but required verification artifacts are unavailable on this device/session.',
      };
    }

    verificationAttempted = true;
    try {
      const verified = await verifyBillingPurchase(verifyPayload);
      const refreshed = await fetchBillingEntitlement();
      const purchasedAfterVerify = mapEntitlementToPackIds(refreshed || verified);
      if (purchasedAfterVerify.includes(packId)) {
        return {
          state: 'success',
          packId,
          productId: verified.productId || native.artifact.productId,
          purchasedPackIds: purchasedAfterVerify,
          verificationAttempted,
          code: 'verified',
          message: 'Purchase verified and entitlement activated.',
        };
      }
      return {
        state: 'pending',
        packId,
        productId: verified.productId || native.artifact.productId,
        purchasedPackIds: purchasedAfterVerify,
        verificationAttempted,
        code: 'verification_pending',
        message: 'Purchase received, but entitlement has not activated yet.',
      };
    } catch (verifyErr) {
      const purchasedAfterFailure = await getPurchasedPacks();
      if (purchasedAfterFailure.includes(packId)) {
        return {
          state: 'success',
          packId,
          productId: native.artifact.productId,
          purchasedPackIds: purchasedAfterFailure,
          verificationAttempted,
          code: 'verified_via_refresh',
          message: 'Entitlement is active after refresh.',
        };
      }
      const classified = classifyVerificationFailure(verifyErr);
      return {
        state: classified.state,
        packId,
        productId: native.artifact.productId,
        purchasedPackIds: purchasedAfterFailure,
        verificationAttempted,
        code: classified.code,
        message: classified.message,
      };
    }
  } catch (error) {
    reportMonetizationError('purchase_pack', error);
    return {
      state: 'failed',
      packId,
      productId: null,
      purchasedPackIds: ['free'],
      verificationAttempted,
      code: 'purchase_exception',
      message: 'Purchase flow failed unexpectedly.',
    };
  } finally {
    purchaseVerificationInFlight = false;
  }
}

/**
 * Restore purchases (from App Store / Play Store) and verify against backend entitlement.
 */
export async function restorePurchases(): Promise<RestorePurchasesResult> {
  let verificationAttempted = false;
  try {
    if (!isStorePurchasingEnabled()) {
      return {
        state: 'success',
        purchasedPackIds: ['free'],
        restoredProductIds: [],
        verificationAttempted,
        code: 'store_disabled',
        message: 'Store purchasing is disabled for this build.',
      };
    }

    if (restoreVerificationInFlight) {
      return {
        state: 'duplicate',
        purchasedPackIds: await getPurchasedPacks(),
        restoredProductIds: [],
        verificationAttempted,
        code: 'restore_in_flight',
        message: 'A restore is already in progress.',
      };
    }
    restoreVerificationInFlight = true;

    const nativeRestore = await restorePurchasesNative();
    if (nativeRestore.state === 'failed') {
      return {
        state: 'failed',
        purchasedPackIds: await getPurchasedPacks(),
        restoredProductIds: [],
        verificationAttempted,
        code: nativeRestore.code,
        message: nativeRestore.message,
      };
    }

    nativeRestore.artifacts.forEach((artifact) => {
      logBillingDebug('restore_artifact_captured', {
        platform: artifact.platform,
        productId: artifact.productId,
        transactionId: artifact.transactionId,
        originalTransactionId: artifact.originalTransactionId,
        transactionReceipt: artifact.transactionReceipt,
        purchaseToken: artifact.purchaseToken,
      });
    });

    const restorePayload = buildRestorePayloadFromArtifacts(nativeRestore.artifacts);
    if (restorePayload) {
      verificationAttempted = true;
      try {
        await restoreBillingPurchases(restorePayload);
      } catch (restoreErr) {
        const purchasedAfterFailure = await getPurchasedPacks();
        const classified = classifyVerificationFailure(restoreErr);
        return {
          state: classified.state,
          purchasedPackIds: purchasedAfterFailure,
          restoredProductIds: nativeRestore.purchasedProductIds,
          verificationAttempted,
          code: classified.code,
          message: classified.message,
        };
      }
    } else if (nativeRestore.purchasedProductIds.length > 0) {
      return {
        state: 'pending',
        purchasedPackIds: await getPurchasedPacks(),
        restoredProductIds: nativeRestore.purchasedProductIds,
        verificationAttempted,
        code: 'missing_restore_artifacts',
        message: 'Restore completed in-store, but verification artifacts are still unavailable.',
      };
    }

    const ent = await fetchBillingEntitlement();
    const purchased = mapEntitlementToPackIds(ent);
    const hintedPacks = mapProductHintsToPackIds(nativeRestore.purchasedProductIds);
    const hintedPremium = hintedPacks.some((packId) => packId !== 'free');
    if (hintedPremium && purchased.length <= 1) {
      return {
        state: 'pending',
        purchasedPackIds: purchased,
        restoredProductIds: nativeRestore.purchasedProductIds,
        verificationAttempted,
        code: 'restore_pending_verification',
        message: 'Restore artifacts were sent, but backend entitlement is still pending.',
      };
    }

    if (purchased.length > 1) {
      const canReview = await StoreReview.hasAction();
      if (canReview) {
        await StoreReview.requestReview();
      }
    }
    return {
      state: 'success',
      purchasedPackIds: purchased,
      restoredProductIds: nativeRestore.purchasedProductIds,
      verificationAttempted,
      code: 'restore_verified',
      message: 'Purchases restored.',
    };
  } catch (error) {
    reportMonetizationError('restore_purchases', error);
    return {
      state: 'failed',
      purchasedPackIds: ['free'],
      restoredProductIds: [],
      verificationAttempted,
      code: 'restore_exception',
      message: 'Restore failed unexpectedly.',
    };
  } finally {
    restoreVerificationInFlight = false;
  }
}

/**
 * Get pack details with purchase status
 */
export async function getPacksWithStatus(): Promise<ExercisePack[]> {
  const purchased = await getPurchasedPacks();
  
  return EXERCISE_PACKS.map(pack => ({
    ...pack,
    isPurchased: purchased.includes(pack.id)
  }));
}

/**
 * Get exercises for a pack
 */
export function getExercisesForPack(packId: string): Exercise[] {
  switch (packId) {
    case 'lifting_pack':
      return LIFTING_EXERCISES;
    case 'running_pack':
      return []; // Running doesn't need exercise library
    case 'calisthenics_pack':
      return []; // Calisthenics exercise library ships in a later content pass.
    default:
      return [];
  }
}

/**
 * Get templates for a pack
 */
export function getTemplatesForPack(packId: string): WorkoutTemplate[] {
  return WORKOUT_TEMPLATES.filter(t => t.packId === packId);
}

/**
 * Track PR (Personal Record)
 */
export interface PersonalRecord {
  exerciseId: string;
  weight: number;
  reps: number;
  date: string;
  oneRepMax: number; // Calculated 1RM
}

/**
 * Calculate 1RM using Epley formula
 */
export function calculate1RM(weight: number, reps: number): number {
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30));
}

/**
 * Save PR
 */
export async function savePR(
  exerciseId: string,
  weight: number,
  reps: number
): Promise<void> {
  try {
    const pr: PersonalRecord = {
      exerciseId,
      weight,
      reps,
      date: new Date().toISOString(),
      oneRepMax: calculate1RM(weight, reps)
    };
    
    const prs = await AsyncStorage.getItem('personalRecords');
    const records: PersonalRecord[] = prs ? JSON.parse(prs) : [];
    
    // Check if this is a new PR
    const existingPR = records.find(r => r.exerciseId === exerciseId);
    if (!existingPR || pr.oneRepMax > existingPR.oneRepMax) {
      // Remove old PR for this exercise
      const filtered = records.filter(r => r.exerciseId !== exerciseId);
      filtered.push(pr);
      await AsyncStorage.setItem('personalRecords', JSON.stringify(filtered));
    }
  } catch (error) {
    reportMonetizationError('save_pr', error);
  }
}

/**
 * Get PRs for user
 */
export async function getPersonalRecords(): Promise<PersonalRecord[]> {
  try {
    const prs = await AsyncStorage.getItem('personalRecords');
    return prs ? JSON.parse(prs) : [];
  } catch (error) {
    reportMonetizationError('get_prs', error);
    return [];
  }
}

/**
 * Get specific exercise PR
 */
export async function getExercisePR(exerciseId: string): Promise<PersonalRecord | null> {
  try {
    const prs = await getPersonalRecords();
    return prs.find(pr => pr.exerciseId === exerciseId) || null;
  } catch (error) {
    reportMonetizationError('get_exercise_pr', error);
    return null;
  }
}
