import { getDailyLog, getDailyLogsByDates, getUserProfile, saveDailyLog, setStorageItem, todayKey, USER_PROFILE_KEY, type DailyLog, type WorkoutEntry } from './storageUtils';
import { WINNING_SETTLEMENT_VERSION, WINNING_THRESHOLDS } from './winningThresholds';

export type DebtCause = 'avoidance' | 'capacity_limited' | 'unknown';

export type EffortDebtEntry = {
  id: string;
  date: string;
  amount: number;
  ageDays: number;
  cause: DebtCause;
};

export type BehavioralModes = {
  strictDeterminismEnabled: boolean;
  identityLockEnabled: boolean;
  noExcusesEnabled: boolean;
  injuryModeEnabled: boolean;
  illnessModeEnabled: boolean;
};

export type AdaptiveMinimums = {
  trainingMinDuration: number;
  recoveryMinDuration: number;
  recoveryWeeklyCap: number;
  intensityMinimum: number;
  recoveryIntensityCeiling: number;
};

export type BehavioralState = {
  modes: BehavioralModes;
  effortDebt: number;
  debtEntries: EffortDebtEntry[];
  disciplineScore: number;
  consecutiveMisses: number;
  lowEffortRepaymentStreak: number;
  memoryEvents: EffortMemoryEvent[];
  currencyBalance: number;
  currencyLifetimeEarned: number;
  currencyLifetimeSpent: number;
  currencyUnlocks: {
    advancedAnalytics: boolean;
    noExcusesMode: boolean;
    extraLoadoutSlots: number;
  };
  lastSettledDay?: string;
};

export type EffortMemoryEventType =
  | 'hard_streak'
  | 'comeback'
  | 'proof_of_struggle'
  | 'debt_recovered'
  | 'identity_lock_milestone';

export type EffortMemoryEvent = {
  id: string;
  type: EffortMemoryEventType;
  date: string;
  title: string;
  detail: string;
  evidence: string;
};

export type SessionAuthority = {
  authoritative: boolean;
  reason:
    | 'watch_authoritative'
    | 'fallback_authoritative'
    | 'manual_not_authoritative'
    | 'missing_required_inputs'
    | 'fallback_limit_exceeded'
    | 'insufficient_duration';
};

export type DaySettlementResult = {
  date: string;
  strictWinningDay: boolean;
  winningReason: 'authoritative_training' | 'authoritative_recovery' | 'none';
  adaptiveMinimums: AdaptiveMinimums;
  debtAccrued: number;
  debtPaid: number;
  effortDebt: number;
  disciplineScore: number;
  xpEfficiency: number;
  rankEfficiency: number;
  silentAccountabilityActive: boolean;
  silentReason: string | null;
  currencyAwarded: number;
  currencyBalance: number;
};

export type EffortDebtTier = 'none' | 'low' | 'medium' | 'high' | 'critical';

const ABSOLUTE_TRAINING_FLOOR = 12;
const ABSOLUTE_RECOVERY_FLOOR = 8;
const TRAINING_MIN_DURATION_MINUTES = WINNING_THRESHOLDS.training.minDurationMin;
const TRAINING_MIN_ACTIVE_ENERGY_KCAL = WINNING_THRESHOLDS.training.minActiveEnergyKcal;
const TRAINING_MIN_HR_RATIO = WINNING_THRESHOLDS.training.minHrRatio;
const TRAINING_MIN_MET_MINUTES = WINNING_THRESHOLDS.training.minMetMinutes;
const RECOVERY_MIN_DURATION_MINUTES = WINNING_THRESHOLDS.recovery.minDurationMin;
const RECOVERY_MAX_DURATION_MINUTES = WINNING_THRESHOLDS.recovery.maxDurationMin;
const RECOVERY_MAX_HR_RATIO = WINNING_THRESHOLDS.recovery.maxHrRatio;
const RECOVERY_MAX_METS = WINNING_THRESHOLDS.recovery.maxMets;
const RECOVERY_WEEKLY_CAP = WINNING_THRESHOLDS.recovery.maxWinningDaysPerRollingWeek;
const INTENSITY_MINIMUM_DEFAULT = 28;
const DEFAULT_USER_AGE = 30;
const SETTLEMENT_VERSION = WINNING_SETTLEMENT_VERSION;

