import type { AiInsightCandidate } from './aiTypes';

function hashToIndex(seed: string, mod: number): number {
  if (mod <= 1) return 0;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % mod;
}

function softPrefix(confidence: AiInsightCandidate['confidenceLevel']): string {
  if (confidence === 'high') return '';
  if (confidence === 'medium') return 'Based on recent logs, ';
  return 'Based on limited logged data, ';
}

function buildVariants(candidate: AiInsightCandidate): string[] {
  const prefix = softPrefix(candidate.confidenceLevel);
  const action = candidate.recommendedAction ? ` ${candidate.recommendedAction}` : '';

  return [
    `${prefix}${candidate.evidenceSummary}${action}`.trim(),
    `${prefix}${candidate.triggerReason} ${candidate.evidenceSummary}${action}`.trim(),
    `${prefix}${candidate.evidenceSummary} One option could be: ${candidate.recommendedAction || 'keep logging consistently.'}`.trim(),
  ];
}

export function renderInsightText(candidate: AiInsightCandidate, seed: string): string {
  const variants = buildVariants(candidate);
  return variants[hashToIndex(seed, variants.length)];
}
