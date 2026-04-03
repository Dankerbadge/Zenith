export type AchievementCategory =
  | "consistency"
  | "volume"
  | "discipline"
  | "nutrition"
  | "hydration"
  | "running"
  | "walking"
  | "lifting"
  | "recovery"
  | "sleep"
  | "bodyweight"
  | "community"
  | "special";

export type AchievementTier = 1 | 2 | 3 | 4 | 5;

export type RequirementWindow = "lifetime" | "year" | "month" | "week";
export type SumWindow = "lifetime" | "month" | "week";

export type Requirement =
  | { type: "count"; metric: string; op: ">="; value: number; window: RequirementWindow }
  | { type: "sum"; metric: string; op: ">="; value: number; window: SumWindow }
  | { type: "single_day"; metric: string; op: ">="; value: number }
  | { type: "single_session"; metric: string; op: ">="; value: number }
  | { type: "boolean"; metric: string; value: true };

export type StreakRequirement = {
  metric: "winning_day";
  days: number;
  consecutive: true;
};

export type AchievementDef = {
  id: string;
  title: string;
  description: string;
  category: AchievementCategory;
  tier: AchievementTier;
  xp: number;
  badge: "bronze" | "silver" | "gold" | "platinum" | "diamond" | "zenith";
  requirements: Requirement[];
  streakRequirement?: StreakRequirement;
  repeatable?: boolean;
  cooldownDays?: number;
};

const count = (metric: string, value: number, window: RequirementWindow = "lifetime"): Requirement => ({
  type: "count",
  metric,
  op: ">=",
  value,
  window,
});

const sum = (metric: string, value: number, window: SumWindow = "lifetime"): Requirement => ({
  type: "sum",
  metric,
  op: ">=",
  value,
  window,
});

const singleDay = (metric: string, value: number): Requirement => ({
  type: "single_day",
  metric,
  op: ">=",
  value,
});

const singleSession = (metric: string, value: number): Requirement => ({
  type: "single_session",
  metric,
  op: ">=",
  value,
});

const yes = (metric: string): Requirement => ({ type: "boolean", metric, value: true });

const winningStreak = (days: number): StreakRequirement => ({
  metric: "winning_day",
  days,
  consecutive: true,
});

