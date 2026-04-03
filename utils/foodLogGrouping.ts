import type { FoodEntry } from './storageUtils';

export type MealKey = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export const MEAL_ORDER: readonly MealKey[] = ['breakfast', 'lunch', 'dinner', 'snack'] as const;

export function mealLabel(meal: MealKey) {
  if (meal === 'breakfast') return 'Breakfast';
  if (meal === 'lunch') return 'Lunch';
  if (meal === 'dinner') return 'Dinner';
  return 'Snack';
}

export function inferMealFromTimeWindow(ts?: string): MealKey {
  const date = ts ? new Date(ts) : new Date();
  const hour = date.getHours();
  // Breakfast 04:00 to 10:59
  if (hour >= 4 && hour <= 10) return 'breakfast';
  // Lunch 11:00 to 15:59
  if (hour >= 11 && hour <= 15) return 'lunch';
  // Dinner 16:00 to 21:59
  if (hour >= 16 && hour <= 21) return 'dinner';
  // Snacks everything else
  return 'snack';
}

function parseTime(ts?: string) {
  if (!ts) return null;
  const ms = new Date(ts).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return ms;
}

function normalizeToken(value: unknown) {
  const raw = String(value ?? '')
    .toLowerCase()
    .trim();
  return raw
    .replace(/[\u2019']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function roundKey(n: number) {
  if (!Number.isFinite(n)) return '0';
  return n.toFixed(4);
}

export function foodEntryQuantity(entry: FoodEntry): number {
  const raw = (entry.amount ?? entry.quantity ?? 1) as any;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return n;
}

export function foodEntryPortionLabel(entry: FoodEntry): string {
  const unit = String(entry.unit || '').trim();
  if (unit.startsWith('serving:')) return unit.slice('serving:'.length).trim() || 'serving';
  if (entry.servingLabel) return String(entry.servingLabel).trim();
  if (unit) return unit;
  return 'serving';
}

export function foodEntryIdentityKey(entry: FoodEntry): string {
  const qty = foodEntryQuantity(entry);

  const baseFood =
    entry.barcode && String(entry.barcode).trim()
      ? `barcode:${normalizeToken(entry.barcode)}`
      : `food:${normalizeToken(entry.label || 'food')}|brand:${normalizeToken(entry.brand || '')}|source:${normalizeToken(entry.source || '')}`;

  const portion = `portion:${normalizeToken(foodEntryPortionLabel(entry))}|unit:${normalizeToken(entry.unit || '')}`;

  const canonicalPerUnit =
    entry.canonicalUnit && typeof entry.canonicalAmount === 'number' && Number.isFinite(entry.canonicalAmount) && qty > 0
      ? `canon:${normalizeToken(entry.canonicalUnit)}:${roundKey(entry.canonicalAmount / qty)}`
      : 'canon:none';

  const calories = (Number(entry.calories) || 0) / qty;
  const protein = (Number(entry.protein) || 0) / qty;
  const carbs = (Number(entry.carbs) || 0) / qty;
  const fat = (Number(entry.fat) || 0) / qty;
  const perUnitMacros = `k:${roundKey(calories)}|p:${roundKey(protein)}|c:${roundKey(carbs)}|f:${roundKey(fat)}`;

  return `${baseFood}|${portion}|${canonicalPerUnit}|${perUnitMacros}`;
}

export type GroupedFoodRow = {
  entry: FoodEntry;
  loggedAtMs: number | null;
  index: number;
  identityKey: string;
  quantity: number;
  sourceEntryIds: string[];
};

export type MealSection = {
  meal: MealKey;
  label: string;
  caloriesTotal: number;
  proteinTotal: number;
  rows: GroupedFoodRow[];
};

export function collapseIdenticalFoodEntries(entries: FoodEntry[]): GroupedFoodRow[] {
  const list = Array.isArray(entries) ? entries : [];
  const sorted = list
    .map((entry, index) => ({
      entry,
      loggedAtMs: parseTime(entry.ts),
      index,
      identityKey: foodEntryIdentityKey(entry),
      quantity: foodEntryQuantity(entry),
    }))
    .sort((a, b) => {
      if (a.loggedAtMs != null && b.loggedAtMs != null) return a.loggedAtMs - b.loggedAtMs;
      return a.index - b.index;
    });

  const map = new Map<
    string,
    {
      identityKey: string;
      entry: FoodEntry;
      loggedAtMs: number | null;
      index: number;
      quantity: number;
      sourceEntryIds: string[];
    }
  >();

  for (const row of sorted) {
    const prev = map.get(row.identityKey);
    if (!prev) {
      map.set(row.identityKey, {
        identityKey: row.identityKey,
        entry: {
          ...row.entry,
          // Keep the first entry id to preserve stable ordering/tests.
          quantity: row.quantity,
          amount: row.quantity,
          canonicalAmount: typeof row.entry.canonicalAmount === 'number' ? row.entry.canonicalAmount : undefined,
        },
        loggedAtMs: row.loggedAtMs,
        index: row.index,
        quantity: row.quantity,
        sourceEntryIds: [row.entry.id],
      });
      continue;
    }

    const addedQty = row.quantity;
    const nextQty = prev.quantity + addedQty;
    const prevEntry = prev.entry;
    const nextCanonicalAmount =
      typeof prevEntry.canonicalAmount === 'number' && typeof row.entry.canonicalAmount === 'number'
        ? (prevEntry.canonicalAmount || 0) + (row.entry.canonicalAmount || 0)
        : prevEntry.canonicalAmount;

    prev.entry = {
      ...prevEntry,
      calories: (Number(prevEntry.calories) || 0) + (Number(row.entry.calories) || 0),
      protein: (Number(prevEntry.protein) || 0) + (Number(row.entry.protein) || 0),
      carbs: (Number(prevEntry.carbs) || 0) + (Number(row.entry.carbs) || 0),
      fat: (Number(prevEntry.fat) || 0) + (Number(row.entry.fat) || 0),
      quantity: nextQty,
      amount: nextQty,
      canonicalAmount: nextCanonicalAmount,
      conversionEstimated: Boolean(prevEntry.conversionEstimated || row.entry.conversionEstimated),
    };
    prev.quantity = nextQty;
    prev.sourceEntryIds.push(row.entry.id);
  }

  return Array.from(map.values()).map((row) => ({
    entry: row.entry,
    loggedAtMs: row.loggedAtMs,
    index: row.index,
    identityKey: row.identityKey,
    quantity: row.quantity,
    sourceEntryIds: row.sourceEntryIds,
  }));
}

export function groupFoodEntriesByMeal(entries: FoodEntry[]): MealSection[] {
  const list = Array.isArray(entries) ? entries : [];

  const rawBuckets: Record<MealKey, FoodEntry[]> = {
    breakfast: [],
    lunch: [],
    dinner: [],
    snack: [],
  };

  list.forEach((entry) => {
    const meal = entry.meal || inferMealFromTimeWindow(entry.ts);
    rawBuckets[meal].push(entry);
  });

  return MEAL_ORDER.map((meal) => {
    const rows = collapseIdenticalFoodEntries(rawBuckets[meal]);

    const caloriesTotal = rows.reduce((sum, row) => sum + (Number(row.entry.calories) || 0), 0);
    const proteinTotal = rows.reduce((sum, row) => sum + (Number(row.entry.protein) || 0), 0);

    return {
      meal,
      label: mealLabel(meal),
      caloriesTotal,
      proteinTotal,
      rows,
    };
  });
}
