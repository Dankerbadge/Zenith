// Zenith Rank System
// 7 tiers, 26 ranks total before Zenith

export interface Rank {
  id: string;
  tier: string;
  subTier: number;
  name: string;
  pointsRequired: number;
  winningDaysRequired: number;
  color: string;
  icon: string;
}

export const RANKS: Rank[] = [
  // IRON (4 ranks)
  { id: 'iron_4', tier: 'Iron', subTier: 4, name: 'Iron IV', pointsRequired: 0, winningDaysRequired: 0, color: '#8B7355', icon: '⚙️' },
  { id: 'iron_3', tier: 'Iron', subTier: 3, name: 'Iron III', pointsRequired: 100, winningDaysRequired: 4, color: '#8B7355', icon: '⚙️' },
  { id: 'iron_2', tier: 'Iron', subTier: 2, name: 'Iron II', pointsRequired: 200, winningDaysRequired: 5, color: '#8B7355', icon: '⚙️' },
  { id: 'iron_1', tier: 'Iron', subTier: 1, name: 'Iron I', pointsRequired: 300, winningDaysRequired: 6, color: '#8B7355', icon: '⚙️' },
  
  // BRONZE (4 ranks)
  { id: 'bronze_4', tier: 'Bronze', subTier: 4, name: 'Bronze IV', pointsRequired: 450, winningDaysRequired: 7, color: '#CD7F32', icon: '🥉' },
  { id: 'bronze_3', tier: 'Bronze', subTier: 3, name: 'Bronze III', pointsRequired: 650, winningDaysRequired: 9, color: '#CD7F32', icon: '🥉' },
  { id: 'bronze_2', tier: 'Bronze', subTier: 2, name: 'Bronze II', pointsRequired: 900, winningDaysRequired: 11, color: '#CD7F32', icon: '🥉' },
  { id: 'bronze_1', tier: 'Bronze', subTier: 1, name: 'Bronze I', pointsRequired: 1200, winningDaysRequired: 14, color: '#CD7F32', icon: '🥉' },
  
  // SILVER (4 ranks)
  { id: 'silver_4', tier: 'Silver', subTier: 4, name: 'Silver IV', pointsRequired: 1600, winningDaysRequired: 18, color: '#C0C0C0', icon: '🥈' },
  { id: 'silver_3', tier: 'Silver', subTier: 3, name: 'Silver III', pointsRequired: 2100, winningDaysRequired: 22, color: '#C0C0C0', icon: '🥈' },
  { id: 'silver_2', tier: 'Silver', subTier: 2, name: 'Silver II', pointsRequired: 2700, winningDaysRequired: 26, color: '#C0C0C0', icon: '🥈' },
  { id: 'silver_1', tier: 'Silver', subTier: 1, name: 'Silver I', pointsRequired: 3500, winningDaysRequired: 30, color: '#C0C0C0', icon: '🥈' },
  
  // GOLD (4 ranks)
  { id: 'gold_4', tier: 'Gold', subTier: 4, name: 'Gold IV', pointsRequired: 4500, winningDaysRequired: 38, color: '#FFD700', icon: '🥇' },
  { id: 'gold_3', tier: 'Gold', subTier: 3, name: 'Gold III', pointsRequired: 5800, winningDaysRequired: 45, color: '#FFD700', icon: '🥇' },
  { id: 'gold_2', tier: 'Gold', subTier: 2, name: 'Gold II', pointsRequired: 7200, winningDaysRequired: 52, color: '#FFD700', icon: '🥇' },
  { id: 'gold_1', tier: 'Gold', subTier: 1, name: 'Gold I', pointsRequired: 8800, winningDaysRequired: 60, color: '#FFD700', icon: '🥇' },
  
  // PLATINUM (4 ranks)
  { id: 'platinum_4', tier: 'Platinum', subTier: 4, name: 'Platinum IV', pointsRequired: 10500, winningDaysRequired: 70, color: '#E5E4E2', icon: '💎' },
  { id: 'platinum_3', tier: 'Platinum', subTier: 3, name: 'Platinum III', pointsRequired: 12500, winningDaysRequired: 80, color: '#E5E4E2', icon: '💎' },
  { id: 'platinum_2', tier: 'Platinum', subTier: 2, name: 'Platinum II', pointsRequired: 15000, winningDaysRequired: 90, color: '#E5E4E2', icon: '💎' },
  { id: 'platinum_1', tier: 'Platinum', subTier: 1, name: 'Platinum I', pointsRequired: 18000, winningDaysRequired: 105, color: '#E5E4E2', icon: '💎' },
  
  // DIAMOND (4 ranks)
  { id: 'diamond_4', tier: 'Diamond', subTier: 4, name: 'Diamond IV', pointsRequired: 21000, winningDaysRequired: 120, color: '#B9F2FF', icon: '💠' },
  { id: 'diamond_3', tier: 'Diamond', subTier: 3, name: 'Diamond III', pointsRequired: 25000, winningDaysRequired: 140, color: '#B9F2FF', icon: '💠' },
  { id: 'diamond_2', tier: 'Diamond', subTier: 2, name: 'Diamond II', pointsRequired: 30000, winningDaysRequired: 165, color: '#B9F2FF', icon: '💠' },
  { id: 'diamond_1', tier: 'Diamond', subTier: 1, name: 'Diamond I', pointsRequired: 36000, winningDaysRequired: 190, color: '#B9F2FF', icon: '💠' },
  
  // ZENITH (final rank)
  { id: 'zenith', tier: 'Zenith', subTier: 0, name: 'Zenith', pointsRequired: 45000, winningDaysRequired: 240, color: '#00D9FF', icon: '⚡' },
];

