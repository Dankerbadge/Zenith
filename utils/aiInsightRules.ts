import type { AiConfidenceLevel, AiInsightCandidate } from './aiTypes';
import type { HomeTruth, PostRunTruth, StatsTruth } from './aiTruthLayer';

function mapConfidence(score: 'none' | 'partial' | 'good' | 'strong'): AiConfidenceLevel {
  if (score === 'strong') return 'high';
  if (score === 'good') return 'medium';
  return 'low';
}

export function getHomeInsightCandidates(truth: HomeTruth): AiInsightCandidate[] {
  const confidence = mapConfidence(truth.dayConfidence);

  if (truth.winningDay) {
    return [
      {
        insightType: 'consistency',
        confidenceLevel: confidence,
        evidenceSummary: `Today is already a winning day with ${truth.workoutsCount} workout logs and ${truth.restMinutes} active rest minutes.`,
        evidenceRefs: { dates: [truth.dateKey], metrics: { workoutsCount: truth.workoutsCount, restMinutes: truth.restMinutes, winningDay: true } },
        triggerReason: 'Winning day condition satisfied.',
        recommendedAction: 'Keep your next log simple and repeatable.',
        toneClass: 'encouraging',
        expirationRule: 'Expires at local day rollover.',
        severity: 'info',
      },
    ];
  }

  if (truth.activityGapMin > 0) {
    return [
      {
        insightType: 'consistency',
        confidenceLevel: confidence,
        evidenceSummary: `${truth.activityGapMin} active-rest minutes remain to reach today\'s recovery target.`,
        evidenceRefs: { dates: [truth.dateKey], metrics: { activityGapMin: truth.activityGapMin, restMinutes: truth.restMinutes, target: truth.activeRestTargetMin } },
        triggerReason: 'Activity target remains open.',
        recommendedAction: `Log ${truth.activityGapMin} minutes of active rest.`,
        toneClass: 'neutral',
        expirationRule: 'Expires at local day rollover.',
        severity: 'nudge',
      },
    ];
  }

  if (truth.waterGapOz > 0) {
    return [
      {
        insightType: 'hydration',
        confidenceLevel: confidence,
        evidenceSummary: `Hydration is ${truth.waterGapOz} oz below today\'s target.`,
        evidenceRefs: { dates: [truth.dateKey], metrics: { waterGapOz: truth.waterGapOz, water: truth.water, target: truth.waterTargetOz } },
        triggerReason: 'Hydration target has remaining gap.',
        recommendedAction: `Add ${truth.waterGapOz} oz across your next two check-ins.`,
        toneClass: 'neutral',
        expirationRule: 'Expires at local day rollover.',
        severity: 'nudge',
      },
    ];
  }

  if (truth.proteinGapG > 0) {
    return [
      {
        insightType: 'nutrition',
        confidenceLevel: confidence,
        evidenceSummary: `Protein is ${truth.proteinGapG}g below today\'s target.`,
        evidenceRefs: { dates: [truth.dateKey], metrics: { proteinGapG: truth.proteinGapG, protein: truth.protein, target: truth.proteinTarget } },
        triggerReason: 'Protein target has remaining gap.',
        recommendedAction: `Add about ${truth.proteinGapG}g protein to your next meal.`,
        toneClass: 'neutral',
        expirationRule: 'Expires at local day rollover.',
        severity: 'nudge',
      },
    ];
  }

  return [
    {
      insightType: 'consistency',
      confidenceLevel: confidence,
      evidenceSummary: 'Today has enough logged signal to keep trends stable.',
      evidenceRefs: { dates: [truth.dateKey], metrics: { workoutsCount: truth.workoutsCount, water: truth.water, protein: truth.protein } },
      triggerReason: 'No immediate gap is critical.',
      recommendedAction: 'Keep the same logging cadence through the evening.',
      toneClass: 'encouraging',
      expirationRule: 'Expires at local day rollover.',
      severity: 'info',
    },
  ];
}

