import AsyncStorage from "@react-native-async-storage/async-storage";
import { emitDailyLogChanged } from "./dailyLogEvents";
import { enqueueCloudStateSyncWrite } from "./cloudStateSync";
import { captureException } from "./crashReporter";

export type FoodEntry = {
  id: string;
  ts: string;
  meal?: "breakfast" | "lunch" | "dinner" | "snack";
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  // Optional nutrient details (progressive disclosure; may be absent for manual entries or legacy logs).
  fiber?: number;
  sugar?: number;
  sodiumMg?: number;
  label?: string;
  brand?: string;
  barcode?: string;
  source?: "off" | "usda" | "user";
  servingLabel?: string;
  quantity?: number;
  amount?: number;
  unit?: string;
  canonicalAmount?: number;
  canonicalUnit?: "g" | "ml";
  conversionEstimated?: boolean;
  note?: string;
};

export type WorkoutEntry = {
  id: string;
  ts: string;
  // For cardio sessions that are represented as "runs" in runsHistory.
  // When present, treat `id` as the primary stable identifier for the workout row,
  // and use `runId` for deep links into run detail screens.
  runId?: string;
  type: "strength" | "cardio" | "mobility";
  intensity: "easy" | "moderate" | "hard";
  minutes?: number;
  durationMin?: number;
  exercises?: WorkoutExerciseBlock[];
  totalSets?: number;
  totalReps?: number;
  totalVolume?: number;
  exerciseCount?: number;
  estimatedSessionLoad?: number;
  label?: string;
  caloriesBurned?: number;
  weightSource?: "dailyLog" | "profile" | "fallback";
  note?: string;
  imported?: boolean;
  importedSource?: "apple_health" | "health_connect" | "garmin_watch";
  importedAt?: string;
  sourceLabel?: string;
  workoutClass?: "run" | "lift" | "manual" | "wearable_import";
  engineType?: "endurance" | "strength" | "mixed_intensity" | "recovery" | "low_intensity" | "water";
  effortUnits?: number;
  effortScore?: number;
  intensityBand?: "low" | "moderate" | "high";
  effortConfidence?: "low" | "medium" | "high";
  verifiedEffort?: boolean;
  setCount?: number;
  classificationTag?: "strength" | "hypertrophy" | "conditioning" | "mobility";
  sourceAuthority?: "watch" | "phone" | "import";
  avgHeartRate?: number;
  peakHeartRate?: number;
  refinement?: {
    applied: boolean;
    distanceBeforeMiles?: number;
    distanceAfterMiles?: number;
    caloriesBefore?: number;
    caloriesAfter?: number;
    note?: string;
  };
  xpBase?: number;
  xpAwarded?: number;
  xpWeight?: number;
  xpEfficiency?: number;
  ruleVersion?: string;
  metricVersions?: {
    workoutComputationVersion?: string;
    calorieModelVersion?: string;
    effortModelVersion?: string;
    xpModelVersion?: string;
    authorityPolicyVersion?: string;
  };
  metricsLock?: {
    metricsImmutable?: boolean;
    metricsLockedAtUtc?: string;
    sessionIntegrityState?: 'pending' | 'finalized' | 'open' | 'locked' | 'reconciled';
  };
  loggedAtUtc?: string;
  xpEligibleByTime?: boolean;
  lateLoggedNoXP?: boolean;

  // Garmin/other import recovery metadata (non-gating UX indicator).
  sessionRecovered?: boolean;
  recoveryReason?: string;
  recoveryDetectedAt?: string;
  recoveryNotes?: string;
};

export type WorkoutExerciseBlock = {
  name: string;
  sets: WorkoutSetEntry[];
};

export type WorkoutSetEntry = {
  setIndex: number;
  weight: number;
  weightUnit: "lb" | "kg";
  reps: number;
  rpe?: number;
  setType?: "warmup" | "working" | "drop" | "failure";
  restSec?: number;
  notes?: string;
  timestamp?: string;
};

export type ActiveRestEntry = {
  id: string;
  ts: string;
  type: "walk" | "mobility" | "stretch" | "recovery";
  intensity?: "easy" | "moderate" | "hard";
  minutes: number;
  label?: string;
  caloriesBurned?: number;
  weightSource?: "dailyLog" | "profile" | "fallback";
  note?: string;
};

