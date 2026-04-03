import type { UserProfile } from './storageUtils';

export type RecommendationGoal = 'GAIN_FAT' | 'GAIN_MUSCLE' | 'MAINTAIN' | 'LOSE_FAT';
export type RecommendationMode = 'LOSS' | 'GAIN' | 'RECOMP' | 'MAINTAIN';
export type RecommendationConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export type RecommendedTargets = {
  caloriesTargetKcal?: number;
  proteinTargetG?: number;
  waterTargetOz?: number;
  fatTargetG?: number;
  carbsTargetG?: number;
  meta: {
    bmrKcal?: number;
    tdeeKcal?: number;
    adjustmentKcal?: number;
    activityFactor?: number;
    method: 'MIFflin_ST_JEOR' | 'WEIGHT_ONLY_FALLBACK';
    confidence: RecommendationConfidence;
    warnings: string[];
    goalsResolved: {
      loseFat: boolean;
      gainMuscle: boolean;
      gainFat: boolean;
      maintain: boolean;
      conflict: boolean;
      mode: RecommendationMode;
    };
  };
};

type GoalResolution = RecommendedTargets['meta']['goalsResolved'];

const ML_PER_OZ = 29.5735;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function roundTo(n: number, step: number) {
  if (!Number.isFinite(n) || !Number.isFinite(step) || step <= 0) return n;
  return Math.round(n / step) * step;
}

function toNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function yearsFromBirthdate(birthdate?: string): number | undefined {
  if (!birthdate) return undefined;
  const dt = new Date(birthdate);
  if (!Number.isFinite(dt.getTime())) return undefined;
  const now = new Date();
  let years = now.getFullYear() - dt.getFullYear();
  const monthDelta = now.getMonth() - dt.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < dt.getDate())) years -= 1;
  return years > 0 ? years : undefined;
}

function normalizeSex(profile: UserProfile): 'male' | 'female' | 'unknown' {
  const next = String(profile.sexAtBirth || profile.sex || 'unknown').toLowerCase();
  if (next === 'male') return 'male';
  if (next === 'female') return 'female';
  return 'unknown';
}

function normalizeActivityLevel(profile: UserProfile): 'sedentary' | 'light' | 'moderate' | 'very' | 'extra' {
  const raw = String(profile.activityLevel || '').toLowerCase();
  if (raw === 'sedentary') return 'sedentary';
  if (raw === 'light') return 'light';
  if (raw === 'moderate') return 'moderate';
  if (raw === 'very' || raw === 'active') return 'very';
  if (raw === 'extra' || raw === 'very_active') return 'extra';
  return 'moderate';
}

function getActivityFactor(level: ReturnType<typeof normalizeActivityLevel>) {
  switch (level) {
    case 'sedentary':
      return 1.2;
    case 'light':
      return 1.375;
    case 'moderate':
      return 1.55;
    case 'very':
      return 1.725;
    case 'extra':
      return 1.9;
    default:
      return 1.55;
  }
}

function normalizeGoals(profile: UserProfile): RecommendationGoal[] {
  const source = Array.isArray(profile.onboardingGoals) ? profile.onboardingGoals : [];
  const normalized = source
    .map((goal) => String(goal).toUpperCase())
    .map((goal) => {
      if (goal === 'CUT') return 'LOSE_FAT';
      if (goal === 'BULK') return 'GAIN_MUSCLE';
      return goal;
    })
    .filter((goal) => goal === 'GAIN_FAT' || goal === 'GAIN_MUSCLE' || goal === 'MAINTAIN' || goal === 'LOSE_FAT') as RecommendationGoal[];

  if (normalized.length > 0) return Array.from(new Set(normalized));

  const legacyGoal = String(profile.goal || '').toLowerCase();
  if (legacyGoal === 'cut') return ['LOSE_FAT'];
  if (legacyGoal === 'gain_fat') return ['GAIN_FAT'];
  if (legacyGoal === 'gain_muscle' || legacyGoal === 'bulk') return ['GAIN_MUSCLE'];
  if (legacyGoal === 'maintain') return ['MAINTAIN'];
  return ['MAINTAIN'];
}

