// Canonical Winning Day thresholds shared across evaluation engines.
// Keep these values in one place to prevent silent logic drift.

export const WINNING_THRESHOLDS = {
  training: {
    minDurationMin: 20,
    minActiveEnergyKcal: 100,
    minHrRatio: 0.6,
    minMetMinutes: 150,
  },
  recovery: {
    minDurationMin: 10,
    maxDurationMin: 30,
    maxHrRatio: 0.5,
    maxMets: 3.0,
    maxWinningDaysPerRollingWeek: 2,
  },
} as const;

export const WINNING_SETTLEMENT_VERSION = 2;
