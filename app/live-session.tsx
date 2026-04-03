import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient'; import { router, useLocalSearchParams } from 'expo-router'; import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'; import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { settleBehaviorDay, getBehaviorMultipliers } from '../utils/behavioralCore';
import { calculateWorkoutCaloriesBurned, type Intensity, resolveWeightKg } from '../utils/calorieBurn';
import { assignSessionDayKey } from '../utils/dayAssignment';
import { computeEffort, getXpWeightForEngine } from '../utils/effortEngine';
import {
  createRunTrackingEngine,
  calculateDistance,
  formatDuration,
  formatPace,
  requestLocationPermissions,
  resetRunTrackingEngine,
  startLocationTracking,
  type ConfidenceLevel,
  type LiveMetricDisplayState,
  type LocationPoint,
  type RunTrackingEngineState,
  updateRunTrackingEngine,
} from '../utils/gpsService';
import { getLatestHeartRateSample, requestHealthPermissions, saveWorkoutToHealth } from '../utils/healthService';
import { getTrackingPriorityPreference, setTrackingPriorityPreference, type TrackingPriorityMode } from '../utils/liveTrackingPreferences';
import { calculateWorkoutXP, mapWorkoutTypeToMET } from '../utils/metSystem';
import { calculateConstrainedXP } from '../utils/xpSystem';
import { getDailyLog, getUserProfile, saveDailyLog, todayKey, type WorkoutEntry } from '../utils/storageUtils';
import { APP_CONFIG } from '../utils/appConfig';
import { createWorkoutMetricVersionSet } from '../utils/workoutMetricVersions';

type SessionMode = 'hiit' | 'mobility' | 'swim';
type SessionState = 'ready' | 'recording' | 'paused' | 'endingConfirm' | 'ended' | 'saved' | 'discarded';

type HiitPhase = {
  phase: 'work' | 'rest';
  round: number;
  phaseElapsedSec: number;
  workSecTotal: number;
  restSecTotal: number;
};

const HIIT_WORK_SEC = APP_CONFIG.LIVE_TRACKING.HIIT.WORK_SEC;
const HIIT_REST_SEC = APP_CONFIG.LIVE_TRACKING.HIIT.REST_SEC;

function normalizeMode(value: string | string[] | undefined): SessionMode {
  const mode = Array.isArray(value) ? value[0] : value;
  if (mode === 'mobility') return 'mobility';
  if (mode === 'swim') return 'swim';
  return 'hiit';
}

function resolveModeTitle(mode: SessionMode) {
  if (mode === 'mobility') return 'Mobility Session';
  if (mode === 'swim') return 'Swim Session';
  return 'HIIT Session';
}

function resolveEngineType(mode: SessionMode): 'mixed_intensity' | 'recovery' | 'water' {
  if (mode === 'mobility') return 'recovery';
  if (mode === 'swim') return 'water';
  return 'mixed_intensity';
}

function resolveWorkoutType(mode: SessionMode): WorkoutEntry['type'] {
  if (mode === 'mobility') return 'mobility';
  return 'cardio';
}

function livePaceLabel(state: LiveMetricDisplayState, pace: number, sessionState: SessionState) {
  if (sessionState === 'paused') return 'PAUSED';
  if (state === 'acquiring') return 'settling...';
  if (state === 'unavailable') return "--'--\"";
  return formatPace(pace);
}

function livePaceHint(state: LiveMetricDisplayState, confidence: ConfidenceLevel, sourceTag: 'gps' | 'fused' | 'estimated') {
  if (state === 'acquiring') return 'Acquiring stable pace signal';
  if (state === 'unavailable') return 'Pace unavailable';
  if (state === 'live_estimated') return `Estimated from ${sourceTag} signal`;
  return `GPS confidence: ${confidence}`;
}

function liveHeartRateLabel(state: LiveMetricDisplayState, bpm: number | null, sessionState: SessionState) {
  if (sessionState === 'paused') return 'Heart rate: PAUSED';
  if (state === 'acquiring') return 'Heart rate: settling...';
  if (state === 'unavailable' || !bpm || bpm <= 0) return 'Heart rate: unavailable';
  return `Heart rate: ${Math.round(bpm)} bpm`;
}

