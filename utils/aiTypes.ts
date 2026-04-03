export type AiSurface = 'home' | 'stats' | 'post_run' | 'weekly_recap';

export type AiInsightCategory = 'consistency' | 'running' | 'nutrition' | 'hydration' | 'challenges';

export type AiConfidenceLevel = 'low' | 'medium' | 'high';

export type AiSeverity = 'info' | 'nudge' | 'caution';

export type AiToneClass = 'neutral' | 'encouraging' | 'cautionary';

export type AiInsightType = 'consistency' | 'running' | 'streak' | 'challenge' | 'nutrition' | 'hydration';

export type AiEvidenceRefs = {
  dates?: string[];
  logIds?: string[];
  runId?: string;
  challengeIds?: string[];
  metrics?: Record<string, number | string | boolean | null>;
};

export type AiInsight = {
  insightId: string;
  insightType: AiInsightType;
  confidenceLevel: AiConfidenceLevel;
  evidenceSummary: string;
  evidenceRefs: AiEvidenceRefs;
  triggerReason: string;
  recommendedAction?: string;
  toneClass: AiToneClass;
  expirationRule: string;
  severity: AiSeverity;
  text: string;
  surface: AiSurface;
  fingerprint: string;
};

export type AiInsightCandidate = Omit<AiInsight, 'insightId' | 'text' | 'surface' | 'fingerprint'>;

export type AiInsightFrequency = 'minimal' | 'standard';

export type AiSettings = {
  enabled: boolean;
  frequency: AiInsightFrequency;
  categories: Record<AiInsightCategory, boolean>;
  neverDuringActivity: boolean;
};

export type AiRuntimeState = {
  shownBySurfaceDay: Partial<Record<AiSurface, string>>;
  dismissedBySurfaceDay: Partial<Record<AiSurface, string>>;
  recentInsights: Array<{
    insightType: AiInsightType;
    fingerprint: string;
    shownDate: string;
  }>;
};
