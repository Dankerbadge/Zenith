import { DailyLog, UserProfile } from "./storageUtils";

export type Intensity = "easy" | "moderate" | "hard";
export type WorkoutType = "strength" | "cardio" | "mobility";
export type ActiveRestType = "walk" | "mobility" | "stretch" | "recovery";
export type WeightSource = "dailyLog" | "profile" | "fallback";

const LB_PER_KG = 2.20462;
const DEFAULT_WEIGHT_KG = 80;

const INTENSITY_MULTIPLIER: Record<Intensity, number> = {
  easy: 0.8,
  moderate: 1,
  hard: 1.25,
};

const WORKOUT_BASE_MET: Record<WorkoutType, number> = {
  strength: 6,
  cardio: 7.5,
  mobility: 3,
};

const REST_BASE_MET: Record<ActiveRestType, number> = {
  walk: 3.3,
  mobility: 2.5,
  stretch: 2.3,
  recovery: 2.8,
};

export const INTENSITY_HELP: Record<Intensity, string> = {
  easy: "Light effort. Talk normally. RPE 3-4.",
  moderate: "Sustainable work. Short sentences. RPE 5-6.",
  hard: "High effort. Breathing heavy. RPE 7-9.",
};

type WeightResolution = {
  weightKg: number;
  source: WeightSource;
};

export function resolveWeightKg(log: DailyLog, profile: UserProfile): WeightResolution {
  const dayWeight = Number(log.weight);
  if (Number.isFinite(dayWeight) && dayWeight > 0) {
    return { weightKg: dayWeight / LB_PER_KG, source: "dailyLog" };
  }

  const profileWeight = Number(profile.currentWeight);
  if (Number.isFinite(profileWeight) && profileWeight > 0) {
    return { weightKg: profileWeight / LB_PER_KG, source: "profile" };
  }

  return { weightKg: DEFAULT_WEIGHT_KG, source: "fallback" };
}

function calculateCalories(met: number, weightKg: number, minutes: number): number {
  const durationHours = Math.max(0, minutes) / 60;
  return Math.max(0, Math.round(met * weightKg * durationHours));
}

export function calculateWorkoutCaloriesBurned(input: {
  type: WorkoutType;
  intensity?: Intensity;
  minutes: number;
  weightKg: number;
}) {
  const intensity = input.intensity ?? "moderate";
  const baseMet = WORKOUT_BASE_MET[input.type] ?? WORKOUT_BASE_MET.strength;
  const finalMet = baseMet * (INTENSITY_MULTIPLIER[intensity] ?? 1);
  return calculateCalories(finalMet, input.weightKg, input.minutes);
}

export function calculateActiveRestCaloriesBurned(input: {
  type: ActiveRestType;
  intensity?: Intensity;
  minutes: number;
  weightKg: number;
}) {
  const intensity = input.intensity ?? "moderate";
  const baseMet = REST_BASE_MET[input.type] ?? REST_BASE_MET.walk;
  const finalMet = baseMet * (INTENSITY_MULTIPLIER[intensity] ?? 1);
  return calculateCalories(finalMet, input.weightKg, input.minutes);
}
