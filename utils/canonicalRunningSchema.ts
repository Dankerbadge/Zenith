export const RUNNING_SCHEMA_VERSION = 2;

export type RunKind = 'gps_outdoor' | 'manual_treadmill' | 'manual_distance';
export type RunState = 'idle' | 'ready' | 'tracking' | 'paused' | 'ended' | 'saved' | 'discarded';
export type Visibility = 'private' | 'friends' | 'club' | 'public';
export type QualityTier = 'high' | 'medium' | 'low' | 'unknown';
export type GpsSignalState = 'good' | 'degraded' | 'lost' | 'recovered' | 'unknown';

export type ChallengeStatus = 'draft' | 'active' | 'expired' | 'completed' | 'failed' | 'cancelled';
export type ChallengeAcceptanceStatus = 'pending' | 'accepted' | 'declined' | 'expired_unaccepted' | 'revoked';
export type ChallengeType =
  | 'segment_beat_last_by_seconds'
  | 'segment_pace_under_threshold'
  | 'segment_attempts_count_in_window'
  | 'route_attempts_count_in_window'
  | 'weekly_distance_goal'
  | 'run_complete_minimum_threshold';
export type OutcomeStatus = 'pass' | 'fail' | 'no_attempt' | 'invalid_data';

export type CanonicalRun = {
  runId: string;
  userId: string;
  routeId?: string | null;
  kind: RunKind;
  state: RunState;
  startTimeUtc: string;
  endTimeUtc?: string | null;
  elapsedTimeSec: number;
  movingTimeSec?: number | null;
  pausedTimeSec: number;
  distanceMeters?: number | null;
  distanceSource: 'gps_measured' | 'user_entered' | 'estimated';
  avgPaceSecPerKm?: number | null;
  avgPaceSecPerMile?: number | null;
  paceSource: 'derived_from_gps' | 'derived_from_user_entry' | 'estimated';
  elevationGainMeters?: number | null;
  elevationLossMeters?: number | null;
  elevationSource: 'gps_measured' | 'estimated' | 'unknown';
  samplesRef?: string | null;
  samplesSummary?: {
    totalSamples: number;
    avgAccuracyMeters?: number;
    maxAccuracyMeters?: number;
    samplingStrategyId?: string;
  } | null;
  polylineSimplifiedRef?: string | null;
  polylineBounds?: { minLat: number; minLon: number; maxLat: number; maxLon: number } | null;
  gpsQuality?: QualityTier;
  gpsSignalState?: GpsSignalState;
  dataQualityNotes?: string[];
  gapSegments?: Array<{
    gapId: string;
    startTimeUtc: string;
    endTimeUtc: string;
    type: 'degraded_gap' | 'lost_gap';
    // NOTE: `gps_low_confidence` is the current honest label used by the on-device run engine for any
    // distance accumulated while GPS confidence is degraded/lost. Keep legacy values for stored runs.
    estimatorUsed: 'none' | 'gps_low_confidence' | 'watch_motion' | 'interpolate' | 'hybrid';
    estimatedDistanceMeters: number;
    confidenceScore: number;
  }>;
  estimatedDistanceMeters?: number;
  // P0 truthfulness: HR must never be implied unless explicitly recorded.
  // When hrAvailable !== true, UI must show "Heart rate: Unavailable" and must not show HR confidence.
  hrAvailable?: boolean;
  confidenceSummary?: {
    distanceConfidence: number;
    paceConfidence: number;
    // P0 truthfulness: null when HR samples/metrics are not present.
    hrConfidence: number | null;
  };
  metricVersions?: {
    accuracyModelVersion: string;
    gpsProcessingVersion: string;
    strideModelVersion: string;
    calorieFormulaVersion: string;
    splitLogicVersion: string;
    confidenceModelVersion: string;
    refinementModelVersion: string;
  };
  metricsLock?: {
    metricsImmutable: boolean;
    metricsLockedAtUtc: string;
    sessionIntegrityState: 'pending' | 'finalized';
  };
  title?: string;
  notes?: string;
  perceivedEffortRpe?: number;
  intensityLabel?: 'easy' | 'moderate' | 'hard';
  trainingLoadScoreEstimated?: number;
  xpAwarded?: number;
  winningDayContribution?: {
    eligible: boolean;
    reasonCodes: string[];
  };
  measuredLabel: 'measured' | 'estimated' | 'user_entered';
  createdAtUtc: string;
  updatedAtUtc: string;
  schemaVersion: number;
};