function resolveGoals(goals: RecommendationGoal[]): GoalResolution {
  const selected = goals.length ? goals : ['MAINTAIN'];
  const loseFat = selected.includes('LOSE_FAT');
  const gainMuscle = selected.includes('GAIN_MUSCLE');
  const gainFat = selected.includes('GAIN_FAT');
  const maintain = selected.includes('MAINTAIN');
  const conflict = loseFat && gainFat;

  let mode: RecommendationMode = 'MAINTAIN';
  if (conflict) {
    mode = 'MAINTAIN';
  } else if (loseFat && gainMuscle) {
    mode = 'RECOMP';
  } else if (loseFat) {
    mode = 'LOSS';
  } else if (gainFat || gainMuscle) {
    mode = 'GAIN';
  } else {
    mode = 'MAINTAIN';
  }

  return { loseFat, gainMuscle, gainFat, maintain, conflict, mode };
}

function ensureMetric(profile: UserProfile): { heightCm?: number; weightKg?: number } {
  const explicitHeight = toNumber(profile.heightCm);
  const explicitWeight = toNumber(profile.weightKg);
  if (explicitHeight && explicitWeight) {
    return { heightCm: explicitHeight, weightKg: explicitWeight };
  }

  const legacyHeightIn = toNumber(profile.height);
  const legacyWeightLb = toNumber(profile.currentWeight || profile.startWeight);
  return {
    heightCm: explicitHeight || (legacyHeightIn ? legacyHeightIn * 2.54 : undefined),
    weightKg: explicitWeight || (legacyWeightLb ? legacyWeightLb * 0.45359237 : undefined),
  };
}

export function hasScienceProfileInputs(profile: UserProfile) {
  const metrics = ensureMetric(profile);
  const activityLevel = String(profile.activityLevel || '').trim();
  const goals = normalizeGoals(profile);
  return Boolean(metrics.heightCm && metrics.weightKg && activityLevel && goals.length > 0);
}

