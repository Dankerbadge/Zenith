import { computeRecommendedTargets } from './nutritionRecommendations';
import type { UserProfile } from './storageUtils';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function buildProfile(overrides: Partial<UserProfile>): UserProfile {
  return {
    heightCm: 180,
    weightKg: 80,
    sexAtBirth: 'male',
    birthdate: '1995-01-01',
    activityLevel: 'moderate',
    onboardingGoals: ['MAINTAIN'],
    ...overrides,
  };
}

export function runNutritionRecommendationsTests() {
  const maintain = computeRecommendedTargets(buildProfile({}));
  assert(Boolean(maintain.caloriesTargetKcal), 'maintain calories should exist');
  assert(maintain.proteinTargetG === 130, 'maintain protein should round to 130g for 80kg at 1.6g/kg');

  const loseFat = computeRecommendedTargets(
    buildProfile({
      heightCm: 165,
      weightKg: 70,
      sexAtBirth: 'female',
      birthdate: '1997-01-01',
      activityLevel: 'light',
      onboardingGoals: ['LOSE_FAT'],
    })
  );
  assert(Boolean(loseFat.caloriesTargetKcal), 'loss calories should exist');
  assert((loseFat.caloriesTargetKcal || 0) >= 1200, 'loss calories should respect female safety floor');
  assert(loseFat.proteinTargetG === 155, 'loss protein should round to 155g for 70kg at 2.2g/kg');

  const missingAge = computeRecommendedTargets(
    buildProfile({
      sexAtBirth: 'unknown',
      birthdate: undefined,
      age: undefined,
    })
  );
  assert(missingAge.meta.method === 'WEIGHT_ONLY_FALLBACK', 'missing age should use weight-only fallback');
  assert(missingAge.meta.confidence !== 'HIGH', 'missing age should reduce confidence');
  assert(missingAge.meta.warnings.some((w) => w.toLowerCase().includes('age missing')), 'missing age warning required');

  const conflict = computeRecommendedTargets(
    buildProfile({
      onboardingGoals: ['LOSE_FAT', 'GAIN_FAT'],
    })
  );
  assert(conflict.meta.goalsResolved.mode === 'MAINTAIN', 'conflicting goals should resolve to maintain');
  assert(
    conflict.meta.warnings.some((w) => w.toLowerCase().includes('conflicting goals')),
    'conflicting goal warning required'
  );

  const recomp = computeRecommendedTargets(
    buildProfile({
      onboardingGoals: ['LOSE_FAT', 'GAIN_MUSCLE'],
    })
  );
  assert(recomp.meta.goalsResolved.mode === 'RECOMP', 'recomp goal mode should be RECOMP');
  assert((recomp.proteinTargetG || 0) >= 175, 'recomp protein should use high multiplier');
}

