import { getUserProfile, setStorageItem, USER_PROFILE_KEY, type WorkoutEntry } from './storageUtils';
import { getLoadoutSlotLimitAsync } from './effortCurrencyService';

export type EffortEngineType = 'endurance' | 'strength' | 'mixed_intensity' | 'recovery' | 'low_intensity' | 'water';

export type WorkoutLoadout = {
  id: string;
  name: string;
  icon: string;
  engine: EffortEngineType;
  tags: string[];
  enabled: boolean;
  countsForWinningDay: boolean;
  xpWeight: number; // bounded by guardrails
  createdAt: string;
  updatedAt: string;
};

export type EffortComputationInput = {
  durationMin: number;
  activeCalories?: number;
  avgHeartRate?: number;
  peakHeartRate?: number;
  engine: EffortEngineType;
  intensity?: 'easy' | 'moderate' | 'hard';
  setCount?: number;
};

export type EffortComputationResult = {
  effortUnits: number; // DEU equivalent
  effortScore: number; // 0-100 normalized score
  intensityBand: 'low' | 'moderate' | 'high';
  confidence: 'low' | 'medium' | 'high';
};

const DEFAULT_XP_WEIGHT = 1;
const MIN_XP_WEIGHT = 0.75;
const MAX_XP_WEIGHT = 1.25;
const LOADOUTS_PREF_KEY = 'workoutLoadouts';