export function computeRecommendedTargets(profile: UserProfile): RecommendedTargets {
  const warnings: string[] = [];
  const goalsResolved = resolveGoals(normalizeGoals(profile));
  const sex = normalizeSex(profile);
  const activityLevel = normalizeActivityLevel(profile);
  const activityFactor = getActivityFactor(activityLevel);
  const metrics = ensureMetric(profile);
  const weightKg = metrics.weightKg;
  const heightCm = metrics.heightCm;

  if (!weightKg || !heightCm) {
    return {
      meta: {
        method: 'WEIGHT_ONLY_FALLBACK',
        confidence: 'LOW',
        warnings: ['Missing profile height/weight; cannot compute targets'],
        goalsResolved,
      },
    };
  }

  const ageFromBirthdate = yearsFromBirthdate(profile.birthdate);
  const fallbackAge = toNumber(profile.age);
  const age = ageFromBirthdate || (fallbackAge && fallbackAge > 0 ? fallbackAge : undefined);

  let method: RecommendedTargets['meta']['method'] = 'MIFflin_ST_JEOR';
  let confidence: RecommendationConfidence = 'HIGH';

  let bmrKcal: number;
  if (!age) {
    method = 'WEIGHT_ONLY_FALLBACK';
    confidence = 'MEDIUM';
    bmrKcal = 22 * weightKg;
    warnings.push('Age missing; used weight-only BMR approximation');
  } else {
    const sexConstant = sex === 'male' ? 5 : sex === 'female' ? -161 : -78;
    bmrKcal = 10 * weightKg + 6.25 * heightCm - 5 * age + sexConstant;
    if (sex === 'unknown') {
      confidence = 'MEDIUM';
      warnings.push('Sex not set; used neutral BMR constant');
    }
  }

  let tdeeKcal = bmrKcal * activityFactor;
  let adjustmentKcal = 0;

  switch (goalsResolved.mode) {
    case 'LOSS': {
      const deficit = clamp(0.18 * tdeeKcal, 300, 750);
      adjustmentKcal = -deficit;
      break;
    }
    case 'RECOMP': {
      const deficit = clamp(0.10 * tdeeKcal, 150, 500);
      adjustmentKcal = -deficit;
      break;
    }
    case 'GAIN': {
      if (goalsResolved.gainFat && goalsResolved.gainMuscle) {
        adjustmentKcal = clamp(0.15 * tdeeKcal, 250, 600);
      } else if (goalsResolved.gainFat) {
        adjustmentKcal = clamp(0.20 * tdeeKcal, 300, 700);
      } else if (goalsResolved.gainMuscle) {
        adjustmentKcal = clamp(0.10 * tdeeKcal, 150, 400);
      } else {
        adjustmentKcal = 0;
      }
      break;
    }
    case 'MAINTAIN':
    default:
      adjustmentKcal = 0;
      break;
  }

  if (goalsResolved.conflict) {
    warnings.push('Conflicting goals (lose fat + gain fat). Defaulting to maintenance calories.');
  }

  let caloriesTarget = tdeeKcal + adjustmentKcal;
  const sexFloor = sex === 'female' ? 1200 : sex === 'male' ? 1500 : 1350;
  caloriesTarget = Math.max(caloriesTarget, sexFloor, bmrKcal * 1.05);
  caloriesTarget = Math.min(caloriesTarget, tdeeKcal + 1000);

  let proteinMultiplier = 1.6;
  if (goalsResolved.mode === 'LOSS' || goalsResolved.mode === 'RECOMP') {
    proteinMultiplier = 2.2;
  } else if (goalsResolved.mode === 'GAIN' && goalsResolved.gainMuscle) {
    proteinMultiplier = 1.8;
  } else if (goalsResolved.mode === 'GAIN' && goalsResolved.gainFat) {
    proteinMultiplier = 1.6;
  }
  let proteinTarget = weightKg * proteinMultiplier;
  proteinTarget = clamp(proteinTarget, weightKg * 1.2, weightKg * 3.0);
  proteinTarget = clamp(proteinTarget, 70, 250);

  const activityWaterMl =
    activityLevel === 'sedentary'
      ? 0
      : activityLevel === 'light'
      ? 250
      : activityLevel === 'moderate'
      ? 500
      : activityLevel === 'very'
      ? 750
      : 1000;
  const baselineMl = weightKg * 35;
  const totalMl = baselineMl + activityWaterMl;
  const rawOz = totalMl / ML_PER_OZ;
  const [waterMin, waterMax] =
    sex === 'male' ? [70, 140] : sex === 'female' ? [60, 120] : [60, 130];
  const waterTargetOz = clamp(rawOz, waterMin, waterMax);
  warnings.push('Water target is an estimate; needs vary with heat and exercise.');

  const fatMinG = Math.max(0.6 * weightKg, 40);
  const fatMaxG = (0.35 * caloriesTarget) / 9;
  const fatTargetG = clamp(fatMinG, fatMinG, Math.max(fatMinG, fatMaxG));
  const proteinKcal = proteinTarget * 4;
  const fatKcal = fatTargetG * 9;
  const remainingKcal = caloriesTarget - proteinKcal - fatKcal;
  const carbsTargetG = Math.max(0, remainingKcal / 4);

  return {
    caloriesTargetKcal: roundTo(caloriesTarget, 10),
    proteinTargetG: roundTo(proteinTarget, 5),
    waterTargetOz: roundTo(waterTargetOz, 5),
    fatTargetG: roundTo(fatTargetG, 5),
    carbsTargetG: roundTo(carbsTargetG, 5),
    meta: {
      bmrKcal: roundTo(bmrKcal, 1),
      tdeeKcal: roundTo(tdeeKcal, 1),
      adjustmentKcal: roundTo(adjustmentKcal, 1),
      activityFactor,
      method,
      confidence,
      warnings,
      goalsResolved,
    },
  };
}
