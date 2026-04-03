export const GARMIN_PROTOCOL_VERSION = 1;

export type GarminWorkoutState =
  | 'idle'
  | 'ready'
  | 'recording'
  | 'paused'
  | 'endingConfirm'
  | 'ended'
  | 'saved'
  | 'discarded'
  | 'error'
  | 'fatal';

export type GarminCommandType =
  | 'start'
  | 'pause'
  | 'resume'
  | 'requestEnd'
  | 'confirmEnd'
  | 'cancelEnd'
  | 'save'
  | 'discard'
  | 'entitlementRequest'
  | 'syncPending';

export type GarminMessageType =
  | 'HELLO'
  | 'WORKOUT_STARTED'
  | 'WORKOUT_PAUSED'
  | 'WORKOUT_RESUMED'
  | 'WORKOUT_STOPPED'
  | 'WORKOUT_SAVED'
  | 'WORKOUT_DISCARDED'
  | 'ENTITLEMENT_REQUEST'
  | 'ACK'
  | 'ENTITLEMENT_STATE'
  | 'LINK_STATUS'
  | 'CONFIG_PUSH';

export type GarminEntitlementFeature =
  | 'garmin_recording_basic'
  | 'garmin_live_metrics_basic'
  | 'garmin_sync_summary'
  | 'garmin_analytics_advanced'
  | 'garmin_trends_deep'
  | 'garmin_coaching_insights'
  | 'garmin_config_profiles';

export type GarminEntitlementState = {
  isPremium: boolean;
  source: 'mobile_cache' | 'backend' | 'unknown';
  serverTimestamp: string;
  expiresAt: string | null;
  featuresEnabled: GarminEntitlementFeature[];
};

export type GarminWorkoutSummary = {
  localSessionId: string;
  watchAppInstallId?: string;
  sportType: string;
  startTimestamp: string;
  endTimestamp: string;
  elapsedTimeSeconds: number;
  distanceMeters: number | null;
  avgHeartRate: number | null;
  // HR truth: watch payload may include HR, but we never imply HR unless explicitly present.
  // When absent/false, the mobile import must treat HR as unavailable.
  hrAvailable?: boolean;
  maxHeartRate?: number | null;
  hrCoverageRatio?: number | null;
  calories: number | null;
  fitFileSaved: boolean;
  // True when the watch app had to "recover" after a crash/restart. Connect IQ cannot reattach to the
  // original ActivityRecording session, so FIT + metrics may be partial.
  sessionRecovered?: boolean;
  recoveryReason?: string | null;
  recoveryDetectedAt?: string | null;
  recoveryNotes?: string | null;
  deviceModel?: string;
  source: 'garmin_watch';
};

export type GarminMessageEnvelope<TPayload = Record<string, unknown>> = {
  messageId: string;
  protocolVersion: number;
  messageType: GarminMessageType;
  sentAt: string;
  source: 'watch' | 'phone';
  watchAppInstallId?: string;
  localSessionId?: string;
  payload: TPayload;
};

export type GarminConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'bridge_unavailable'
  | 'feature_disabled';

export const GARMIN_FREE_FEATURES: GarminEntitlementFeature[] = [
  'garmin_recording_basic',
  'garmin_live_metrics_basic',
  'garmin_sync_summary',
];

export const GARMIN_PREMIUM_FEATURES: GarminEntitlementFeature[] = [
  'garmin_analytics_advanced',
  'garmin_trends_deep',
  'garmin_coaching_insights',
  'garmin_config_profiles',
];

export function createGarminMessageId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.round(Math.random() * 100000)}`;
}
