import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AppState, BackHandler, Linking, StyleSheet, Text, View, TouchableOpacity, Alert, Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  type ConfidenceLevel,
  calculateDistance,
  createRunTrackingEngine,
  formatDuration,
  formatPace,
  type LiveMetricDisplayState,
  type LocationPoint,
  type Reaction,
  requestLocationPermissions,
  requestBackgroundLocationPermissions,
  startLocationTracking,
  calculatePace,
  calculateRunningCalories,
  resetRunTrackingEngine,
  type RunTrackingEngineState,
  type TrackingSampleProfile,
  updateRunTrackingEngine,
} from '../utils/gpsService';
import { createRunMetricVersionSet } from '../utils/runMetricVersions';
import { stagePendingRun } from '../utils/runReviewService';
import { calculateRunningDistanceXP } from '../utils/xpSystem';
import { transitionOrThrow, type RunLifecycleState } from '../utils/runStateMachine';
import { getUserProfile } from '../utils/storageUtils';
import { getTrackingPriorityPreference, setTrackingPriorityPreference } from '../utils/liveTrackingPreferences';
import { APP_CONFIG } from '../utils/appConfig';
import {
  consumeRunCommand,
  createSessionId,
  clearActiveRunSnapshot,
  clearOrphanRunResolutionIntent,
  getActiveRunSnapshot,
  getQueuedRunCommands,
  logRunSyncEvent,
  putRunCommandAck,
  consumeOrphanRunResolutionIntent,
  type RunCommandRequest,
  type RunControlState,
  upsertActiveRunSnapshot,
} from '../utils/runControlSync';
import { syncLiveActivityWithSnapshot } from '../utils/runNativeBridge';
import {
  clearRunBackgroundLocationQueue,
  consumeRunBackgroundLocationQueue,
  startRunBackgroundLocationTracking,
  stopRunBackgroundLocationTracking,
} from '../utils/runBackgroundLocation';
import ExplainSheet from '../components/ui/ExplainSheet';

type GpsSignalState = 'good' | 'degraded' | 'lost' | 'recovered';
type GapEstimatorUsed = 'none' | 'gps_low_confidence' | 'interpolate' | 'hybrid';

type RunGapSegment = {
  gapId: string;
  startTimeUtc: string;
  endTimeUtc: string;
  type: 'degraded_gap' | 'lost_gap';
  estimatorUsed: GapEstimatorUsed;
  estimatedDistanceMiles: number;
  confidenceScore: number;
};

function livePaceLabel(state: LiveMetricDisplayState, pace: number, runState: RunLifecycleState) {
  if (runState === 'paused') return 'PAUSED';
  if (state === 'unavailable') return "--'--\"";
  if (state === 'acquiring') return "--'--\"";
  return formatPace(pace);
}

function showEstimatedPaceBadge(state: LiveMetricDisplayState, pace: number, runState: RunLifecycleState) {
  return runState === 'tracking' && state === 'live_estimated' && Number.isFinite(pace) && pace > 0;
}

function gpsSignalBadgeLabel(state: GpsSignalState) {
  if (state === 'good') return 'GPS GOOD';
  if (state === 'degraded') return 'GPS DEGRADED';
  if (state === 'lost') return 'GPS LOST';
  return 'GPS RECOVERED';
}

