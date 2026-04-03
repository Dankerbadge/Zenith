export type MacroCaloriesCheck = {
  estimatedCalories: number;
  loggedCalories: number;
  delta: number;
  deltaPercent: number;
  hasMeaningfulData: boolean;
  severity: 'ok' | 'moderate' | 'high';
};

function round(n: number): number {
  return Math.round(Number.isFinite(n) ? n : 0);
}

export function estimatedCaloriesFromMacros(input: { protein: number; carbs: number; fat: number }): number {
  const protein = Math.max(0, Number(input.protein) || 0);
  const carbs = Math.max(0, Number(input.carbs) || 0);
  const fat = Math.max(0, Number(input.fat) || 0);
  return round(protein * 4 + carbs * 4 + fat * 9);
}

export function checkMacroCalories(input: {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}): MacroCaloriesCheck {
  const loggedCalories = Math.max(0, round(input.calories));
  const estimatedCalories = estimatedCaloriesFromMacros(input);
  const delta = round(loggedCalories - estimatedCalories);
  const base = Math.max(estimatedCalories, loggedCalories, 1);
  const deltaPercent = Math.abs(delta) / base;
  const hasMeaningfulData = loggedCalories > 0 || estimatedCalories > 0;

  let severity: MacroCaloriesCheck['severity'] = 'ok';
  if (deltaPercent >= 0.35) severity = 'high';
  else if (deltaPercent >= 0.2) severity = 'moderate';

  return {
    estimatedCalories,
    loggedCalories,
    delta,
    deltaPercent,
    hasMeaningfulData,
    severity,
  };
}

export function normalizeCaloriesFromMacros(input: {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  qualityTier?: 'VERIFIED' | 'HIGH' | 'MEDIUM' | 'LOW' | 'USER';
}): { calories: number; source: 'logged' | 'macro_estimated' } {
  const check = checkMacroCalories(input);
  if (!check.hasMeaningfulData) return { calories: 0, source: 'logged' };
  if (check.loggedCalories <= 0 && check.estimatedCalories > 0) {
    return { calories: check.estimatedCalories, source: 'macro_estimated' };
  }

  const quality = input.qualityTier || 'LOW';
  const canCorrect = quality === 'LOW' || quality === 'MEDIUM' || quality === 'USER';
  if (canCorrect && check.severity === 'high' && check.estimatedCalories > 0) {
    return { calories: check.estimatedCalories, source: 'macro_estimated' };
  }

  return { calories: check.loggedCalories, source: 'logged' };
}
