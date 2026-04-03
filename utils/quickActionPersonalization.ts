import AsyncStorage from '@react-native-async-storage/async-storage';

export type QuickActionUsageRow = {
  count: number;
  lastUsedAtMs: number;
};

export type QuickActionUsageMap = Record<string, QuickActionUsageRow>;
export type QuickActionPersonalizationState = 'active' | 'insufficient_signal' | 'fallback';
export type QuickActionTransparencyRow = {
  actionId: string;
  count: number;
  lastUsedAtMs: number;
  reason: string;
};

const STORAGE_KEY = 'quickActionUsage:v1';

function asFiniteNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function safeParseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function loadQuickActionUsage(): Promise<QuickActionUsageMap> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  const parsed = safeParseJson<QuickActionUsageMap>(raw, {});
  const normalized: QuickActionUsageMap = {};
  Object.keys(parsed || {}).forEach((key) => {
    const row = (parsed as any)[key] || {};
    const count = Math.max(0, Math.floor(asFiniteNumber(row.count)));
    const lastUsedAtMs = Math.max(0, Math.floor(asFiniteNumber(row.lastUsedAtMs)));
    if (!key || count <= 0) return;
    normalized[String(key)] = { count, lastUsedAtMs };
  });
  return normalized;
}

export async function recordQuickActionUse(actionId: string): Promise<QuickActionUsageMap> {
  const id = String(actionId || '').trim();
  if (!id) return loadQuickActionUsage();
  const now = Date.now();
  const usage = await loadQuickActionUsage();
  const existing = usage[id] || { count: 0, lastUsedAtMs: 0 };
  const next: QuickActionUsageMap = {
    ...usage,
    [id]: {
      count: Math.max(0, existing.count) + 1,
      lastUsedAtMs: now,
    },
  };
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

function scoreRow(row: QuickActionUsageRow, nowMs: number): number {
  const count = clamp(asFiniteNumber(row.count), 0, 9999);
  const lastUsedAtMs = clamp(asFiniteNumber(row.lastUsedAtMs), 0, nowMs);
  const ageDays = (nowMs - lastUsedAtMs) / (24 * 60 * 60 * 1000);
  // Exponential decay makes ordering stable, but still responsive to real habit changes.
  const decay = Math.exp(-clamp(ageDays, 0, 365) / 14);
  const recentBonus = ageDays <= 1 ? 0.35 : ageDays <= 3 ? 0.15 : 0;
  return count * decay + recentBonus;
}

export function rankQuickActions<T extends { id: string; defaultRank: number }>(input: {
  actions: T[];
  usage: QuickActionUsageMap | null | undefined;
  nowMs?: number;
}): T[] {
  const actions = Array.isArray(input.actions) ? input.actions : [];
  const usage = input.usage || null;
  if (!usage || actions.length <= 1) return actions;

  const nowMs = typeof input.nowMs === 'number' ? input.nowMs : Date.now();
  const totalUses = Object.values(usage).reduce((sum, row) => sum + Math.max(0, Math.floor(asFiniteNumber(row.count))), 0);

  // Guardrail: avoid noisy reordering early. Until we have signal, keep defaults.
  if (totalUses < 10) return actions;

  const scored = actions.map((a) => {
    const row = usage[a.id];
    const score = row ? scoreRow(row, nowMs) : 0;
    return { action: a, score };
  });

  const byId = new Map<string, number>();
  scored.forEach((row) => byId.set(row.action.id, row.score));

  const MIN_SCORE_DELTA_TO_SWAP = 0.35;
  const ranked = [...actions].sort((a, b) => {
    const sa = byId.get(a.id) || 0;
    const sb = byId.get(b.id) || 0;
    const delta = sb - sa;
    if (Math.abs(delta) < MIN_SCORE_DELTA_TO_SWAP) {
      return a.defaultRank - b.defaultRank;
    }
    if (delta !== 0) return delta > 0 ? 1 : -1;
    return a.defaultRank - b.defaultRank;
  });

  return ranked;
}

export function getQuickActionPersonalizationState(
  usage: QuickActionUsageMap | null | undefined,
  fallbackReason?: string | null
): QuickActionPersonalizationState {
  if (fallbackReason) return 'fallback';
  if (!usage) return 'insufficient_signal';
  const totalUses = Object.values(usage).reduce((sum, row) => sum + Math.max(0, Math.floor(asFiniteNumber(row.count))), 0);
  if (totalUses < 10) return 'insufficient_signal';
  return 'active';
}

export function buildQuickActionTransparencyRows(input: {
  actionIds: string[];
  usage: QuickActionUsageMap | null | undefined;
  fallbackReason?: string | null;
}): QuickActionTransparencyRow[] {
  const ids = Array.isArray(input.actionIds) ? input.actionIds.filter(Boolean) : [];
  const usage = input.usage || {};
  const state = getQuickActionPersonalizationState(input.usage, input.fallbackReason);
  const now = Date.now();
  return ids.map((actionId) => {
    const row = usage[actionId] || { count: 0, lastUsedAtMs: 0 };
    const ageHours =
      row.lastUsedAtMs > 0 ? Math.max(0, Math.round((now - row.lastUsedAtMs) / (60 * 60 * 1000))) : null;
    let reason = 'Default ordering';
    if (state === 'fallback') {
      reason = 'Default ordering (personalization unavailable)';
    } else if (row.count > 0 && ageHours != null) {
      reason = ageHours <= 24 ? `Used ${row.count}x, active recently` : `Used ${row.count}x, less recent`;
    } else if (state === 'active') {
      reason = 'Available but lower usage than top actions';
    }
    return {
      actionId,
      count: row.count,
      lastUsedAtMs: row.lastUsedAtMs,
      reason,
    };
  });
}
