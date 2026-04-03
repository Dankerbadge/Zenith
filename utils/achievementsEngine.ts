import { calculateCurrentRank } from "../constants/ranks";
import { listCanonicalRuns } from "./canonicalRunService";
import { getCommunityLocalMetrics } from "./communityLocalMetrics";
import { getAllDailyLogs, getUserProfile } from "./storageUtils";
import { getWinningSnapshot } from "./winningSystem";
import { ACHIEVEMENTS_CATALOG, type AchievementDef, type Requirement, type RequirementWindow } from "./achievements.catalog";

type MetricValue = number | boolean;

export type AchievementMetrics = {
  lifetime: Record<string, MetricValue>;
  year: Record<string, MetricValue>;
  month: Record<string, MetricValue>;
  week: Record<string, MetricValue>;
  single_day: Record<string, number>;
  single_session: Record<string, number>;
};

const WINDOW_DAYS: Record<RequirementWindow, number> = {
  lifetime: 10_000,
  year: 365,
  month: 30,
  week: 7,
};

function clamp(n: number, low: number, high: number) {
  return Math.max(low, Math.min(high, n));
}

function utcDayToMs(day: string) {
  const [y, m, d] = String(day).split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return NaN;
  return Date.UTC(y, m - 1, d);
}

function daysAgoMs(days: number) {
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

function inWindow(dateKey: string, window: RequirementWindow) {
  if (window === "lifetime") return true;
  const ts = utcDayToMs(dateKey);
  if (!Number.isFinite(ts)) return false;
  const since = daysAgoMs(WINDOW_DAYS[window]);
  return ts >= since;
}

function maxConsecutiveDays(datesAscending: string[]) {
  let best = 0;
  let running = 0;
  let prev: string | null = null;
  for (const dateKey of datesAscending) {
    if (!prev) {
      running = 1;
      best = Math.max(best, running);
      prev = dateKey;
      continue;
    }
    const delta = utcDayToMs(dateKey) - utcDayToMs(prev);
    if (delta === 24 * 60 * 60 * 1000) {
      running += 1;
    } else {
      running = 1;
    }
    best = Math.max(best, running);
    prev = dateKey;
  }
  return { best, lastRunning: running };
}

function hasCalendarWeekPerfectWinningDays(history: Array<{ date: string; winningDay: boolean }>) {
  // Calendar week: Sunday->Saturday in the user's locale is tricky; we use ISO week (Mon-based) in UTC for deterministic behavior.
  const buckets = new Map<string, number>();
  history.forEach((row) => {
    if (!row.winningDay) return;
    const ts = utcDayToMs(row.date);
    if (!Number.isFinite(ts)) return;
    const d = new Date(ts);
    const year = d.getUTCFullYear();
    const jan1 = new Date(Date.UTC(year, 0, 1));
    const dayOfYear = Math.floor((ts - jan1.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    const week = Math.floor((dayOfYear - 1) / 7) + 1;
    const key = `${year}-W${String(week).padStart(2, "0")}`;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  });
  return Array.from(buckets.values()).some((count) => count >= 7);
}

function hasCalendarMonthPerfectWinningDays(history: Array<{ date: string; winningDay: boolean }>) {
  const buckets = new Map<string, number>();
  history.forEach((row) => {
    if (!row.winningDay) return;
    const ts = utcDayToMs(row.date);
    if (!Number.isFinite(ts)) return;
    const d = new Date(ts);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  });
  return Array.from(buckets.values()).some((count) => count >= 28);
}

function normalizeExerciseName(name: string) {
  return String(name || "").trim().toLowerCase();
}

function weightToLb(weight: number, unit: "lb" | "kg") {
  const w = Number(weight) || 0;
  if (unit === "kg") return w * 2.2046226218;
  return w;
}

function computeRunPrCount(runs: Array<{ startTimeUtc: string; distanceMeters: number; avgPaceSecPerMile: number | null }>) {
  // Deterministic PR counting: for each distance bracket, count times a new best pace is set.
  const brackets = [
    { key: "1mi", milesMin: 1.0 },
    { key: "5k", milesMin: 3.1069 },
    { key: "10k", milesMin: 6.2137 },
    { key: "half", milesMin: 13.1 },
    { key: "full", milesMin: 26.2 },
  ];
  const bestByBracket: Record<string, number> = {};
  let prCount = 0;

  const ordered = [...runs].sort((a, b) => (a.startTimeUtc < b.startTimeUtc ? -1 : 1));
  ordered.forEach((run) => {
    const miles = Math.max(0, Number(run.distanceMeters || 0) / 1609.344);
    const pace = Number(run.avgPaceSecPerMile || 0);
    if (!(pace > 0) || miles <= 0.1) return;
    brackets.forEach((b) => {
      if (miles < b.milesMin) return;
      const best = bestByBracket[b.key];
      if (best == null || pace < best) {
        bestByBracket[b.key] = pace;
        prCount += 1;
      }
    });
  });
  return prCount;
}

export async function computeAchievementMetrics(): Promise<AchievementMetrics> {
  const [allDailyLogs, winning, profile, runs, community] = await Promise.all([
    getAllDailyLogs(),
    getWinningSnapshot(),
    getUserProfile(),
    listCanonicalRuns(),
    getCommunityLocalMetrics(),
  ]);

  const proteinTarget = Number((profile as any)?.goals?.proteinTarget) || 0;
  const waterTargetOz = Number((profile as any)?.goals?.waterTargetOz) || 0;
  const calorieTarget = Number((profile as any)?.goals?.caloriesTarget) || 0;

  const metrics: AchievementMetrics = {
    lifetime: {},
    year: {},
    month: {},
    week: {},
    single_day: {},
    single_session: {},
  };

  const incCount = (metric: string, dateKey: string, amount = 1) => {
    metrics.lifetime[metric] = (Number(metrics.lifetime[metric]) || 0) + amount;
    (["year", "month", "week"] as const).forEach((w) => {
      if (inWindow(dateKey, w)) {
        (metrics[w][metric] as number | undefined) = (Number(metrics[w][metric]) || 0) + amount;
      }
    });
  };

  const incSum = (metric: string, dateKey: string, amount = 0) => {
    metrics.lifetime[metric] = (Number(metrics.lifetime[metric]) || 0) + amount;
    (["month", "week"] as const).forEach((w) => {
      if (inWindow(dateKey, w)) {
        (metrics[w][metric] as number | undefined) = (Number(metrics[w][metric]) || 0) + amount;
      }
    });
  };

  // Winning day stats
  metrics.lifetime.winning_days_total = winning.totalWinningDays;
  metrics.lifetime.winning_day_streak_current = winning.currentStreak;

  const history = Array.isArray(winning.history) ? winning.history : [];
  metrics.lifetime.perfect_week = hasCalendarWeekPerfectWinningDays(history);
  metrics.lifetime.perfect_month = hasCalendarMonthPerfectWinningDays(history);

  // Daily log derived stats
  let liftSessionsLifetime = 0;
  let hiitSessionsLifetime = 0;
  let mobilitySessionsLifetime = 0;
  let walkSessionsLifetime = 0;
  let walkMinutesLifetime = 0;
  let stepsLifetime = 0;
  let maxStepsDay = 0;
  let maxWaterOzDay = 0;

  let wholeFoodMealsLifetime = 0;
  let homeCookedMealsLifetime = 0;

  const workoutDaysInWeek = new Set<string>();
  const runDaysInWeek = new Set<string>();
  const liftDaysInWeek = new Set<string>();
  const hiitDaysInWeek = new Set<string>();
  const walkDaysInWeek = new Set<string>();
  const recoveryDays = new Set<string>();

  const foodLoggedDatesAscending: string[] = [];
  const hydrationTargetDatesAscending: string[] = [];
  const walkDatesAscending: string[] = [];
  const recoveryDatesAscending: string[] = [];

  let dailyXpMax = 0;

  const now = Date.now();

  allDailyLogs.forEach(({ date, log }) => {
    const dayTs = utcDayToMs(date);
    const inWeek = Number.isFinite(dayTs) ? dayTs >= now - 7 * 24 * 60 * 60 * 1000 : false;

    const workouts = Array.isArray((log as any)?.workouts) ? ((log as any).workouts as any[]) : [];
    if (workouts.length) {
      incCount("workouts_total", date, workouts.length);
      if (inWeek) workoutDaysInWeek.add(date);
      workouts.forEach((workout: any) => {
        const type = String(workout?.type || "");
        const intensity = String(workout?.intensity || "");
        const label = String(workout?.label || workout?.sourceLabel || "");
        const workoutClass = String(workout?.workoutClass || "");
        const engineType = String(workout?.engineType || "");
        const isLift = type === "strength" || workoutClass === "lift" || engineType === "strength";
        const isMobility = type === "mobility" || engineType === "recovery" || label.toLowerCase().includes("mobility");
        const isHiiT = workoutClass === "hiit" || engineType === "mixed_intensity" || (type === "cardio" && intensity === "hard") || label.toLowerCase().includes("hiit");

        if (isLift) {
          liftSessionsLifetime += 1;
          if (inWeek) liftDaysInWeek.add(date);
        }
        if (isMobility) {
          mobilitySessionsLifetime += 1;
          recoveryDays.add(date);
          recoveryDatesAscending.push(date);
          if (inWeek) {
            // no-op
          }
        }
        if (isHiiT) {
          hiitSessionsLifetime += 1;
          if (inWeek) hiitDaysInWeek.add(date);
        }
      });
    }

    const activeRest = Array.isArray((log as any)?.activeRest) ? ((log as any).activeRest as any[]) : [];
    if (activeRest.length) {
      activeRest.forEach((entry: any) => {
        const type = String(entry?.type || "");
        const minutes = Number(entry?.minutes) || 0;
        if (type === "walk" && minutes > 0) {
          walkSessionsLifetime += 1;
          walkMinutesLifetime += minutes;
          incCount("walk_sessions_total", date, 1);
          incSum("walk_minutes_total", date, minutes);
          walkDatesAscending.push(date);
          if (inWeek) walkDaysInWeek.add(date);
        }
        const isRecovery = type === "recovery" || type === "stretch" || type === "mobility";
        if (isRecovery && minutes > 0) {
          recoveryDays.add(date);
          recoveryDatesAscending.push(date);
        }
        if (type === "mobility" && minutes > 0) {
          mobilitySessionsLifetime += 1;
        }
      });
    }

    const waterOz = Number((log as any)?.water) || 0;
    if (waterOz > 0) {
      incCount("water_logged_days_total", date, 1);
      maxWaterOzDay = Math.max(maxWaterOzDay, waterOz);
    }
    if (waterTargetOz > 0 && waterOz >= waterTargetOz) {
      incCount("water_target_days_total", date, 1);
      hydrationTargetDatesAscending.push(date);
    }

    const calories = Number((log as any)?.calories) || 0;
    const foodEntries = Array.isArray((log as any)?.foodEntries) ? ((log as any).foodEntries as any[]) : [];
    if (calories > 0 || foodEntries.length > 0) {
      incCount("calories_logged_days_total", date, 1);
      foodLoggedDatesAscending.push(date);
    }
    if (proteinTarget > 0 && Number((log as any)?.macros?.protein) >= proteinTarget) incCount("protein_target_days_total", date, 1);
    if (calorieTarget > 0 && calories > 0) {
      // Treat as "on target" if within ±7% (approx), to avoid fake precision.
      const low = calorieTarget * 0.93;
      const high = calorieTarget * 1.07;
      if (calories >= low && calories <= high) incCount("calorie_target_days_total", date, 1);
    }
    if (foodEntries.some((e: any) => String(e?.meal || "") === "breakfast")) incCount("breakfast_logged_days_total", date, 1);

    // Whole-food and meal-prep approximations (trustworthy, not fake-precise):
    // - Whole-food meal: any zenith-common item logged that day.
    // - Home-cooked meal: any note contains "home" or "meal prep".
    const wholeFoodsForDay = foodEntries.filter((e: any) => String(e?.sourceId || "").startsWith("zenith-common:") || String(e?.label || "").toLowerCase().includes("generic"));
    if (wholeFoodsForDay.length) wholeFoodMealsLifetime += 1;
    const homeCookedForDay = foodEntries.filter((e: any) => String(e?.note || "").toLowerCase().includes("home") || String(e?.note || "").toLowerCase().includes("meal prep"));
    if (homeCookedForDay.length) homeCookedMealsLifetime += 1;

    const weight = Number((log as any)?.weight) || 0;
    if (weight > 0) incCount("weight_logged_days_total", date, 1);

    const sleepMin = Number((log as any)?.wearableSignals?.sleepMinutes) || 0;
    if (sleepMin > 0) incCount("sleep_logged_days_total", date, 1);
    if (sleepMin >= 480) incCount("sleep_8h_days_total", date, 1);

    const steps = Number((log as any)?.wearableSignals?.steps) || 0;
    if (steps > 0) {
      stepsLifetime += steps;
      maxStepsDay = Math.max(maxStepsDay, steps);
    }

    const xp = Number((log as any)?.dailyXP) || Number((log as any)?.xpEarned) || Number((log as any)?.behavioral?.currencyAwarded) || 0;
    dailyXpMax = Math.max(dailyXpMax, xp);
  });

  Array.from(recoveryDays).forEach((dateKey) => incCount("recovery_days_total", dateKey, 1));

  // Canonical runs
  const runSessionsLifetime = runs.length;
  const runMilesLifetime = runs.reduce((sum, run) => sum + Math.max(0, Number(run.distanceMeters || 0) / 1609.344), 0);
  const runDistanceMax = runs.reduce((max, run) => Math.max(max, Math.max(0, Number(run.distanceMeters || 0) / 1609.344)), 0);
  const prCount = computeRunPrCount(
    runs.map((r) => ({
      startTimeUtc: r.startTimeUtc,
      distanceMeters: Number(r.distanceMeters) || 0,
      avgPaceSecPerMile: r.avgPaceSecPerMile == null ? null : Number(r.avgPaceSecPerMile),
    }))
  );

  // Also count run days in week for "mix 4 types" signal.
  runs.forEach((run) => {
    const start = String(run.startTimeUtc || "");
    if (!start) return;
    const dateKey = start.split("T")[0];
    const ts = Date.parse(start);
    if (!Number.isFinite(ts)) return;
    if (ts >= Date.now() - 7 * 24 * 60 * 60 * 1000) runDaysInWeek.add(dateKey);
    incCount("run_sessions_total", dateKey, 1);
    const miles = Math.max(0, Number(run.distanceMeters || 0) / 1609.344);
    incSum("run_miles_total", dateKey, miles);
  });

  // Lift volume / sets / reps + milestones
  let setsTotal = 0;
  let repsTotal = 0;
  let liftVolumeTotal = 0;
  let bench225 = false;
  let squat315 = false;
  let deadlift405 = false;

  allDailyLogs.forEach(({ log }) => {
    const workouts = Array.isArray((log as any)?.workouts) ? ((log as any).workouts as any[]) : [];
    workouts.forEach((workout: any) => {
      const exercises = Array.isArray(workout?.exercises) ? workout.exercises : [];
      exercises.forEach((ex: any) => {
        const name = normalizeExerciseName(ex?.name || "");
        const sets = Array.isArray(ex?.sets) ? ex.sets : [];
        sets.forEach((set: any) => {
          const reps = Math.max(0, Number(set?.reps) || 0);
          const weight = Math.max(0, Number(set?.weight) || 0);
          const unit = (set?.weightUnit === "kg" ? "kg" : "lb") as "lb" | "kg";
          const lb = weightToLb(weight, unit);
          setsTotal += 1;
          repsTotal += reps;
          liftVolumeTotal += lb * reps;
          if (!bench225 && name.includes("bench") && lb >= 225) bench225 = true;
          if (!squat315 && name.includes("squat") && lb >= 315) squat315 = true;
          if (!deadlift405 && (name.includes("deadlift") || name.includes("dl")) && lb >= 405) deadlift405 = true;
        });
      });
    });
  });

  // Streak-style booleans
  const foodDates = Array.from(new Set(foodLoggedDatesAscending)).sort();
  const hydrationDates = Array.from(new Set(hydrationTargetDatesAscending)).sort();
  const walkDates = Array.from(new Set(walkDatesAscending)).sort();
  const recoveryDates = Array.from(new Set(recoveryDatesAscending)).sort();

  const foodStreak = maxConsecutiveDays(foodDates);
  const hydrationStreak = maxConsecutiveDays(hydrationDates);
  const walkStreak = maxConsecutiveDays(walkDates);
  const recoveryStreak = maxConsecutiveDays(recoveryDates);

  const mix4TypesWeek = runDaysInWeek.size > 0 && liftDaysInWeek.size > 0 && hiitDaysInWeek.size > 0 && walkDaysInWeek.size > 0;

  // Special "combo" day: protein + water + activity (walk or workout) in any day.
  const hasConsistencyCombo = allDailyLogs.some(({ log }) => {
    const protein = Number((log as any)?.macros?.protein) || 0;
    const water = Number((log as any)?.water) || 0;
    const hasProtein = proteinTarget > 0 && protein >= proteinTarget;
    const hasWater = waterTargetOz > 0 && water >= waterTargetOz;
    const hasActivity = (Array.isArray((log as any)?.workouts) && (log as any).workouts.length > 0) || (Array.isArray((log as any)?.activeRest) && (log as any).activeRest.some((e: any) => String(e?.type || "") === "walk" && Number(e?.minutes) > 0));
    return hasProtein && hasWater && hasActivity;
  });

  // Water 2× target in one day
  const water2xTargetDay = waterTargetOz > 0 && maxWaterOzDay >= waterTargetOz * 2;

  // No overtrain: last 14 days includes at least 2 recovery days.
  const recoveryDaysLast14 = Array.from(new Set(recoveryDates.filter((d) => {
    const ts = utcDayToMs(d);
    if (!Number.isFinite(ts)) return false;
    return ts >= Date.now() - 14 * 24 * 60 * 60 * 1000;
  }))).length;
  const noOvertrain14 = recoveryDaysLast14 >= 2;

  // Streak save / comeback are hard to detect deterministically without explicit events; keep false until formalized.
  metrics.lifetime.streak_save = false;
  metrics.lifetime.come_back_7 = false;
  metrics.lifetime.share_streak_7 = false;

  // Rank booleans
  const progressXp = (winning.totalWinningDays || 0) * 350;
  const currentRank = calculateCurrentRank(progressXp, winning.totalWinningDays || 0);
  const tier = String(currentRank.tier || "");
  metrics.lifetime.rank_diamond = tier === "Diamond" || tier === "Ascendant" || tier === "Paragon" || tier === "Zenith";
  metrics.lifetime.rank_zenith = tier === "Zenith";

  // Assign metrics
  metrics.lifetime.workouts_total = Number(metrics.lifetime.workouts_total) || 0;
  // Add runs into workout totals (workouts_total is inclusive).
  metrics.lifetime.workouts_total = (Number(metrics.lifetime.workouts_total) || 0) + runSessionsLifetime;
  metrics.year.workouts_total = (Number(metrics.year.workouts_total) || 0) + (Number(metrics.year.run_sessions_total) || 0);
  metrics.month.workouts_total = (Number(metrics.month.workouts_total) || 0) + (Number(metrics.month.run_sessions_total) || 0);
  metrics.week.workouts_total = (Number(metrics.week.workouts_total) || 0) + (Number(metrics.week.run_sessions_total) || 0);

  metrics.lifetime.lift_sessions_total = liftSessionsLifetime;
  metrics.lifetime.hiit_sessions_total = hiitSessionsLifetime;
  metrics.lifetime.walk_sessions_total = walkSessionsLifetime;
  metrics.lifetime.walk_minutes_total = walkMinutesLifetime;
  metrics.lifetime.steps_total = stepsLifetime;
  metrics.single_day.steps_day_max = maxStepsDay;
  metrics.single_day.water_oz_day_max = maxWaterOzDay;
  metrics.lifetime.mobility_sessions_total = mobilitySessionsLifetime;
  metrics.lifetime.run_miles_total = Number(runMilesLifetime.toFixed(2));
  metrics.single_session.run_distance_miles_max = Number(runDistanceMax.toFixed(2));
  metrics.lifetime.pr_count_total = prCount;
  metrics.lifetime.sets_total = setsTotal;
  metrics.lifetime.reps_total = repsTotal;
  metrics.lifetime.lift_volume_total = Math.round(liftVolumeTotal);
  metrics.lifetime.bench_225 = bench225;
  metrics.lifetime.squat_315 = squat315;
  metrics.lifetime.deadlift_405 = deadlift405;
  metrics.lifetime.nutrition_streak_30 = foodStreak.best >= 30;
  metrics.lifetime.hydration_streak_14 = hydrationStreak.best >= 14;
  metrics.lifetime.hydration_streak_30 = hydrationStreak.best >= 30;
  metrics.lifetime.walk_streak_7 = walkStreak.best >= 7;
  metrics.lifetime.walk_streak_30 = walkStreak.best >= 30;
  metrics.lifetime.recovery_streak_7 = recoveryStreak.best >= 7;
  metrics.lifetime.mix_4_types_week = mix4TypesWeek;
  metrics.single_day.daily_xp_day_max = dailyXpMax;
  metrics.lifetime.water_2x_target_day = water2xTargetDay;
  metrics.lifetime.no_overtrain_14 = noOvertrain14;
  metrics.lifetime.consistency_combo_day = hasConsistencyCombo;
  metrics.lifetime.whole_food_meals_total = wholeFoodMealsLifetime;
  metrics.lifetime.home_cooked_meals_total = homeCookedMealsLifetime;

  // Macro balance week: protein + calories hit at least 5 of last 7 days.
  const last7 = allDailyLogs.filter(({ date }) => inWindow(date, "week"));
  const daysHit = last7.reduce((sum, { log }) => {
    const protein = Number((log as any)?.macros?.protein) || 0;
    const calories = Number((log as any)?.calories) || 0;
    const hasProtein = proteinTarget > 0 && protein >= proteinTarget;
    const hasCalories = calorieTarget > 0 && calories >= calorieTarget * 0.93 && calories <= calorieTarget * 1.07;
    return sum + (hasProtein && hasCalories ? 1 : 0);
  }, 0);
  metrics.lifetime.macro_balance_week = daysHit >= 5;

  // Community
  metrics.lifetime.community_posts_total = community.postsTotal;
  metrics.lifetime.community_likes_total = community.likesGivenTotal;
  metrics.lifetime.community_comments_total = community.commentsTotal;
  metrics.lifetime.community_likes_received_total = community.likesReceivedTotal;
  metrics.lifetime.community_challenges_joined_total = community.challengesJoinedTotal;
  metrics.lifetime.community_challenges_won_total = community.challengesWonTotal;
  metrics.lifetime.community_leaderboard_top10_total = community.leaderboardTop10Total;

  return metrics;
}

export function listAchievements(): AchievementDef[] {
  return ACHIEVEMENTS_CATALOG.slice();
}

export function evaluateAchievement(def: AchievementDef, metrics: AchievementMetrics): { unlocked: boolean; progressPct: number } {
  const readMetric = (metric: string, window?: RequirementWindow) => {
    if (!window || window === "lifetime") return metrics.lifetime[metric];
    if (window === "year") return metrics.year[metric];
    if (window === "month") return metrics.month[metric];
    if (window === "week") return metrics.week[metric];
    return metrics.lifetime[metric];
  };

  const reqProgress = (req: Requirement) => {
    if (req.type === "single_day") {
      const n = Number(metrics.single_day[req.metric]) || 0;
      return n >= req.value ? 1 : clamp(n / Math.max(1, req.value), 0, 1);
    }
    if (req.type === "single_session") {
      const n = Number(metrics.single_session[req.metric]) || 0;
      return n >= req.value ? 1 : clamp(n / Math.max(1, req.value), 0, 1);
    }

    const raw = req.type === "count" || req.type === "sum" ? readMetric(req.metric, req.window) : readMetric(req.metric);
    if (req.type === "boolean") return raw === true ? 1 : 0;
    const n = typeof raw === "number" ? raw : 0;
    return n >= req.value ? 1 : clamp(n / Math.max(1, req.value), 0, 1);
  };

  const requirementRatios = (def.requirements || []).map(reqProgress);

  const streakRatio = def.streakRequirement
    ? clamp((Number(metrics.lifetime.winning_day_streak_current) || 0) / Math.max(1, def.streakRequirement.days), 0, 1)
    : 1;

  const progress = requirementRatios.length ? Math.min(streakRatio, ...requirementRatios) : streakRatio;
  const unlocked = progress >= 1;
  return { unlocked, progressPct: Math.round(progress * 100) };
}