export interface UserProgress {
  totalXP: number;
  totalWinningDays: number;
  currentStreak: number;
  longestStreak: number;
  lastWinningDate: string | null;
}

/**
 * Calculate current rank based on XP and Winning Days
 * Both requirements must be met to advance
 */
export function calculateCurrentRank(progress: UserProgress): Rank {
  let currentRank = RANKS[0]; // Start at Iron IV
  
  for (const rank of RANKS) {
    // Must meet BOTH requirements
    if (progress.totalXP >= rank.pointsRequired && 
        progress.totalWinningDays >= rank.winningDaysRequired) {
      currentRank = rank;
    } else {
      break; // Stop at first rank we don't qualify for
    }
  }
  
  return currentRank;
}

/**
 * Get next rank in progression
 */
export function getNextRank(currentRank: Rank): Rank | null {
  const currentIndex = RANKS.findIndex(r => r.id === currentRank.id);
  if (currentIndex === -1 || currentIndex === RANKS.length - 1) {
    return null; // Already at Zenith
  }
  return RANKS[currentIndex + 1];
}

/**
 * Calculate progress to next rank (0-100%)
 */
export function calculateRankProgress(progress: UserProgress, currentRank: Rank): {
  xpProgress: number;
  winningDaysProgress: number;
  overallProgress: number;
} {
  const nextRank = getNextRank(currentRank);
  
  if (!nextRank) {
    return { xpProgress: 100, winningDaysProgress: 100, overallProgress: 100 };
  }
  
  // XP progress
  const xpRange = nextRank.pointsRequired - currentRank.pointsRequired;
  const xpGained = progress.totalXP - currentRank.pointsRequired;
  const xpProgress = Math.min(100, Math.max(0, (xpGained / xpRange) * 100));
  
  // Winning Days progress
  const daysRange = nextRank.winningDaysRequired - currentRank.winningDaysRequired;
  const daysGained = progress.totalWinningDays - currentRank.winningDaysRequired;
  const winningDaysProgress = Math.min(100, Math.max(0, (daysGained / daysRange) * 100));
  
  // Overall progress (both must be 100% to rank up)
  const overallProgress = Math.min(xpProgress, winningDaysProgress);
  
  return { xpProgress, winningDaysProgress, overallProgress };
}

/**
 * Check if user can rank up
 */
export function canRankUp(progress: UserProgress, currentRank: Rank): boolean {
  const nextRank = getNextRank(currentRank);
  if (!nextRank) return false;
  
  return progress.totalXP >= nextRank.pointsRequired && 
         progress.totalWinningDays >= nextRank.winningDaysRequired;
}

/**
 * Get estimated days to next rank (rough estimate)
 */
export function estimateDaysToRankUp(progress: UserProgress, currentRank: Rank): number | null {
  const nextRank = getNextRank(currentRank);
  if (!nextRank) return null;
  
  const xpNeeded = Math.max(0, nextRank.pointsRequired - progress.totalXP);
  const daysNeeded = Math.max(0, nextRank.winningDaysRequired - progress.totalWinningDays);
  
  // Assume average 30 XP per winning day
  const daysBasedOnXP = Math.ceil(xpNeeded / 30);
  
  // Return whichever takes longer
  return Math.max(daysBasedOnXP, daysNeeded);
}