function liveHeartRateHint(state: LiveMetricDisplayState, confidence: ConfidenceLevel) {
  if (state === 'acquiring') return 'Waiting for a stable heart-rate sample';
  if (state === 'unavailable') return 'Wear watch snugly for better HR capture';
  if (state === 'live_estimated') return 'Heart rate signal is estimated';
  return `HR confidence: ${confidence}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function confidenceLabel(value: ConfidenceLevel) {
  if (value === 'high') return 'High';
  if (value === 'medium') return 'Medium';
  return 'Low';
}

type SessionRefinementResult = {
  distanceMiles: number;
  averagePaceMinPerMile: number | null;
  calories: number;
  significantDistanceDelta: boolean;
  significantCaloriesDelta: boolean;
  note: string | null;
};

function refineSwimDistance(routePoints: LocationPoint[], rawDistanceMiles: number) {
  if (!Array.isArray(routePoints) || routePoints.length < 2 || rawDistanceMiles <= 0) {
    return rawDistanceMiles;
  }
  let refined = 0;
  const metersPerMile = 1609.344;
  for (let i = 1; i < routePoints.length; i += 1) {
    const prev = routePoints[i - 1];
    const next = routePoints[i];
    const dtSec = Math.max(0.25, (next.timestamp - prev.timestamp) / 1000);
    const segmentMiles = calculateDistance(prev.latitude, prev.longitude, next.latitude, next.longitude);
    const speedMps = (segmentMiles * metersPerMile) / dtSec;
    const accuracy = Number(next.accuracy);
    const lowConfidence = Number.isFinite(accuracy) && accuracy > APP_CONFIG.LIVE_TRACKING.SWIM.ACCURACY_REJECT_METERS;
    const isStationaryDrift =
      segmentMiles < APP_CONFIG.LIVE_TRACKING.SWIM.STATIONARY_MAX_MILES &&
      dtSec > APP_CONFIG.LIVE_TRACKING.SWIM.STATIONARY_MIN_SEC;
    const impossibleJump = speedMps > APP_CONFIG.LIVE_TRACKING.SWIM.MAX_SPEED_MPS_REFINED;
    if (lowConfidence || isStationaryDrift || impossibleJump) continue;
    refined += segmentMiles;
  }
  if (!Number.isFinite(refined) || refined <= 0) return rawDistanceMiles;
  const lower = rawDistanceMiles * APP_CONFIG.LIVE_TRACKING.SWIM.DISTANCE_CLAMP_LOW_RATIO;
  const upper = rawDistanceMiles * APP_CONFIG.LIVE_TRACKING.SWIM.DISTANCE_CLAMP_HIGH_RATIO;
  return clamp(refined, lower, upper);
}

function refineSessionMetrics(input: {
  mode: SessionMode;
  routePoints: LocationPoint[];
  elapsedSec: number;
  distanceMiles: number;
  calories: number;
  avgHeartRate: number | null;
  hrConfidence: ConfidenceLevel;
}): SessionRefinementResult {
  const elapsedSec = Math.max(1, Math.round(input.elapsedSec || 0));
  const rawDistance = Math.max(0, Number(input.distanceMiles) || 0);
  const rawCalories = Math.max(0, Math.round(Number(input.calories) || 0));

  const refinedDistance =
    input.mode === 'swim'
      ? refineSwimDistance(input.routePoints, rawDistance)
      : rawDistance;
  const refinedPace = refinedDistance > 0.01 ? (elapsedSec / 60) / refinedDistance : null;

  let refinedCalories = rawCalories;
  if (input.avgHeartRate && input.avgHeartRate > 0) {
    const hrFactor = clamp((input.avgHeartRate - 95) / 60, 0.75, 1.2);
    const blend = input.hrConfidence === 'high' ? 0.45 : input.hrConfidence === 'medium' ? 0.25 : 0.12;
    refinedCalories = Math.max(
      0,
      Math.round((rawCalories * (1 - blend)) + (rawCalories * hrFactor * blend))
    );
  }

  const distanceDeltaRatio = rawDistance > 0 ? Math.abs(refinedDistance - rawDistance) / rawDistance : 0;
  const caloriesDeltaRatio = rawCalories > 0 ? Math.abs(refinedCalories - rawCalories) / rawCalories : 0;
  const threshold = APP_CONFIG.LIVE_TRACKING.REFINEMENT_DELTA_THRESHOLD_RATIO;
  const significantDistanceDelta = distanceDeltaRatio > threshold;
  const significantCaloriesDelta = caloriesDeltaRatio > threshold;

  let note: string | null = null;
  if (significantDistanceDelta || significantCaloriesDelta) {
    const noteParts: string[] = [];
    if (significantDistanceDelta) {
      const distancePct = Math.round(((refinedDistance - rawDistance) / Math.max(0.001, rawDistance)) * 100);
      noteParts.push(`distance ${distancePct > 0 ? '+' : ''}${distancePct}%`);
    }
    if (significantCaloriesDelta) {
      const caloriesPct = Math.round(((refinedCalories - rawCalories) / Math.max(1, rawCalories)) * 100);
      noteParts.push(`calories ${caloriesPct > 0 ? '+' : ''}${caloriesPct}%`);
    }
    note = `Refined after sync: ${noteParts.join(', ')}.`;
  }

  return {
    distanceMiles: Number(refinedDistance.toFixed(2)),
    averagePaceMinPerMile: refinedPace,
    calories: refinedCalories,
    significantDistanceDelta,
    significantCaloriesDelta,
    note,
  };
}

export default function LiveSessionScreen() {
  const params = useLocalSearchParams<{ mode?: string }>();
  const mode = normalizeMode(params.mode);

  const [sessionState, setSessionState] = useState<SessionState>('ready');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [distanceMiles, setDistanceMiles] = useState(0);
  const [currentPace, setCurrentPace] = useState(0);
  const [averagePace, setAveragePace] = useState(0);
  const [paceState, setPaceState] = useState<LiveMetricDisplayState>(mode === 'swim' ? 'acquiring' : 'unavailable');
  const [gpsConfidence, setGpsConfidence] = useState<ConfidenceLevel>('low');
  const [paceSourceTag, setPaceSourceTag] = useState<'gps' | 'fused' | 'estimated'>('gps');
  const [currentHeartRate, setCurrentHeartRate] = useState<number | null>(null);
  const [avgHeartRate, setAvgHeartRate] = useState<number | null>(null);
  const [peakHeartRate, setPeakHeartRate] = useState<number | null>(null);
  const [hrState, setHrState] = useState<LiveMetricDisplayState>('acquiring');
  const [hrConfidence, setHrConfidence] = useState<ConfidenceLevel>('low');
  const [trackingPriority, setTrackingPriority] = useState<TrackingPriorityMode>('accuracy');
  const [weightKg, setWeightKg] = useState(80);
  const [endConfirmArmedUntil, setEndConfirmArmedUntil] = useState<number | null>(null);
  const [hiitPhase, setHiitPhase] = useState<HiitPhase>({
    phase: 'work',
    round: 1,
    phaseElapsedSec: 0,
    workSecTotal: 0,
    restSecTotal: 0,
  });

  const trackingPriorityRef = useRef<TrackingPriorityMode>('accuracy');
  const trackingEngineRef = useRef<RunTrackingEngineState>(createRunTrackingEngine('accuracy'));
  const locationSubscriptionRef = useRef<any>(null);
  const heartRatePollRef = useRef<any>(null);
  const heartRateSamplesRef = useRef<{ bpm: number; timestamp: number }[]>([]);
  const routePointsRef = useRef<LocationPoint[]>([]);
  const healthPermissionCheckedRef = useRef(false);
  const healthPermissionGrantedRef = useRef(false);
  const startMsRef = useRef<number>(0);
  const pausedMsRef = useRef(0);
  const pauseStartedAtRef = useRef<number | null>(null);
  const intervalRef = useRef<any>(null);
  const sessionIdRef = useRef(`live_${mode}_${Date.now()}_${Math.round(Math.random() * 10000)}`);

  const isSwim = mode === 'swim';
  const modeTitle = resolveModeTitle(mode);
  const engineType = resolveEngineType(mode);

  const sessionIntensity: Intensity = useMemo(() => {
    if (mode === 'mobility') return 'easy';
    if (mode === 'swim') return 'moderate';
    return hiitPhase.phase === 'work' ? 'hard' : 'moderate';
  }, [hiitPhase.phase, mode]);

  const calories = useMemo(() => {
    const minutes = Math.max(1, Math.round(elapsedSec / 60));
    const baseline = calculateWorkoutCaloriesBurned({
      type: mode === 'mobility' ? 'mobility' : 'cardio',
      intensity: sessionIntensity,
      minutes,
      weightKg,
    });
    if (!avgHeartRate || avgHeartRate <= 0) {
      if (mode !== 'mobility') return baseline;
      const mobilityCap = Math.round((APP_CONFIG.LIVE_TRACKING.MOBILITY.MAX_CALORIES_PER_HOUR * minutes) / 60);
      return Math.min(baseline, mobilityCap);
    }
    const normalizedHr = clamp((avgHeartRate - 85) / 65, 0.65, 1.25);
    const modeBias = mode === 'mobility' ? 0.85 : mode === 'hiit' ? 1.1 : 1;
    const blended = Math.max(0, Math.round(baseline * normalizedHr * modeBias));
    if (mode !== 'mobility') return blended;
    const mobilityCap = Math.round((APP_CONFIG.LIVE_TRACKING.MOBILITY.MAX_CALORIES_PER_HOUR * minutes) / 60);
    return Math.min(blended, mobilityCap);
  }, [avgHeartRate, elapsedSec, mode, sessionIntensity, weightKg]);

  const refinementPreview = useMemo(
    () =>
      refineSessionMetrics({
        mode,
        routePoints: routePointsRef.current,
        elapsedSec,
        distanceMiles,
        calories,
        avgHeartRate,
        hrConfidence,
      }),
    [avgHeartRate, calories, distanceMiles, elapsedSec, hrConfidence, mode]
  );

  const cleanupTracking = useCallback(() => {
    if (locationSubscriptionRef.current) {
      locationSubscriptionRef.current.remove();
      locationSubscriptionRef.current = null;
    }
  }, []);

  const clearHeartRatePolling = useCallback(() => {
    if (heartRatePollRef.current) {
      clearInterval(heartRatePollRef.current);
      heartRatePollRef.current = null;
    }
  }, []);

  const refreshHeartRate = useCallback(async () => {
    const sample = await getLatestHeartRateSample(90);
    if (!sample) {
      const sessionAgeSec = startMsRef.current > 0 ? Math.max(0, Math.round((Date.now() - startMsRef.current) / 1000)) : 0;
      if (heartRateSamplesRef.current.length === 0) {
        setHrState(sessionAgeSec < 30 ? 'acquiring' : 'unavailable');
        setHrConfidence('low');
      }
      return;
    }

    const last = heartRateSamplesRef.current[heartRateSamplesRef.current.length - 1];
    if (last && sample.timestamp <= last.timestamp) {
      const staleAgeSec = Math.max(0, Math.round((Date.now() - sample.timestamp) / 1000));
      if (staleAgeSec > 45) {
        setHrState('unavailable');
        setHrConfidence('low');
      }
      return;
    }

    if (last) {
      const dtSec = (sample.timestamp - last.timestamp) / 1000;
      const jump = Math.abs(sample.bpm - last.bpm);
      if (dtSec > 0 && dtSec <= 2.5 && jump >= 30) {
        setHrState('live_estimated');
        setHrConfidence('low');
        return;
      }
    }

    heartRateSamplesRef.current = [...heartRateSamplesRef.current, { bpm: sample.bpm, timestamp: sample.timestamp }].slice(-240);
    const points = heartRateSamplesRef.current;
    const bpms = points.map((p) => p.bpm);
    const avg = Math.round(bpms.reduce((sum, value) => sum + value, 0) / Math.max(1, bpms.length));

    const rollingMedianPeaks: number[] = [];
    for (let i = 0; i < points.length; i += 1) {
      const window = points.slice(Math.max(0, i - 1), Math.min(points.length, i + 2)).map((p) => p.bpm).sort((a, b) => a - b);
      rollingMedianPeaks.push(window[Math.floor(window.length / 2)]);
    }
    const robustPeak = rollingMedianPeaks.length > 0 ? Math.max(...rollingMedianPeaks) : sample.bpm;
    const ageSec = Math.max(0, Math.round((Date.now() - sample.timestamp) / 1000));
    const confidence: ConfidenceLevel = ageSec <= 15 ? 'high' : ageSec <= 45 ? 'medium' : 'low';

    setCurrentHeartRate(sample.bpm);
    setAvgHeartRate(avg);
    setPeakHeartRate(robustPeak);
    setHrConfidence(confidence);
    if (confidence === 'high') {
      setHrState('live_confident');
    } else if (confidence === 'medium') {
      setHrState('live_estimated');
    } else {
      setHrState('unavailable');
    }
  }, []);

  const startHeartRatePolling = useCallback(async () => {
    clearHeartRatePolling();
    setHrState('acquiring');
    if (!healthPermissionCheckedRef.current) {
      healthPermissionGrantedRef.current = await requestHealthPermissions({ heartRate: true });
      healthPermissionCheckedRef.current = true;
    }
    if (!healthPermissionGrantedRef.current) {
      setHrState('unavailable');
      setHrConfidence('low');
      return;
    }

    await refreshHeartRate();
    heartRatePollRef.current = setInterval(() => {
      void refreshHeartRate();
    }, 5000);
  }, [clearHeartRatePolling, refreshHeartRate]);

  useEffect(() => {
    let alive = true;
    const loadContext = async () => {
      const [profile, pref] = await Promise.all([getUserProfile(), getTrackingPriorityPreference()]);
      const today = await getDailyLog(todayKey());
      if (!alive) return;
      setWeightKg(resolveWeightKg(today, profile).weightKg);
      setTrackingPriority(pref);
      trackingPriorityRef.current = pref;
      trackingEngineRef.current = resetRunTrackingEngine(trackingEngineRef.current, pref);
    };
    void loadContext();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (sessionState !== 'recording') {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }
    intervalRef.current = setInterval(() => {
      const elapsed = Math.max(0, Math.floor((Date.now() - startMsRef.current - pausedMsRef.current) / 1000));
      setElapsedSec(elapsed);

      if (mode === 'hiit') {
        setHiitPhase((prev) => {
          const nextElapsed = prev.phaseElapsedSec + 1;
          if (prev.phase === 'work' && nextElapsed >= HIIT_WORK_SEC) {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            return {
              ...prev,
              phase: 'rest',
              phaseElapsedSec: 0,
              workSecTotal: prev.workSecTotal + HIIT_WORK_SEC,
            };
          }
          if (prev.phase === 'rest' && nextElapsed >= HIIT_REST_SEC) {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            return {
              ...prev,
              phase: 'work',
              phaseElapsedSec: 0,
              round: prev.round + 1,
              restSecTotal: prev.restSecTotal + HIIT_REST_SEC,
            };
          }
          return {
            ...prev,
            phaseElapsedSec: nextElapsed,
          };
        });
      }
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [mode, sessionState]);

  useEffect(() => {
    return () => {
      cleanupTracking();
      clearHeartRatePolling();
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [cleanupTracking, clearHeartRatePolling]);

  useEffect(() => {
    if (!endConfirmArmedUntil) return;
    const remaining = endConfirmArmedUntil - Date.now();
    if (remaining <= 0) {
      setEndConfirmArmedUntil(null);
      if (sessionState === 'endingConfirm') {
        setSessionState(pauseStartedAtRef.current ? 'paused' : 'recording');
      }
      return;
    }
    const timeout = setTimeout(() => {
      setEndConfirmArmedUntil(null);
      if (sessionState === 'endingConfirm') {
        setSessionState(pauseStartedAtRef.current ? 'paused' : 'recording');
      }
    }, remaining + 30);
    return () => clearTimeout(timeout);
  }, [endConfirmArmedUntil, sessionState]);

  const onLocationUpdate = useCallback(
    (location: LocationPoint) => {
      if (!isSwim || sessionState !== 'recording') return;
      const activeTime = Math.max(0, Math.floor((Date.now() - startMsRef.current - pausedMsRef.current) / 1000));
      const update = updateRunTrackingEngine(trackingEngineRef.current, location, activeTime);
      trackingEngineRef.current = update.state;
      setDistanceMiles(update.metrics.totalDistanceMiles);
      setCurrentPace(update.metrics.currentPaceMinPerMile || 0);
      setAveragePace(update.metrics.averagePaceMinPerMile || 0);
      setPaceState(update.metrics.paceState);
      setGpsConfidence(update.metrics.gpsConfidence);
      setPaceSourceTag(update.metrics.sourceTag);
      if (update.metrics.includePointInRoute) {
        routePointsRef.current = [...routePointsRef.current, location].slice(-2400);
      }
    },
    [isSwim, sessionState]
  );

  const startGpsIfNeeded = useCallback(async () => {
    if (!isSwim) return;
    const hasPermission = await requestLocationPermissions();
    if (!hasPermission) {
      setPaceState('unavailable');
      Alert.alert('Swim tracking started', 'Location was not granted, so pace and distance will stay unavailable.');
      return;
    }
    const profile = trackingPriorityRef.current === 'accuracy' ? 'precision' : 'balanced';
    cleanupTracking();
    locationSubscriptionRef.current = await startLocationTracking(onLocationUpdate, profile);
    if (!locationSubscriptionRef.current) {
      setPaceState('unavailable');
      Alert.alert('GPS unavailable', 'Could not read GPS right now. Session will continue with timer and calories.');
    }
  }, [cleanupTracking, isSwim, onLocationUpdate]);

  const startSession = useCallback(async () => {
    if (sessionState !== 'ready') return;
    startMsRef.current = Date.now();
    pausedMsRef.current = 0;
    pauseStartedAtRef.current = null;
    setElapsedSec(0);
    setDistanceMiles(0);
    setCurrentPace(0);
    setAveragePace(0);
    setPaceState(isSwim ? 'acquiring' : 'unavailable');
    setGpsConfidence('low');
    setPaceSourceTag('gps');
    routePointsRef.current = [];
    heartRateSamplesRef.current = [];
    setCurrentHeartRate(null);
    setAvgHeartRate(null);
    setPeakHeartRate(null);
    setHrState('acquiring');
    setHrConfidence('low');
    setHiitPhase({
      phase: 'work',
      round: 1,
      phaseElapsedSec: 0,
      workSecTotal: 0,
      restSecTotal: 0,
    });
    trackingEngineRef.current = resetRunTrackingEngine(trackingEngineRef.current, trackingPriorityRef.current);
    setSessionState('recording');
    await startGpsIfNeeded();
    void startHeartRatePolling();
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [isSwim, sessionState, startGpsIfNeeded, startHeartRatePolling]);

  const togglePause = useCallback(async () => {
    if (sessionState === 'recording') {
      pauseStartedAtRef.current = Date.now();
      setSessionState('paused');
      cleanupTracking();
      clearHeartRatePolling();
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return;
    }
    if (sessionState === 'paused') {
      if (pauseStartedAtRef.current) {
        pausedMsRef.current += Date.now() - pauseStartedAtRef.current;
      }
      pauseStartedAtRef.current = null;
      setSessionState('recording');
      await startGpsIfNeeded();
      void startHeartRatePolling();
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  }, [cleanupTracking, clearHeartRatePolling, sessionState, startGpsIfNeeded, startHeartRatePolling]);

  const armEnd = useCallback(async () => {
    if (sessionState !== 'recording' && sessionState !== 'paused') return;
    setSessionState('endingConfirm');
    setEndConfirmArmedUntil(Date.now() + 2500);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [sessionState]);

  const cancelEnd = useCallback(async () => {
    if (sessionState !== 'endingConfirm') return;
    setSessionState(pauseStartedAtRef.current ? 'paused' : 'recording');
    setEndConfirmArmedUntil(null);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [sessionState]);

  const confirmEnd = useCallback(async () => {
    if (sessionState !== 'endingConfirm') return;
    if (!endConfirmArmedUntil || Date.now() > endConfirmArmedUntil) {
      setEndConfirmArmedUntil(null);
      return;
    }
    if (pauseStartedAtRef.current) {
      pausedMsRef.current += Date.now() - pauseStartedAtRef.current;
      pauseStartedAtRef.current = null;
    }
    setElapsedSec(Math.max(0, Math.floor((Date.now() - startMsRef.current - pausedMsRef.current) / 1000)));
    setSessionState('ended');
    setEndConfirmArmedUntil(null);
    cleanupTracking();
    clearHeartRatePolling();
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [cleanupTracking, clearHeartRatePolling, endConfirmArmedUntil, sessionState]);

  const saveSession = useCallback(async () => {
    if (sessionState !== 'ended') return;
    const startIso = new Date(startMsRef.current || Date.now()).toISOString();
    const endIso = new Date().toISOString();
    const date = assignSessionDayKey(startIso, endIso);
    const log = await getDailyLog(date);
    const workouts = Array.isArray(log.workouts) ? [...log.workouts] : [];
    const refined = refineSessionMetrics({
      mode,
      routePoints: routePointsRef.current,
      elapsedSec,
      distanceMiles,
      calories,
      avgHeartRate,
      hrConfidence,
    });
    const minutes = Math.max(1, Math.round(elapsedSec / 60));
    const met = mapWorkoutTypeToMET(
      mode === 'mobility' ? 'flexibility' : mode === 'hiit' ? 'hiit' : 'cardio',
      sessionIntensity === 'hard' ? 'high' : sessionIntensity === 'easy' ? 'low' : 'medium'
    );
    const baseXp = calculateWorkoutXP(
      met.met,
      minutes,
      sessionIntensity === 'hard' ? 'high' : sessionIntensity === 'easy' ? 'low' : 'medium'
    );
    const constrained = calculateConstrainedXP(baseXp, workouts.length + 1, Number((log as any).dailyXP) || 0);
    const effort = computeEffort({
      engine: engineType,
      durationMin: minutes,
      activeCalories: refined.calories,
      avgHeartRate: avgHeartRate ?? 0,
      peakHeartRate: peakHeartRate ?? 0,
      setCount: 0,
      intensity: sessionIntensity,
    });
    const [xpWeight, behavior] = await Promise.all([getXpWeightForEngine(engineType), getBehaviorMultipliers(date)]);
    const awardedXp = Math.max(0, Math.round(constrained.awarded * xpWeight * behavior.xpEfficiency));
    const workout: WorkoutEntry = {
      id: sessionIdRef.current,
      ts: endIso,
      type: resolveWorkoutType(mode),
      intensity: sessionIntensity,
      minutes,
      durationMin: minutes,
      label: modeTitle,
      caloriesBurned: refined.calories,
      note:
        mode === 'hiit'
          ? `Rounds: ${hiitPhase.round} · Work: ${Math.floor(hiitPhase.workSecTotal / 60)}m`
          : mode === 'swim'
          ? `Distance: ${refined.distanceMiles.toFixed(2)} mi`
          : 'Recovery-focused mobility session',
      workoutClass: 'manual',
      engineType,
      effortUnits: effort.effortUnits,
      effortScore: effort.effortScore,
      intensityBand: effort.intensityBand,
      effortConfidence: effort.confidence,
      verifiedEffort: mode !== 'mobility',
      sourceAuthority: 'phone',
      avgHeartRate: avgHeartRate ?? undefined,
      peakHeartRate: peakHeartRate ?? undefined,
      xpBase: Math.max(0, Math.round(baseXp * xpWeight)),
      xpAwarded: awardedXp,
      xpWeight,
      xpEfficiency: behavior.xpEfficiency,
      ruleVersion: 'live_tracking_v1',
      metricVersions: createWorkoutMetricVersionSet(),
      metricsLock: {
        metricsImmutable: true,
        metricsLockedAtUtc: endIso,
        sessionIntegrityState: 'finalized',
      },
      refinement:
        refined.significantDistanceDelta || refined.significantCaloriesDelta
          ? {
              applied: true,
              distanceBeforeMiles: Number(distanceMiles.toFixed(2)),
              distanceAfterMiles: refined.distanceMiles,
              caloriesBefore: Math.round(calories),
              caloriesAfter: refined.calories,
              note: refined.note || undefined,
            }
          : undefined,
    };
    if (refined.note) {
      workout.note = `${workout.note} · ${refined.note}`;
    }

    const nextLog = {
      ...log,
      workouts: [...workouts, workout],
      dailyXP: (Number((log as any).dailyXP) || 0) + awardedXp,
    };
    await saveDailyLog(date, nextLog);

    if (mode === 'hiit') {
      await saveWorkoutToHealth('hiit', new Date(startIso), new Date(endIso), refined.calories);
    } else if (mode === 'mobility') {
      await saveWorkoutToHealth('yoga', new Date(startIso), new Date(endIso), refined.calories);
    }

    await settleBehaviorDay(date);
    setSessionState('saved');
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (refined.note) {
      Alert.alert('Session refined', refined.note);
    }
    router.replace('/(tabs)/log' as any);
  }, [
    avgHeartRate,
    calories,
    distanceMiles,
    elapsedSec,
    engineType,
    hiitPhase.round,
    hiitPhase.workSecTotal,
    mode,
    modeTitle,
    peakHeartRate,
    hrConfidence,
    sessionIntensity,
    sessionState,
  ]);

  const discardSession = useCallback(async () => {
    if (sessionState !== 'ended') return;
    setSessionState('discarded');
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  }, [sessionState]);

  const canTogglePause = sessionState === 'recording' || sessionState === 'paused';

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.back}>Back</Text>
        </Pressable>
        <Text style={styles.title}>{modeTitle}</Text>
        <View style={{ width: 42 }} />
      </View>

      <LinearGradient colors={['#0A0F18', '#101B2A', '#0A0F18']} style={styles.metricsCard}>
        <Text style={styles.status}>
          {sessionState === 'ready'
            ? 'Ready'
            : sessionState === 'recording'
            ? 'Recording'
            : sessionState === 'paused'
            ? 'Paused'
            : sessionState === 'endingConfirm'
            ? 'Confirm End'
            : sessionState === 'ended'
            ? 'Ended'
            : sessionState === 'saved'
            ? 'Saved'
            : 'Discarded'}
        </Text>
        <View style={styles.badgeRow}>
          <View style={styles.badge}>
            <Text style={styles.badgeLabel}>HR</Text>
            <Text style={styles.badgeValue}>{confidenceLabel(hrConfidence)}</Text>
          </View>
          <View style={styles.badge}>
            <Text style={styles.badgeLabel}>GPS</Text>
            <Text style={styles.badgeValue}>{isSwim ? confidenceLabel(gpsConfidence) : 'N/A'}</Text>
          </View>
          <View style={styles.badge}>
            <Text style={styles.badgeLabel}>Mode</Text>
            <Text style={styles.badgeValue}>{trackingPriority === 'accuracy' ? 'Acc' : 'Resp'}</Text>
          </View>
        </View>
        <Text style={styles.time}>{formatDuration(elapsedSec)}</Text>
        {mode === 'swim' ? (
          <>
            <Text style={styles.metric}>Distance: {distanceMiles.toFixed(2)} mi</Text>
            <Text style={styles.metric}>Current pace: {livePaceLabel(paceState, currentPace, sessionState)}</Text>
            <Text style={styles.metricHint}>{livePaceHint(paceState, gpsConfidence, paceSourceTag)}</Text>
            <Text style={styles.metric}>Average pace: {averagePace > 0 ? formatPace(averagePace) : "--'--\""}</Text>
          </>
        ) : null}
        {mode === 'hiit' ? (
          <>
            <Text style={styles.metric}>Round: {hiitPhase.round}</Text>
            <Text style={styles.metric}>Phase: {hiitPhase.phase === 'work' ? 'WORK' : 'REST'} ({hiitPhase.phaseElapsedSec}s)</Text>
            <Text style={styles.metric}>Work / Rest: {Math.floor(hiitPhase.workSecTotal / 60)}m / {Math.floor(hiitPhase.restSecTotal / 60)}m</Text>
          </>
        ) : null}
        {mode === 'mobility' ? <Text style={styles.metric}>Recovery intensity target active</Text> : null}
        <Text style={styles.metric}>Active calories: {Math.round(calories)} kcal</Text>
        <Text style={styles.metric}>{liveHeartRateLabel(hrState, currentHeartRate, sessionState)}</Text>
        <Text style={styles.metricHint}>{liveHeartRateHint(hrState, hrConfidence)}</Text>
        {avgHeartRate && avgHeartRate > 0 ? <Text style={styles.metric}>Avg HR: {Math.round(avgHeartRate)} bpm</Text> : null}
        {peakHeartRate && peakHeartRate > 0 ? <Text style={styles.metric}>Peak HR: {Math.round(peakHeartRate)} bpm</Text> : null}
      </LinearGradient>

      {sessionState === 'ready' && mode === 'swim' ? (
        <Pressable
          style={styles.priorityButton}
          onPress={async () => {
            const next = trackingPriority === 'accuracy' ? 'responsiveness' : 'accuracy';
            setTrackingPriority(next);
            trackingPriorityRef.current = next;
            trackingEngineRef.current = resetRunTrackingEngine(trackingEngineRef.current, next);
            await setTrackingPriorityPreference(next);
          }}
        >
          <Text style={styles.priorityText}>
            Tracking mode: {trackingPriority === 'accuracy' ? 'Accuracy priority' : 'Responsiveness priority'}
          </Text>
        </Pressable>
      ) : null}

      {mode === 'swim' ? (
        <View style={styles.modeHintChip}>
          <Text style={styles.modeHintText}>
            {trackingPriority === 'accuracy'
              ? 'Accuracy prioritizes stable pace and distance.'
              : 'Responsiveness updates faster with slightly more jitter.'}
          </Text>
        </View>
      ) : null}

      <View style={styles.controls}>
        {sessionState === 'ready' ? (
          <Pressable style={[styles.button, styles.primary]} onPress={() => void startSession()}>
            <Text style={styles.primaryText}>START</Text>
          </Pressable>
        ) : null}

        {canTogglePause ? (
          <Pressable style={[styles.button, styles.neutral]} onPress={() => void togglePause()}>
            <Text style={styles.neutralText}>{sessionState === 'paused' ? 'RESUME' : 'PAUSE'}</Text>
          </Pressable>
        ) : null}

        {(sessionState === 'recording' || sessionState === 'paused') ? (
          <Pressable style={[styles.button, styles.danger]} onPress={() => void armEnd()}>
            <Text style={styles.dangerText}>END</Text>
          </Pressable>
        ) : null}
      </View>

      {sessionState === 'endingConfirm' ? (
        <View style={styles.confirmCard}>
          <Text style={styles.confirmTitle}>End session?</Text>
          <Text style={styles.confirmSub}>Double tap END within 2.5s</Text>
          <View style={styles.confirmRow}>
            <Pressable style={[styles.button, styles.neutral, styles.flex]} onPress={() => void cancelEnd()}>
              <Text style={styles.neutralText}>CANCEL</Text>
            </Pressable>
            <Pressable style={[styles.button, styles.danger, styles.flex]} onPress={() => void confirmEnd()}>
              <Text style={styles.dangerText}>END</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {sessionState === 'ended' ? (
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Session Summary</Text>
          <Text style={styles.summaryText}>Duration: {formatDuration(elapsedSec)}</Text>
          {mode === 'swim' ? <Text style={styles.summaryText}>Distance: {refinementPreview.distanceMiles.toFixed(2)} mi</Text> : null}
          <Text style={styles.summaryText}>Calories: {Math.round(refinementPreview.calories)} kcal</Text>
          {avgHeartRate && avgHeartRate > 0 ? <Text style={styles.summaryText}>Avg HR: {Math.round(avgHeartRate)} bpm</Text> : null}
          {peakHeartRate && peakHeartRate > 0 ? <Text style={styles.summaryText}>Peak HR: {Math.round(peakHeartRate)} bpm</Text> : null}
          {refinementPreview.note ? <Text style={styles.summaryRefined}>{refinementPreview.note}</Text> : null}
          <View style={styles.confirmRow}>
            <Pressable style={[styles.button, styles.neutral, styles.flex]} onPress={() => void discardSession()}>
              <Text style={styles.neutralText}>DISCARD</Text>
            </Pressable>
            <Pressable style={[styles.button, styles.primary, styles.flex]} onPress={() => void saveSession()}>
              <Text style={styles.primaryText}>SAVE</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#050A12',
    paddingHorizontal: 16,
  },
  header: {
    paddingTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  back: {
    color: '#9FC7E4',
    fontSize: 14,
    fontWeight: '700',
  },
  title: {
    color: '#E8F4FF',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  metricsCard: {
    marginTop: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(124, 170, 206, 0.35)',
    padding: 18,
    gap: 6,
  },
  status: {
    color: '#9DC6E3',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
    marginBottom: 2,
  },
  badge: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2C4C64',
    backgroundColor: '#102132',
    paddingHorizontal: 8,
    paddingVertical: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  badgeLabel: {
    color: '#79A6C8',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  badgeValue: {
    color: '#D9EEFF',
    fontSize: 11,
    fontWeight: '800',
  },
  time: {
    color: '#F2FAFF',
    fontSize: 48,
    fontWeight: '900',
    letterSpacing: -1.2,
    marginBottom: 2,
  },
  metric: {
    color: '#D5E9F8',
    fontSize: 15,
    fontWeight: '600',
  },
  metricHint: {
    color: '#88AAC4',
    fontSize: 12,
  },
  priorityButton: {
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#27547A',
    backgroundColor: '#102438',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  priorityText: {
    color: '#A7D2F0',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  modeHintChip: {
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#29445A',
    backgroundColor: '#0E1B27',
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  modeHintText: {
    color: '#8AB1CE',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  controls: {
    marginTop: 16,
    gap: 10,
  },
  button: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: {
    backgroundColor: '#2CE3A2',
  },
  neutral: {
    backgroundColor: '#182636',
    borderWidth: 1,
    borderColor: '#35506A',
  },
  secondary: {
    backgroundColor: '#0E3D5A',
    borderWidth: 1,
    borderColor: '#2B7BA6',
  },
  danger: {
    backgroundColor: '#5E2121',
    borderWidth: 1,
    borderColor: '#BC5454',
  },
  primaryText: {
    color: '#01140F',
    fontWeight: '900',
    letterSpacing: 1.4,
    fontSize: 16,
  },
  neutralText: {
    color: '#CEE8FA',
    fontWeight: '800',
    letterSpacing: 1.2,
    fontSize: 14,
  },
  secondaryText: {
    color: '#9ED4F4',
    fontWeight: '800',
    letterSpacing: 1.2,
    fontSize: 14,
  },
  dangerText: {
    color: '#FFD8D8',
    fontWeight: '800',
    letterSpacing: 1.2,
    fontSize: 14,
  },
  confirmCard: {
    marginTop: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#8D4A4A',
    backgroundColor: '#271619',
    padding: 14,
    gap: 10,
  },
  confirmTitle: {
    color: '#FFE8E8',
    fontSize: 17,
    fontWeight: '800',
  },
  confirmSub: {
    color: '#E6BDBD',
    fontSize: 13,
  },
  confirmRow: {
    flexDirection: 'row',
    gap: 10,
  },
  flex: {
    flex: 1,
  },
  summaryCard: {
    marginTop: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#35506A',
    backgroundColor: '#101A27',
    padding: 14,
    gap: 6,
  },
  summaryTitle: {
    color: '#ECF7FF',
    fontSize: 18,
    fontWeight: '800',
  },
  summaryText: {
    color: '#CCE3F3',
    fontSize: 14,
    fontWeight: '600',
  },
  summaryRefined: {
    color: '#9FD9C6',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
});
