import { getUserProfile, setStorageItem, USER_PROFILE_KEY } from './storageUtils';
import { normalizeBehaviorState, type BehavioralState } from './behavioralCore';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type CurrencyUnlockKey = 'advanced_analytics' | 'no_excuses_mode' | 'extra_loadout_slot';

export type CurrencyUnlockCatalogItem = {
  key: CurrencyUnlockKey;
  title: string;
  description: string;
  cost: number;
  repeatable: boolean;
};

export const CURRENCY_UNLOCK_CATALOG: CurrencyUnlockCatalogItem[] = [
  {
    key: 'advanced_analytics',
    title: 'Advanced Analytics Access',
    description: 'Unlock HR/recovery analytics without subscription for this account.',
    cost: 8,
    repeatable: false,
  },
  {
    key: 'no_excuses_mode',
    title: 'No Excuses Mode Access',
    description: 'Unlock strict no-excuses mode toggle in behavior controls.',
    cost: 5,
    repeatable: false,
  },
  {
    key: 'extra_loadout_slot',
    title: 'Extra Loadout Slot (+2)',
    description: 'Increase custom start/loadout capacity by 2 slots.',
    cost: 3,
    repeatable: true,
  },
];

const BASE_LOADOUT_SLOTS = 6;

function getCatalogItem(key: CurrencyUnlockKey) {
  return CURRENCY_UNLOCK_CATALOG.find((item) => item.key === key) || null;
}

async function loadState(): Promise<{ profile: any; state: BehavioralState }> {
  const profile = await getUserProfile();
  let state: BehavioralState;
  try {
    state = normalizeBehaviorState(profile);
  } catch {
    // Defensive: never let a corrupted/legacy profile blob make Pro features appear locked.
    state = normalizeBehaviorState({});
  }
  return { profile, state };
}

async function saveState(profile: any, state: BehavioralState): Promise<void> {
  await setStorageItem(USER_PROFILE_KEY, {
    ...profile,
    behaviorState: state,
  });
}

export function hasCurrencyUnlock(state: BehavioralState, key: CurrencyUnlockKey): boolean {
  if (key === 'advanced_analytics') return state.currencyUnlocks.advancedAnalytics;
  if (key === 'no_excuses_mode') return state.currencyUnlocks.noExcusesMode;
  return state.currencyUnlocks.extraLoadoutSlots > 0;
}

export function getLoadoutSlotLimit(state: BehavioralState): number {
  return BASE_LOADOUT_SLOTS + state.currencyUnlocks.extraLoadoutSlots * 2;
}

export async function getLoadoutSlotLimitAsync(): Promise<number> {
  const { state } = await loadState();
  return getLoadoutSlotLimit(state);
}

