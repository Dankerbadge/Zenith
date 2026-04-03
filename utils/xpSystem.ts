// Daily XP System with 50 XP Cap
// Prevents abuse and encourages consistent behavior over grinding

export const DAILY_XP_CAP = 50;
export const RUNNING_DAILY_XP_CAP = 35;

export interface DailyXPBreakdown {
  caloriesOnTarget: number; // +10 XP
  workoutLogged: number; // +15 XP base (MET-based)
  activeRest: number; // +8 XP
  waterGoalHit: number; // +5 XP
  winningDayBonus: number; // +5 XP
  total: number;
  capped: number;
  isAtCap: boolean;
}

/**
 * Calculate XP earned for a day
 * Returns breakdown and enforces 50 XP cap
 */
export function calculateDailyXP(activities: {
  caloriesOnTarget: boolean;
  workoutsLogged: number;
  workoutXP: number; // Already calculated from MET system
  activeRestLogged: boolean;
  waterGoalHit: boolean;
  isWinningDay: boolean;
}): DailyXPBreakdown {
  let breakdown: DailyXPBreakdown = {
    caloriesOnTarget: 0,
    workoutLogged: 0,
    activeRest: 0,
    waterGoalHit: 0,
    winningDayBonus: 0,
    total: 0,
    capped: 0,
    isAtCap: false
  };
  
  // Calories on target: +10 XP
  if (activities.caloriesOnTarget) {
    breakdown.caloriesOnTarget = 10;
  }
  
  // Workout logged: Use MET-based XP (already calculated)
  if (activities.workoutsLogged > 0) {
    breakdown.workoutLogged = activities.workoutXP;
  }
  
  // Active rest: +8 XP
  if (activities.activeRestLogged) {
    breakdown.activeRest = 8;
  }
  
  // Water goal: +5 XP
  if (activities.waterGoalHit) {
    breakdown.waterGoalHit = 5;
  }
  
  // Winning day bonus: +5 XP (only if it's a winning day)
  if (activities.isWinningDay) {
    breakdown.winningDayBonus = 5;
  }
  
  // Calculate total
  breakdown.total = 
    breakdown.caloriesOnTarget +
    breakdown.workoutLogged +
    breakdown.activeRest +
    breakdown.waterGoalHit +
    breakdown.winningDayBonus;
  
  // Apply cap
  breakdown.capped = Math.min(breakdown.total, DAILY_XP_CAP);
  breakdown.isAtCap = breakdown.total >= DAILY_XP_CAP;
  
  return breakdown;
}

/**
 * Check if user has hit daily XP cap
 */
export function hasHitDailyCap(currentDailyXP: number): boolean {
  return currentDailyXP >= DAILY_XP_CAP;
}

/**
 * Get remaining XP available today
 */
export function getRemainingDailyXP(currentDailyXP: number): number {
  return Math.max(0, DAILY_XP_CAP - currentDailyXP);
}

/**
 * Diminishing returns for multiple workouts same day
 * First workout: Full XP
 * Second workout: 33% XP
 * Third+ workout: 0 XP
 */
export function applyDiminishingReturns(
  workoutNumber: number,
  baseXP: number
): number {
  if (workoutNumber === 1) {
    return baseXP; // Full XP for first workout
  } else if (workoutNumber === 2) {
    return Math.floor(baseXP * 0.33); // 33% for second workout
  } else {
    return 0; // No XP for third+ workout
  }
}

/**
 * Calculate XP with all constraints applied
 */
export function calculateConstrainedXP(
  baseXP: number,
  workoutNumber: number,
  currentDailyXP: number
): {
  awarded: number;
  diminished: number;
  cappedAmount: number;
  message: string | null;
} {
  // Apply diminishing returns
  const diminishedXP = applyDiminishingReturns(workoutNumber, baseXP);
  
  // Check if we'd hit the cap
  const remainingXP = getRemainingDailyXP(currentDailyXP);
  const awardedXP = Math.min(diminishedXP, remainingXP);
  
  // Generate message
  let message: string | null = null;
  
  if (workoutNumber === 2) {
    message = '2nd workout today - earning 33% XP';
  } else if (workoutNumber >= 3) {
    message = 'Daily workout limit reached - focus on recovery!';
  } else if (awardedXP < diminishedXP) {
    message = `Daily XP cap reached! (${DAILY_XP_CAP} max)`;
  }
  
  return {
    awarded: awardedXP,
    diminished: diminishedXP - baseXP,
    cappedAmount: diminishedXP - awardedXP,
    message
  };
}

/**
 * Get XP summary for display
 */
export function getXPSummary(breakdown: DailyXPBreakdown): string {
  const parts: string[] = [];
  
  if (breakdown.caloriesOnTarget > 0) {
    parts.push(`Calories: +${breakdown.caloriesOnTarget}`);
  }
  if (breakdown.workoutLogged > 0) {
    parts.push(`Workout: +${breakdown.workoutLogged}`);
  }
  if (breakdown.activeRest > 0) {
    parts.push(`Active Rest: +${breakdown.activeRest}`);
  }
  if (breakdown.waterGoalHit > 0) {
    parts.push(`Water: +${breakdown.waterGoalHit}`);
  }
  if (breakdown.winningDayBonus > 0) {
    parts.push(`Winning Day: +${breakdown.winningDayBonus}`);
  }
  
  if (breakdown.isAtCap) {
    parts.push(`(Capped at ${DAILY_XP_CAP})`);
  }
  
  return parts.join(' • ');
}

/**
 * Predict XP for potential action
 */
export function predictXP(
  currentBreakdown: DailyXPBreakdown,
  action: 'calories' | 'workout' | 'activeRest' | 'water'
): number {
  const remainingXP = getRemainingDailyXP(currentBreakdown.capped);
  
  const actionXP = {
    calories: 10,
    workout: 15, // Base estimate
    activeRest: 8,
    water: 5
  };
  
  return Math.min(actionXP[action], remainingXP);
}

/**
 * Sublinear running XP curve to reward distance without making very long runs
 * dominate progression.
 */
export function calculateRunningDistanceXP(distanceMiles: number): number {
  if (!Number.isFinite(distanceMiles) || distanceMiles <= 0.05) return 0;
  const normalizedDistance = Math.max(0, distanceMiles);
  const raw = 2 + 14 * Math.sqrt(normalizedDistance);
  const rounded = Math.round(raw);
  return Math.max(3, rounded);
}

/**
 * Apply running-specific and daily global XP caps.
 */
export function calculateRunningXPAward(input: {
  distanceMiles: number;
  currentDailyXP: number;
  currentRunningXP: number;
}) {
  const baseXP = calculateRunningDistanceXP(input.distanceMiles);
  const runningRemaining = Math.max(0, RUNNING_DAILY_XP_CAP - Math.max(0, input.currentRunningXP || 0));
  const afterRunningCap = Math.min(baseXP, runningRemaining);
  const globalRemaining = getRemainingDailyXP(Math.max(0, input.currentDailyXP || 0));
  const awardedXP = Math.min(afterRunningCap, globalRemaining);

  return {
    baseXP,
    awardedXP,
    runningRemaining,
    globalRemaining,
    runningCapHit: awardedXP < baseXP && runningRemaining <= 0,
    dailyCapHit: awardedXP < baseXP && globalRemaining <= 0,
  };
}
