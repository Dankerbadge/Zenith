// Achievement System
// Tracks milestones and awards badges

export interface Achievement {
  id: string;
  category: 'consistency' | 'volume' | 'discipline' | 'dedication' | 'special';
  name: string;
  description: string;
  icon: string;
  requirement: number;
  xpReward: number;
  tier: 'bronze' | 'silver' | 'gold' | 'platinum';
}

export interface UserAchievement {
  achievementId: string;
  unlockedAt: string;
  progress: number;
}

export const ACHIEVEMENTS: Achievement[] = [
  // CONSISTENCY - Streak based
  {
    id: 'streak_7',
    category: 'consistency',
    name: 'Week Warrior',
    description: '7-day winning streak',
    icon: '🔥',
    requirement: 7,
    xpReward: 25,
    tier: 'bronze'
  },
  {
    id: 'streak_14',
    category: 'consistency',
    name: 'Fortnight Fighter',
    description: '14-day winning streak',
    icon: '🔥',
    requirement: 14,
    xpReward: 50,
    tier: 'silver'
  },
  {
    id: 'streak_30',
    category: 'consistency',
    name: 'Monthly Master',
    description: '30-day winning streak',
    icon: '🔥',
    requirement: 30,
    xpReward: 100,
    tier: 'gold'
  },
  {
    id: 'streak_60',
    category: 'consistency',
    name: 'Unstoppable',
    description: '60-day winning streak',
    icon: '🔥',
    requirement: 60,
    xpReward: 200,
    tier: 'platinum'
  },
  {
    id: 'streak_90',
    category: 'consistency',
    name: 'Legend',
    description: '90-day winning streak',
    icon: '👑',
    requirement: 90,
    xpReward: 500,
    tier: 'platinum'
  },

  // VOLUME - Workout count
  {
    id: 'workouts_10',
    category: 'volume',
    name: 'Getting Started',
    description: 'Complete 10 workouts',
    icon: '💪',
    requirement: 10,
    xpReward: 25,
    tier: 'bronze'
  },
  {
    id: 'workouts_50',
    category: 'volume',
    name: 'Gym Regular',
    description: 'Complete 50 workouts',
    icon: '💪',
    requirement: 50,
    xpReward: 50,
    tier: 'silver'
  },
  {
    id: 'workouts_100',
    category: 'volume',
    name: 'Century Club',
    description: 'Complete 100 workouts',
    icon: '💪',
    requirement: 100,
    xpReward: 100,
    tier: 'gold'
  },
  {
    id: 'workouts_250',
    category: 'volume',
    name: 'Dedicated Athlete',
    description: 'Complete 250 workouts',
    icon: '💪',
    requirement: 250,
    xpReward: 250,
    tier: 'platinum'
  },
  {
    id: 'workouts_500',
    category: 'volume',
    name: 'Elite Performer',
    description: 'Complete 500 workouts',
    icon: '⚡',
    requirement: 500,
    xpReward: 500,
    tier: 'platinum'
  },

  // DISCIPLINE - Winning days
  {
    id: 'winning_30',
    category: 'discipline',
    name: 'Disciplined',
    description: '30 total winning days',
    icon: '🏆',
    requirement: 30,
    xpReward: 50,
    tier: 'bronze'
  },
  {
    id: 'winning_60',
    category: 'discipline',
    name: 'Committed',
    description: '60 total winning days',
    icon: '🏆',
    requirement: 60,
    xpReward: 100,
    tier: 'silver'
  },
  {
    id: 'winning_90',
    category: 'discipline',
    name: 'Relentless',
    description: '90 total winning days',
    icon: '🏆',
    requirement: 90,
    xpReward: 150,
    tier: 'gold'
  },
  {
    id: 'winning_180',
    category: 'discipline',
    name: 'Unstoppable Force',
    description: '180 total winning days',
    icon: '🏆',
    requirement: 180,
    xpReward: 300,
    tier: 'platinum'
  },
  {
    id: 'winning_365',
    category: 'discipline',
    name: 'Year of Greatness',
    description: '365 total winning days',
    icon: '👑',
    requirement: 365,
    xpReward: 1000,
    tier: 'platinum'
  },

  // DEDICATION - Rank achievements
  {
    id: 'rank_bronze',
    category: 'dedication',
    name: 'Bronze Achiever',
    description: 'Reach Bronze rank',
    icon: '🥉',
    requirement: 1,
    xpReward: 50,
    tier: 'bronze'
  },
  {
    id: 'rank_silver',
    category: 'dedication',
    name: 'Silver Achiever',
    description: 'Reach Silver rank',
    icon: '🥈',
    requirement: 1,
    xpReward: 100,
    tier: 'silver'
  },
  {
    id: 'rank_gold',
    category: 'dedication',
    name: 'Gold Achiever',
    description: 'Reach Gold rank',
    icon: '🥇',
    requirement: 1,
    xpReward: 200,
    tier: 'gold'
  },
  {
    id: 'rank_platinum',
    category: 'dedication',
    name: 'Platinum Achiever',
    description: 'Reach Platinum rank',
    icon: '💎',
    requirement: 1,
    xpReward: 500,
    tier: 'platinum'
  },
  {
    id: 'rank_diamond',
    category: 'dedication',
    name: 'Diamond Achiever',
    description: 'Reach Diamond rank',
    icon: '💠',
    requirement: 1,
    xpReward: 1000,
    tier: 'platinum'
  },
  {
    id: 'rank_zenith',
    category: 'dedication',
    name: 'Zenith Reached',
    description: 'Reach the pinnacle - Zenith rank',
    icon: '⚡',
    requirement: 1,
    xpReward: 5000,
    tier: 'platinum'
  },

  // SPECIAL - Unique achievements
  {
    id: 'first_workout',
    category: 'special',
    name: 'First Steps',
    description: 'Log your first workout',
    icon: '🎯',
    requirement: 1,
    xpReward: 10,
    tier: 'bronze'
  },
  {
    id: 'first_winning_day',
    category: 'special',
    name: 'Day One',
    description: 'Your first winning day',
    icon: '✨',
    requirement: 1,
    xpReward: 10,
    tier: 'bronze'
  },
  {
    id: 'max_daily_xp',
    category: 'special',
    name: 'Daily Maximum',
    description: 'Earn 50 XP in a single day',
    icon: '⚡',
    requirement: 1,
    xpReward: 25,
    tier: 'silver'
  },
];