export async function hasAdvancedAnalyticsAccess(): Promise<boolean> {
  const { profile, state } = await loadState();
  const level = String((profile as any)?.level || '').trim().toLowerCase();
  const subscriptionTier = String(
    (profile as any)?.subscription?.tier ||
      (profile as any)?.subscription?.level ||
      (profile as any)?.subscription?.plan ||
      (profile as any)?.subscriptionStatus?.tier ||
      (profile as any)?.subscriptionStatus?.level ||
      (profile as any)?.subscriptionStatus?.plan ||
      (profile as any)?.subscriptionTier ||
      (profile as any)?.subscription_level ||
      (profile as any)?.premiumTier ||
      ''
  )
    .trim()
    .toLowerCase();
  const subscriptionActive =
    Boolean((profile as any)?.subscription?.isActive) ||
    Boolean((profile as any)?.subscription?.active) ||
    Boolean((profile as any)?.subscriptionStatus?.isActive) ||
    Boolean((profile as any)?.subscriptionStatus?.active);
  const currentRank = String((profile as any)?.current_rank || '').trim().toLowerCase();
  const plan = String((profile as any)?.plan || '').trim().toLowerCase();
  const membership = String((profile as any)?.membership || '').trim().toLowerCase();

  // Pro detection must be tolerant: different builds store Pro state in different places.
  // This function gates analytics features only; keep it strict enough to avoid accidental unlocks,
  // but wide enough to respect real subscription state in TestFlight.
  const profileMarksPro =
    (profile as any)?.isPro === true ||
    (profile as any)?.pro === true ||
    (profile as any)?.premium === true ||
    level === 'pro' ||
    (subscriptionActive && (subscriptionTier === 'pro' || subscriptionTier === 'premium')) ||
    subscriptionTier === 'pro' ||
    currentRank.includes('pro') ||
    plan === 'pro' ||
    membership === 'pro';

  let subscriptionMarksPro = false;
  try {
    const raw = await AsyncStorage.getItem('subscriptionStatus');
    if (raw) {
      const parsed = JSON.parse(raw) as any;
      const active = Boolean(parsed?.isActive) || Boolean(parsed?.active);
      const tier = String(parsed?.tier || parsed?.plan || parsed?.level || '').trim().toLowerCase();
      subscriptionMarksPro = active && (tier === 'pro' || tier === 'premium');
    }
  } catch {
    // ignore
  }

  return profileMarksPro || subscriptionMarksPro || state.currencyUnlocks.advancedAnalytics;
}

export async function hasNoExcusesUnlock(): Promise<boolean> {
  const { state } = await loadState();
  return state.currencyUnlocks.noExcusesMode;
}

export async function getCurrencySnapshot() {
  const { state } = await loadState();
  return {
    balance: state.currencyBalance,
    lifetimeEarned: state.currencyLifetimeEarned,
    lifetimeSpent: state.currencyLifetimeSpent,
    unlocks: state.currencyUnlocks,
    loadoutSlotLimit: getLoadoutSlotLimit(state),
  };
}

export async function spendEffortCurrency(input: { key: CurrencyUnlockKey; quantity?: number }): Promise<{
  ok: boolean;
  reason?: 'insufficient_balance' | 'already_unlocked' | 'invalid_unlock';
  balance: number;
  state: BehavioralState;
}> {
  const quantity = Math.max(1, Math.floor(Number(input.quantity) || 1));
  const item = getCatalogItem(input.key);
  if (!item) {
    const { state } = await loadState();
    return { ok: false, reason: 'invalid_unlock', balance: state.currencyBalance, state };
  }

  const { profile, state } = await loadState();
  if (!item.repeatable) {
    if (input.key === 'advanced_analytics' && state.currencyUnlocks.advancedAnalytics) {
      return { ok: false, reason: 'already_unlocked', balance: state.currencyBalance, state };
    }
    if (input.key === 'no_excuses_mode' && state.currencyUnlocks.noExcusesMode) {
      return { ok: false, reason: 'already_unlocked', balance: state.currencyBalance, state };
    }
  }

  const totalCost = Number((item.cost * quantity).toFixed(2));
  if (state.currencyBalance < totalCost) {
    return { ok: false, reason: 'insufficient_balance', balance: state.currencyBalance, state };
  }

  const next: BehavioralState = {
    ...state,
    currencyBalance: Number((state.currencyBalance - totalCost).toFixed(2)),
    currencyLifetimeSpent: Number((state.currencyLifetimeSpent + totalCost).toFixed(2)),
    currencyUnlocks: {
      ...state.currencyUnlocks,
      advancedAnalytics:
        input.key === 'advanced_analytics' ? true : state.currencyUnlocks.advancedAnalytics,
      noExcusesMode:
        input.key === 'no_excuses_mode' ? true : state.currencyUnlocks.noExcusesMode,
      extraLoadoutSlots:
        input.key === 'extra_loadout_slot'
          ? state.currencyUnlocks.extraLoadoutSlots + quantity
          : state.currencyUnlocks.extraLoadoutSlots,
    },
  };

  await saveState(profile, next);
  return { ok: true, balance: next.currencyBalance, state: next };
}
