export type Rank = {
  id: string;
  tier: string;
  subTier: number;
  name: string;
  pointsRequired: number;
  winningDaysRequired: number;
  color: string;
  icon: string;
  subtitle: string;
};

export type RankId = Rank["id"];

export const RANKS: Rank[] = [
  // IRON
  { id: "iron_4", tier: "Iron", subTier: 4, name: "Iron IV", pointsRequired: 0, winningDaysRequired: 0, color: "#8B7355", icon: "⚙️", subtitle: "Start the climb." },
  { id: "iron_3", tier: "Iron", subTier: 3, name: "Iron III", pointsRequired: 100, winningDaysRequired: 4, color: "#8B7355", icon: "⚙️", subtitle: "Build the habit." },
  { id: "iron_2", tier: "Iron", subTier: 2, name: "Iron II", pointsRequired: 200, winningDaysRequired: 5, color: "#8B7355", icon: "⚙️", subtitle: "Show up again." },
  { id: "iron_1", tier: "Iron", subTier: 1, name: "Iron I", pointsRequired: 300, winningDaysRequired: 6, color: "#8B7355", icon: "⚙️", subtitle: "Momentum is forming." },

  // BRONZE
  { id: "bronze_4", tier: "Bronze", subTier: 4, name: "Bronze IV", pointsRequired: 450, winningDaysRequired: 7, color: "#CD7F32", icon: "🥉", subtitle: "Consistency begins." },
  { id: "bronze_3", tier: "Bronze", subTier: 3, name: "Bronze III", pointsRequired: 650, winningDaysRequired: 9, color: "#CD7F32", icon: "🥉", subtitle: "You’re proving it." },
  { id: "bronze_2", tier: "Bronze", subTier: 2, name: "Bronze II", pointsRequired: 900, winningDaysRequired: 11, color: "#CD7F32", icon: "🥉", subtitle: "Less talk. More reps." },
  { id: "bronze_1", tier: "Bronze", subTier: 1, name: "Bronze I", pointsRequired: 1200, winningDaysRequired: 14, color: "#CD7F32", icon: "🥉", subtitle: "Your baseline is rising." },

  // SILVER
  { id: "silver_4", tier: "Silver", subTier: 4, name: "Silver IV", pointsRequired: 1600, winningDaysRequired: 18, color: "#C0C0C0", icon: "🥈", subtitle: "Discipline appears." },
  { id: "silver_3", tier: "Silver", subTier: 3, name: "Silver III", pointsRequired: 2100, winningDaysRequired: 22, color: "#C0C0C0", icon: "🥈", subtitle: "Form over feelings." },
  { id: "silver_2", tier: "Silver", subTier: 2, name: "Silver II", pointsRequired: 2700, winningDaysRequired: 26, color: "#C0C0C0", icon: "🥈", subtitle: "You’re getting sharp." },
  { id: "silver_1", tier: "Silver", subTier: 1, name: "Silver I", pointsRequired: 3500, winningDaysRequired: 30, color: "#C0C0C0", icon: "🥈", subtitle: "Work is becoming normal." },

  // GOLD
  { id: "gold_4", tier: "Gold", subTier: 4, name: "Gold IV", pointsRequired: 4500, winningDaysRequired: 38, color: "#FFD700", icon: "🥇", subtitle: "You train with intent." },
  { id: "gold_3", tier: "Gold", subTier: 3, name: "Gold III", pointsRequired: 5800, winningDaysRequired: 45, color: "#FFD700", icon: "🥇", subtitle: "Structure wins." },
  { id: "gold_2", tier: "Gold", subTier: 2, name: "Gold II", pointsRequired: 7200, winningDaysRequired: 52, color: "#FFD700", icon: "🥇", subtitle: "You’re not guessing." },
  { id: "gold_1", tier: "Gold", subTier: 1, name: "Gold I", pointsRequired: 8800, winningDaysRequired: 60, color: "#FFD700", icon: "🥇", subtitle: "You’re consistent under stress." },

  // PLATINUM
  { id: "platinum_4", tier: "Platinum", subTier: 4, name: "Platinum IV", pointsRequired: 10500, winningDaysRequired: 70, color: "#E5E4E2", icon: "💎", subtitle: "You don’t negotiate." },
  { id: "platinum_3", tier: "Platinum", subTier: 3, name: "Platinum III", pointsRequired: 12500, winningDaysRequired: 80, color: "#E5E4E2", icon: "💎", subtitle: "The body adapts." },
  { id: "platinum_2", tier: "Platinum", subTier: 2, name: "Platinum II", pointsRequired: 15000, winningDaysRequired: 90, color: "#E5E4E2", icon: "💎", subtitle: "The mind hardens." },
  { id: "platinum_1", tier: "Platinum", subTier: 1, name: "Platinum I", pointsRequired: 18000, winningDaysRequired: 105, color: "#E5E4E2", icon: "💎", subtitle: "You execute." },

  // DIAMOND
  { id: "diamond_4", tier: "Diamond", subTier: 4, name: "Diamond IV", pointsRequired: 21000, winningDaysRequired: 120, color: "#B9F2FF", icon: "💠", subtitle: "Elite output." },
  { id: "diamond_3", tier: "Diamond", subTier: 3, name: "Diamond III", pointsRequired: 25000, winningDaysRequired: 140, color: "#B9F2FF", icon: "💠", subtitle: "Elite consistency." },
  { id: "diamond_2", tier: "Diamond", subTier: 2, name: "Diamond II", pointsRequired: 30000, winningDaysRequired: 165, color: "#B9F2FF", icon: "💠", subtitle: "Pressure tested." },
  { id: "diamond_1", tier: "Diamond", subTier: 1, name: "Diamond I", pointsRequired: 36000, winningDaysRequired: 190, color: "#B9F2FF", icon: "💠", subtitle: "You’re the standard." },

  // ENDGAME
  { id: "ascendant_4", tier: "Ascendant", subTier: 4, name: "Ascendant IV", pointsRequired: 45000, winningDaysRequired: 220, color: "#8A2BE2", icon: "🜂", subtitle: "Consistency becomes identity." },
  { id: "ascendant_3", tier: "Ascendant", subTier: 3, name: "Ascendant III", pointsRequired: 55000, winningDaysRequired: 250, color: "#8A2BE2", icon: "🜂", subtitle: "No excuses survive here." },
  { id: "ascendant_2", tier: "Ascendant", subTier: 2, name: "Ascendant II", pointsRequired: 65000, winningDaysRequired: 280, color: "#8A2BE2", icon: "🜂", subtitle: "You bend the week to you." },
  { id: "ascendant_1", tier: "Ascendant", subTier: 1, name: "Ascendant I", pointsRequired: 75000, winningDaysRequired: 310, color: "#8A2BE2", icon: "🜂", subtitle: "You are unrecognizable." },

  { id: "paragon_3", tier: "Paragon", subTier: 3, name: "Paragon III", pointsRequired: 90000, winningDaysRequired: 335, color: "#FF1493", icon: "✦", subtitle: "Rare discipline." },
  { id: "paragon_2", tier: "Paragon", subTier: 2, name: "Paragon II", pointsRequired: 105000, winningDaysRequired: 350, color: "#FF1493", icon: "✦", subtitle: "You don’t drift." },
  { id: "paragon_1", tier: "Paragon", subTier: 1, name: "Paragon I", pointsRequired: 115000, winningDaysRequired: 360, color: "#FF1493", icon: "✦", subtitle: "You don’t break." },

  { id: "zenith", tier: "Zenith", subTier: 0, name: "Zenith", pointsRequired: 125000, winningDaysRequired: 365, color: "#00D9FF", icon: "⚡", subtitle: "A year of proof." }
];

export function calculateCurrentRank(xp: number, days: number) {
  let current = RANKS[0];
  for (const r of RANKS) {
    if (xp >= r.pointsRequired && days >= r.winningDaysRequired) current = r;
    else break;
  }
  return current;
}

export function getNextRank(currentId: string) {
  const idx = RANKS.findIndex(r => r.id === currentId);
  if (idx < 0 || idx >= RANKS.length - 1) return null;
  return RANKS[idx + 1];
}