export function getStatsInsightCandidates(truth: StatsTruth): AiInsightCandidate[] {
  const confidence = mapConfidence(truth.dayConfidence);

  if (truth.daysWithAnyLog === 0) {
    return [
      {
        insightType: 'consistency',
        confidenceLevel: 'low',
        evidenceSummary: `No logged days were found in ${truth.rangeLabel}.`,
        evidenceRefs: { metrics: { daysWithAnyLog: truth.daysWithAnyLog, rangeLabel: truth.rangeLabel } },
        triggerReason: 'Selected range has no logs.',
        recommendedAction: 'Log any core metric today to start a trend baseline.',
        toneClass: 'neutral',
        expirationRule: 'Expires when new logs are added in range.',
        severity: 'info',
      },
    ];
  }

  if (truth.averageMode === 'calendar') {
    return [
      {
        insightType: 'consistency',
        confidenceLevel: confidence,
        evidenceSummary: 'Calendar-day mode includes unlogged days, so averages can look lower.',
        evidenceRefs: { metrics: { averageMode: truth.averageMode, daysWithAnyLog: truth.daysWithAnyLog } },
        triggerReason: 'Calendar denominator selected.',
        recommendedAction: 'Switch to logged-day mode for performance interpretation.',
        toneClass: 'neutral',
        expirationRule: 'Expires when mode changes.',
        severity: 'info',
      },
    ];
  }

  if (truth.proteinGapG > 0 && truth.proteinGapG >= truth.waterGapOz / 4) {
    return [
      {
        insightType: 'nutrition',
        confidenceLevel: confidence,
        evidenceSummary: `Average protein is ${truth.proteinGapG}g below your logged-day target in ${truth.rangeLabel}.`,
        evidenceRefs: { metrics: { avgProtein: truth.avgProtein, proteinTarget: truth.proteinTarget, gap: truth.proteinGapG } },
        triggerReason: 'Protein consistency is the largest nutrition gap.',
        recommendedAction: 'Add one protein-first meal anchor each day.',
        toneClass: 'neutral',
        expirationRule: 'Expires after 7 days or meaningful new logs.',
        severity: 'nudge',
      },
    ];
  }

  if (truth.waterGapOz > 0) {
    return [
      {
        insightType: 'hydration',
        confidenceLevel: confidence,
        evidenceSummary: `Average water is ${truth.waterGapOz} oz below your logged-day target in ${truth.rangeLabel}.`,
        evidenceRefs: { metrics: { avgWater: truth.avgWater, waterTargetOz: truth.waterTargetOz, gap: truth.waterGapOz } },
        triggerReason: 'Hydration consistency trails target.',
        recommendedAction: 'Use two fixed hydration check-ins per day.',
        toneClass: 'neutral',
        expirationRule: 'Expires after 7 days or meaningful new logs.',
        severity: 'nudge',
      },
    ];
  }

  return [
    {
      insightType: 'consistency',
      confidenceLevel: confidence,
      evidenceSummary: `Logged-day trends in ${truth.rangeLabel} are stable.`,
      evidenceRefs: { metrics: { daysWithAnyLog: truth.daysWithAnyLog, rangeLabel: truth.rangeLabel } },
      triggerReason: 'No major consistency gap detected.',
      recommendedAction: 'Maintain this cadence for another week to strengthen trend confidence.',
      toneClass: 'encouraging',
      expirationRule: 'Expires after 7 days or meaningful new logs.',
      severity: 'info',
    },
  ];
}

export function getPostRunInsightCandidates(truth: PostRunTruth): AiInsightCandidate[] {
  const candidates: AiInsightCandidate[] = [];

  if (truth.routePrHit || truth.segmentPrHits > 0) {
    candidates.push({
      insightType: 'running',
      confidenceLevel: 'high',
      evidenceSummary: `This run hit ${truth.routePrHit ? 'a route PR' : 'no route PR'} and ${truth.segmentPrHits} segment PRs.`,
      evidenceRefs: {
        runId: truth.runId,
        metrics: {
          routePrHit: truth.routePrHit,
          segmentPrHits: truth.segmentPrHits,
          distanceMiles: Number(truth.distanceMiles.toFixed(2)),
          durationSec: truth.durationSec,
        },
      },
      triggerReason: 'PR events were detected on save.',
      recommendedAction: 'Recover well and repeat this route profile soon.',
      toneClass: 'encouraging',
      expirationRule: 'Expires after this run summary is dismissed.',
      severity: 'info',
    });
  }

  candidates.push({
    insightType: 'running',
    confidenceLevel: truth.distanceMiles >= 2 ? 'medium' : 'low',
    evidenceSummary: `Run logged at ${truth.distanceMiles.toFixed(2)} miles in ${truth.durationSec} seconds.`,
    evidenceRefs: {
      runId: truth.runId,
      metrics: {
        distanceMiles: Number(truth.distanceMiles.toFixed(2)),
        durationSec: truth.durationSec,
        avgPaceSecPerMile: Math.round(truth.avgPaceSecPerMile),
      },
    },
    triggerReason: 'Post-run summary is available after save.',
    recommendedAction: 'Use this run as your baseline for the next session.',
    toneClass: 'neutral',
    expirationRule: 'Expires after this run summary is dismissed.',
    severity: 'info',
  });

  if (truth.winningDayAfter) {
    candidates.push({
      insightType: 'challenge',
      confidenceLevel: 'high',
      evidenceSummary: `This run contributed to a winning day and keeps your streak at ${truth.streakAfter}.`,
      evidenceRefs: { runId: truth.runId, metrics: { winningDayAfter: true, streakAfter: truth.streakAfter } },
      triggerReason: 'Winning-day state changed after run save.',
      recommendedAction: 'Keep tomorrow\'s target simple to protect momentum.',
      toneClass: 'encouraging',
      expirationRule: 'Expires at local day rollover.',
      severity: 'info',
    });
  }

  return candidates;
}