export type CanonicalSegment = {
  segmentId: string;
  userId: string;
  routeId?: string;
  visibility: Visibility;
  name: string;
  startMarker: { lat: number; lon: number; toleranceRadiusMeters: number };
  endMarker: { lat: number; lon: number; toleranceRadiusMeters: number };
  direction: 'forward' | 'reverse' | 'either';
  segmentDistanceMetersApprox: number;
  allowMultipleAttemptsPerRun: boolean;
  minAttemptDurationSec?: number;
  maxAttemptDurationSec?: number;
  createdAtUtc: string;
  updatedAtUtc: string;
  schemaVersion: number;
};

export type CanonicalChallengeDefinition = {
  challengeId: string;
  creatorUserId: string;
  visibility: Visibility;
  status: ChallengeStatus;
  type: ChallengeType;
  title: string;
  description?: string;
  startTimeUtc: string;
  endTimeUtc: string;
  timezoneContext: string;
  targetSegmentId?: string | null;
  targetRouteId?: string | null;
  requiredAttemptsCount?: number | null;
  beatBySeconds?: number | null;
  paceThresholdSecPerKm?: number | null;
  paceThresholdSecPerMile?: number | null;
  weeklyDistanceMeters?: number | null;
  minRunDistanceMetersForEligibility?: number | null;
  minRunDurationSecForEligibility?: number | null;
  eligibleRunKinds: RunKind[];
  grantsWinningDayCredit?: boolean;
  rewardXp: number;
  penaltyXp: number;
  rewardBadgeId?: string | null;
  penaltyRule: 'none' | 'if_accepted_and_failed' | 'if_accepted_and_no_attempt';
  evaluationMode:
    | 'best_attempt_in_window'
    | 'first_attempt_in_window'
    | 'cumulative_attempts_in_window'
    | 'cumulative_distance_in_window';
  tieBreakPolicy: 'earliest_completion' | 'fastest_time' | 'highest_quality';
  createdAtUtc: string;
  updatedAtUtc: string;
  schemaVersion: number;
};

export type CanonicalChallengeParticipant = {
  participantId: string;
  challengeId: string;
  userId: string;
  acceptanceStatus: ChallengeAcceptanceStatus;
  invitedAtUtc?: string | null;
  respondedAtUtc?: string | null;
  acceptedAtUtc?: string | null;
  declinedAtUtc?: string | null;
  revokedAtUtc?: string | null;
  expiresUnacceptedAtUtc?: string | null;
  outcomeStatus: OutcomeStatus;
  outcomeEvaluatedAtUtc?: string | null;
  outcomeReasonCodes: string[];
  linkedRunIds: string[];
  linkedAttemptIds: string[];
  xpAwarded?: number | null;
  xpPenalized?: number | null;
  xpSettlementDelta?: number;
  xpSettlementAppliedAtUtc?: string | null;
  minQualityRequired: QualityTier;
  invalidationReasons: string[];
  createdAtUtc: string;
  updatedAtUtc: string;
  schemaVersion: number;
};

export function nowUtcIso() {
  return new Date().toISOString();
}

export function asVisibility(isPrivate?: boolean, visibility?: Visibility): Visibility {
  if (visibility) return visibility;
  return isPrivate === false ? 'friends' : 'private';
}
