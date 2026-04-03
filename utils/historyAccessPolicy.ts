export type HistoryRangeKey = '7D' | '30D' | '90D' | '6M' | '1Y';

export const HISTORY_RANGE_DAYS: Record<HistoryRangeKey, number> = {
  '7D': 7,
  '30D': 30,
  '90D': 90,
  '6M': 182,
  '1Y': 365,
};

export const FREE_HISTORY_VISIBLE_DAYS = 30;

export function isPremiumHistoryRange(range: HistoryRangeKey): boolean {
  return HISTORY_RANGE_DAYS[range] > FREE_HISTORY_VISIBLE_DAYS;
}

export function canAccessHistoryRange(input: {
  range: HistoryRangeKey;
  isPro: boolean;
}): boolean {
  return input.isPro || !isPremiumHistoryRange(input.range);
}

export function normalizeHistoryRangeForPlan(input: {
  range: HistoryRangeKey;
  isPro: boolean;
}): HistoryRangeKey {
  if (canAccessHistoryRange(input)) return input.range;
  return '30D';
}

export function historyRangeLabel(range: HistoryRangeKey): string {
  switch (range) {
    case '7D':
      return 'This week';
    case '30D':
      return 'Last 30 days';
    case '90D':
      return 'Last 90 days';
    case '6M':
      return 'Last 6 months';
    case '1Y':
      return 'Last year';
    default:
      return 'This range';
  }
}
