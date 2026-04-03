import { todayKey } from './storageUtils';
import {
  canRenderAiSurface,
  dismissAiForToday,
  getAiSettings,
  hasRecentMatchingInsight,
  markAiInsightShown,
  wasAiDismissedToday,
} from './aiOverlay';
import { renderInsightText } from './aiLanguageTemplates';
import { getHomeInsightCandidates, getPostRunInsightCandidates, getStatsInsightCandidates } from './aiInsightRules';
import { buildHomeTruth, buildPostRunTruth, buildStatsTruth, type HomeTruthInput, type PostRunTruthInput, type StatsTruthInput } from './aiTruthLayer';
import type { AiInsight, AiInsightCandidate, AiInsightCategory, AiSurface } from './aiTypes';

const insightCacheBySurfaceDay = new Map<string, AiInsight[]>();

function mapTypeToCategory(type: AiInsight['insightType']): AiInsightCategory {
  if (type === 'nutrition') return 'nutrition';
  if (type === 'hydration') return 'hydration';
  if (type === 'running') return 'running';
  if (type === 'challenge') return 'challenges';
  return 'consistency';
}

function buildFingerprint(candidate: AiInsightCandidate): string {
  return JSON.stringify({
    t: candidate.insightType,
    c: candidate.confidenceLevel,
    m: candidate.evidenceRefs.metrics || {},
    d: candidate.evidenceRefs.dates || [],
    r: candidate.triggerReason,
  });
}

function shortHash(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 33 + seed.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

function buildInsightId(surface: AiSurface, candidate: AiInsightCandidate, fingerprint: string, date: string): string {
  return `ai_${surface}_${candidate.insightType}_${date}_${shortHash(fingerprint).slice(0, 10)}`;
}

async function finalizeInsights(surface: AiSurface, candidates: AiInsightCandidate[], maxInsights: number): Promise<AiInsight[]> {
  const settings = await getAiSettings();
  const date = todayKey();

  const filteredByCategory = candidates.filter((candidate) => settings.categories[mapTypeToCategory(candidate.insightType)] !== false);
  const out: AiInsight[] = [];

  for (const candidate of filteredByCategory) {
    if (out.length >= maxInsights) break;

    const fingerprint = buildFingerprint(candidate);
    const recentlyShown = await hasRecentMatchingInsight(candidate.insightType, fingerprint, 7);
    if (recentlyShown) continue;

    const text = renderInsightText(candidate, `${surface}_${date}_${candidate.insightType}_${fingerprint}`);
    out.push({
      ...candidate,
      surface,
      fingerprint,
      insightId: buildInsightId(surface, candidate, fingerprint, date),
      text,
    });
  }

  return out;
}

async function canShowSurfaceInsights(surface: AiSurface): Promise<boolean> {
  const cacheKey = `${surface}:${todayKey()}`;
  if (insightCacheBySurfaceDay.has(cacheKey)) return true;
  const allowed = await canRenderAiSurface(surface);
  if (!allowed) return false;
  const dismissed = await wasAiDismissedToday(surface);
  if (dismissed) return false;

  return true;
}

function getCachedSurfaceInsights(surface: AiSurface): AiInsight[] {
  return insightCacheBySurfaceDay.get(`${surface}:${todayKey()}`) || [];
}

function setCachedSurfaceInsights(surface: AiSurface, insights: AiInsight[]): void {
  insightCacheBySurfaceDay.set(`${surface}:${todayKey()}`, insights);
}

export async function getHomeInsights(input: HomeTruthInput): Promise<AiInsight[]> {
  const cached = getCachedSurfaceInsights('home');
  if (cached.length > 0) return cached;
  if (!(await canShowSurfaceInsights('home'))) return [];
  const truth = buildHomeTruth(input);
  const candidates = getHomeInsightCandidates(truth);
  const settings = await getAiSettings();
  const maxInsights = settings.frequency === 'standard' ? 1 : 1;
  const insights = await finalizeInsights('home', candidates, maxInsights);
  if (insights.length > 0) setCachedSurfaceInsights('home', insights);
  return insights;
}

export async function getStatsInsights(input: StatsTruthInput): Promise<AiInsight[]> {
  const cached = getCachedSurfaceInsights('stats');
  if (cached.length > 0) return cached;
  if (!(await canShowSurfaceInsights('stats'))) return [];
  const truth = buildStatsTruth(input);
  const candidates = getStatsInsightCandidates(truth);
  const settings = await getAiSettings();
  const maxInsights = settings.frequency === 'standard' ? 1 : 1;
  const insights = await finalizeInsights('stats', candidates, maxInsights);
  if (insights.length > 0) setCachedSurfaceInsights('stats', insights);
  return insights;
}

export async function getWeeklyRecapInsights(input: StatsTruthInput): Promise<AiInsight[]> {
  const cached = getCachedSurfaceInsights('weekly_recap');
  if (cached.length > 0) return cached;
  if (!(await canShowSurfaceInsights('weekly_recap'))) return [];
  const truth = buildStatsTruth(input);
  const candidates = getStatsInsightCandidates(truth);
  const insights = await finalizeInsights('weekly_recap', candidates, 1);
  if (insights.length > 0) setCachedSurfaceInsights('weekly_recap', insights);
  return insights;
}

export async function getPostRunInsights(input: PostRunTruthInput): Promise<AiInsight[]> {
  const cached = getCachedSurfaceInsights('post_run');
  if (cached.length > 0) return cached;
  if (!(await canShowSurfaceInsights('post_run'))) return [];
  const truth = buildPostRunTruth(input);
  const candidates = getPostRunInsightCandidates(truth);
  const settings = await getAiSettings();
  const maxInsights = settings.frequency === 'standard' ? 2 : 1;
  const insights = await finalizeInsights('post_run', candidates, Math.min(2, maxInsights));
  if (insights.length > 0) setCachedSurfaceInsights('post_run', insights);
  return insights;
}

export async function acknowledgeSurfaceInsights(insights: AiInsight[]): Promise<void> {
  if (!insights.length) return;
  await Promise.all(
    insights.map((insight) =>
      markAiInsightShown(insight.surface, {
        insightType: insight.insightType,
        fingerprint: insight.fingerprint,
      })
    )
  );
}

export async function dismissSurfaceInsights(surface: AiSurface): Promise<void> {
  insightCacheBySurfaceDay.delete(`${surface}:${todayKey()}`);
  await dismissAiForToday(surface);
}