const DEFAULT_LOADOUTS: WorkoutLoadout[] = [
  {
    id: 'run',
    name: 'Run',
    icon: 'figure.run',
    engine: 'endurance',
    tags: ['running', 'outdoor'],
    enabled: true,
    countsForWinningDay: true,
    xpWeight: 1,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: 'lift',
    name: 'Lift',
    icon: 'dumbbell',
    engine: 'strength',
    tags: ['lifting', 'gym'],
    enabled: true,
    countsForWinningDay: true,
    xpWeight: 1,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: 'hiit',
    name: 'HIIT',
    icon: 'bolt.heart',
    engine: 'mixed_intensity',
    tags: ['intervals'],
    enabled: true,
    countsForWinningDay: true,
    xpWeight: 1,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: 'mobility',
    name: 'Mobility',
    icon: 'figure.cooldown',
    engine: 'recovery',
    tags: ['recovery'],
    enabled: true,
    countsForWinningDay: true,
    xpWeight: 0.9,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: 'swim',
    name: 'Swim',
    icon: 'figure.pool.swim',
    engine: 'water',
    tags: ['pool', 'water'],
    enabled: true,
    countsForWinningDay: true,
    xpWeight: 1,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
];

function asFinite(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function clampXpWeight(value: number): number {
  return Number(clamp(asFinite(value), MIN_XP_WEIGHT, MAX_XP_WEIGHT).toFixed(2));
}

export function normalizeLoadout(input: Partial<WorkoutLoadout>): WorkoutLoadout {
  const now = new Date().toISOString();
  const name = String(input.name || 'Custom Workout').trim() || 'Custom Workout';
  const idBase = String(input.id || name.toLowerCase().replace(/[^a-z0-9]+/g, '-')).replace(/^-+|-+$/g, '') || `loadout-${Date.now()}`;
  const engine = isEngineType(input.engine) ? input.engine : 'mixed_intensity';

  return {
    id: idBase,
    name,
    icon: String(input.icon || 'bolt.heart'),
    engine,
    tags: Array.isArray(input.tags) ? input.tags.map((t) => String(t).toLowerCase()).slice(0, 6) : [],
    enabled: input.enabled !== false,
    countsForWinningDay: input.countsForWinningDay !== false,
    xpWeight: clampXpWeight(asFinite(input.xpWeight) || DEFAULT_XP_WEIGHT),
    createdAt: String(input.createdAt || now),
    updatedAt: now,
  };
}

export function isEngineType(value: unknown): value is EffortEngineType {
  return (
    value === 'endurance' ||
    value === 'strength' ||
    value === 'mixed_intensity' ||
    value === 'recovery' ||
    value === 'low_intensity' ||
    value === 'water'
  );
}

export function canonicalEngineType(engine: EffortEngineType): Exclude<EffortEngineType, 'low_intensity'> {
  return engine === 'low_intensity' ? 'recovery' : engine;
}

export function resolveEngineFromWorkout(workout: Partial<WorkoutEntry> & { type?: string; label?: string }): EffortEngineType {
  const explicitEngine = workout.engineType;
  if (isEngineType(explicitEngine)) return explicitEngine;

  const type = String(workout.type || '').toLowerCase();
  const label = String(workout.label || '').toLowerCase();

  if (type.includes('run') || label.includes('run') || label.includes('jog')) return 'endurance';
  if (type.includes('strength') || type.includes('lift') || label.includes('lift') || label.includes('strength')) return 'strength';
  if (type.includes('mobility') || type.includes('stretch') || label.includes('mobility') || label.includes('recovery')) return 'recovery';
  if (type.includes('swim') || label.includes('swim') || label.includes('pool')) return 'water';
  if (type.includes('cardio') || label.includes('hiit') || label.includes('sport')) return 'mixed_intensity';

  return 'mixed_intensity';
}

function intensityMultiplier(input?: string): number {
  const normalized = String(input || 'moderate').toLowerCase();
  if (normalized === 'easy') return 0.85;
  if (normalized === 'hard') return 1.2;
  return 1;
}

function engineMultiplier(engine: EffortEngineType): number {
  switch (canonicalEngineType(engine)) {
    case 'strength':
      return 1.05;
    case 'mixed_intensity':
      return 1.1;
    case 'endurance':
      return 1.0;
    case 'water':
      return 1.08;
    case 'recovery':
      return 0.8;
    default:
      return 1;
  }
}

function computeConfidence(input: EffortComputationInput): EffortComputationResult['confidence'] {
  const hasCalories = asFinite(input.activeCalories) > 0;
  const hasHeartRate = asFinite(input.avgHeartRate) > 0 || asFinite(input.peakHeartRate) > 0;
  const durationMin = asFinite(input.durationMin);

  if (durationMin >= 20 && hasCalories && hasHeartRate) return 'high';
  if (durationMin >= 10 && (hasCalories || hasHeartRate)) return 'medium';
  return 'low';
}

export function computeEffort(input: EffortComputationInput): EffortComputationResult {
  const durationMin = Math.max(0, asFinite(input.durationMin));
  const calories = Math.max(0, asFinite(input.activeCalories));
  const avgHeartRate = Math.max(0, asFinite(input.avgHeartRate));
  const setCount = Math.max(0, Math.round(asFinite(input.setCount)));

  const intensity = intensityMultiplier(input.intensity);
  const canonicalEngine = canonicalEngineType(input.engine);
  const engineWeight = engineMultiplier(canonicalEngine);

  const calorieUnits = calories * 0.12;
  const durationUnits = durationMin * 1.35;
  const hrUnits = avgHeartRate > 0 ? Math.max(0, (avgHeartRate - 90) * 0.12) : 0;
  const structureUnits = canonicalEngine === 'strength' ? setCount * 1.1 : 0;

  const effortUnitsRaw = (calorieUnits + durationUnits + hrUnits + structureUnits) * intensity * engineWeight;
  const effortUnits = Number(Math.max(0, effortUnitsRaw).toFixed(1));
  const effortScore = Math.round(clamp(effortUnits * 1.4, 0, 100));

  let intensityBand: EffortComputationResult['intensityBand'] = 'low';
  if (effortScore >= 70) intensityBand = 'high';
  else if (effortScore >= 35) intensityBand = 'moderate';

  return {
    effortUnits,
    effortScore,
    intensityBand,
    confidence: computeConfidence(input),
  };
}

export async function getWorkoutLoadouts(): Promise<WorkoutLoadout[]> {
  const profile = await getUserProfile();
  const prefs = (profile.preferences || {}) as Record<string, unknown>;
  const rawLoadouts = prefs[LOADOUTS_PREF_KEY];

  if (!Array.isArray(rawLoadouts) || rawLoadouts.length === 0) {
    return DEFAULT_LOADOUTS.map((loadout) => ({ ...loadout }));
  }

  const normalized = rawLoadouts
    .map((row) => normalizeLoadout((row || {}) as Partial<WorkoutLoadout>))
    .reduce<WorkoutLoadout[]>((acc, loadout) => {
      if (acc.some((existing) => existing.id === loadout.id)) return acc;
      acc.push(loadout);
      return acc;
    }, []);

  return normalized.length > 0 ? normalized : DEFAULT_LOADOUTS.map((loadout) => ({ ...loadout }));
}

export async function saveWorkoutLoadouts(loadouts: WorkoutLoadout[]): Promise<WorkoutLoadout[]> {
  const profile = await getUserProfile();
  const slotLimit = await getLoadoutSlotLimitAsync();
  const safeLoadouts = (Array.isArray(loadouts) ? loadouts : [])
    .map((entry) => normalizeLoadout(entry))
    .slice(0, Math.max(1, slotLimit));

  await setStorageItem(USER_PROFILE_KEY, {
    ...profile,
    preferences: {
      ...(profile.preferences || {}),
      [LOADOUTS_PREF_KEY]: safeLoadouts,
    },
  });

  return safeLoadouts;
}

export async function upsertWorkoutLoadout(partial: Partial<WorkoutLoadout>): Promise<WorkoutLoadout[]> {
  const current = await getWorkoutLoadouts();
  const slotLimit = await getLoadoutSlotLimitAsync();
  const next = normalizeLoadout(partial);
  const idx = current.findIndex((entry) => entry.id === next.id);
  if (idx >= 0) {
    current[idx] = { ...current[idx], ...next, updatedAt: new Date().toISOString() };
  } else {
    if (current.length >= Math.max(1, slotLimit)) return current;
    current.push(next);
  }
  return saveWorkoutLoadouts(current);
}

export async function setWorkoutLoadoutEnabled(id: string, enabled: boolean): Promise<WorkoutLoadout[]> {
  const current = await getWorkoutLoadouts();
  const next = current.map((entry) =>
    entry.id === id ? { ...entry, enabled, updatedAt: new Date().toISOString() } : entry
  );
  return saveWorkoutLoadouts(next);
}

export function getDefaultWorkoutLoadouts(): WorkoutLoadout[] {
  return DEFAULT_LOADOUTS.map((entry) => ({ ...entry }));
}

export async function getXpWeightForEngine(engine: EffortEngineType): Promise<number> {
  const loadouts = await getWorkoutLoadouts();
  const match = loadouts.find((row) => row.engine === engine && row.enabled);
  return clampXpWeight(match?.xpWeight ?? DEFAULT_XP_WEIGHT);
}