export const ACHIEVEMENTS_CATALOG: AchievementDef[] = [
  // 5.1 Consistency (15)
  { id: "streak_3", title: "Spark", description: "3-day winning streak", category: "consistency", tier: 2, xp: 150, badge: "bronze", requirements: [], streakRequirement: winningStreak(3) },
  { id: "streak_7", title: "Week Warrior", description: "7-day winning streak", category: "consistency", tier: 3, xp: 300, badge: "bronze", requirements: [], streakRequirement: winningStreak(7) },
  { id: "streak_14", title: "Fortnight Fighter", description: "14-day winning streak", category: "consistency", tier: 3, xp: 600, badge: "silver", requirements: [], streakRequirement: winningStreak(14) },
  { id: "streak_30", title: "Monthly Master", description: "30-day winning streak", category: "consistency", tier: 4, xp: 1500, badge: "gold", requirements: [], streakRequirement: winningStreak(30) },
  { id: "streak_60", title: "Unstoppable", description: "60-day winning streak", category: "consistency", tier: 5, xp: 3500, badge: "platinum", requirements: [], streakRequirement: winningStreak(60) },
  { id: "streak_90", title: "Legend", description: "90-day winning streak", category: "consistency", tier: 5, xp: 6000, badge: "diamond", requirements: [], streakRequirement: winningStreak(90) },
  { id: "streak_120", title: "Mythic", description: "120-day winning streak", category: "consistency", tier: 5, xp: 8000, badge: "diamond", requirements: [], streakRequirement: winningStreak(120) },
  { id: "streak_180", title: "Iron Will", description: "180-day winning streak", category: "consistency", tier: 5, xp: 10000, badge: "zenith", requirements: [], streakRequirement: winningStreak(180) },
  { id: "win_days_30", title: "Disciplined", description: "30 total winning days", category: "consistency", tier: 2, xp: 250, badge: "bronze", requirements: [count("winning_days_total", 30, "lifetime")] },
  { id: "win_days_60", title: "Committed", description: "60 total winning days", category: "consistency", tier: 3, xp: 500, badge: "silver", requirements: [count("winning_days_total", 60, "lifetime")] },
  { id: "win_days_90", title: "Relentless", description: "90 total winning days", category: "consistency", tier: 3, xp: 750, badge: "gold", requirements: [count("winning_days_total", 90, "lifetime")] },
  { id: "win_days_180", title: "Unstoppable Force", description: "180 total winning days", category: "consistency", tier: 4, xp: 2000, badge: "platinum", requirements: [count("winning_days_total", 180, "lifetime")] },
  { id: "win_days_365", title: "Year of Greatness", description: "365 total winning days", category: "consistency", tier: 5, xp: 7000, badge: "zenith", requirements: [count("winning_days_total", 365, "lifetime")] },
  { id: "perfect_week", title: "Perfect Week", description: "7 winning days in a calendar week", category: "consistency", tier: 3, xp: 600, badge: "silver", requirements: [yes("perfect_week")] },
  { id: "perfect_month", title: "Perfect Month", description: "28+ winning days in a calendar month", category: "consistency", tier: 4, xp: 2500, badge: "gold", requirements: [yes("perfect_month")] },

  // 5.2 Volume (Workouts) (15)
  { id: "workouts_5", title: "Showing Up", description: "5 workouts", category: "volume", tier: 1, xp: 75, badge: "bronze", requirements: [count("workouts_total", 5, "lifetime")] },
  { id: "workouts_10", title: "Getting Started", description: "10 workouts", category: "volume", tier: 2, xp: 150, badge: "bronze", requirements: [count("workouts_total", 10, "lifetime")] },
  { id: "workouts_25", title: "Gym Regular", description: "25 workouts", category: "volume", tier: 3, xp: 300, badge: "silver", requirements: [count("workouts_total", 25, "lifetime")] },
  { id: "workouts_50", title: "Dedicated", description: "50 workouts", category: "volume", tier: 3, xp: 600, badge: "gold", requirements: [count("workouts_total", 50, "lifetime")] },
  { id: "workouts_100", title: "Century Club", description: "100 workouts", category: "volume", tier: 4, xp: 1500, badge: "gold", requirements: [count("workouts_total", 100, "lifetime")] },
  { id: "workouts_250", title: "Committed Athlete", description: "250 workouts", category: "volume", tier: 5, xp: 3500, badge: "platinum", requirements: [count("workouts_total", 250, "lifetime")] },
  { id: "workouts_500", title: "Elite Performer", description: "500 workouts", category: "volume", tier: 5, xp: 7000, badge: "diamond", requirements: [count("workouts_total", 500, "lifetime")] },
  { id: "workouts_750", title: "Machine", description: "750 workouts", category: "volume", tier: 5, xp: 9000, badge: "diamond", requirements: [count("workouts_total", 750, "lifetime")] },
  { id: "workouts_1000", title: "Built Different", description: "1000 workouts", category: "volume", tier: 5, xp: 10000, badge: "zenith", requirements: [count("workouts_total", 1000, "lifetime")] },
  { id: "sessions_7_days", title: "Seven Straight", description: "7 workouts in 7 days", category: "volume", tier: 3, xp: 500, badge: "silver", requirements: [count("workouts_total", 7, "week")] },
  { id: "sessions_14_days", title: "Two Week Tear", description: "14 workouts in 14 days", category: "volume", tier: 4, xp: 1500, badge: "gold", requirements: [count("workouts_total", 14, "month")] },
  { id: "sessions_20_month", title: "High Frequency", description: "20 workouts in a month", category: "volume", tier: 4, xp: 1500, badge: "gold", requirements: [count("workouts_total", 20, "month")] },
  { id: "sessions_30_month", title: "Every Day", description: "30 workouts in a month", category: "volume", tier: 5, xp: 3500, badge: "platinum", requirements: [count("workouts_total", 30, "month")] },
  { id: "mix_4_types_week", title: "Well Rounded", description: "Run + Lift + HIIT + Walk in 7 days", category: "volume", tier: 3, xp: 600, badge: "silver", requirements: [yes("mix_4_types_week")] },
  { id: "lift_run_balance", title: "Hybrid Athlete", description: "20 lifts + 20 runs lifetime", category: "volume", tier: 4, xp: 1500, badge: "gold", requirements: [count("lift_sessions_total", 20, "lifetime"), count("run_sessions_total", 20, "lifetime")] },

  // 5.3 Nutrition (15)
  { id: "food_log_3", title: "First Forks", description: "Log food 3 days", category: "nutrition", tier: 1, xp: 75, badge: "bronze", requirements: [count("calories_logged_days_total", 3, "month")] },
  { id: "food_log_7", title: "Food Tracker", description: "Log food 7 days", category: "nutrition", tier: 2, xp: 150, badge: "bronze", requirements: [count("calories_logged_days_total", 7, "month")] },
  { id: "food_log_30", title: "Dialed In", description: "Log food 30 days", category: "nutrition", tier: 3, xp: 600, badge: "silver", requirements: [count("calories_logged_days_total", 30, "year")] },
  { id: "food_log_90", title: "Nutrition Veteran", description: "Log food 90 days", category: "nutrition", tier: 4, xp: 2000, badge: "platinum", requirements: [count("calories_logged_days_total", 90, "lifetime")] },
  { id: "protein_target_3", title: "Protein Starter", description: "Hit protein target 3 days", category: "nutrition", tier: 2, xp: 150, badge: "bronze", requirements: [count("protein_target_days_total", 3, "month")] },
  { id: "protein_target_7", title: "Protein Week", description: "Hit protein target 7 days", category: "nutrition", tier: 3, xp: 300, badge: "silver", requirements: [count("protein_target_days_total", 7, "month")] },
  { id: "protein_target_30", title: "Protein Month", description: "Hit protein target 30 days", category: "nutrition", tier: 4, xp: 1500, badge: "gold", requirements: [count("protein_target_days_total", 30, "year")] },
  { id: "calorie_target_3", title: "In The Zone", description: "Hit calorie window 3 days", category: "nutrition", tier: 2, xp: 150, badge: "bronze", requirements: [count("calorie_target_days_total", 3, "month")] },
  { id: "calorie_target_7", title: "Precision Week", description: "Hit calorie window 7 days", category: "nutrition", tier: 3, xp: 300, badge: "silver", requirements: [count("calorie_target_days_total", 7, "month")] },
  { id: "calorie_target_30", title: "Precision Month", description: "Hit calorie window 30 days", category: "nutrition", tier: 4, xp: 1500, badge: "gold", requirements: [count("calorie_target_days_total", 30, "year")] },
  { id: "macro_balance_week", title: "Balanced Week", description: "Hit protein + calories 5 of 7 days", category: "nutrition", tier: 3, xp: 600, badge: "silver", requirements: [yes("macro_balance_week")] },
  { id: "no_skip_breakfast_7", title: "Morning Fuel", description: "Log breakfast 7 days", category: "nutrition", tier: 2, xp: 250, badge: "bronze", requirements: [count("breakfast_logged_days_total", 7, "month")] },
  { id: "whole_food_20", title: "Real Food", description: "Log 20 whole-food meals", category: "nutrition", tier: 3, xp: 300, badge: "silver", requirements: [count("whole_food_meals_total", 20, "lifetime")] },
  { id: "meal_prep_10", title: "Meal Prep", description: "Log 10 home cooked meals", category: "nutrition", tier: 3, xp: 300, badge: "silver", requirements: [count("home_cooked_meals_total", 10, "lifetime")] },
  { id: "nutrition_streak_30", title: "Nutrition Streak", description: "30 consecutive days logging food", category: "nutrition", tier: 4, xp: 2500, badge: "gold", requirements: [yes("nutrition_streak_30")] },

  // 5.4 Hydration (10)
  { id: "water_target_3", title: "Hydrated", description: "Hit water target 3 days", category: "hydration", tier: 2, xp: 150, badge: "bronze", requirements: [count("water_target_days_total", 3, "month")] },
  { id: "water_target_7", title: "Hydration Week", description: "Hit water target 7 days", category: "hydration", tier: 3, xp: 300, badge: "silver", requirements: [count("water_target_days_total", 7, "month")] },
  { id: "water_target_30", title: "Hydration Month", description: "Hit water target 30 days", category: "hydration", tier: 4, xp: 1500, badge: "gold", requirements: [count("water_target_days_total", 30, "year")] },
  { id: "water_log_10", title: "Water Logger", description: "Log water 10 days", category: "hydration", tier: 2, xp: 150, badge: "bronze", requirements: [count("water_logged_days_total", 10, "year")] },
  { id: "water_log_30", title: "Always Sipping", description: "Log water 30 days", category: "hydration", tier: 3, xp: 600, badge: "silver", requirements: [count("water_logged_days_total", 30, "lifetime")] },
  { id: "water_100oz_day", title: "Flooded", description: "100 oz in one day", category: "hydration", tier: 1, xp: 75, badge: "bronze", requirements: [singleDay("water_oz_day_max", 100)] },
  { id: "water_2x_target_day", title: "Overflow", description: "2× target in one day", category: "hydration", tier: 2, xp: 150, badge: "bronze", requirements: [yes("water_2x_target_day")] },
  { id: "hydration_streak_14", title: "Two Week Sip", description: "14-day hydration streak", category: "hydration", tier: 3, xp: 600, badge: "silver", requirements: [yes("hydration_streak_14")] },
  { id: "hydration_streak_30", title: "Hydration Discipline", description: "30-day hydration streak", category: "hydration", tier: 4, xp: 2500, badge: "gold", requirements: [yes("hydration_streak_30")] },
  { id: "hydration_year_100", title: "Hydration Habit", description: "100 target days", category: "hydration", tier: 4, xp: 2000, badge: "platinum", requirements: [count("water_target_days_total", 100, "lifetime")] },

  // 5.5 Running (15)
  { id: "run_1", title: "First Run", description: "Complete a run", category: "running", tier: 1, xp: 75, badge: "bronze", requirements: [count("run_sessions_total", 1, "lifetime")] },
  { id: "run_5", title: "Runner", description: "5 runs", category: "running", tier: 2, xp: 150, badge: "bronze", requirements: [count("run_sessions_total", 5, "lifetime")] },
  { id: "run_25", title: "Road Warrior", description: "25 runs", category: "running", tier: 3, xp: 600, badge: "silver", requirements: [count("run_sessions_total", 25, "lifetime")] },
  { id: "run_100", title: "Distance Devotee", description: "100 runs", category: "running", tier: 4, xp: 2500, badge: "platinum", requirements: [count("run_sessions_total", 100, "lifetime")] },
  { id: "miles_10", title: "Ten Miles", description: "10 lifetime miles", category: "running", tier: 1, xp: 75, badge: "bronze", requirements: [sum("run_miles_total", 10, "lifetime")] },
  { id: "miles_50", title: "Fifty Miles", description: "50 lifetime miles", category: "running", tier: 3, xp: 300, badge: "silver", requirements: [sum("run_miles_total", 50, "lifetime")] },
  { id: "miles_200", title: "Two Hundred", description: "200 lifetime miles", category: "running", tier: 4, xp: 1500, badge: "gold", requirements: [sum("run_miles_total", 200, "lifetime")] },
  { id: "miles_500", title: "Five Hundred", description: "500 lifetime miles", category: "running", tier: 5, xp: 3500, badge: "platinum", requirements: [sum("run_miles_total", 500, "lifetime")] },
  { id: "long_run_10k", title: "10K Day", description: "Single run ≥ 6.2 miles", category: "running", tier: 2, xp: 250, badge: "silver", requirements: [singleSession("run_distance_miles_max", 6.2)] },
  { id: "long_run_half", title: "Half Day", description: "Single run ≥ 13.1 miles", category: "running", tier: 4, xp: 1500, badge: "gold", requirements: [singleSession("run_distance_miles_max", 13.1)] },
  { id: "long_run_full", title: "Marathon Day", description: "Single run ≥ 26.2 miles", category: "running", tier: 5, xp: 6000, badge: "diamond", requirements: [singleSession("run_distance_miles_max", 26.2)] },
  { id: "run_week_20mi", title: "Big Week", description: "20 miles in 7 days", category: "running", tier: 4, xp: 1500, badge: "gold", requirements: [sum("run_miles_total", 20, "week")] },
  { id: "run_week_40mi", title: "Huge Week", description: "40 miles in 7 days", category: "running", tier: 5, xp: 3500, badge: "platinum", requirements: [sum("run_miles_total", 40, "week")] },
  { id: "pace_pr_1", title: "PR Hunter", description: "Record 1 pace PR", category: "running", tier: 3, xp: 300, badge: "silver", requirements: [count("pr_count_total", 1, "lifetime")] },
  { id: "pace_pr_10", title: "PR Machine", description: "Record 10 pace PRs", category: "running", tier: 4, xp: 2000, badge: "platinum", requirements: [count("pr_count_total", 10, "lifetime")] },

  // 5.6 Walking (10)
  { id: "walk_1", title: "First Walk", description: "Complete a walk", category: "walking", tier: 1, xp: 75, badge: "bronze", requirements: [count("walk_sessions_total", 1, "lifetime")] },
  { id: "walk_minutes_60", title: "Hour Walker", description: "60 minutes lifetime", category: "walking", tier: 2, xp: 150, badge: "bronze", requirements: [sum("walk_minutes_total", 60, "lifetime")] },
  { id: "walk_minutes_600", title: "Ten Hours", description: "600 minutes lifetime", category: "walking", tier: 3, xp: 600, badge: "silver", requirements: [sum("walk_minutes_total", 600, "lifetime")] },
  { id: "walk_minutes_3000", title: "Fifty Hours", description: "3000 minutes lifetime", category: "walking", tier: 4, xp: 1500, badge: "gold", requirements: [sum("walk_minutes_total", 3000, "lifetime")] },
  { id: "steps_10k_day", title: "10K Steps", description: "10k steps in one day", category: "walking", tier: 2, xp: 150, badge: "bronze", requirements: [singleDay("steps_day_max", 10_000)] },
  { id: "steps_20k_day", title: "20K Steps", description: "20k steps in one day", category: "walking", tier: 3, xp: 300, badge: "silver", requirements: [singleDay("steps_day_max", 20_000)] },
  { id: "walk_7_days", title: "Daily Walker", description: "Walk 7 days in a row", category: "walking", tier: 3, xp: 600, badge: "silver", requirements: [yes("walk_streak_7")] },
  { id: "walk_30_days", title: "Walking Habit", description: "30-day walk streak", category: "walking", tier: 4, xp: 2500, badge: "gold", requirements: [yes("walk_streak_30")] },
  { id: "walk_week_300min", title: "Active Week", description: "300 walk minutes in 7 days", category: "walking", tier: 4, xp: 1500, badge: "gold", requirements: [sum("walk_minutes_total", 300, "week")] },
  { id: "walk_month_1200min", title: "Walking Month", description: "1200 minutes in 30 days", category: "walking", tier: 5, xp: 3500, badge: "platinum", requirements: [sum("walk_minutes_total", 1200, "month")] },

  // 5.7 Lifting (15)
  { id: "lift_1", title: "First Lift", description: "Complete a lift", category: "lifting", tier: 1, xp: 75, badge: "bronze", requirements: [count("lift_sessions_total", 1, "lifetime")] },
  { id: "lift_10", title: "In The Iron", description: "10 lifts", category: "lifting", tier: 3, xp: 300, badge: "silver", requirements: [count("lift_sessions_total", 10, "lifetime")] },
  { id: "lift_50", title: "Strength Regular", description: "50 lifts", category: "lifting", tier: 4, xp: 1500, badge: "gold", requirements: [count("lift_sessions_total", 50, "lifetime")] },
  { id: "lift_200", title: "Iron Lifestyle", description: "200 lifts", category: "lifting", tier: 5, xp: 3500, badge: "platinum", requirements: [count("lift_sessions_total", 200, "lifetime")] },
  { id: "sets_100", title: "Set Builder", description: "100 total sets", category: "lifting", tier: 2, xp: 150, badge: "bronze", requirements: [count("sets_total", 100, "lifetime")] },
  { id: "sets_1000", title: "Set Machine", description: "1000 sets", category: "lifting", tier: 4, xp: 1500, badge: "gold", requirements: [count("sets_total", 1000, "lifetime")] },
  { id: "reps_1000", title: "Rep Grinder", description: "1000 reps", category: "lifting", tier: 3, xp: 600, badge: "silver", requirements: [count("reps_total", 1000, "lifetime")] },
  { id: "reps_10000", title: "Rep Monster", description: "10,000 reps", category: "lifting", tier: 5, xp: 3500, badge: "platinum", requirements: [count("reps_total", 10_000, "lifetime")] },
  { id: "volume_100k", title: "Volume I", description: "100,000 total volume", category: "lifting", tier: 4, xp: 1500, badge: "gold", requirements: [sum("lift_volume_total", 100_000, "lifetime")] },
  { id: "volume_500k", title: "Volume II", description: "500,000 total volume", category: "lifting", tier: 5, xp: 3500, badge: "platinum", requirements: [sum("lift_volume_total", 500_000, "lifetime")] },
  { id: "pr_1", title: "First PR", description: "1 PR", category: "lifting", tier: 3, xp: 300, badge: "silver", requirements: [count("pr_count_total", 1, "lifetime")] },
  { id: "pr_10", title: "PR Collector", description: "10 PRs", category: "lifting", tier: 4, xp: 2000, badge: "platinum", requirements: [count("pr_count_total", 10, "lifetime")] },
  { id: "bench_milestone", title: "Bench Milestone", description: "Log any bench set ≥ 225 lb", category: "lifting", tier: 3, xp: 600, badge: "silver", requirements: [yes("bench_225")] },
  { id: "squat_milestone", title: "Squat Milestone", description: "Log any squat set ≥ 315 lb", category: "lifting", tier: 3, xp: 600, badge: "silver", requirements: [yes("squat_315")] },
  { id: "deadlift_milestone", title: "Deadlift Milestone", description: "Log any deadlift set ≥ 405 lb", category: "lifting", tier: 4, xp: 1500, badge: "gold", requirements: [yes("deadlift_405")] },

  // 5.8 Recovery / Sleep (10)
  { id: "recovery_day_1", title: "Recovery Matters", description: "Log 1 recovery day", category: "recovery", tier: 1, xp: 75, badge: "bronze", requirements: [count("recovery_days_total", 1, "lifetime")] },
  { id: "recovery_week_3", title: "Balanced Week", description: "3 recovery days in 7", category: "recovery", tier: 2, xp: 250, badge: "bronze", requirements: [count("recovery_days_total", 3, "week")] },
  { id: "sleep_log_7", title: "Sleep Tracker", description: "Log sleep 7 days", category: "sleep", tier: 3, xp: 300, badge: "silver", requirements: [count("sleep_logged_days_total", 7, "month")] },
  { id: "sleep_8h_3", title: "Well Rested", description: "3 days ≥ 8h", category: "sleep", tier: 3, xp: 300, badge: "silver", requirements: [count("sleep_8h_days_total", 3, "month")] },
  { id: "sleep_8h_14", title: "Sleep Discipline", description: "14 days ≥ 8h", category: "sleep", tier: 4, xp: 1500, badge: "gold", requirements: [count("sleep_8h_days_total", 14, "year")] },
  { id: "sleep_8h_30", title: "Sleep Master", description: "30 days ≥ 8h", category: "sleep", tier: 5, xp: 3500, badge: "platinum", requirements: [count("sleep_8h_days_total", 30, "year")] },
  { id: "rest_streak_7", title: "Rest Rhythm", description: "7 days with recovery logged", category: "recovery", tier: 3, xp: 600, badge: "silver", requirements: [yes("recovery_streak_7")] },
  { id: "no_overtrain_14", title: "Smart Training", description: "14 days with at least 2 recovery days", category: "recovery", tier: 4, xp: 1500, badge: "gold", requirements: [yes("no_overtrain_14")] },
  { id: "mobility_10", title: "Mobility Builder", description: "10 mobility sessions", category: "recovery", tier: 3, xp: 300, badge: "silver", requirements: [count("mobility_sessions_total", 10, "lifetime")] },
  { id: "mobility_50", title: "Supple", description: "50 mobility sessions", category: "recovery", tier: 4, xp: 2000, badge: "platinum", requirements: [count("mobility_sessions_total", 50, "lifetime")] },

  // 5.9 Community (10)
  { id: "post_1", title: "First Post", description: "Create 1 post", category: "community", tier: 1, xp: 75, badge: "bronze", requirements: [count("community_posts_total", 1, "lifetime")] },
  { id: "post_10", title: "Contributor", description: "10 posts", category: "community", tier: 3, xp: 300, badge: "silver", requirements: [count("community_posts_total", 10, "lifetime")] },
  { id: "comment_25", title: "Encourager", description: "25 comments", category: "community", tier: 3, xp: 300, badge: "silver", requirements: [count("community_comments_total", 25, "lifetime")] },
  { id: "like_100", title: "Supporter", description: "100 likes given", category: "community", tier: 3, xp: 300, badge: "silver", requirements: [count("community_likes_total", 100, "lifetime")] },
  { id: "received_50", title: "Recognized", description: "50 likes received", category: "community", tier: 3, xp: 600, badge: "gold", requirements: [count("community_likes_received_total", 50, "lifetime")] },
  { id: "received_250", title: "Respected", description: "250 likes received", category: "community", tier: 4, xp: 1500, badge: "platinum", requirements: [count("community_likes_received_total", 250, "lifetime")] },
  { id: "streak_share_7", title: "Share The Grind", description: "Share 7 days in a row", category: "community", tier: 4, xp: 1500, badge: "gold", requirements: [yes("share_streak_7")] },
  { id: "challenge_join_1", title: "In The Arena", description: "Join 1 challenge", category: "community", tier: 2, xp: 150, badge: "bronze", requirements: [count("community_challenges_joined_total", 1, "lifetime")] },
  { id: "challenge_win_1", title: "Challenge Winner", description: "Win 1 challenge", category: "community", tier: 4, xp: 2000, badge: "platinum", requirements: [count("community_challenges_won_total", 1, "lifetime")] },
  { id: "leaderboard_top_10", title: "Top 10", description: "Place top 10 in a weekly leaderboard", category: "community", tier: 5, xp: 3500, badge: "platinum", requirements: [count("community_leaderboard_top10_total", 1, "lifetime")] },

  // 5.10 Special (10)
  { id: "first_workout", title: "First Steps", description: "Log first workout", category: "special", tier: 1, xp: 75, badge: "bronze", requirements: [count("workouts_total", 1, "lifetime")] },
  { id: "first_winning_day", title: "Day One", description: "First winning day", category: "special", tier: 1, xp: 75, badge: "bronze", requirements: [count("winning_days_total", 1, "lifetime")] },
  { id: "daily_300xp", title: "Big Day", description: "Earn 300 XP in one day", category: "special", tier: 2, xp: 250, badge: "silver", requirements: [singleDay("daily_xp_day_max", 300)] },
  { id: "daily_600xp", title: "Monster Day", description: "Earn 600 XP in one day", category: "special", tier: 3, xp: 600, badge: "gold", requirements: [singleDay("daily_xp_day_max", 600)] },
  { id: "daily_1000xp", title: "Legendary Day", description: "Earn 1000 XP in one day", category: "special", tier: 4, xp: 1500, badge: "platinum", requirements: [singleDay("daily_xp_day_max", 1000)] },
  { id: "streak_save", title: "Clutch", description: "Maintain streak after a near-miss day", category: "special", tier: 3, xp: 300, badge: "silver", requirements: [yes("streak_save")] },
  { id: "come_back_7", title: "Comeback", description: "Return after 7-day inactivity and win day", category: "special", tier: 3, xp: 300, badge: "silver", requirements: [yes("come_back_7")] },
  { id: "consistency_combo", title: "Locked In", description: "Hit protein + water + activity in one day", category: "special", tier: 3, xp: 300, badge: "silver", requirements: [yes("consistency_combo_day")] },
  { id: "zenith_rank", title: "Zenith Reached", description: "Reach Zenith rank", category: "special", tier: 5, xp: 10000, badge: "zenith", requirements: [yes("rank_zenith")] },
  { id: "diamond_rank", title: "Diamond Achiever", description: "Reach Diamond rank", category: "special", tier: 5, xp: 3500, badge: "diamond", requirements: [yes("rank_diamond")] },
];