function livePaceHint(input: {
  paceState: LiveMetricDisplayState;
  confidence: ConfidenceLevel;
  sourceTag: 'gps' | 'fused' | 'estimated';
  gpsSignalState: GpsSignalState;
  estimationCapped: boolean;
}) {
  const { paceState, confidence, sourceTag, gpsSignalState, estimationCapped } = input;
  if (gpsSignalState === 'lost') {
    if (estimationCapped) return 'GPS lost — estimation capped, time still running';
    return sourceTag === 'estimated'
      ? 'GPS lost — estimating conservatively'
      : 'GPS lost — still tracking time and effort';
  }
  if (gpsSignalState === 'degraded') return 'GPS unstable — still tracking your run';
  if (gpsSignalState === 'recovered') return 'GPS restored — stabilizing';
  if (paceState === 'acquiring') return 'Acquiring stable pace signal';
  if (paceState === 'unavailable') return 'Pace unavailable';
  if (paceState === 'live_estimated') return sourceTag === 'estimated' ? 'Low-confidence GPS estimate' : `Estimated from ${sourceTag} signal`;
  return `GPS confidence: ${confidence}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

type RunLiveDiagnostics = {
  samples: number;
  confidence: { high: number; medium: number; low: number };
  gpsStates: { good: number; degraded: number; lost: number; recovered: number };
  paceStates: {
    live_confident: number;
    live_estimated: number;
    acquiring: number;
    unavailable: number;
    paused: number;
  };
  sourceTags: { gps: number; fused: number; estimated: number };
};

function createRunLiveDiagnostics(): RunLiveDiagnostics {
  return {
    samples: 0,
    confidence: { high: 0, medium: 0, low: 0 },
    gpsStates: { good: 0, degraded: 0, lost: 0, recovered: 0 },
    paceStates: {
      live_confident: 0,
      live_estimated: 0,
      acquiring: 0,
      unavailable: 0,
      paused: 0,
    },
    sourceTags: { gps: 0, fused: 0, estimated: 0 },
  };
}

type RunRefinementResult = {
  distance: number;
  averagePace: number;
  calories: number;
  note: string | null;
};

function refineRunSummary(input: {
  route: LocationPoint[];
  rawDistance: number;
  rawDurationSec: number;
  rawCalories: number;
  userWeightLbs: number;
}): RunRefinementResult {
  const { route, rawDistance, rawDurationSec, rawCalories, userWeightLbs } = input;
  if (!Array.isArray(route) || route.length < 2 || rawDistance <= 0) {
    const basePace = rawDistance > 0 && rawDurationSec > 0 ? calculatePace(rawDistance, rawDurationSec) : 0;
    return { distance: rawDistance, averagePace: basePace, calories: rawCalories, note: null };
  }

  let refinedDistance = 0;
  for (let i = 1; i < route.length; i += 1) {
    const prev = route[i - 1];
    const next = route[i];
    const dtSec = Math.max(0.25, (next.timestamp - prev.timestamp) / 1000);
    const segmentMiles = calculateDistance(prev.latitude, prev.longitude, next.latitude, next.longitude);
    const speedMps = (segmentMiles * 1609.344) / dtSec;
    const accuracy = Number(next.accuracy);
    const lowConfidence = Number.isFinite(accuracy) && accuracy > APP_CONFIG.LIVE_TRACKING.RUN.ACCURACY_REJECT_METERS;
    const impossibleJump = speedMps > APP_CONFIG.LIVE_TRACKING.RUN.MAX_SPEED_MPS_REFINED;
    if (lowConfidence || impossibleJump) continue;
    refinedDistance += segmentMiles;
  }

  const boundedDistance = clamp(
    refinedDistance,
    rawDistance * APP_CONFIG.LIVE_TRACKING.RUN.DISTANCE_CLAMP_LOW_RATIO,
    rawDistance * APP_CONFIG.LIVE_TRACKING.RUN.DISTANCE_CLAMP_HIGH_RATIO
  );
  const refinedPace = boundedDistance > 0 && rawDurationSec > 0 ? calculatePace(boundedDistance, rawDurationSec) : 0;
  const refinedCalories = calculateRunningCalories(boundedDistance, userWeightLbs);

  const threshold = APP_CONFIG.LIVE_TRACKING.REFINEMENT_DELTA_THRESHOLD_RATIO;
  const distanceDeltaRatio = rawDistance > 0 ? Math.abs(boundedDistance - rawDistance) / rawDistance : 0;
  const caloriesDeltaRatio = rawCalories > 0 ? Math.abs(refinedCalories - rawCalories) / rawCalories : 0;
  const changedDistance = distanceDeltaRatio > threshold;
  const changedCalories = caloriesDeltaRatio > threshold;

  let note: string | null = null;
  if (changedDistance || changedCalories) {
    const noteParts: string[] = [];
    if (changedDistance) {
      const pct = Math.round(((boundedDistance - rawDistance) / rawDistance) * 100);
      noteParts.push(`distance ${pct > 0 ? '+' : ''}${pct}%`);
    }
    if (changedCalories) {
      const pct = Math.round(((refinedCalories - rawCalories) / Math.max(1, rawCalories)) * 100);
      noteParts.push(`calories ${pct > 0 ? '+' : ''}${pct}%`);
    }
    note = `Refined after sync: ${noteParts.join(', ')}.`;
  }

  return {
    distance: Number(boundedDistance.toFixed(2)),
    averagePace: refinedPace,
    calories: refinedCalories,
    note,
  };
}

export default function LiveRunScreen() {
  const router = useRouter();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [runState, setRunState] = useState<RunLifecycleState>('ready');
  const [duration, setDuration] = useState(0);
  const [distance, setDistance] = useState(0);
  const [currentPace, setCurrentPace] = useState(0);
  const [averagePace, setAveragePace] = useState(0);
  const [paceState, setPaceState] = useState<LiveMetricDisplayState>('acquiring');
  const [gpsConfidence, setGpsConfidence] = useState<ConfidenceLevel>('low');
  const [gpsSignalState, setGpsSignalState] = useState<GpsSignalState>('good');
  const [estimationCapped, setEstimationCapped] = useState(false);
  const [paceSourceTag, setPaceSourceTag] = useState<'gps' | 'fused' | 'estimated'>('gps');
  const [route, setRoute] = useState<LocationPoint[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [userWeight, setUserWeight] = useState(180);
  const [trackingPriority, setTrackingPriority] = useState<'accuracy' | 'responsiveness'>('accuracy');
  const [trackingInfoOpen, setTrackingInfoOpen] = useState(false);
  const [endConfirmArmedUntil, setEndConfirmArmedUntil] = useState<number | null>(null);
  const [leaveGuardRequestedEnd, setLeaveGuardRequestedEnd] = useState(false);
  const [trackingIssue, setTrackingIssue] = useState<null | { kind: 'permission' | 'gps_start' | 'gps_resume'; title: string; body: string }>(null);
  const [recoveryVisible, setRecoveryVisible] = useState(false);
  const [recoverySnapshotState, setRecoverySnapshotState] = useState<RunControlState | null>(null);
  const [pendingOrphanDiscard, setPendingOrphanDiscard] = useState(false);
  
  const locationSubscription = useRef<any>(null);
  const timerInterval = useRef<any>(null);
  const runStartTime = useRef<number>(0);
  const pausedDurationMs = useRef<number>(0);
  const pauseStartedAt = useRef<number | null>(null);
  const runStateRef = useRef<RunLifecycleState>('ready');
  const onLocationUpdateRef = useRef<(location: LocationPoint) => void>(() => {});
  const samplingProfileRef = useRef<TrackingSampleProfile>('balanced');
  const lastSamplingSwitchAt = useRef<number>(0);
  const pauseEventsRef = useRef<{ pauseAtUtc: string; resumeAtUtc?: string }[]>([]);
  const finishingRef = useRef(false);
  const sessionIdRef = useRef<string>('');
  const seqRef = useRef(0);
  const lastPublishedDistanceRef = useRef(0);
  const trackingPriorityRef = useRef<'accuracy' | 'responsiveness'>('accuracy');
  const runEngineRef = useRef<RunTrackingEngineState>(createRunTrackingEngine('accuracy'));
  const diagnosticsRef = useRef<RunLiveDiagnostics>(createRunLiveDiagnostics());
  const gpsSignalStateRef = useRef<GpsSignalState>('good');
  const lastValidFixMsRef = useRef<number | null>(null);
  const lastLocationTimestampMsRef = useRef<number | null>(null);
  const recoveredAtMsRef = useRef<number | null>(null);
  const recoveryFixStreakRef = useRef(0);
  const activeGapRef = useRef<RunGapSegment | null>(null);
  const gapSegmentsRef = useRef<RunGapSegment[]>([]);

  const toggleTrackingPriority = useCallback(async () => {
    const next = trackingPriorityRef.current === 'accuracy' ? 'responsiveness' : 'accuracy';
    setTrackingPriority(next);
    trackingPriorityRef.current = next;
    runEngineRef.current = resetRunTrackingEngine(runEngineRef.current, next);
    await setTrackingPriorityPreference(next);
    void Haptics.selectionAsync().catch(() => {});
  }, []);
  const appStateRef = useRef(AppState.currentState);
  const backgroundTrackingActiveRef = useRef(false);
  const syncBackgroundModeBusyRef = useRef(false);

  useEffect(() => {
    runStateRef.current = runState;
  }, [runState]);

  useEffect(() => {
    trackingPriorityRef.current = trackingPriority;
  }, [trackingPriority]);

  useEffect(() => {
    gpsSignalStateRef.current = gpsSignalState;
  }, [gpsSignalState]);

  useEffect(() => {
    const loadProfileWeight = async () => {
      const [profile, savedPriority] = await Promise.all([
        getUserProfile(),
        getTrackingPriorityPreference(),
      ]);
      const weight = Number((profile as any)?.currentWeight);
      if (Number.isFinite(weight) && weight > 0) {
        setUserWeight(weight);
      }
      setTrackingPriority(savedPriority);
      trackingPriorityRef.current = savedPriority;
      runEngineRef.current = resetRunTrackingEngine(runEngineRef.current, savedPriority);
    };
    void loadProfileWeight();
  }, []);

  const currentControlState = useCallback((): RunControlState => {
    if (endConfirmArmedUntil && Date.now() <= endConfirmArmedUntil) return 'endingConfirm';
    if (runStateRef.current === 'tracking') return 'recording';
    if (runStateRef.current === 'paused') return 'paused';
    if (runStateRef.current === 'ended') return 'ended';
    return 'idle';
  }, [endConfirmArmedUntil]);

  const publishSnapshot = useCallback(
    async (reasonCode: 'stateChange' | 'tick' | 'metricThreshold' | 'manual') => {
      if (!sessionIdRef.current) return;
      const snapshot = {
        sessionId: sessionIdRef.current,
        state: currentControlState(),
        startedAtWatch: new Date(runStartTime.current || Date.now()).toISOString(),
        endedAtWatch: runStateRef.current === 'ended' ? new Date().toISOString() : null,
        elapsedTimeSec: duration,
        movingTimeSec: duration,
        pausedTotalSec: Math.floor(pausedDurationMs.current / 1000),
        totalDistanceMiles: distance,
        paceMinPerMile: currentPace > 0 ? currentPace : null,
        lastUpdatedAtWatch: new Date().toISOString(),
        seq: seqRef.current + 1,
        sourceDevice: 'phone' as const,
        reasonCode,
      };
      seqRef.current = snapshot.seq;
      await upsertActiveRunSnapshot(snapshot);
      await syncLiveActivityWithSnapshot(snapshot);
      logRunSyncEvent('snapshot_published', {
        sessionId: snapshot.sessionId,
        seq: snapshot.seq,
        state: snapshot.state,
        reasonCode: snapshot.reasonCode,
        distance: snapshot.totalDistanceMiles,
        elapsedTimeSec: snapshot.elapsedTimeSec,
      });
    },
    [currentControlState, currentPace, distance, duration]
  );

  const applyRunState = useCallback((next: RunLifecycleState) => {
    const current = runStateRef.current;
    try {
      const resolved = transitionOrThrow(current, next);
      setRunState(resolved);
      runStateRef.current = resolved;
      return true;
    } catch {
      return false;
    }
  }, []);

  const computeStartTimeFromSnapshot = (snapshot: { elapsedTimeSec?: number; pausedTotalSec?: number }) => {
    const elapsedSec = Math.max(0, Number(snapshot.elapsedTimeSec) || 0);
    const pausedSec = Math.max(0, Number(snapshot.pausedTotalSec) || 0);
    // live-run snapshot elapsedTimeSec is moving-time (pause excluded). Reconstruct a start time that preserves it.
    return Date.now() - (elapsedSec * 1000) - (pausedSec * 1000);
  };

  useEffect(() => {
    void (async () => {
      try {
        // Consume any one-shot orphan-resolution intent immediately so it cannot loop across launches.
        const orphanIntent = await consumeOrphanRunResolutionIntent();
        const snapshot = await getActiveRunSnapshot();
        if (!snapshot) return;
        if (snapshot.sourceDevice !== 'phone') return;
        if (snapshot.state !== 'recording' && snapshot.state !== 'paused') return;

        // Force explicit recovery. Never auto-start GPS.
        setRecoveryVisible(true);
        setRecoverySnapshotState(snapshot.state);

        sessionIdRef.current = snapshot.sessionId;
        seqRef.current = Math.max(0, Number(snapshot.seq) || 0);
        setDistance(Math.max(0, Number(snapshot.totalDistanceMiles) || 0));
        setDuration(Math.max(0, Number(snapshot.elapsedTimeSec) || 0));
        pausedDurationMs.current = Math.max(0, Number(snapshot.pausedTotalSec) || 0) * 1000;
        pauseStartedAt.current = null;
        runStartTime.current = computeStartTimeFromSnapshot(snapshot);

        // Keep session safe until the user explicitly resumes.
        applyRunState('paused');
        await publishSnapshot('stateChange');

        // If Home requested an orphan resolution action, honor it explicitly (never silently).
        if (orphanIntent === 'end') {
          // Force the end-confirm UI into view without ending automatically.
          setRecoveryVisible(false);
          setRecoverySnapshotState(null);
          setLeaveGuardRequestedEnd(true);
          setEndConfirmArmedUntil(Date.now() + 2500);
          await publishSnapshot('stateChange');
        }
        if (orphanIntent === 'discard') {
          setPendingOrphanDiscard(true);
        }
      } catch {
        // Recovery is best-effort; do not block.
      }
    })();
    // Intentional: run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeActiveGap = useCallback((endMs: number) => {
    const active = activeGapRef.current;
    if (!active) return;
    const finalized: RunGapSegment = {
      ...active,
      endTimeUtc: new Date(endMs).toISOString(),
      confidenceScore: active.confidenceScore,
      estimatedDistanceMiles: Number(active.estimatedDistanceMiles.toFixed(4)),
    };
    gapSegmentsRef.current.push(finalized);
    activeGapRef.current = null;
  }, []);

  const transitionGpsSignalState = useCallback(
    (next: GpsSignalState, atMs: number) => {
      setGpsSignalState((current) => {
        if (current === next) return current;
        if ((next === 'degraded' || next === 'lost') && !activeGapRef.current) {
          activeGapRef.current = {
            gapId: `gap_${atMs}_${Math.round(Math.random() * 1000)}`,
            startTimeUtc: new Date(atMs).toISOString(),
            endTimeUtc: new Date(atMs).toISOString(),
            type: next === 'lost' ? 'lost_gap' : 'degraded_gap',
            estimatorUsed: 'none',
            estimatedDistanceMiles: 0,
            confidenceScore: next === 'lost' ? 40 : 55,
          };
        }
        if (next === 'lost' && activeGapRef.current) {
          activeGapRef.current.type = 'lost_gap';
          activeGapRef.current.confidenceScore = Math.min(activeGapRef.current.confidenceScore, 40);
        }
        if (next === 'recovered') {
          recoveredAtMsRef.current = atMs;
        }
        if (next === 'good') {
          closeActiveGap(atMs);
        }
        if (next !== 'lost') {
          setEstimationCapped(false);
        }
        gpsSignalStateRef.current = next;
        return next;
      });
    },
    [closeActiveGap]
  );

  const stopGpsTracking = useCallback(() => {
    if (locationSubscription.current) {
      locationSubscription.current.remove();
      locationSubscription.current = null;
    }
  }, []);

  const startGpsTracking = useCallback(
    async (profile?: TrackingSampleProfile) => {
      const nextProfile = profile || samplingProfileRef.current;
      stopGpsTracking();
      samplingProfileRef.current = nextProfile;
      lastSamplingSwitchAt.current = Date.now();
      locationSubscription.current = await startLocationTracking((location) => {
        onLocationUpdateRef.current(location);
      }, nextProfile);
    },
    [stopGpsTracking]
  );

  const cleanup = useCallback(() => {
    stopGpsTracking();
    if (timerInterval.current) {
      clearInterval(timerInterval.current);
    }
  }, [stopGpsTracking]);

  const discardRunAndExit = useCallback(async () => {
    cleanup();
    applyRunState('discarded');
    const discardSnapshot = {
      sessionId: sessionIdRef.current || `session_${Date.now()}`,
      state: 'discarded' as RunControlState,
      startedAtWatch: new Date(runStartTime.current || Date.now()).toISOString(),
      endedAtWatch: new Date().toISOString(),
      elapsedTimeSec: Math.max(0, Number(duration) || 0),
      movingTimeSec: Math.max(0, Number(duration) || 0),
      pausedTotalSec: Math.floor(Math.max(0, Number(pausedDurationMs.current) || 0) / 1000),
      totalDistanceMiles: Math.max(0, Number(distance) || 0),
      paceMinPerMile: Number.isFinite(Number(currentPace)) && Number(currentPace) > 0 ? Number(currentPace) : null,
      lastUpdatedAtWatch: new Date().toISOString(),
      seq: Math.max(1, Number(seqRef.current) + 1 || 1),
      sourceDevice: 'phone' as const,
      reasonCode: 'stateChange' as const,
    };
    try {
      await publishSnapshot('stateChange');
    } catch {
      // Hard fallback: write terminal discarded state so Home cannot keep prompting stale resolve flows.
      try {
        await upsertActiveRunSnapshot(discardSnapshot);
      } catch {
        // ignore
      }
    }
    try {
      await clearActiveRunSnapshot();
    } catch {
      // Best-effort; do not block discard UX.
    }
    try {
      await syncLiveActivityWithSnapshot(null);
    } catch {
      // ignore
    }
    await stopRunBackgroundLocationTracking();
    backgroundTrackingActiveRef.current = false;
    await clearRunBackgroundLocationQueue(sessionIdRef.current);
    try {
      await clearOrphanRunResolutionIntent();
    } catch {
      // Best-effort; do not block discard UX.
    }
    setRecoveryVisible(false);
    setRecoverySnapshotState(null);
    setPendingOrphanDiscard(false);
    // Discard should exit to a deterministic, known-safe surface (not stack-dependent back behavior).
    router.replace('/(tabs)' as any);
  }, [applyRunState, cleanup, currentPace, distance, duration, publishSnapshot, router]);

  useEffect(() => {
    if (!pendingOrphanDiscard) return;
    setPendingOrphanDiscard(false);
    Alert.alert('Discard run?', 'This will remove the in-progress run.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => void discardRunAndExit() },
    ]);
  }, [discardRunAndExit, pendingOrphanDiscard]);

  const maybeSwitchSamplingProfile = useCallback(
    async (nextProfile: TrackingSampleProfile) => {
      if (nextProfile === samplingProfileRef.current) return;
      if (Date.now() - lastSamplingSwitchAt.current < 12000) return;
      await startGpsTracking(nextProfile);
    },
    [startGpsTracking]
  );

  const handleLocationUpdate = useCallback(
    (location: LocationPoint) => {
      let desiredProfile: TrackingSampleProfile | null = null;
      const nowMs = Number(location.timestamp) || Date.now();
      lastLocationTimestampMsRef.current = nowMs;
      const elapsed = Math.floor((Date.now() - runStartTime.current - pausedDurationMs.current) / 1000);
      const previousEngineState = runEngineRef.current;
      const update = updateRunTrackingEngine(previousEngineState, location, elapsed);
      let liveMetrics = update.metrics;
      let nextEngineState = update.state;

      const activeGap = activeGapRef.current;
      if (activeGap) {
        const gapElapsedSec = Math.max(
          0,
          (nowMs - Date.parse(activeGap.startTimeUtc)) / 1000
        );
        const exceededGapEstimationWindow =
          gapElapsedSec > APP_CONFIG.LIVE_TRACKING.RUN.GAP_ESTIMATION_MAX_SEC;
        const estimatedDistanceSource = liveMetrics.sourceTag === 'estimated';
        if (exceededGapEstimationWindow && estimatedDistanceSource) {
          const frozenDistanceMiles = previousEngineState.totalDistanceMiles;
          nextEngineState = {
            ...nextEngineState,
            totalDistanceMiles: frozenDistanceMiles,
          };
          liveMetrics = {
            ...liveMetrics,
            distanceDeltaMiles: 0,
            totalDistanceMiles: frozenDistanceMiles,
            currentPaceMinPerMile: null,
            averagePaceMinPerMile:
              frozenDistanceMiles > 0.01 && elapsed > 0 ? calculatePace(frozenDistanceMiles, elapsed) : null,
            paceState: 'unavailable',
          };
          activeGap.confidenceScore = Math.min(activeGap.confidenceScore, 40);
          activeGap.estimatorUsed = activeGap.estimatorUsed === 'none' ? 'none' : activeGap.estimatorUsed;
          setEstimationCapped(true);
        }
      }

      runEngineRef.current = nextEngineState;

      setDistance(liveMetrics.totalDistanceMiles);
      setCurrentPace(liveMetrics.currentPaceMinPerMile || 0);
      setAveragePace(liveMetrics.averagePaceMinPerMile || 0);
      setPaceState(liveMetrics.paceState);
      setGpsConfidence(liveMetrics.gpsConfidence);
      setPaceSourceTag(liveMetrics.sourceTag);
      diagnosticsRef.current.samples += 1;
      diagnosticsRef.current.confidence[liveMetrics.gpsConfidence] += 1;
      diagnosticsRef.current.paceStates[liveMetrics.paceState] += 1;
      diagnosticsRef.current.sourceTags[liveMetrics.sourceTag] += 1;

      const validFix = liveMetrics.gpsConfidence !== 'low' && liveMetrics.includePointInRoute;
      if (validFix) {
        lastValidFixMsRef.current = nowMs;
        if (gpsSignalStateRef.current === 'lost' || gpsSignalStateRef.current === 'degraded') {
          recoveryFixStreakRef.current += 1;
          if (recoveryFixStreakRef.current >= APP_CONFIG.LIVE_TRACKING.RUN.GPS_STATE.RECOVER_FIX_STREAK) {
            transitionGpsSignalState('recovered', nowMs);
          }
        } else if (gpsSignalStateRef.current === 'recovered') {
          if (
            recoveredAtMsRef.current &&
            nowMs - recoveredAtMsRef.current >= APP_CONFIG.LIVE_TRACKING.RUN.GPS_STATE.GOOD_AFTER_STABLE_SEC * 1000
          ) {
            transitionGpsSignalState('good', nowMs);
            recoveryFixStreakRef.current = 0;
          }
        } else if (gpsSignalStateRef.current !== 'good') {
          transitionGpsSignalState('good', nowMs);
          recoveryFixStreakRef.current = 0;
        }
      } else {
        recoveryFixStreakRef.current = 0;
        const lastValid = lastValidFixMsRef.current;
        if (lastValid != null) {
          const secondsWithoutFix = Math.max(0, (nowMs - lastValid) / 1000);
          if (secondsWithoutFix >= APP_CONFIG.LIVE_TRACKING.RUN.GPS_STATE.LOST_AFTER_SEC) {
            transitionGpsSignalState('lost', nowMs);
          } else if (secondsWithoutFix >= APP_CONFIG.LIVE_TRACKING.RUN.GPS_STATE.DEGRADED_AFTER_SEC) {
            transitionGpsSignalState('degraded', nowMs);
          }
        } else {
          transitionGpsSignalState('degraded', nowMs);
        }
      }
      diagnosticsRef.current.gpsStates[gpsSignalStateRef.current] += 1;

      if (activeGapRef.current && liveMetrics.distanceDeltaMiles > 0) {
        const gapElapsedSec = Math.max(
          0,
          (nowMs - Date.parse(activeGapRef.current.startTimeUtc)) / 1000
        );
        const canEstimateGapDistance =
          gapElapsedSec <= APP_CONFIG.LIVE_TRACKING.RUN.GAP_ESTIMATION_MAX_SEC;
        if (
          canEstimateGapDistance &&
          (
            gpsSignalStateRef.current === 'degraded' ||
            gpsSignalStateRef.current === 'lost' ||
            liveMetrics.sourceTag === 'estimated'
          )
        ) {
          activeGapRef.current.estimatedDistanceMiles += liveMetrics.distanceDeltaMiles;
          if (liveMetrics.sourceTag === 'estimated') {
            activeGapRef.current.estimatorUsed = 'gps_low_confidence';
          } else if (activeGapRef.current.estimatorUsed === 'none') {
            activeGapRef.current.estimatorUsed = 'interpolate';
          }
          if (liveMetrics.gpsConfidence === 'high') activeGapRef.current.confidenceScore = 75;
          else if (liveMetrics.gpsConfidence === 'medium') activeGapRef.current.confidenceScore = 60;
          else activeGapRef.current.confidenceScore = 45;
        } else if (!canEstimateGapDistance) {
          activeGapRef.current.confidenceScore = Math.min(activeGapRef.current.confidenceScore, 40);
        }
      }

      setRoute((prevRoute) => {
        if (!liveMetrics.includePointInRoute) return prevRoute;
        return [...prevRoute, location];
      });

      const speedMps = Number(location.speed) || 0;
      if (liveMetrics.gpsConfidence === 'high' && (elapsed < 180 || speedMps >= 4.2)) {
        desiredProfile = 'precision';
      } else if (liveMetrics.gpsConfidence === 'low' || speedMps < 1.4) {
        desiredProfile = 'eco';
      } else {
        desiredProfile = 'balanced';
      }

      if (desiredProfile) {
        void maybeSwitchSamplingProfile(desiredProfile);
      }
    },
    [maybeSwitchSamplingProfile, transitionGpsSignalState]
  );

  useEffect(() => {
    onLocationUpdateRef.current = handleLocationUpdate;
  }, [handleLocationUpdate]);

  const drainBackgroundLocationQueue = useCallback(async () => {
    const sessionId = String(sessionIdRef.current || '').trim();
    if (!sessionId) return;
    const queued = await consumeRunBackgroundLocationQueue(sessionId);
    if (!queued.length) return;
    const lastTimestamp = Number(lastLocationTimestampMsRef.current || 0);
    const deduped = queued.filter((point) => Number(point?.timestamp || 0) > lastTimestamp);
    if (!deduped.length) return;
    deduped.forEach((point) => {
      onLocationUpdateRef.current(point);
    });
    await publishSnapshot('manual');
  }, [publishSnapshot]);

  const syncBackgroundTrackingMode = useCallback(async () => {
    if (syncBackgroundModeBusyRef.current) return;
    syncBackgroundModeBusyRef.current = true;
    try {
      const sessionId = String(sessionIdRef.current || '').trim();
      if (!sessionId || runStateRef.current !== 'tracking') {
        await stopRunBackgroundLocationTracking({ clearActiveSession: false });
        backgroundTrackingActiveRef.current = false;
        return;
      }

      if (appStateRef.current === 'active') {
        await stopRunBackgroundLocationTracking({ clearActiveSession: false });
        backgroundTrackingActiveRef.current = false;
        if (!locationSubscription.current) {
          await startGpsTracking();
          if (!locationSubscription.current) {
            setTrackingIssue((current) =>
              current || {
                kind: 'gps_resume',
                title: 'GPS unavailable',
                body: 'Background tracking is still active, but foreground GPS did not resume. You can keep running and finish normally, or tap Try GPS Again.',
              }
            );
          }
        }
        await drainBackgroundLocationQueue();
        return;
      }

      // App is inactive/backgrounded: use background location task only.
      if (locationSubscription.current) {
        stopGpsTracking();
      }
      const started = await startRunBackgroundLocationTracking({
        sessionId,
        profile: samplingProfileRef.current,
      });
      backgroundTrackingActiveRef.current = started;
    } finally {
      syncBackgroundModeBusyRef.current = false;
    }
  }, [drainBackgroundLocationQueue, startGpsTracking, stopGpsTracking]);

  useEffect(() => {
    if (runState === 'tracking') {
      timerInterval.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - runStartTime.current - pausedDurationMs.current) / 1000);
        setDuration(elapsed);
      }, 1000);
    } else {
      if (timerInterval.current) {
        clearInterval(timerInterval.current);
      }
    }
    
    return () => {
      if (timerInterval.current) {
        clearInterval(timerInterval.current);
      }
    };
  }, [runState]);

  const startRun = async () => {
    if (runState !== 'ready') return;
    if (recoveryVisible) {
      Alert.alert('Active run detected', 'Resolve the active run before starting a new one.');
      return;
    }
    try {
      const hasPermission = await requestLocationPermissions();
      if (!hasPermission) {
        setTrackingIssue({
          kind: 'permission',
          title: 'Location permission required',
          body: 'GPS tracking needs location permission. You can enable it in Settings, or log a manual run instead.',
        });
        return;
      }
      setTrackingIssue(null);
      pausedDurationMs.current = 0;
      pauseStartedAt.current = null;
      setDuration(0);
      setDistance(0);
      setCurrentPace(0);
      setAveragePace(0);
      setPaceState('acquiring');
      setGpsConfidence('low');
      setGpsSignalState('good');
      setEstimationCapped(false);
      gpsSignalStateRef.current = 'good';
      setPaceSourceTag('gps');
      setRoute([]);
      setReactions([]);
      diagnosticsRef.current = createRunLiveDiagnostics();
      pauseEventsRef.current = [];
      gapSegmentsRef.current = [];
      activeGapRef.current = null;
      lastValidFixMsRef.current = null;
      lastLocationTimestampMsRef.current = null;
      recoveredAtMsRef.current = null;
      recoveryFixStreakRef.current = 0;
      runEngineRef.current = resetRunTrackingEngine(runEngineRef.current, trackingPriorityRef.current);
      samplingProfileRef.current = 'precision';
      await startGpsTracking('precision');
      if (!locationSubscription.current) {
        setTrackingIssue({
          kind: 'gps_start',
          title: 'GPS unavailable',
          body: 'We could not start location tracking. You can try again, or continue with time-only tracking and add distance later in review.',
        });
        return;
      }
      runStartTime.current = Date.now();
      sessionIdRef.current = createSessionId();
      seqRef.current = 0;
      lastPublishedDistanceRef.current = 0;
      await clearRunBackgroundLocationQueue(sessionIdRef.current);
      // Best-effort: allow lock-screen/background tracking when the user leaves the app.
      // Do not block run start if iOS background permission is not granted yet.
      void requestBackgroundLocationPermissions();
      setEndConfirmArmedUntil(null);
      if (!applyRunState('tracking')) {
        stopGpsTracking();
        Alert.alert('Run state error', 'Could not start run from current state.');
        return;
      }
      await publishSnapshot('stateChange');
      await syncBackgroundTrackingMode();
    } catch {
      stopGpsTracking();
      setTrackingIssue({
        kind: 'gps_start',
        title: 'Start failed',
        body: 'We could not start GPS tracking right now. Try again in open sky, or use manual run logging.',
      });
    }
  };

  const beginTimeOnlyRun = useCallback(async () => {
    if (runStateRef.current !== 'ready') return;
    setTrackingIssue(null);
    pausedDurationMs.current = 0;
    pauseStartedAt.current = null;
    setDuration(0);
    setDistance(0);
    setCurrentPace(0);
    setAveragePace(0);
    setPaceState('unavailable');
    setGpsConfidence('low');
    setGpsSignalState('lost');
    setEstimationCapped(true);
    gpsSignalStateRef.current = 'lost';
    setPaceSourceTag('estimated');
    setRoute([]);
    setReactions([]);
    diagnosticsRef.current = createRunLiveDiagnostics();
    diagnosticsRef.current.gpsStates.lost += 1;
    diagnosticsRef.current.paceStates.unavailable += 1;
    diagnosticsRef.current.sourceTags.estimated += 1;
    pauseEventsRef.current = [];
    gapSegmentsRef.current = [];
    activeGapRef.current = null;
    lastValidFixMsRef.current = null;
    lastLocationTimestampMsRef.current = null;
    recoveredAtMsRef.current = null;
    recoveryFixStreakRef.current = 0;
    runEngineRef.current = resetRunTrackingEngine(runEngineRef.current, trackingPriorityRef.current);
    runStartTime.current = Date.now();
    sessionIdRef.current = createSessionId();
    seqRef.current = 0;
    lastPublishedDistanceRef.current = 0;
    await clearRunBackgroundLocationQueue(sessionIdRef.current);
    await stopRunBackgroundLocationTracking({ clearActiveSession: false });
    backgroundTrackingActiveRef.current = false;
    setEndConfirmArmedUntil(null);
    if (!applyRunState('tracking')) {
      setTrackingIssue({
        kind: 'gps_start',
        title: 'Run state error',
        body: 'Could not start this run from the current state.',
      });
      return;
    }
    await publishSnapshot('stateChange');
  }, [applyRunState, publishSnapshot]);

  const togglePause = useCallback(async () => {
    if (recoveryVisible) {
      setRecoveryVisible(false);
      setRecoverySnapshotState(null);
    }
    if (runState === 'tracking') {
      await drainBackgroundLocationQueue();
      pauseStartedAt.current = Date.now();
      pauseEventsRef.current.push({ pauseAtUtc: new Date().toISOString() });
      diagnosticsRef.current.paceStates.paused += 1;
      stopGpsTracking();
      await stopRunBackgroundLocationTracking({ clearActiveSession: false });
      backgroundTrackingActiveRef.current = false;
      await clearRunBackgroundLocationQueue(sessionIdRef.current);
      applyRunState('paused');
      await publishSnapshot('stateChange');
      return;
    }
    if (runState === 'paused') {
      const startedAt = pauseStartedAt.current;
      if (startedAt) {
        pausedDurationMs.current += Date.now() - startedAt;
      }
      pauseStartedAt.current = null;
      const lastPause = pauseEventsRef.current[pauseEventsRef.current.length - 1];
      if (lastPause && !lastPause.resumeAtUtc) {
        lastPause.resumeAtUtc = new Date().toISOString();
      }
      if (!applyRunState('tracking')) {
        Alert.alert('Run state error', 'Could not resume from current state.');
        return;
      }
      try {
        await startGpsTracking();
        if (!locationSubscription.current) {
          const lastPauseReset = pauseEventsRef.current[pauseEventsRef.current.length - 1];
          if (lastPauseReset?.resumeAtUtc) {
            lastPauseReset.resumeAtUtc = undefined;
          }
          pauseStartedAt.current = Date.now();
          applyRunState('paused');
          setTrackingIssue({
            kind: 'gps_resume',
            title: 'GPS unavailable',
            body: 'We could not resume location tracking. You can try again, or continue time-only (distance will not change) and finish the run.',
          });
          await publishSnapshot('stateChange');
          return;
        }
        setTrackingIssue(null);
        await publishSnapshot('stateChange');
        await syncBackgroundTrackingMode();
      } catch {
        const lastPauseReset = pauseEventsRef.current[pauseEventsRef.current.length - 1];
        if (lastPauseReset?.resumeAtUtc) {
          lastPauseReset.resumeAtUtc = undefined;
        }
        pauseStartedAt.current = Date.now();
        applyRunState('paused');
        setTrackingIssue({
          kind: 'gps_resume',
          title: 'Resume failed',
          body: 'We could not resume GPS tracking right now. Try again in open sky, or finish as time-only.',
        });
        await publishSnapshot('stateChange');
      }
    }
  }, [applyRunState, drainBackgroundLocationQueue, publishSnapshot, recoveryVisible, runState, startGpsTracking, stopGpsTracking, syncBackgroundTrackingMode]);

  const resumeTimeOnly = useCallback(async () => {
    if (runStateRef.current !== 'paused') return;
    setTrackingIssue(null);
    const startedAt = pauseStartedAt.current;
    if (startedAt) {
      pausedDurationMs.current += Date.now() - startedAt;
    }
    pauseStartedAt.current = null;
    const lastPause = pauseEventsRef.current[pauseEventsRef.current.length - 1];
    if (lastPause && !lastPause.resumeAtUtc) {
      lastPause.resumeAtUtc = new Date().toISOString();
    }
    setPaceState('unavailable');
    setGpsConfidence('low');
    setGpsSignalState('lost');
    setEstimationCapped(true);
    gpsSignalStateRef.current = 'lost';
    setPaceSourceTag('estimated');
    if (!applyRunState('tracking')) return;
    await stopRunBackgroundLocationTracking({ clearActiveSession: false });
    backgroundTrackingActiveRef.current = false;
    await publishSnapshot('stateChange');
  }, [applyRunState, publishSnapshot]);

  const isRunActiveForGuards = useCallback(() => {
    return runStateRef.current === 'tracking' || runStateRef.current === 'paused';
  }, []);

  const showLeaveGuard = useCallback(() => {
    const state = runStateRef.current;
    if (state !== 'tracking' && state !== 'paused') return;

    const actions: { text: string; onPress: () => void; style?: 'cancel' | 'destructive' }[] = [];

    if (state === 'tracking') {
      actions.push({ text: 'Pause', onPress: () => void togglePause() });
    } else {
      actions.push({ text: 'Resume', onPress: () => void togglePause() });
    }

    actions.push({
      text: 'End',
      onPress: () => {
        setLeaveGuardRequestedEnd(true);
        setEndConfirmArmedUntil(Date.now() + 2500);
        void publishSnapshot('stateChange');
      },
    });

    actions.push({
      text: 'Discard',
      style: 'destructive',
      onPress: () => {
        Alert.alert('Discard run?', 'This will remove the in-progress run.', [
          { text: 'Keep', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: () => void discardRunAndExit() },
        ]);
      },
    });

    actions.push({ text: 'Cancel', style: 'cancel', onPress: () => {} });

    Alert.alert('Run in progress', 'Choose what to do before leaving.', actions);
  }, [discardRunAndExit, publishSnapshot, togglePause]);

  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e: any) => {
      if (!isRunActiveForGuards()) return;
      e.preventDefault();
      showLeaveGuard();
    });

    const backSub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!isRunActiveForGuards()) return false;
      showLeaveGuard();
      return true;
    });

    return () => {
      unsub?.();
      backSub.remove();
    };
  }, [isRunActiveForGuards, navigation, showLeaveGuard]);

  const addReaction = (type: '👍' | '👎' | '🔥' | '😮‍💨') => {
    if (runState === 'ready') return;
    const reaction: Reaction = {
      type,
      distance,
      timestamp: Date.now()
    };
    setReactions(prev => [...prev, reaction]);
  };

  const finalizeRunEnd = useCallback(async () => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    try {
      await drainBackgroundLocationQueue();
      const inFlightPauseMs =
        runStateRef.current === 'paused' && pauseStartedAt.current
          ? Math.max(0, Date.now() - pauseStartedAt.current)
          : 0;
      const effectivePausedMs = pausedDurationMs.current + inFlightPauseMs;
      const finalDuration = Math.max(
        0,
        Math.floor((Date.now() - runStartTime.current - effectivePausedMs) / 1000)
      );
      const endMs = Date.now();
      closeActiveGap(endMs);
      const rawCalories = calculateRunningCalories(distance, userWeight);
      const refined = refineRunSummary({
        route,
        rawDistance: distance,
        rawDurationSec: finalDuration,
        rawCalories,
        userWeightLbs: userWeight,
      });
      const diagnostics = diagnosticsRef.current;
      const gapSegments = [...gapSegmentsRef.current];
      const gpsGapSeconds = gapSegments.reduce((sum, gap) => {
        const start = Date.parse(gap.startTimeUtc);
        const end = Date.parse(gap.endTimeUtc);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return sum;
        return sum + (end - start) / 1000;
      }, 0);
      const estimatedGapDistanceMiles = gapSegments.reduce((sum, gap) => sum + (gap.estimatedDistanceMiles || 0), 0);
      const confidenceHighRatio = diagnostics.samples > 0 ? diagnostics.confidence.high / diagnostics.samples : 0;
      const confidenceMediumRatio = diagnostics.samples > 0 ? diagnostics.confidence.medium / diagnostics.samples : 0;
      const confidenceLowRatio = diagnostics.samples > 0 ? diagnostics.confidence.low / diagnostics.samples : 1;
      const baseDistanceConfidence = Math.round(
        (confidenceHighRatio * 92) + (confidenceMediumRatio * 74) + (Math.max(0, 1 - confidenceLowRatio) * 40)
      );
      const gapPenalty = Math.min(45, Math.round(gpsGapSeconds / 15));
      const distanceConfidence = clamp(baseDistanceConfidence - gapPenalty, 20, 99);
      const paceConfidence = clamp(Math.round(distanceConfidence - Math.min(20, gpsGapSeconds / 30)), 15, 99);
      const finalAveragePace = refined.averagePace > 0 ? refined.averagePace : averagePace;
      await stagePendingRun({
        runId: sessionIdRef.current || `run_${Date.now()}`,
        kind: 'gps_outdoor',
        lifecycleState: 'ended',
        pausedTimeSec: Math.floor(effectivePausedMs / 1000),
        pauseEvents: pauseEventsRef.current,
        hrAvailable: false,
        distance: refined.distance,
        duration: finalDuration,
        averagePace: finalAveragePace,
        calories: refined.calories,
        xpEarned: calculateRunningDistanceXP(refined.distance),
        route,
        reactions,
        diagnostics: {
          samples: diagnostics.samples,
          confidence: { ...diagnostics.confidence },
          gpsStates: { ...diagnostics.gpsStates },
          paceStates: { ...diagnostics.paceStates },
          sourceTags: { ...diagnostics.sourceTags },
          gpsGapSeconds: Number(gpsGapSeconds.toFixed(1)),
          estimatedGapDistanceMiles: Number(estimatedGapDistanceMiles.toFixed(3)),
        },
        gapSegments: gapSegments.map((gap) => ({
          ...gap,
          estimatedDistanceMiles: Number(gap.estimatedDistanceMiles.toFixed(4)),
          confidenceScore: Math.round(gap.confidenceScore),
        })),
        confidenceSummary: {
          distanceConfidence,
          paceConfidence,
          // P0 truthfulness: Live Run does not ingest HR yet, so HR confidence must never be implied.
          hrConfidence: null,
        },
        metricVersions: createRunMetricVersionSet(),
        metricsLock: {
          metricsImmutable: false,
          metricsLockedAtUtc: new Date().toISOString(),
          sessionIntegrityState: 'pending',
        },
        refinement: refined.note
          ? {
              applied: true,
              distanceBefore: Number(distance.toFixed(2)),
              distanceAfter: refined.distance,
              caloriesBefore: rawCalories,
              caloriesAfter: refined.calories,
              note: refined.note,
            }
          : undefined,
        timestamp: new Date().toISOString(),
      });
      cleanup();
      await stopRunBackgroundLocationTracking();
      backgroundTrackingActiveRef.current = false;
      await clearRunBackgroundLocationQueue(sessionIdRef.current);
      if (!applyRunState('ended')) {
        Alert.alert('Run state error', 'Could not end run from current state.');
        return;
      }
      setEndConfirmArmedUntil(null);
      setLeaveGuardRequestedEnd(false);
      await publishSnapshot('stateChange');
      router.replace('/run-review' as any);
    } catch {
      Alert.alert('Finish failed', 'Could not finish this run right now. Please try again.');
    } finally {
      finishingRef.current = false;
    }
  }, [applyRunState, averagePace, cleanup, closeActiveGap, distance, drainBackgroundLocationQueue, publishSnapshot, reactions, route, router, userWeight]);

  const finishRun = () => {
    if (finishingRef.current) return;
    if (runState !== 'tracking' && runState !== 'paused') {
      Alert.alert('Run not active', 'Start a run before finishing.');
      return;
    }
    if (!endConfirmArmedUntil || Date.now() > endConfirmArmedUntil) {
      setEndConfirmArmedUntil(Date.now() + 2500);
      void publishSnapshot('stateChange');
      return;
    }
    void finalizeRunEnd();
  };

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  useEffect(() => {
    if (!endConfirmArmedUntil) return;
    const remaining = endConfirmArmedUntil - Date.now();
    if (remaining <= 0) {
      setEndConfirmArmedUntil(null);
      setLeaveGuardRequestedEnd(false);
      void publishSnapshot('stateChange');
      return;
    }
    const timeout = setTimeout(() => {
      setEndConfirmArmedUntil(null);
      setLeaveGuardRequestedEnd(false);
      void publishSnapshot('stateChange');
    }, remaining + 30);
    return () => clearTimeout(timeout);
  }, [endConfirmArmedUntil, publishSnapshot]);

  useEffect(() => {
    if (runState !== 'tracking') return;
    const interval = setInterval(() => {
      void publishSnapshot('tick');
    }, 10000);
    return () => clearInterval(interval);
  }, [publishSnapshot, runState]);

  useEffect(() => {
    if (runState !== 'tracking') return;
    const interval = setInterval(() => {
      const nowMs = Date.now();
      const lastValid = lastValidFixMsRef.current;
      if (lastValid == null) return;
      const secondsWithoutFix = Math.max(0, (nowMs - lastValid) / 1000);
      if (secondsWithoutFix >= APP_CONFIG.LIVE_TRACKING.RUN.GPS_STATE.LOST_AFTER_SEC) {
        transitionGpsSignalState('lost', nowMs);
      } else if (secondsWithoutFix >= APP_CONFIG.LIVE_TRACKING.RUN.GPS_STATE.DEGRADED_AFTER_SEC) {
        transitionGpsSignalState('degraded', nowMs);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [runState, transitionGpsSignalState]);

  useEffect(() => {
    if (runState !== 'tracking') return;
    const last = lastPublishedDistanceRef.current;
    if (distance - last >= 0.05) {
      lastPublishedDistanceRef.current = distance;
      void publishSnapshot('metricThreshold');
    }
  }, [distance, publishSnapshot, runState]);

  const applyRemoteCommand = useCallback(
    async (command: RunCommandRequest) => {
      let accepted = false;
      let reasonCode: string | undefined;
      logRunSyncEvent('command_received_on_recorder', {
        commandType: command.commandType,
        clientCommandId: command.clientCommandId,
        sessionId: command.sessionId,
      });

      if (command.commandType === 'pause') {
        if (runStateRef.current === 'tracking') {
          await togglePause();
          accepted = true;
        } else {
          reasonCode = 'invalid_state';
        }
      } else if (command.commandType === 'resume') {
        if (runStateRef.current === 'paused') {
          await togglePause();
          accepted = true;
        } else {
          reasonCode = 'invalid_state';
        }
      } else if (command.commandType === 'requestEnd') {
        if (runStateRef.current === 'tracking' || runStateRef.current === 'paused') {
          setEndConfirmArmedUntil(Date.now() + 2500);
          accepted = true;
          await publishSnapshot('stateChange');
        } else {
          reasonCode = 'invalid_state';
        }
      } else if (command.commandType === 'confirmEnd') {
        if (endConfirmArmedUntil && Date.now() <= endConfirmArmedUntil) {
          accepted = true;
          await finalizeRunEnd();
        } else {
          reasonCode = 'confirmWindowExpired';
        }
      } else if (command.commandType === 'cancelEnd') {
        setEndConfirmArmedUntil(null);
        accepted = true;
        await publishSnapshot('stateChange');
      } else {
        reasonCode = 'unsupported_command';
      }

      await putRunCommandAck({
        clientCommandId: command.clientCommandId,
        accepted,
        reasonCode,
        snapshot: (await getActiveRunSnapshot()) || undefined,
        ackedAt: new Date().toISOString(),
      });
      logRunSyncEvent('command_ack_written', {
        commandType: command.commandType,
        clientCommandId: command.clientCommandId,
        sessionId: command.sessionId,
        accepted,
        reasonCode: reasonCode || null,
      });
      await consumeRunCommand(command.clientCommandId);
    },
    [endConfirmArmedUntil, finalizeRunEnd, publishSnapshot, togglePause]
  );

  useEffect(() => {
    if (!sessionIdRef.current) return;
    const interval = setInterval(() => {
      void (async () => {
        const queue = await getQueuedRunCommands();
        const next = queue.find((row) => row.sessionId === sessionIdRef.current);
        if (!next) return;
        await applyRemoteCommand(next);
      })();
    }, 500);
    return () => clearInterval(interval);
  }, [applyRemoteCommand]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      appStateRef.current = state;
      void syncBackgroundTrackingMode();
    });
    return () => sub.remove();
  }, [syncBackgroundTrackingMode]);

  useEffect(() => {
    void syncBackgroundTrackingMode();
    if (runState !== 'tracking') return;
    const interval = setInterval(() => {
      void syncBackgroundTrackingMode();
    }, 5000);
    return () => clearInterval(interval);
  }, [runState, syncBackgroundTrackingMode]);

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#0A0A0A', '#1A1A2A', '#0A0A0A']}
        style={styles.gradient}
      >
        {/* Header */}
        <View style={[styles.header, { paddingTop: Math.max(20, insets.top + 12) }]}>
          <Text style={styles.headerTitle}>🏃 RUNNING</Text>
          {runState === 'tracking' ? (
            <View
              style={[
                styles.gpsBadge,
                gpsSignalState === 'good'
                  ? styles.gpsBadgeGood
                  : gpsSignalState === 'degraded'
                  ? styles.gpsBadgeDegraded
                  : gpsSignalState === 'lost'
                  ? styles.gpsBadgeLost
                  : styles.gpsBadgeRecovered,
              ]}
            >
              <Text style={styles.gpsBadgeText}>{gpsSignalBadgeLabel(gpsSignalState)}</Text>
            </View>
          ) : null}
          {runState === 'paused' && (
            <View style={styles.pausedBadge}>
              <Text style={styles.pausedText}>PAUSED</Text>
            </View>
          )}
          {endConfirmArmedUntil && Date.now() <= endConfirmArmedUntil ? (
            <View style={styles.endingBadge}>
              <Text style={styles.endingText}>CONFIRM END</Text>
            </View>
          ) : null}
        </View>

        {trackingIssue ? (
          <View style={styles.issueCard} pointerEvents='auto'>
            <Text style={styles.issueTitle}>{trackingIssue.title}</Text>
            <Text style={styles.issueBody}>{trackingIssue.body}</Text>
            <View style={styles.issueActions}>
              {trackingIssue.kind === 'permission' ? (
                <>
                  <Pressable
                    style={({ pressed }) => [styles.issueBtn, styles.issueBtnPrimary, pressed && styles.issueBtnPressed]}
                    onPress={() => void Linking.openSettings()}
                    pressRetentionOffset={{ top: 12, left: 12, right: 12, bottom: 12 }}
                  >
                    <Text style={styles.issueBtnTextPrimary}>Open Settings</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.issueBtn, styles.issueBtnSecondary, pressed && styles.issueBtnPressed]}
                    onPress={() => router.push('/manual-run' as any)}
                    pressRetentionOffset={{ top: 12, left: 12, right: 12, bottom: 12 }}
                  >
                    <Text style={styles.issueBtnTextSecondary}>Manual Run</Text>
                  </Pressable>
                </>
              ) : trackingIssue.kind === 'gps_start' ? (
                <>
                  <Pressable
                    style={({ pressed }) => [styles.issueBtn, styles.issueBtnPrimary, pressed && styles.issueBtnPressed]}
                    onPress={() => void beginTimeOnlyRun()}
                    pressRetentionOffset={{ top: 12, left: 12, right: 12, bottom: 12 }}
                  >
                    <Text style={styles.issueBtnTextPrimary}>Start Time-Only</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.issueBtn, styles.issueBtnSecondary, pressed && styles.issueBtnPressed]}
                    onPress={() => void startRun()}
                    pressRetentionOffset={{ top: 12, left: 12, right: 12, bottom: 12 }}
                  >
                    <Text style={styles.issueBtnTextSecondary}>Try Again</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Pressable
                    style={({ pressed }) => [styles.issueBtn, styles.issueBtnPrimary, pressed && styles.issueBtnPressed]}
                    onPress={() => void resumeTimeOnly()}
                    pressRetentionOffset={{ top: 12, left: 12, right: 12, bottom: 12 }}
                  >
                    <Text style={styles.issueBtnTextPrimary}>Resume Time-Only</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.issueBtn, styles.issueBtnSecondary, pressed && styles.issueBtnPressed]}
                    onPress={() => void togglePause()}
                    pressRetentionOffset={{ top: 12, left: 12, right: 12, bottom: 12 }}
                  >
                    <Text style={styles.issueBtnTextSecondary}>Try GPS Again</Text>
                  </Pressable>
                </>
              )}

              <Pressable
                style={({ pressed }) => [styles.issueBtn, styles.issueBtnGhost, pressed && styles.issueBtnPressed]}
                onPress={() => setTrackingIssue(null)}
                pressRetentionOffset={{ top: 12, left: 12, right: 12, bottom: 12 }}
              >
                <Text style={styles.issueBtnTextGhost}>Dismiss</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {recoveryVisible ? (
          <View style={styles.recoveryOverlay} pointerEvents="auto">
            <View style={styles.recoveryCard}>
              <Text style={styles.recoveryTitle}>Active run detected</Text>
              <Text style={styles.recoveryText}>
                This run was already in progress. Choose what to do next.
              </Text>

              <TouchableOpacity
                style={[styles.recoveryButton, styles.recoveryButtonPrimary]}
                onPress={() => void togglePause()}
              >
                <Text style={styles.recoveryButtonTextPrimary}>Resume</Text>
              </TouchableOpacity>

              {recoverySnapshotState === 'recording' ? (
                <TouchableOpacity
                  style={[styles.recoveryButton, styles.recoveryButtonSecondary]}
                  onPress={() => {
                    setRecoveryVisible(false);
                    setRecoverySnapshotState(null);
                    void publishSnapshot('stateChange');
                  }}
                >
                  <Text style={styles.recoveryButtonTextSecondary}>Keep paused</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.recoveryButton, styles.recoveryButtonSecondary]}
                  onPress={() => {
                    setRecoveryVisible(false);
                    setRecoverySnapshotState(null);
                    void publishSnapshot('stateChange');
                  }}
                >
                  <Text style={styles.recoveryButtonTextSecondary}>Keep paused</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[styles.recoveryButton, styles.recoveryButtonSecondary]}
                onPress={() => {
                  setRecoveryVisible(false);
                  setRecoverySnapshotState(null);
                  setLeaveGuardRequestedEnd(true);
                  setEndConfirmArmedUntil(Date.now() + 2500);
                  void publishSnapshot('stateChange');
                }}
              >
                <Text style={styles.recoveryButtonTextSecondary}>End</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.recoveryButton, styles.recoveryButtonDanger]}
                onPress={() => {
                  Alert.alert('Discard run?', 'This will remove the in-progress run.', [
                    { text: 'Keep', style: 'cancel' },
                    { text: 'Discard', style: 'destructive', onPress: () => void discardRunAndExit() },
                  ]);
                }}
              >
                <Text style={styles.recoveryButtonTextDanger}>Discard</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {/* Main Stats */}
        <View style={styles.mainStats}>
          <View style={styles.mainStatItem}>
            <Text style={styles.mainStatValue}>{formatDuration(duration)}</Text>
            <Text style={styles.mainStatLabel}>Time</Text>
          </View>
          
          <View style={styles.mainStatItem}>
            <Text style={styles.mainStatValue}>{distance.toFixed(2)}</Text>
            <Text style={styles.mainStatLabel}>Miles</Text>
          </View>
        </View>

        {/* Pace Display */}
	        <View style={styles.paceContainer}>
	          <View style={styles.paceItem}>
	            <Text style={styles.paceLabel}>Current Pace</Text>
	            <View style={styles.paceValueRow}>
	              <Text style={styles.paceValue}>{livePaceLabel(paceState, currentPace, runState)}</Text>
	              {paceState === 'acquiring' && runState !== 'paused' ? (
	                <View style={styles.statusBadge}>
	                  <Text style={styles.statusBadgeText}>SETTLING</Text>
	                </View>
	              ) : null}
	              {showEstimatedPaceBadge(paceState, currentPace, runState) ? (
	                <View style={styles.estimatedBadge}>
	                  <Text style={styles.estimatedBadgeText}>E</Text>
	                </View>
              ) : null}
            </View>
            <Text style={styles.paceUnit}>{paceState === 'acquiring' || paceState === 'unavailable' || runState === 'paused' ? '' : '/mi'}</Text>
            <Text style={styles.paceHint}>
              {livePaceHint({
                paceState,
                confidence: gpsConfidence,
                sourceTag: paceSourceTag,
                gpsSignalState,
                estimationCapped,
              })}
            </Text>
          </View>
          
          <View style={styles.paceDivider} />
          
          <View style={styles.paceItem}>
            <Text style={styles.paceLabel}>Average Pace</Text>
            <Text style={styles.paceValue}>{averagePace > 0 ? formatPace(averagePace) : "--'--\""}</Text>
            <Text style={styles.paceUnit}>{averagePace > 0 ? '/mi' : ''}</Text>
          </View>
        </View>

        {/* Reactions */}
        <View style={styles.reactionsContainer}>
          <Text style={styles.reactionsTitle}>How are you feeling?</Text>
          <View style={styles.reactionsRow}>
            <TouchableOpacity 
              style={styles.reactionButton}
              onPress={() => addReaction('👍')}
            >
              <Text style={styles.reactionIcon}>👍</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.reactionButton}
              onPress={() => addReaction('👎')}
            >
              <Text style={styles.reactionIcon}>👎</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.reactionButton}
              onPress={() => addReaction('🔥')}
            >
              <Text style={styles.reactionIcon}>🔥</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.reactionButton}
              onPress={() => addReaction('😮‍💨')}
            >
              <Text style={styles.reactionIcon}>😮‍💨</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Controls */}
	        <View style={[styles.controls, { bottom: Math.max(16, insets.bottom + 16) }]}>
	          {runState === 'ready' ? (
	            <>
	              <Pressable
	                style={({ pressed }) => [styles.finishButton, pressed && styles.finishButtonPressed]}
	                onPress={() => {
	                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
	                  void startRun();
	                }}
	              >
	                <LinearGradient
	                  colors={['#00FF88', '#00D9FF']}
	                  start={{ x: 0, y: 0 }}
	                  end={{ x: 1, y: 0 }}
	                  style={styles.finishGradient}
	                >
	                  <Text style={styles.finishButtonText}>START RUN</Text>
	                </LinearGradient>
	              </Pressable>
	              <TouchableOpacity style={styles.manualButton} onPress={() => router.push('/manual-run' as any)}>
	                <Text style={styles.manualButtonText}>Manual / Treadmill</Text>
	              </TouchableOpacity>
	              <View style={styles.trackingRow}>
	                <Pressable style={({ pressed }) => [styles.trackingPill, pressed && styles.trackingPressed]} onPress={() => void toggleTrackingPriority()}>
	                  <Text style={styles.trackingText}>
	                    Tracking: {trackingPriority === 'accuracy' ? 'Accuracy' : 'Responsive'}
	                  </Text>
	                </Pressable>
	                <Pressable
	                  accessibilityRole="button"
	                  accessibilityLabel="Tracking mode info"
	                  style={({ pressed }) => [styles.infoButton, pressed && styles.infoButtonPressed]}
	                  onPress={() => setTrackingInfoOpen(true)}
	                  hitSlop={10}
	                >
	                  <Text style={styles.infoButtonText}>i</Text>
	                </Pressable>
	              </View>
	            </>
	          ) : (
	            <>
              {leaveGuardRequestedEnd && endConfirmArmedUntil && Date.now() <= endConfirmArmedUntil ? (
                <View style={styles.leaveGuardEndHint}>
                  <Text style={styles.leaveGuardEndHintText}>Confirm end here (tap End again)</Text>
                </View>
              ) : null}

              <TouchableOpacity
                style={styles.pauseButton}
                onPress={() => {
                  void togglePause();
                }}
              >
                <Text style={styles.pauseButtonText}>
                  {runState === 'paused' ? 'RESUME' : 'PAUSE'}
                </Text>
              </TouchableOpacity>

	              <TouchableOpacity style={styles.finishButton} onPress={finishRun}>
	                <LinearGradient
	                  // End should always read as destructive. Keep it vibrant red in both normal + confirm states.
	                  colors={endConfirmArmedUntil && Date.now() <= endConfirmArmedUntil ? ['#FF453A', '#FF3B30'] : ['#FF3B30', '#B00020']}
	                  start={{ x: 0, y: 0 }}
	                  end={{ x: 1, y: 0 }}
	                  style={styles.finishGradient}
	                >
                  <Text style={styles.finishButtonText}>
                    {endConfirmArmedUntil && Date.now() <= endConfirmArmedUntil ? 'TAP AGAIN' : 'END'}
                  </Text>
                </LinearGradient>
              </TouchableOpacity>
            </>
          )}
	        </View>
	      </LinearGradient>

        <ExplainSheet
          visible={trackingInfoOpen}
          title="Tracking Mode"
          subtitle="Choose how live pace reacts to GPS jitter."
          sections={[
            {
              title: 'Accuracy Priority',
              lines: [
                'Smooths spikes and favors stable pacing.',
                'Best default for outdoor runs.',
              ],
            },
            {
              title: 'Responsiveness Priority',
              lines: [
                'Reacts faster to pace changes with slightly more jitter.',
                'Useful for intervals or quick surges.',
              ],
            },
          ]}
          onClose={() => setTrackingInfoOpen(false)}
        />
	    </View>
	  );
	}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  gradient: {
    flex: 1,
  },
  header: {
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 20,
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
    letterSpacing: 2,
  },
  pausedBadge: {
    backgroundColor: '#FF8800',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  pausedText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#000000',
  },
  endingBadge: {
    backgroundColor: '#FFB347',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  endingText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#1A1202',
    letterSpacing: 0.6,
  },
  leaveGuardEndHint: {
    marginHorizontal: 20,
    marginTop: -8,
    marginBottom: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 179, 71, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255, 179, 71, 0.28)',
  },
  leaveGuardEndHintText: {
    color: '#FFD9B0',
    fontSize: 13,
    fontWeight: '600',
  },
  gpsBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  gpsBadgeGood: {
    backgroundColor: 'rgba(0, 255, 136, 0.18)',
    borderColor: 'rgba(0, 255, 136, 0.55)',
  },
  gpsBadgeDegraded: {
    backgroundColor: 'rgba(255, 179, 71, 0.18)',
    borderColor: 'rgba(255, 179, 71, 0.6)',
  },
  gpsBadgeLost: {
    backgroundColor: 'rgba(255, 120, 80, 0.2)',
    borderColor: 'rgba(255, 120, 80, 0.65)',
  },
  gpsBadgeRecovered: {
    backgroundColor: 'rgba(128, 210, 255, 0.2)',
    borderColor: 'rgba(128, 210, 255, 0.6)',
  },
  gpsBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#DDF5FF',
    letterSpacing: 0.5,
  },
  mainStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 26,
  },
  mainStatItem: {
    alignItems: 'center',
  },
  mainStatValue: {
    fontSize: 54,
    fontWeight: '900',
    color: '#00D9FF',
    marginBottom: 4,
  },
  mainStatLabel: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.55)',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  paceContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.03)',
    marginHorizontal: 20,
    borderRadius: 18,
    padding: 18,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  paceItem: {
    flex: 1,
    alignItems: 'center',
  },
  paceLabel: {
    fontSize: 12,
    color: '#888',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  paceValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  paceValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  estimatedBadge: {
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#89D8FF',
    backgroundColor: 'rgba(137, 216, 255, 0.2)',
  },
  estimatedBadgeText: {
    fontSize: 11,
    color: '#E9F7FF',
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: 'rgba(0,217,255,0.55)',
    backgroundColor: 'rgba(0,217,255,0.16)',
  },
  statusBadgeText: { fontSize: 11, color: '#BFF3FF', fontWeight: '900', letterSpacing: 0.3 },
  paceUnit: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  paceHint: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 16,
    color: 'rgba(220,240,255,0.74)',
    textAlign: 'center',
  },
  paceDivider: {
    width: 1,
    backgroundColor: '#2A2A3A',
    marginHorizontal: 20,
  },
  reactionsContainer: {
    paddingHorizontal: 20,
    marginBottom: 40,
  },
  reactionsTitle: {
    fontSize: 14,
    color: '#888',
    marginBottom: 16,
    textAlign: 'center',
  },
  reactionsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
  },
  reactionButton: {
    width: 60,
    height: 60,
    backgroundColor: '#1A1A2A',
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#2A2A3A',
  },
  reactionIcon: {
    fontSize: 32,
  },
  controls: {
    paddingHorizontal: 20,
    gap: 16,
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
  },
  pauseButton: {
    backgroundColor: '#2A2A3A',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FF8800',
  },
  pauseButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FF8800',
    letterSpacing: 2,
  },
  finishButton: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  finishButtonPressed: { opacity: 0.92, transform: [{ scale: 0.99 }] },
  finishGradient: {
    padding: 20,
    alignItems: 'center',
  },
  finishButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000000',
    letterSpacing: 2,
  },
  manualButton: {
    backgroundColor: '#1B1B1B',
    borderRadius: 12,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2F2F2F',
  },
  manualButtonText: {
    color: '#D3D3D3',
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  trackingRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  trackingPill: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  trackingPressed: { opacity: 0.86, transform: [{ scale: 0.99 }] },
  trackingText: { color: '#CFEAF4', fontWeight: '800', fontSize: 13, letterSpacing: 0.2 },
  infoButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,217,255,0.20)',
    backgroundColor: 'rgba(0,217,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoButtonPressed: { opacity: 0.86, transform: [{ scale: 0.99 }] },
  infoButtonText: { color: '#BFF3FF', fontWeight: '900', fontSize: 16 },
  priorityButton: {
    backgroundColor: '#101a24',
    borderRadius: 12,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#274154',
    paddingHorizontal: 10,
  },
  priorityButtonText: {
    color: '#9fd6f1',
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  priorityHintChip: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2C4456',
    backgroundColor: '#0d1721',
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  priorityHintText: {
    color: '#8fb4cc',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  recoveryOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    zIndex: 1000,
  },
  recoveryCard: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: '#111214',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2A2C31',
  },
  recoveryTitle: {
    color: '#EDEDED',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
  },
  recoveryText: {
    color: '#A8A8A8',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 14,
  },
  recoveryButton: {
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    borderWidth: 1,
  },
  recoveryButtonPrimary: {
    backgroundColor: '#00D9FF',
    borderColor: '#00D9FF',
  },
  recoveryButtonSecondary: {
    backgroundColor: '#141719',
    borderColor: '#2C2C2C',
  },
  recoveryButtonDanger: {
    backgroundColor: '#2A1717',
    borderColor: '#7E2A36',
  },
  recoveryButtonTextPrimary: {
    color: '#001318',
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  recoveryButtonTextSecondary: {
    color: '#E7E7E7',
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  recoveryButtonTextDanger: {
    color: '#FFD6DE',
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  issueCard: {
    marginHorizontal: 16,
    marginTop: 10,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,170,0,0.28)',
    backgroundColor: 'rgba(255,170,0,0.10)',
  },
  issueTitle: { color: '#FFF', fontWeight: '900', fontSize: 14 },
  issueBody: { color: 'rgba(255,255,255,0.78)', marginTop: 6, lineHeight: 18, fontSize: 13 },
  issueActions: { marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  issueBtn: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999, borderWidth: 1 },
  issueBtnPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  issueBtnPrimary: { borderColor: 'rgba(0,255,136,0.35)', backgroundColor: 'rgba(0,255,136,0.15)' },
  issueBtnSecondary: { borderColor: 'rgba(0,217,255,0.28)', backgroundColor: 'rgba(0,217,255,0.10)' },
  issueBtnGhost: { borderColor: 'rgba(255,255,255,0.16)', backgroundColor: 'rgba(0,0,0,0.10)' },
  issueBtnTextPrimary: { color: '#00FF88', fontWeight: '900', fontSize: 12 },
  issueBtnTextSecondary: { color: '#00D9FF', fontWeight: '800', fontSize: 12 },
  issueBtnTextGhost: { color: 'rgba(255,255,255,0.86)', fontWeight: '800', fontSize: 12 },
});
