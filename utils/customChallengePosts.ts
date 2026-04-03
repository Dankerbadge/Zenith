export type CustomChallengeMetric = 'distance_mi' | 'workouts' | 'xp';
export type CustomChallengeScope = 'friend' | 'team';

export type CustomChallengePayload = {
  schemaVersion: 1;
  title: string;
  metric: CustomChallengeMetric;
  targetValue: number;
  unitLabel: string;
  windowDays: number;
  rewardXp: number;
  note?: string;
  scope: CustomChallengeScope;
  createdByUserId: string;
  createdAtIso: string;
  expiresAtIso: string;
};

const METRIC_META: Record<CustomChallengeMetric, { unitLabel: string; verb: string }> = {
  distance_mi: { unitLabel: 'mi', verb: 'Cover' },
  workouts: { unitLabel: 'workouts', verb: 'Complete' },
  xp: { unitLabel: 'XP', verb: 'Earn' },
};

function asFiniteNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function buildCustomChallengePayload(input: {
  title: string;
  metric: CustomChallengeMetric;
  targetValue: number;
  windowDays: number;
  rewardXp: number;
  note?: string;
  scope: CustomChallengeScope;
  createdByUserId: string;
  nowIso?: string;
}): CustomChallengePayload {
  const nowIso = input.nowIso || new Date().toISOString();
  const targetValue = clamp(asFiniteNumber(input.targetValue), 1, 1000000);
  const windowDays = clamp(Math.round(asFiniteNumber(input.windowDays)), 1, 90);
  const rewardXp = clamp(Math.round(asFiniteNumber(input.rewardXp)), 0, 10000);
  const expiresAtIso = new Date(Date.parse(nowIso) + windowDays * 24 * 60 * 60 * 1000).toISOString();
  const metricMeta = METRIC_META[input.metric];
  return {
    schemaVersion: 1,
    title: String(input.title || '').trim() || 'Custom challenge',
    metric: input.metric,
    targetValue,
    unitLabel: metricMeta.unitLabel,
    windowDays,
    rewardXp,
    note: String(input.note || '').trim() || undefined,
    scope: input.scope,
    createdByUserId: String(input.createdByUserId || ''),
    createdAtIso: nowIso,
    expiresAtIso,
  };
}

export function parseCustomChallengePayload(raw: any): CustomChallengePayload | null {
  const src = raw?.customChallenge || raw;
  if (!src || typeof src !== 'object') return null;
  const metric = String(src.metric || '').trim() as CustomChallengeMetric;
  if (metric !== 'distance_mi' && metric !== 'workouts' && metric !== 'xp') return null;
  const scope = String(src.scope || '').trim() as CustomChallengeScope;
  if (scope !== 'friend' && scope !== 'team') return null;
  const title = String(src.title || '').trim();
  if (!title) return null;
  const targetValue = asFiniteNumber(src.targetValue);
  const windowDays = asFiniteNumber(src.windowDays);
  const rewardXp = asFiniteNumber(src.rewardXp);
  const payload: CustomChallengePayload = {
    schemaVersion: 1,
    title,
    metric,
    targetValue: clamp(targetValue, 1, 1000000),
    unitLabel: String(src.unitLabel || METRIC_META[metric].unitLabel),
    windowDays: clamp(Math.round(windowDays), 1, 90),
    rewardXp: clamp(Math.round(rewardXp), 0, 10000),
    note: String(src.note || '').trim() || undefined,
    scope,
    createdByUserId: String(src.createdByUserId || ''),
    createdAtIso: String(src.createdAtIso || ''),
    expiresAtIso: String(src.expiresAtIso || ''),
  };
  return payload;
}

export function customChallengeSummary(payload: CustomChallengePayload): string {
  const meta = METRIC_META[payload.metric];
  const valueText =
    payload.metric === 'distance_mi' ? `${Number(payload.targetValue).toFixed(1)} ${payload.unitLabel}` : `${Math.round(payload.targetValue)} ${payload.unitLabel}`;
  return `${meta.verb} ${valueText} in ${payload.windowDays}d • +${Math.round(payload.rewardXp)} XP`;
}