export type DailyLog = {
  calories?: number;
  water?: number;
  weight?: number;
  dailyXP?: number;
  wearableSignals?: {
    source?: "apple_health" | "health_connect";
    importedAt?: string;
    steps?: number;
    activeEnergy?: number;
    sleepMinutes?: number;
    restingHeartRate?: number;
  };
  macros?: {
    protein?: number;
    carbs?: number;
    fat?: number;
  };
  foodEntries?: FoodEntry[];
  workouts?: WorkoutEntry[];
  activeRest?: ActiveRestEntry[];
  behavioral?: {
    strictWinningDay?: boolean;
    winningReason?: "authoritative_training" | "authoritative_recovery" | "none";
    adaptiveMinimumTrainingMin?: number;
    adaptiveMinimumRecoveryMin?: number;
    adaptiveRecoveryWeeklyCap?: number;
    adaptiveMinimumTrainingPrev?: number;
    adaptiveMinimumRecoveryPrev?: number;
    adaptiveMinimumReason?: string;
    debtAccrued?: number;
    debtPaid?: number;
    effortDebt?: number;
    disciplineScore?: number;
    xpEfficiency?: number;
    rankEfficiency?: number;
    silentAccountabilityActive?: boolean;
    silentReason?: string;
    currencyAwarded?: number;
    currencyBalance?: number;
    ruleVersion?: string;
    settlementSource?: string;
    settlementVersion?: number;
    settlementInputHash?: string;
    settlementSnapshot?: {
      effortDebt?: number;
      debtEntries?: Array<{ id: string; date: string; amount: number; ageDays: number; cause: string }>;
      consecutiveMisses?: number;
      lowEffortRepaymentStreak?: number;
      disciplineScore?: number;
      memoryEvents?: Array<{ id: string; type: string; date: string; title: string; detail: string; evidence: string }>;
      currencyBalance?: number;
      currencyLifetimeEarned?: number;
      lastSettledDay?: string;
    };
    dayLockedAt?: string;
  };
  updatedAt?: string;
};

export type UserProfile = {
  onboardingCompleted?: boolean;
  onboardingGoals?: Array<"GAIN_FAT" | "GAIN_MUSCLE" | "MAINTAIN" | "LOSE_FAT">;
  heightCm?: number;
  weightKg?: number;
  sexAtBirth?: "male" | "female" | "unknown";
  birthdate?: string;
  activityLevel?: "sedentary" | "light" | "moderate" | "very" | "extra" | "active" | "very_active";
  age?: number;
  sex?: "male" | "female" | null;
  height?: number;
  startWeight?: number;
  currentWeight?: number;
  goal?: string;
  goals?: {
    proteinTarget?: number;
    waterTargetOz?: number;
    activeRestTargetMin?: number;
    caloriesTarget?: number;
  };
  weightLog?: WeightLogEntry[];
  [key: string]: unknown;
};

export type WeightLogEntry = {
  id: string;
  ts: string;
  date: string;
  weight: number;
  note?: string;
};

export const DAILY_LOG_KEY_PREFIX = "dailyLog_";
export const USER_PROFILE_KEY_PREFIX = "userProfile:";
export const LEGACY_USER_PROFILE_KEY = "userProfile";
export const USER_PROFILE_KEY = LEGACY_USER_PROFILE_KEY;
export const WEIGHT_LOG_KEY = "weightLog";
export const STORAGE_SCHEMA_VERSION = 1;
export const GUEST_PROFILE_EMAIL = "local_user@zenith.local";

const dayKey = (date: string) => `${DAILY_LOG_KEY_PREFIX}${date}`;

function formatDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export const todayKey = formatDateKey;
export const getLocalDateKey = formatDateKey;

export function normalizeEmail(email: string | null | undefined) {
  return String(email || "").trim().toLowerCase();
}

function canonicalProfileEmail(email: string | null | undefined) {
  return normalizeEmail(email) || GUEST_PROFILE_EMAIL;
}

export function getCanonicalUserProfileKey(email: string | null | undefined) {
  return `${USER_PROFILE_KEY_PREFIX}${canonicalProfileEmail(email)}`;
}

export function isUserProfileStorageKey(key: string) {
  return key === LEGACY_USER_PROFILE_KEY || key.startsWith(USER_PROFILE_KEY_PREFIX) || key.startsWith("userProfile_");
}

function getLegacyProfileKeysForEmail(email: string | null | undefined) {
  const normalized = normalizeEmail(email);
  const keys = [LEGACY_USER_PROFILE_KEY];
  if (normalized) {
    keys.push(`userProfile_${normalized}`);
    if (normalized !== String(email || "").trim()) {
      keys.push(`userProfile_${String(email || "").trim()}`);
    }
  }
  return Array.from(new Set(keys));
}

export function safeParseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    void captureException(err, { feature: "storage_utils", op: "safe_parse_json" });
    return fallback;
  }
}

export async function getDailyLogsByDates(dates: string[]): Promise<Record<string, DailyLog>> {
  const result: Record<string, DailyLog> = {};
  if (!dates.length) return result;

  try {
    const keys = dates.map((date) => dayKey(date));
    const rows = await AsyncStorage.multiGet(keys);
    rows.forEach(([key, raw], index) => {
      const parsed = safeParseJson<DailyLog | null>(raw, null);
      const date = dates[index];
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        result[date] = parsed;
      } else {
        result[date] = {};
      }
      if (!date && key.startsWith(DAILY_LOG_KEY_PREFIX)) {
        const extracted = key.replace(DAILY_LOG_KEY_PREFIX, "");
        result[extracted] = result[date] || {};
      }
    });
  } catch (err) {
    void captureException(err, { feature: "storage_utils", op: "get_daily_logs_by_dates" });
    dates.forEach((date) => {
      result[date] = {};
    });
  }

  return result;
}