/**
 * Check if user has unlocked an achievement
 */
export function checkAchievement(
  achievement: Achievement,
  userStats: {
    currentStreak: number;
    longestStreak: number;
    totalWorkouts: number;
    totalWinningDays: number;
    currentRankTier: string;
    maxDailyXP: number;
  }
): boolean {
  switch (achievement.category) {
    case 'consistency':
      return userStats.longestStreak >= achievement.requirement;
    
    case 'volume':
      return userStats.totalWorkouts >= achievement.requirement;
    
    case 'discipline':
      return userStats.totalWinningDays >= achievement.requirement;
    
    case 'dedication':
      const tierMap: { [key: string]: number } = {
        'Iron': 0,
        'Bronze': 1,
        'Silver': 2,
        'Gold': 3,
        'Platinum': 4,
        'Diamond': 5,
        'Zenith': 6
      };
      const requiredRank = achievement.id.replace('rank_', '');
      const userRankLevel = tierMap[userStats.currentRankTier] || 0;
      const achievementRankLevel = tierMap[requiredRank.charAt(0).toUpperCase() + requiredRank.slice(1)] || 0;
      return userRankLevel >= achievementRankLevel;
    
    case 'special':
      if (achievement.id === 'first_workout') {
        return userStats.totalWorkouts >= 1;
      }
      if (achievement.id === 'first_winning_day') {
        return userStats.totalWinningDays >= 1;
      }
      if (achievement.id === 'max_daily_xp') {
        return userStats.maxDailyXP >= 50;
      }
      return false;
    
    default:
      return false;
  }
}

/**
 * Get achievement progress (0-100%)
 */
export function getAchievementProgress(
  achievement: Achievement,
  userStats: {
    currentStreak: number;
    longestStreak: number;
    totalWorkouts: number;
    totalWinningDays: number;
    currentRankTier: string;
    maxDailyXP: number;
  }
): number {
  let current = 0;
  
  switch (achievement.category) {
    case 'consistency':
      current = userStats.longestStreak;
      break;
    case 'volume':
      current = userStats.totalWorkouts;
      break;
    case 'discipline':
      current = userStats.totalWinningDays;
      break;
    case 'dedication':
      return checkAchievement(achievement, userStats) ? 100 : 0;
    case 'special':
      return checkAchievement(achievement, userStats) ? 100 : 0;
  }
  
  return Math.min(100, (current / achievement.requirement) * 100);
}

/**
 * Get all achievements grouped by category
 */
export function getAchievementsByCategory() {
  const grouped: { [key: string]: Achievement[] } = {
    consistency: [],
    volume: [],
    discipline: [],
    dedication: [],
    special: []
  };
  
  ACHIEVEMENTS.forEach(achievement => {
    grouped[achievement.category].push(achievement);
  });
  
  return grouped;
}

/**
 * Get tier color
 */
export function getTierColor(tier: string): string {
  switch (tier) {
    case 'bronze': return '#CD7F32';
    case 'silver': return '#C0C0C0';
    case 'gold': return '#FFD700';
    case 'platinum': return '#E5E4E2';
    default: return '#888888';
  }
}

/**
 * Get recently unlocked achievements
 */
export function getRecentlyUnlocked(userAchievements: UserAchievement[]): UserAchievement[] {
  const oneDayAgo = new Date(Date.now() - 86400000).toISOString();
  return userAchievements.filter(ua => ua.unlockedAt > oneDayAgo);
}