function asFinite(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toDateKey(date: Date): string {
  return todayKey(date);
}

function parseDateKey(dateKey: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function buildDateRange(endDate: string, days: number): string[] {
  const end = parseDateKey(endDate);
  const list: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const next = new Date(end.getTime() - i * 24 * 60 * 60 * 1000);
    list.push(toDateKey(next));
  }
  return list;
}

function mondayOfWeek(dateKey: string): string {
  const date = parseDateKey(dateKey);
  const day = date.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  const monday = new Date(date.getTime() + delta * 24 * 60 * 60 * 1000);
  return toDateKey(monday);
}

function previousDateKey(dateKey: string): string {
  const date = parseDateKey(dateKey);
  return toDateKey(new Date(date.getTime() - 24 * 60 * 60 * 1000));
}

function stableHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

function buildSettlementInputHash(date: string, log: DailyLog, modes: BehavioralModes): string {
  const workouts = (Array.isArray(log.workouts) ? log.workouts : []) as WorkoutEntry[];
  const workoutSignature = workouts
    .map((row) => ({
      id: String(row.id || ''),
      ts: String(row.ts || ''),
      type: String(row.type || ''),
      duration: Math.round((asFinite((row as any).durationMin) || asFinite((row as any).minutes)) * 10) / 10,
      calories: Math.round((asFinite((row as any).caloriesBurned) || 0) * 10) / 10,
      score: Math.round((asFinite((row as any).effortScore) || 0) * 10) / 10,
      authority: String((row as any).sourceAuthority || ''),
      imported: (row as any).imported === true,
      recovery: (row as any).isRecoverySession === true || String(row.type || '').toLowerCase() === 'mobility',
    }))
    .sort((a, b) => `${a.id}_${a.ts}`.localeCompare(`${b.id}_${b.ts}`));
  const behavioralSnapshot = {
    date,
    workouts: workoutSignature,
    modes,
  };
  return stableHash(JSON.stringify(behavioralSnapshot));
}

function readSettlementSnapshot(log: DailyLog): any | null {
  const behavioral = (log as any)?.behavioral || {};
  if (behavioral?.settlementVersion !== SETTLEMENT_VERSION) return null;
  if (!behavioral?.settlementSnapshot || typeof behavioral.settlementSnapshot !== 'object') return null;
  return behavioral.settlementSnapshot;
}

function rollbackToSnapshot(behavior: BehavioralState, snapshot: any): BehavioralState {
  if (!snapshot || typeof snapshot !== 'object') return behavior;
  const debtEntriesRaw = Array.isArray(snapshot.debtEntries) ? snapshot.debtEntries : behavior.debtEntries;
  const memoryEventsRaw = Array.isArray(snapshot.memoryEvents) ? snapshot.memoryEvents : behavior.memoryEvents;
  return {
    ...behavior,
    effortDebt: Math.max(0, Number((asFinite(snapshot.effortDebt) || behavior.effortDebt).toFixed(2))),
    debtEntries: debtEntriesRaw
      .map((entry: any, idx: number) => ({
        id: String(entry?.id || `debt_restore_${idx}`),
        date: String(entry?.date || ''),
        amount: Math.max(0, asFinite(entry?.amount)),
        ageDays: Math.max(0, Math.round(asFinite(entry?.ageDays))),
        cause: entry?.cause === 'avoidance' || entry?.cause === 'capacity_limited' ? entry.cause : 'unknown',
      }))
      .filter((row: EffortDebtEntry) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && row.amount > 0),
    consecutiveMisses: Math.max(0, Math.round(asFinite(snapshot.consecutiveMisses))),
    lowEffortRepaymentStreak: Math.max(0, Math.round(asFinite(snapshot.lowEffortRepaymentStreak))),
    disciplineScore: clamp(asFinite(snapshot.disciplineScore) || behavior.disciplineScore, 0, 100),
    memoryEvents: memoryEventsRaw
      .map((event: any, idx: number) => ({
        id: String(event?.id || `memory_restore_${idx}`),
        type: String(event?.type || 'hard_streak') as EffortMemoryEventType,
        date: String(event?.date || ''),
        title: String(event?.title || 'Effort Memory'),
        detail: String(event?.detail || ''),
        evidence: String(event?.evidence || ''),
      }))
      .filter((event: EffortMemoryEvent) => /^\d{4}-\d{2}-\d{2}$/.test(event.date))
      .slice(-120),
    currencyBalance: Math.max(0, Number((asFinite(snapshot.currencyBalance) || behavior.currencyBalance).toFixed(2))),
    currencyLifetimeEarned: Math.max(0, Number((asFinite(snapshot.currencyLifetimeEarned) || behavior.currencyLifetimeEarned).toFixed(2))),
    lastSettledDay: typeof snapshot.lastSettledDay === 'string' ? snapshot.lastSettledDay : behavior.lastSettledDay,
  };
}

function normalizeModes(profile: any): BehavioralModes {
  const behavior = (profile.behaviorState || {}) as any;
  const modes = (behavior.modes || {}) as any;
  const injuryModeEnabled = modes.injuryModeEnabled === true;
  const illnessModeEnabled = modes.illnessModeEnabled === true;
  const capacityOverride = injuryModeEnabled || illnessModeEnabled;
  return {
    strictDeterminismEnabled: true,
    identityLockEnabled: modes.identityLockEnabled === true,
    noExcusesEnabled: capacityOverride ? false : modes.noExcusesEnabled === true,
    injuryModeEnabled,
    illnessModeEnabled,
  };
}

export function getEffortDebtTier(effortDebt: number): EffortDebtTier {
  const value = Math.max(0, asFinite(effortDebt));
  if (value <= 0) return 'none';
  if (value < 3) return 'low';
  if (value < 7) return 'medium';
  if (value < 12) return 'high';
  return 'critical';
}

export function estimateSessionsToClearDebt(input: {
  effortDebt: number;
  trainingIntensity?: number;
  recoveryIntensity?: number;
}) {
  const effortDebt = Math.max(0, asFinite(input.effortDebt));
  const trainingIntensity = clamp(asFinite(input.trainingIntensity) || 52, 20, 100);
  const recoveryIntensity = clamp(asFinite(input.recoveryIntensity) || 24, 10, 60);
  const trainingPaydown = trainingIntensity / 50;
  const recoveryPaydown = recoveryIntensity / 150;
  if (effortDebt <= 0) {
    return {
      trainingSessions: 0,
      recoverySessions: 0,
    };
  }
  return {
    trainingSessions: Math.ceil(effortDebt / Math.max(trainingPaydown, 0.01)),
    recoverySessions: Math.ceil(effortDebt / Math.max(recoveryPaydown, 0.01)),
  };
}

export function defaultBehaviorState(): BehavioralState {
  return {
    modes: {
      strictDeterminismEnabled: true,
      identityLockEnabled: false,
      noExcusesEnabled: false,
      injuryModeEnabled: false,
      illnessModeEnabled: false,
    },
    effortDebt: 0,
    debtEntries: [],
    disciplineScore: 50,
    consecutiveMisses: 0,
    lowEffortRepaymentStreak: 0,
    memoryEvents: [],
    currencyBalance: 0,
    currencyLifetimeEarned: 0,
    currencyLifetimeSpent: 0,
    currencyUnlocks: {
      advancedAnalytics: false,
      noExcusesMode: false,
      extraLoadoutSlots: 0,
    },
  };
}

export function normalizeBehaviorState(profile: any): BehavioralState {
  const raw = (profile.behaviorState || {}) as any;
  const defaults = defaultBehaviorState();
  const modes = normalizeModes(profile);
  const debtEntriesRaw = Array.isArray(raw.debtEntries) ? raw.debtEntries : [];
  const memoryEventsRaw = Array.isArray(raw.memoryEvents) ? raw.memoryEvents : [];
  const currencyUnlocksRaw = (raw.currencyUnlocks || {}) as any;
  const debtEntries: EffortDebtEntry[] = debtEntriesRaw
    .map((entry: any, idx: number) => ({
      id: String(entry?.id || `debt_${idx}_${entry?.date || 'unknown'}`),
      date: String(entry?.date || ''),
      amount: Math.max(0, asFinite(entry?.amount)),
      ageDays: Math.max(0, Math.round(asFinite(entry?.ageDays))),
      cause: entry?.cause === 'avoidance' || entry?.cause === 'capacity_limited' ? entry.cause : 'unknown',
    }))
    .filter((entry: EffortDebtEntry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && entry.amount > 0);
  const memoryEvents: EffortMemoryEvent[] = memoryEventsRaw
    .map((entry: any, idx: number) => ({
      id: String(entry?.id || `memory_${idx}_${entry?.date || 'unknown'}`),
      type: String(entry?.type || 'hard_streak') as EffortMemoryEventType,
      date: String(entry?.date || ''),
      title: String(entry?.title || 'Effort Memory'),
      detail: String(entry?.detail || ''),
      evidence: String(entry?.evidence || ''),
    }))
    .filter((entry: EffortMemoryEvent) => /^\d{4}-\d{2}-\d{2}$/.test(entry.date))
    .slice(-120);

  return {
    modes,
    effortDebt: Math.max(0, asFinite(raw.effortDebt) || debtEntries.reduce((sum, row) => sum + row.amount, 0)),
    debtEntries,
    disciplineScore: clamp(asFinite(raw.disciplineScore) || defaults.disciplineScore, 0, 100),
    consecutiveMisses: Math.max(0, Math.round(asFinite(raw.consecutiveMisses))),
    lowEffortRepaymentStreak: Math.max(0, Math.round(asFinite(raw.lowEffortRepaymentStreak))),
    memoryEvents,
    currencyBalance: Math.max(0, Number((asFinite(raw.currencyBalance) || 0).toFixed(2))),
    currencyLifetimeEarned: Math.max(0, Number((asFinite(raw.currencyLifetimeEarned) || 0).toFixed(2))),
    currencyLifetimeSpent: Math.max(0, Number((asFinite(raw.currencyLifetimeSpent) || 0).toFixed(2))),
    currencyUnlocks: {
      advancedAnalytics: currencyUnlocksRaw.advancedAnalytics === true,
      noExcusesMode: currencyUnlocksRaw.noExcusesMode === true,
      extraLoadoutSlots: Math.max(0, Math.floor(asFinite(currencyUnlocksRaw.extraLoadoutSlots))),
    },
    lastSettledDay: typeof raw.lastSettledDay === 'string' ? raw.lastSettledDay : undefined,
  };
}

export function computeSilentAccountability(input: {
  effortDebt: number;
  disciplineScore: number;
}): {
  active: boolean;
  xpEfficiency: number;
  rankEfficiency: number;
  reason: string | null;
} {
  const debtMedium = input.effortDebt >= 3;
  const disciplineLow = input.disciplineScore < 45;
  if (debtMedium || disciplineLow) {
    return {
      active: true,
      xpEfficiency: 0.85,
      rankEfficiency: 0.85,
      reason: debtMedium ? 'effort_debt_medium_or_higher' : 'discipline_below_floor',
    };
  }
  return {
    active: false,
    xpEfficiency: 1,
    rankEfficiency: 1,
    reason: null,
  };
}

function estimateSessionIntensity(workout: WorkoutEntry): number {
  const explicit = asFinite((workout as any).effortScore);
  if (explicit > 0) return clamp(explicit, 0, 100);

  const durationMin = asFinite(workout.durationMin) || asFinite(workout.minutes);
  const calories = asFinite(workout.caloriesBurned);
  const avgHr = asFinite((workout as any).avgHeartRate);
  const raw = durationMin * 1.2 + calories * 0.05 + Math.max(0, avgHr - 95) * 0.25;
  return clamp(Math.round(raw), 0, 100);
}

function sessionDuration(workout: WorkoutEntry): number {
  return Math.max(0, asFinite(workout.durationMin) || asFinite(workout.minutes));
}

function isRecoverySession(workout: WorkoutEntry): boolean {
  if ((workout as any).isRecoverySession === true) return true;
  const engineType = String((workout as any).engineType || '').toLowerCase();
  if (engineType === 'low_intensity' || engineType === 'recovery') return true;
  const type = String(workout.type || '').toLowerCase();
  return type === 'mobility';
}

function resolveUserAge(profile: any): number {
  const directAge = Math.round(asFinite(profile?.age));
  if (directAge > 12 && directAge < 100) return directAge;

  const birthYear = Math.round(asFinite(profile?.birthYear));
  if (birthYear > 1900) {
    const currentYear = new Date().getFullYear();
    const computed = currentYear - birthYear;
    if (computed > 12 && computed < 100) return computed;
  }

  return DEFAULT_USER_AGE;
}

function resolveMaxHeartRate(profile: any): number {
  const age = resolveUserAge(profile);
  return Math.max(130, 220 - age);
}

function resolveSessionHrRatio(workout: WorkoutEntry, maxHeartRate: number): number {
  const avgHeartRate = asFinite((workout as any).avgHeartRate);
  if (avgHeartRate <= 0 || maxHeartRate <= 0) return 0;
  return clamp(avgHeartRate / maxHeartRate, 0, 1.2);
}

function estimateSessionMets(workout: WorkoutEntry): number {
  const explicitMet = asFinite((workout as any).mets) || asFinite((workout as any).met);
  if (explicitMet > 0) return explicitMet;

  const explicitMetMinutes = asFinite((workout as any).metMinutes);
  const duration = sessionDuration(workout);
  if (explicitMetMinutes > 0 && duration > 0) return explicitMetMinutes / duration;

  const intensity = String((workout as any).intensity || '').toLowerCase();
  const type = String((workout as any).type || '').toLowerCase();
  const engineType = String((workout as any).engineType || '').toLowerCase();
  const workoutClass = String((workout as any).workoutClass || '').toLowerCase();

  if (isRecoverySession(workout)) return 2.4;
  if (type === 'running' || workoutClass === 'run' || engineType === 'endurance') {
    if (intensity === 'hard') return 10.5;
    if (intensity === 'moderate') return 8.3;
    return 6.8;
  }
  if (engineType === 'strength' || workoutClass === 'lift' || type === 'strength') {
    if (intensity === 'hard') return 6.0;
    if (intensity === 'moderate') return 4.8;
    return 3.8;
  }
  if (engineType === 'mixed_intensity') {
    if (intensity === 'hard') return 8.2;
    if (intensity === 'moderate') return 5.8;
    return 4.0;
  }

  if (intensity === 'hard') return 5.5;
  if (intensity === 'moderate') return 4.2;
  return 3.0;
}

function estimateSessionMetMinutes(workout: WorkoutEntry, durationMin: number): number {
  const explicit = asFinite((workout as any).metMinutes);
  if (explicit > 0) return explicit;
  return estimateSessionMets(workout) * Math.max(0, durationMin);
}

function evaluateSessionAuthority(workout: WorkoutEntry): SessionAuthority {
  if ((workout as any).lateLoggedNoXP === true || (workout as any).xpEligibleByTime === false) {
    return { authoritative: false, reason: 'manual_not_authoritative' };
  }

  const sourceAuthority = String((workout as any).sourceAuthority || '').toLowerCase();
  const workoutClass = String((workout as any).workoutClass || '').toLowerCase();
  const verifiedEffort = (workout as any).verifiedEffort === true;

  if (sourceAuthority === 'watch' || sourceAuthority === 'import' || workout.imported === true) {
    return { authoritative: true, reason: 'watch_authoritative' };
  }

  if (workoutClass === 'manual' || !verifiedEffort) {
    return { authoritative: false, reason: 'manual_not_authoritative' };
  }

  if (sourceAuthority !== 'phone') {
    return { authoritative: false, reason: 'missing_required_inputs' };
  }

  if (workoutClass !== 'run' && workoutClass !== 'lift') {
    return { authoritative: false, reason: 'manual_not_authoritative' };
  }

  return { authoritative: true, reason: 'fallback_authoritative' };
}

function countWinningRate(logs: DailyLog[]): number {
  if (!logs.length) return 0;
  const wins = logs.filter((log) => Boolean((log as any)?.behavioral?.strictWinningDay)).length;
  return wins / logs.length;
}

function computeAdaptiveMinimums(input: {
  recentLogs: DailyLog[];
  modes: BehavioralModes;
}): AdaptiveMinimums {
  const identityMultiplier = input.modes.identityLockEnabled ? 1.25 : 1;
  const noExcusesMultiplier = input.modes.noExcusesEnabled ? 1.4 : 1;
  const capacityReduction = input.modes.injuryModeEnabled || input.modes.illnessModeEnabled ? 0.75 : 1;

  const trainingMinDuration = clamp(
    Math.round(TRAINING_MIN_DURATION_MINUTES * identityMultiplier * noExcusesMultiplier * capacityReduction),
    ABSOLUTE_TRAINING_FLOOR,
    120
  );

  const recoveryMinDuration = clamp(Math.round(RECOVERY_MIN_DURATION_MINUTES * capacityReduction), ABSOLUTE_RECOVERY_FLOOR, RECOVERY_MAX_DURATION_MINUTES);
  const recoveryWeeklyCap = input.modes.noExcusesEnabled ? 0 : RECOVERY_WEEKLY_CAP;

  return {
    trainingMinDuration,
    recoveryMinDuration,
    recoveryWeeklyCap,
    intensityMinimum: INTENSITY_MINIMUM_DEFAULT,
    recoveryIntensityCeiling: RECOVERY_MAX_METS,
  };
}

function smoothAdaptiveMinimums(
  date: string,
  raw: AdaptiveMinimums,
  logsByDate: Record<string, DailyLog>
): {
  minimums: AdaptiveMinimums;
  previousTraining?: number;
  previousRecovery?: number;
} {
  const prevKey = previousDateKey(date);
  const previousBehavior = (logsByDate[prevKey] as any)?.behavioral || {};
  const prevTraining = asFinite(previousBehavior.adaptiveMinimumTrainingMin);
  const prevRecovery = asFinite(previousBehavior.adaptiveMinimumRecoveryMin);

  const nextTraining =
    prevTraining > 0
      ? clamp(raw.trainingMinDuration, Math.round(prevTraining * 0.9), Math.round(prevTraining * 1.1))
      : raw.trainingMinDuration;
  const nextRecovery =
    prevRecovery > 0
      ? clamp(raw.recoveryMinDuration, Math.round(prevRecovery * 0.9), Math.round(prevRecovery * 1.1))
      : raw.recoveryMinDuration;

  return {
    minimums: {
      ...raw,
      trainingMinDuration: clamp(nextTraining, ABSOLUTE_TRAINING_FLOOR, 120),
      recoveryMinDuration: clamp(nextRecovery, ABSOLUTE_RECOVERY_FLOOR, 60),
    },
    previousTraining: prevTraining > 0 ? prevTraining : undefined,
    previousRecovery: prevRecovery > 0 ? prevRecovery : undefined,
  };
}

function buildAdaptiveMinimumReason(input: {
  modes: BehavioralModes;
  minimums: AdaptiveMinimums;
  previousTraining?: number;
  previousRecovery?: number;
  recentWinRate: number;
}): string {
  const reasons: string[] = [];
  if (input.modes.identityLockEnabled) reasons.push('identity-lock');
  if (input.modes.noExcusesEnabled) reasons.push('no-excuses');
  if (input.modes.injuryModeEnabled || input.modes.illnessModeEnabled) reasons.push('capacity-override');
  if (input.recentWinRate >= 0.75) reasons.push('high-consistency');
  if (input.recentWinRate <= 0.4) reasons.push('rebuild-baseline');

  const trainingDelta =
    input.previousTraining && input.previousTraining > 0
      ? Math.round(((input.minimums.trainingMinDuration - input.previousTraining) / input.previousTraining) * 100)
      : 0;
  const recoveryDelta =
    input.previousRecovery && input.previousRecovery > 0
      ? Math.round(((input.minimums.recoveryMinDuration - input.previousRecovery) / input.previousRecovery) * 100)
      : 0;

  const reasonPrefix = reasons.length ? reasons.join(', ') : 'steady';
  return `${reasonPrefix} · training ${input.minimums.trainingMinDuration}m (${trainingDelta >= 0 ? '+' : ''}${trainingDelta}%) · recovery ${input.minimums.recoveryMinDuration}-${RECOVERY_MAX_DURATION_MINUTES}m (${recoveryDelta >= 0 ? '+' : ''}${recoveryDelta}%)`;
}

function evaluateStrictWinningDay(input: {
  date: string;
  log: DailyLog;
  minimums: AdaptiveMinimums;
  modes: BehavioralModes;
  weeklyRecoveryWinsSoFar: number;
  maxHeartRate: number;
}) {
  const workouts = (Array.isArray(input.log.workouts) ? input.log.workouts : []) as WorkoutEntry[];

  const sessionRows = workouts.map((workout) => {
    const authority = evaluateSessionAuthority(workout);
    const intensity = estimateSessionIntensity(workout);
    const durationMin = sessionDuration(workout);
    const recovery = isRecoverySession(workout);
    const calories = asFinite((workout as any).caloriesBurned);
    const hrRatio = resolveSessionHrRatio(workout, input.maxHeartRate);
    const mets = estimateSessionMets(workout);
    const metMinutes = estimateSessionMetMinutes(workout, durationMin);
    const trainingIntensityQualified =
      calories >= TRAINING_MIN_ACTIVE_ENERGY_KCAL ||
      hrRatio >= TRAINING_MIN_HR_RATIO ||
      metMinutes >= TRAINING_MIN_MET_MINUTES;
    const recoveryIntensityQualified = (hrRatio <= 0 || hrRatio <= RECOVERY_MAX_HR_RATIO) && mets <= RECOVERY_MAX_METS;

    return {
      workout,
      authority,
      intensity,
      durationMin,
      recovery,
      calories,
      hrRatio,
      mets,
      metMinutes,
      trainingIntensityQualified,
      recoveryIntensityQualified,
    };
  });

  const authoritativeTraining = sessionRows.find(
    (row) =>
      row.authority.authoritative &&
      !row.recovery &&
      row.durationMin >= input.minimums.trainingMinDuration &&
      row.trainingIntensityQualified
  );

  const authoritativeRecovery = sessionRows.find(
    (row) =>
      row.authority.authoritative &&
      row.recovery &&
      row.durationMin >= input.minimums.recoveryMinDuration &&
      row.durationMin <= RECOVERY_MAX_DURATION_MINUTES &&
      row.recoveryIntensityQualified
  );

  const recoveryAllowed =
    !input.modes.noExcusesEnabled &&
    input.weeklyRecoveryWinsSoFar < input.minimums.recoveryWeeklyCap;

  const strictWinningDay = Boolean(authoritativeTraining) || Boolean(authoritativeRecovery && recoveryAllowed);
  const winningReason: 'authoritative_training' | 'authoritative_recovery' | 'none' = authoritativeTraining
    ? 'authoritative_training'
    : authoritativeRecovery && recoveryAllowed
    ? 'authoritative_recovery'
    : 'none';

  return {
    strictWinningDay,
    winningReason,
    sessionRows,
  };
}

function ageDebtEntries(entries: EffortDebtEntry[]): EffortDebtEntry[] {
  return entries.map((entry) => ({ ...entry, ageDays: entry.ageDays + 1 }));
}

function repayDebt(entries: EffortDebtEntry[], paydownAmount: number) {
  let remaining = Math.max(0, paydownAmount);
  const next: EffortDebtEntry[] = [];
  for (const entry of entries) {
    if (remaining <= 0) {
      next.push(entry);
      continue;
    }
    if (entry.amount <= remaining) {
      remaining -= entry.amount;
      continue;
    }
    next.push({ ...entry, amount: Number((entry.amount - remaining).toFixed(2)) });
    remaining = 0;
  }
  return next;
}

function computeDebtAccrual(modes: BehavioralModes, consecutiveMisses: number) {
  const base = 1 + Math.max(0, consecutiveMisses) * 0.25;
  const lockMultiplier = modes.identityLockEnabled ? 1.5 : 1;
  const noExcusesMultiplier = modes.noExcusesEnabled ? 2 : 1;
  return Number((base * lockMultiplier * noExcusesMultiplier).toFixed(2));
}

function computeDebtPaydown(input: {
  sessionRows: Array<{ authoritative: boolean; recovery: boolean; intensity: number; durationMin: number }>;
  minimums: AdaptiveMinimums;
  lowEffortRepaymentStreak: number;
}) {
  const authoritativeRows = input.sessionRows.filter((row) => row.authoritative);
  if (authoritativeRows.length === 0) return { paydown: 0, lowEffortRepaymentStreak: input.lowEffortRepaymentStreak };

  const lowEffort = authoritativeRows.every((row) => row.intensity < input.minimums.intensityMinimum * 1.1);
  let paydown = authoritativeRows.reduce((sum, row) => {
    if (row.recovery) return sum + row.intensity / 150;
    return sum + row.intensity / 50;
  }, 0);

  const nextLowEffortStreak = lowEffort ? input.lowEffortRepaymentStreak + 1 : 0;
  if (nextLowEffortStreak >= 3) paydown *= 0.5;

  return {
    paydown: Number(Math.max(0, paydown).toFixed(2)),
    lowEffortRepaymentStreak: nextLowEffortStreak,
  };
}

function calculateDisciplineScore30Day(logs: Array<{ log: DailyLog }>): number {
  const last30 = logs.slice(Math.max(0, logs.length - 30));
  if (!last30.length) return 50;

  let points = 0;
  for (let i = 0; i < last30.length; i += 1) {
    const today = Boolean((last30[i].log as any)?.behavioral?.strictWinningDay);
    const yesterday = i > 0 ? Boolean((last30[i - 1].log as any)?.behavioral?.strictWinningDay) : false;

    if (today) points += 1;
    if (today && !yesterday) points += 1.5;
    if (today && yesterday) points += 0.5;
    if (!today && yesterday) points -= 2;
  }

  const normalized = 50 + points * 2.5;
  return Math.round(clamp(normalized, 0, 100));
}

function computeCurrencyAward(input: {
  strictWinningDay: boolean;
  disciplineScore: number;
}): number {
  if (!input.strictWinningDay) return 0;
  const base = 1;
  const disciplineBonus = input.disciplineScore >= 60 ? 0.5 : 0;
  return Number(Math.min(2, base + disciplineBonus).toFixed(2));
}

function getLastEventDateByType(memoryEvents: EffortMemoryEvent[], type: EffortMemoryEventType): string | null {
  const matched = memoryEvents.filter((row) => row.type === type).sort((a, b) => a.date.localeCompare(b.date));
  return matched.length ? matched[matched.length - 1].date : null;
}

function daysBetween(a: string, b: string): number {
  const ms = parseDateKey(b).getTime() - parseDateKey(a).getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

function maybeCreateMemoryEvents(input: {
  date: string;
  strictWinningDay: boolean;
  winningReason: 'authoritative_training' | 'authoritative_recovery' | 'none';
  logsForDiscipline: Array<{ date: string; log: DailyLog }>;
  memoryEvents: EffortMemoryEvent[];
  debtBefore: number;
  debtAfter: number;
  modes: BehavioralModes;
}) {
  const next = [...input.memoryEvents];
  const recent = input.logsForDiscipline.slice(-10);
  const strictWinStreak = (() => {
    let streak = 0;
    for (let i = input.logsForDiscipline.length - 1; i >= 0; i -= 1) {
      const row = input.logsForDiscipline[i];
      const win = Boolean((row.log as any)?.behavioral?.strictWinningDay);
      if (!win) break;
      streak += 1;
    }
    return streak;
  })();

  const prevRow = input.logsForDiscipline[input.logsForDiscipline.length - 2];
  const prevWin = Boolean((prevRow?.log as any)?.behavioral?.strictWinningDay);
  const lastHardStreak = getLastEventDateByType(next, 'hard_streak');
  const lastComeback = getLastEventDateByType(next, 'comeback');
  const lastProof = getLastEventDateByType(next, 'proof_of_struggle');
  const lastDebtRecovered = getLastEventDateByType(next, 'debt_recovered');
  const lastLockMilestone = getLastEventDateByType(next, 'identity_lock_milestone');

  if (input.strictWinningDay && strictWinStreak >= 5 && (!lastHardStreak || daysBetween(lastHardStreak, input.date) >= 7)) {
    next.push({
      id: `memory_hard_streak_${input.date}`,
      type: 'hard_streak',
      date: input.date,
      title: `Hard streak: ${strictWinStreak} days`,
      detail: 'You stacked strict winning days with verified effort.',
      evidence: `${strictWinStreak} strict winning days`,
    });
  }

  if (input.strictWinningDay && !prevWin && (!lastComeback || daysBetween(lastComeback, input.date) >= 3)) {
    next.push({
      id: `memory_comeback_${input.date}`,
      type: 'comeback',
      date: input.date,
      title: 'Comeback day',
      detail: 'You returned after a miss and reset momentum.',
      evidence: `Winning reason: ${input.winningReason}`,
    });
  }

  const recentWinRate =
    recent.length > 0
      ? recent.filter((row) => Boolean((row.log as any)?.behavioral?.strictWinningDay)).length / recent.length
      : 0;
  const recentIntensity = recent
    .flatMap((row) => (Array.isArray(row.log.workouts) ? row.log.workouts : []))
    .reduce((sum, workout: any) => sum + Math.max(0, asFinite(workout?.effortScore)), 0);
  const recentCount = recent.flatMap((row) => (Array.isArray(row.log.workouts) ? row.log.workouts : [])).length;
  const avgIntensity = recentCount > 0 ? recentIntensity / recentCount : 0;
  const workoutMinutesLast7 = input.logsForDiscipline
    .slice(-7)
    .reduce((sum, row) => sum + (Array.isArray(row.log.workouts) ? row.log.workouts.reduce((s: number, w: any) => s + (asFinite(w?.durationMin) || asFinite(w?.minutes)), 0) : 0), 0);
  const workoutMinutesPrev7 = input.logsForDiscipline
    .slice(-14, -7)
    .reduce((sum, row) => sum + (Array.isArray(row.log.workouts) ? row.log.workouts.reduce((s: number, w: any) => s + (asFinite(w?.durationMin) || asFinite(w?.minutes)), 0) : 0), 0);

  if (
    recentWinRate >= 0.7 &&
    avgIntensity >= 40 &&
    workoutMinutesLast7 <= workoutMinutesPrev7 * 1.02 &&
    (!lastProof || daysBetween(lastProof, input.date) >= 21)
  ) {
    next.push({
      id: `memory_proof_${input.date}`,
      type: 'proof_of_struggle',
      date: input.date,
      title: 'Proof of struggle',
      detail: 'Effort stayed high even while outcomes plateaued.',
      evidence: `Win rate ${(recentWinRate * 100).toFixed(0)}%, avg intensity ${avgIntensity.toFixed(1)}`,
    });
  }

  if (input.debtBefore > 0 && input.debtAfter <= 0 && (!lastDebtRecovered || daysBetween(lastDebtRecovered, input.date) >= 7)) {
    next.push({
      id: `memory_debt_zero_${input.date}`,
      type: 'debt_recovered',
      date: input.date,
      title: 'Debt cleared',
      detail: 'You paid down effort debt through verified sessions.',
      evidence: `Debt ${input.debtBefore.toFixed(2)} -> ${input.debtAfter.toFixed(2)}`,
    });
  }

  if (input.modes.identityLockEnabled && input.strictWinningDay && strictWinStreak >= 7 && (!lastLockMilestone || daysBetween(lastLockMilestone, input.date) >= 14)) {
    next.push({
      id: `memory_lock_${input.date}`,
      type: 'identity_lock_milestone',
      date: input.date,
      title: 'Identity lock milestone',
      detail: 'You held strict standards while lock-in was active.',
      evidence: `${strictWinStreak} strict days during lock-in`,
    });
  }

  return next.slice(-120);
}

export async function setBehaviorModes(patch: Partial<BehavioralModes>): Promise<BehavioralState> {
  const profile = await getUserProfile();
  const current = normalizeBehaviorState(profile);
  const requestedNoExcuses = patch.noExcusesEnabled === true;
  const noExcusesAllowed = current.currencyUnlocks.noExcusesMode;
  const nextInjuryMode = patch.injuryModeEnabled ?? current.modes.injuryModeEnabled;
  const nextIllnessMode = patch.illnessModeEnabled ?? current.modes.illnessModeEnabled;
  const capacityOverride = nextInjuryMode || nextIllnessMode;
  const next: BehavioralState = {
    ...current,
    modes: {
      ...current.modes,
      ...patch,
      noExcusesEnabled: capacityOverride
        ? false
        : requestedNoExcuses && !noExcusesAllowed
        ? false
        : patch.noExcusesEnabled ?? current.modes.noExcusesEnabled,
    },
  };

  await setStorageItem(USER_PROFILE_KEY, {
    ...profile,
    behaviorState: next,
  });
  return next;
}

export async function getBehaviorState(): Promise<BehavioralState> {
  const profile = await getUserProfile();
  return normalizeBehaviorState(profile);
}

export async function getIdentityLockEligibility(date = todayKey()): Promise<{
  eligible: boolean;
  reason: string;
  strictWinsLast14: number;
  effortDebt: number;
  disciplineScore: number;
}> {
  const [profile, behavior] = await Promise.all([getUserProfile(), getBehaviorState()]);
  const dates = buildDateRange(date, 14);
  const logsByDate = await getDailyLogsByDates(dates);
  const strictWinsLast14 = dates.reduce((sum, key) => sum + (((logsByDate[key] as any)?.behavioral?.strictWinningDay ? 1 : 0) as number), 0);

  if (strictWinsLast14 < 9) {
    return {
      eligible: false,
      reason: 'Need at least 9 strict winning days in the last 14 days.',
      strictWinsLast14,
      effortDebt: behavior.effortDebt,
      disciplineScore: behavior.disciplineScore,
    };
  }
  if (behavior.effortDebt > 2) {
    return {
      eligible: false,
      reason: 'Reduce effort debt below 2 before lock-in.',
      strictWinsLast14,
      effortDebt: behavior.effortDebt,
      disciplineScore: behavior.disciplineScore,
    };
  }
  if (behavior.disciplineScore < 55) {
    return {
      eligible: false,
      reason: 'Raise discipline score to 55+ before lock-in.',
      strictWinsLast14,
      effortDebt: behavior.effortDebt,
      disciplineScore: behavior.disciplineScore,
    };
  }
  return {
    eligible: true,
    reason: 'Eligible for identity lock-in.',
    strictWinsLast14,
    effortDebt: behavior.effortDebt,
    disciplineScore: behavior.disciplineScore,
  };
}

export async function getBehaviorMultipliers(date = todayKey()): Promise<{
  xpEfficiency: number;
  rankEfficiency: number;
  active: boolean;
  reason: string | null;
}> {
  const [profile, log] = await Promise.all([getUserProfile(), getDailyLog(date)]);
  const behavior = normalizeBehaviorState(profile);
  const fromLog = (log as any)?.behavioral || {};
  const xpEfficiencyLog = asFinite(fromLog.xpEfficiency);
  const rankEfficiencyLog = asFinite(fromLog.rankEfficiency);
  const activeLog = typeof fromLog.silentAccountabilityActive === 'boolean' ? fromLog.silentAccountabilityActive : null;
  if (xpEfficiencyLog > 0 && rankEfficiencyLog > 0 && activeLog !== null) {
    return {
      xpEfficiency: clamp(xpEfficiencyLog, 0.5, 1),
      rankEfficiency: clamp(rankEfficiencyLog, 0.5, 1),
      active: activeLog,
      reason: typeof fromLog.silentReason === 'string' ? fromLog.silentReason : null,
    };
  }
  const computed = computeSilentAccountability({
    effortDebt: behavior.effortDebt,
    disciplineScore: behavior.disciplineScore,
  });
  return {
    xpEfficiency: computed.xpEfficiency,
    rankEfficiency: computed.rankEfficiency,
    active: computed.active,
    reason: computed.reason,
  };
}

export async function settleBehaviorDay(date = todayKey()): Promise<DaySettlementResult> {
  const [profile, log] = await Promise.all([getUserProfile(), getDailyLog(date)]);
  let behavior = normalizeBehaviorState(profile);
  const behavioralToday = ((log as any)?.behavioral || {}) as Record<string, unknown>;
  const inputHash = buildSettlementInputHash(date, log, behavior.modes);
  const alreadySettled =
    behavioralToday.settlementVersion === SETTLEMENT_VERSION &&
    behavioralToday.settlementInputHash === inputHash &&
    typeof behavioralToday.dayLockedAt === 'string';

  if (alreadySettled) {
    return {
      date,
      strictWinningDay: Boolean(behavioralToday.strictWinningDay),
      winningReason: (behavioralToday.winningReason as any) || 'none',
      adaptiveMinimums: {
        trainingMinDuration: Math.max(ABSOLUTE_TRAINING_FLOOR, Math.round(asFinite(behavioralToday.adaptiveMinimumTrainingMin) || ABSOLUTE_TRAINING_FLOOR)),
        recoveryMinDuration: Math.max(ABSOLUTE_RECOVERY_FLOOR, Math.round(asFinite(behavioralToday.adaptiveMinimumRecoveryMin) || ABSOLUTE_RECOVERY_FLOOR)),
        recoveryWeeklyCap: Math.max(0, Math.round(asFinite(behavioralToday.adaptiveRecoveryWeeklyCap) || 0)),
        intensityMinimum: INTENSITY_MINIMUM_DEFAULT,
        recoveryIntensityCeiling: RECOVERY_MAX_METS,
      },
      debtAccrued: Number(asFinite(behavioralToday.debtAccrued).toFixed(2)),
      debtPaid: Number(asFinite(behavioralToday.debtPaid).toFixed(2)),
      effortDebt: Number(asFinite(behavioralToday.effortDebt).toFixed(2)),
      disciplineScore: Math.round(asFinite(behavioralToday.disciplineScore) || behavior.disciplineScore),
      xpEfficiency: clamp(asFinite(behavioralToday.xpEfficiency) || 1, 0.5, 1),
      rankEfficiency: clamp(asFinite(behavioralToday.rankEfficiency) || 1, 0.5, 1),
      silentAccountabilityActive: behavioralToday.silentAccountabilityActive === true,
      silentReason: typeof behavioralToday.silentReason === 'string' ? behavioralToday.silentReason : null,
      currencyAwarded: Number(asFinite(behavioralToday.currencyAwarded).toFixed(2)),
      currencyBalance: Number(asFinite(behavioralToday.currencyBalance).toFixed(2)),
    };
  }

  const priorSnapshot = readSettlementSnapshot(log);
  if (priorSnapshot) {
    behavior = rollbackToSnapshot(behavior, priorSnapshot);
  }

  const recentDates = buildDateRange(date, 30);
  const logsByDate = await getDailyLogsByDates(recentDates);

  const recentLogs14 = recentDates.slice(-14).map((key) => logsByDate[key] || {});
  const rawMinimums = computeAdaptiveMinimums({
    recentLogs: recentLogs14,
    modes: behavior.modes,
  });
  const recentWinRate = countWinningRate(recentLogs14);
  const smoothed = smoothAdaptiveMinimums(date, rawMinimums, logsByDate);
  const minimums = smoothed.minimums;
  const adaptiveReason = buildAdaptiveMinimumReason({
    modes: behavior.modes,
    minimums,
    previousTraining: smoothed.previousTraining,
    previousRecovery: smoothed.previousRecovery,
    recentWinRate,
  });

  const weekKey = mondayOfWeek(date);
  const weeklyRecoveryWinsSoFar = recentDates
    .filter((key) => key >= weekKey && key <= date)
    .reduce((sum, key) => {
      const row = logsByDate[key] || {};
      const strict = (row as any)?.behavioral;
      return sum + (strict?.winningReason === 'authoritative_recovery' ? 1 : 0);
    }, 0);

  const strictEval = evaluateStrictWinningDay({
    date,
    log,
    minimums,
    modes: behavior.modes,
    weeklyRecoveryWinsSoFar,
    maxHeartRate: resolveMaxHeartRate(profile),
  });

  const sessionRows = strictEval.sessionRows.map((row) => ({
    authoritative: row.authority.authoritative,
    recovery: row.recovery,
    intensity: row.intensity,
    durationMin: row.durationMin,
  }));

  let debtEntries = ageDebtEntries(behavior.debtEntries);
  let consecutiveMisses = behavior.consecutiveMisses;
  let debtAccrued = 0;
  let debtPaid = 0;

  const paydown = computeDebtPaydown({
    sessionRows,
    minimums,
    lowEffortRepaymentStreak: behavior.lowEffortRepaymentStreak,
  });

  if (strictEval.strictWinningDay) {
    debtPaid = paydown.paydown;
    debtEntries = repayDebt(debtEntries, debtPaid);
    consecutiveMisses = 0;
  } else {
    const debtCause: DebtCause = behavior.modes.injuryModeEnabled || behavior.modes.illnessModeEnabled ? 'capacity_limited' : 'avoidance';
    debtAccrued = computeDebtAccrual(behavior.modes, consecutiveMisses);
    debtEntries.push({
      id: `debt_${date}_${debtEntries.length + 1}`,
      date,
      amount: debtAccrued,
      ageDays: 0,
      cause: debtCause,
    });
    consecutiveMisses += 1;
  }

  const effortDebtBefore = behavior.effortDebt;
  const effortDebt = Number(debtEntries.reduce((sum, row) => sum + row.amount, 0).toFixed(2));

  const nextBehavior: BehavioralState = {
    ...behavior,
    effortDebt,
    debtEntries,
    consecutiveMisses,
    lowEffortRepaymentStreak: paydown.lowEffortRepaymentStreak,
    lastSettledDay: date,
  };

  const logsWithToday = recentDates.map((key) => ({ date: key, log: key === date ? log : logsByDate[key] || {} }));
  const syntheticTodayLog: DailyLog = {
    ...log,
    behavioral: {
      ...(log as any).behavioral,
      strictWinningDay: strictEval.strictWinningDay,
      winningReason: strictEval.winningReason,
    } as any,
  };
  const logsForDiscipline = logsWithToday.map((row) => (row.date === date ? { date: row.date, log: syntheticTodayLog } : row));
  const disciplineScore = calculateDisciplineScore30Day(logsForDiscipline);
  nextBehavior.disciplineScore = disciplineScore;
  const currencyAwarded = computeCurrencyAward({
    strictWinningDay: strictEval.strictWinningDay,
    disciplineScore,
  });
  nextBehavior.currencyBalance = Number((nextBehavior.currencyBalance + currencyAwarded).toFixed(2));
  nextBehavior.currencyLifetimeEarned = Number((nextBehavior.currencyLifetimeEarned + currencyAwarded).toFixed(2));
  nextBehavior.memoryEvents = maybeCreateMemoryEvents({
    date,
    strictWinningDay: strictEval.strictWinningDay,
    winningReason: strictEval.winningReason,
    logsForDiscipline,
    memoryEvents: behavior.memoryEvents,
    debtBefore: effortDebtBefore,
    debtAfter: effortDebt,
    modes: behavior.modes,
  });
  const accountability = computeSilentAccountability({
    effortDebt,
    disciplineScore,
  });
  const settlementSnapshot = {
    effortDebt: behavior.effortDebt,
    debtEntries: behavior.debtEntries,
    consecutiveMisses: behavior.consecutiveMisses,
    lowEffortRepaymentStreak: behavior.lowEffortRepaymentStreak,
    disciplineScore: behavior.disciplineScore,
    memoryEvents: behavior.memoryEvents,
    currencyBalance: behavior.currencyBalance,
    currencyLifetimeEarned: behavior.currencyLifetimeEarned,
    lastSettledDay: behavior.lastSettledDay,
  };

  await setStorageItem(USER_PROFILE_KEY, {
    ...profile,
    behaviorState: nextBehavior,
  });

  const strictWorkouts = strictEval.sessionRows.map((row) => ({
    ...(row.workout as any),
    authoritative: row.authority.authoritative,
    authoritativeReason: row.authority.reason,
  }));

  await saveDailyLog(date, {
    ...log,
    workouts: strictWorkouts,
    behavioral: {
      ...((log as any).behavioral || {}),
      strictWinningDay: strictEval.strictWinningDay,
      winningReason: strictEval.winningReason,
      adaptiveMinimumTrainingMin: minimums.trainingMinDuration,
      adaptiveMinimumRecoveryMin: minimums.recoveryMinDuration,
      adaptiveRecoveryWeeklyCap: minimums.recoveryWeeklyCap,
      adaptiveMinimumTrainingPrev: smoothed.previousTraining,
      adaptiveMinimumRecoveryPrev: smoothed.previousRecovery,
      adaptiveMinimumReason: adaptiveReason,
      debtAccrued,
      debtPaid,
      effortDebt,
      disciplineScore,
      xpEfficiency: accountability.xpEfficiency,
      rankEfficiency: accountability.rankEfficiency,
      silentAccountabilityActive: accountability.active,
      silentReason: accountability.reason || undefined,
      currencyAwarded,
      currencyBalance: nextBehavior.currencyBalance,
      ruleVersion: 'winning_day_v2',
      settlementSource: 'behavioral_core',
      settlementVersion: SETTLEMENT_VERSION,
      settlementInputHash: inputHash,
      settlementSnapshot,
      dayLockedAt: new Date().toISOString(),
    },
  } as any);

  return {
    date,
    strictWinningDay: strictEval.strictWinningDay,
    winningReason: strictEval.winningReason,
    adaptiveMinimums: minimums,
    debtAccrued,
    debtPaid,
    effortDebt,
    disciplineScore,
    xpEfficiency: accountability.xpEfficiency,
    rankEfficiency: accountability.rankEfficiency,
    silentAccountabilityActive: accountability.active,
    silentReason: accountability.reason,
    currencyAwarded,
    currencyBalance: nextBehavior.currencyBalance,
  };
}