export async function getAllDailyLogs(): Promise<Array<{ date: string; log: DailyLog }>> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const dailyKeys = keys.filter((key) => key.startsWith(DAILY_LOG_KEY_PREFIX)).sort();
    if (!dailyKeys.length) return [];

    const rows = await AsyncStorage.multiGet(dailyKeys);
    return rows.map(([key, raw]) => {
      const parsed = safeParseJson<DailyLog | null>(raw, null);
      const date = key.replace(DAILY_LOG_KEY_PREFIX, "");
      return {
        date,
        log: parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {},
      };
    });
  } catch (err) {
    void captureException(err, { feature: "storage_utils", op: "get_all_daily_logs" });
    return [];
  }
}

export async function getRecentDailyLogs(days: number): Promise<Array<{ date: string; log: DailyLog }>> {
  if (!Number.isFinite(days) || days <= 0) return [];
  const count = Math.max(1, Math.floor(days));
  const dates: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const dt = new Date();
    dt.setDate(dt.getDate() - i);
    dates.push(todayKey(dt));
  }
  const byDate = await getDailyLogsByDates(dates);
  return dates
    .slice()
    .reverse()
    .map((date) => ({ date, log: byDate[date] || {} }));
}

export async function getCurrentUserEmail(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem("user");
    const parsed = safeParseJson<{ email?: string } | null>(raw, null);
    const normalized = normalizeEmail(parsed?.email);
    return normalized || null;
  } catch (err) {
    void captureException(err, { feature: "storage_utils", op: "get_current_user_email" });
    return null;
  }
}

export async function migrateLegacyUserProfileForEmail(email: string | null | undefined): Promise<void> {
  const canonicalKey = getCanonicalUserProfileKey(email);
  const legacyKeys = getLegacyProfileKeysForEmail(email);

  let canonicalProfile = safeParseJson<UserProfile | null>(await AsyncStorage.getItem(canonicalKey), null);

  if (!canonicalProfile || typeof canonicalProfile !== "object" || Array.isArray(canonicalProfile)) {
    for (const key of legacyKeys) {
      const candidate = safeParseJson<UserProfile | null>(await AsyncStorage.getItem(key), null);
      if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
        canonicalProfile = candidate;
        break;
      }
    }
  }

  if (canonicalProfile && typeof canonicalProfile === "object" && !Array.isArray(canonicalProfile)) {
    await AsyncStorage.setItem(canonicalKey, JSON.stringify(canonicalProfile));
  }

  const staleLegacyKeys = legacyKeys.filter((key) => key !== canonicalKey);
  if (staleLegacyKeys.length > 0) {
    await AsyncStorage.multiRemove(staleLegacyKeys);
  }
}

export async function getUserProfileByEmail(email: string | null | undefined): Promise<UserProfile> {
  try {
    await migrateLegacyUserProfileForEmail(email);
    const raw = await AsyncStorage.getItem(getCanonicalUserProfileKey(email));
    const parsed = safeParseJson<UserProfile | null>(raw, null);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch (err) {
    void captureException(err, { feature: "storage_utils", op: "get_user_profile_by_email" });
  }
  return {};
}

export async function getDailyLog(date: string): Promise<DailyLog> {
  try {
    const raw = await AsyncStorage.getItem(dayKey(date));
    const parsed = safeParseJson<DailyLog | null>(raw, null);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch (err) {
    void captureException(err, { feature: "storage_utils", op: "get_daily_log" });
  }
  return {};
}

export async function saveDailyLog(date: string, log: DailyLog) {
  try {
    const payload = {
      ...log,
      updatedAt: new Date().toISOString(),
    };
    const key = dayKey(date);
    await AsyncStorage.setItem(
      dayKey(date),
      JSON.stringify(payload)
    );
    void enqueueCloudStateSyncWrite(key, payload);
    emitDailyLogChanged(date);
  } catch (err) {
    void captureException(err, { feature: "storage_utils", op: "save_daily_log" });
  }
}

export async function getUserProfile(): Promise<UserProfile> {
  const currentEmail = await getCurrentUserEmail();
  return getUserProfileByEmail(currentEmail);
}

export async function setStorageItem(key: string, value: any) {
  try {
    if (key === USER_PROFILE_KEY || key === LEGACY_USER_PROFILE_KEY) {
      const valueEmail = normalizeEmail((value as { email?: string } | null)?.email);
      const currentEmail = await getCurrentUserEmail();
      const profileKey = getCanonicalUserProfileKey(valueEmail || currentEmail || GUEST_PROFILE_EMAIL);
      await AsyncStorage.setItem(profileKey, JSON.stringify(value));
      void enqueueCloudStateSyncWrite(profileKey, value);
      await migrateLegacyUserProfileForEmail(valueEmail || currentEmail || GUEST_PROFILE_EMAIL);
      return;
    }
    await AsyncStorage.setItem(key, JSON.stringify(value));
    void enqueueCloudStateSyncWrite(key, value);
  } catch (err) {
    void captureException(err, { feature: "storage_utils", op: "set_storage_item", key });
  }
}
