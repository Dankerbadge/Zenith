// GPS Tracking Service for Running
// Handles location tracking, distance calculation, pace calculation

import * as Location from 'expo-location';
import { useState, useEffect, useRef } from 'react';
import { APP_CONFIG } from './appConfig';
import { captureException } from './crashReporter';

export interface LocationPoint {
  latitude: number;
  longitude: number;
  timestamp: number;
  altitude: number | null;
  accuracy: number | null;
  speed?: number | null;
}

export interface RunStats {
  distance: number; // miles
  duration: number; // seconds
  currentPace: number; // min/mile
  averagePace: number; // min/mile
  calories: number;
  splits: Split[];
  reactions: Reaction[];
}

export interface Split {
  mile: number;
  time: number; // seconds
  pace: number; // min/mile
  // Optional: partial distance for the final split (miles).
  partial?: number;
  // Optional: attribution for split timing (e.g. synthesized timestamps from a route preview).
  timeSource?: 'gps' | 'estimated_route_preview';
}

export interface Reaction {
  type: '👍' | '👎' | '🔥' | '😮‍💨';
  distance: number; // miles
  timestamp: number;
}

export type PauseEvent = { pauseAtUtc: string; resumeAtUtc?: string };

export type TrackingSampleProfile = 'precision' | 'balanced' | 'eco';
export type LiveMetricDisplayState = 'live_confident' | 'live_estimated' | 'acquiring' | 'unavailable' | 'paused';
export type TrackingPriority = 'accuracy' | 'responsiveness';
export type ConfidenceLevel = 'high' | 'medium' | 'low';

export type RunTrackingEngineState = {
  priority: TrackingPriority;
  totalDistanceMiles: number;
  lastPoint: LocationPoint | null;
  smoothedSpeedMps: number | null;
  recentSpeedSamplesMps: number[];
  acceptedPointCount: number;
};

export type RunLiveMetrics = {
  includePointInRoute: boolean;
  distanceDeltaMiles: number;
  totalDistanceMiles: number;
  gpsConfidence: ConfidenceLevel;
  paceState: LiveMetricDisplayState;
  currentPaceMinPerMile: number | null;
  averagePaceMinPerMile: number | null;
  sourceTag: 'gps' | 'fused' | 'estimated';
};

const MILES_TO_METERS = 1609.344;
const SECONDS_PER_MINUTE = 60;

function toMinPerMileFromMps(speedMps: number): number {
  if (!Number.isFinite(speedMps) || speedMps <= 0) return 0;
  return (MILES_TO_METERS / speedMps) / SECONDS_PER_MINUTE;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[middle - 1] + sorted[middle]) / 2;
  return sorted[middle];
}

function resolveConfidenceFromAccuracy(accuracyMeters: number | null | undefined): ConfidenceLevel {
  const accuracy = Number(accuracyMeters);
  if (!Number.isFinite(accuracy) || accuracy <= 0) return 'low';
  if (accuracy <= APP_CONFIG.LIVE_TRACKING.RUN.CONFIDENCE_HIGH_ACCURACY_MAX) return 'high';
  if (accuracy <= APP_CONFIG.LIVE_TRACKING.RUN.CONFIDENCE_MEDIUM_ACCURACY_MAX) return 'medium';
  return 'low';
}

function isOutlierSegment(input: {
  deltaDistanceMiles: number;
  deltaSeconds: number;
  speedMps: number;
  confidence: ConfidenceLevel;
  previousSmoothedSpeedMps: number | null;
  accuracyMeters: number | null;
}) {
  const { deltaDistanceMiles, deltaSeconds, speedMps, confidence, previousSmoothedSpeedMps, accuracyMeters } = input;
  if (!Number.isFinite(deltaDistanceMiles) || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return true;

  // Treat extremely stale samples as unusable for live metric integration.
  if (deltaSeconds > APP_CONFIG.LIVE_TRACKING.RUN.GAP_ESTIMATION_MAX_SEC) return true;

  // Hard reject on very poor accuracy (even in responsiveness mode).
  const acc = Number(accuracyMeters);
  if (Number.isFinite(acc) && acc > APP_CONFIG.LIVE_TRACKING.RUN.ACCURACY_REJECT_METERS) return true;

  // If the location stream stalls long enough to be considered "lost", do not integrate distance
  // across the gap. This prevents late GPS "catch-up" points from adding huge distance spikes.
  if (deltaSeconds > APP_CONFIG.LIVE_TRACKING.RUN.GPS_STATE.LOST_AFTER_SEC) return true;

  // Impossible jump protection to prevent "teleports" from polluting live metrics.
  if (
    deltaDistanceMiles > APP_CONFIG.LIVE_TRACKING.RUN.TELEPORT_MAX_SEGMENT_MILES &&
    deltaSeconds < APP_CONFIG.LIVE_TRACKING.RUN.TELEPORT_WINDOW_SEC
  ) return true;
  if (speedMps > APP_CONFIG.LIVE_TRACKING.RUN.OUTLIER_MAX_SPEED_MPS) return true;
  if (confidence === 'low' && speedMps > APP_CONFIG.LIVE_TRACKING.RUN.LOW_CONF_MAX_SPEED_MPS) return true;
  if (previousSmoothedSpeedMps && previousSmoothedSpeedMps > 0) {
    const ratio = speedMps / previousSmoothedSpeedMps;
    if (
      ratio > APP_CONFIG.LIVE_TRACKING.RUN.SPEED_RATIO_SPIKE_MAX &&
      deltaSeconds < APP_CONFIG.LIVE_TRACKING.RUN.SPEED_RATIO_SPIKE_WINDOW_SEC
    ) return true;
  }

  return false;
}

export function createRunTrackingEngine(priority: TrackingPriority = 'accuracy'): RunTrackingEngineState {
  return {
    priority,
    totalDistanceMiles: 0,
    lastPoint: null,
    smoothedSpeedMps: null,
    recentSpeedSamplesMps: [],
    acceptedPointCount: 0,
  };
}

export function resetRunTrackingEngine(
  state: RunTrackingEngineState,
  priority: TrackingPriority = state.priority
): RunTrackingEngineState {
  return createRunTrackingEngine(priority);
}

export function updateRunTrackingEngine(
  state: RunTrackingEngineState,
  point: LocationPoint,
  activeTimeSec: number
): { state: RunTrackingEngineState; metrics: RunLiveMetrics } {
  const previous = state.lastPoint;
  if (!previous) {
    const nextState: RunTrackingEngineState = {
      ...state,
      lastPoint: point,
    };
    return {
      state: nextState,
      metrics: {
        includePointInRoute: true,
        distanceDeltaMiles: 0,
        totalDistanceMiles: nextState.totalDistanceMiles,
        gpsConfidence: resolveConfidenceFromAccuracy(point.accuracy),
        paceState: 'acquiring',
        currentPaceMinPerMile: null,
        averagePaceMinPerMile: null,
        sourceTag: 'gps',
      },
    };
  }

  const deltaSecondsRaw = (point.timestamp - previous.timestamp) / 1000;
  const deltaSeconds = Math.max(0.25, Number.isFinite(deltaSecondsRaw) ? deltaSecondsRaw : 0.25);
  const rawDistanceMiles = calculateDistance(previous.latitude, previous.longitude, point.latitude, point.longitude);
  const rawSpeedMpsFromDistance = (rawDistanceMiles * MILES_TO_METERS) / deltaSeconds;
  const speedFromSensor =
    typeof point.speed === 'number' && Number.isFinite(point.speed) && point.speed >= 0 ? point.speed : null;
  const accuracyMeters =
    typeof point.accuracy === 'number' && Number.isFinite(point.accuracy) && point.accuracy > 0 ? point.accuracy : null;
  const confidence = resolveConfidenceFromAccuracy(accuracyMeters);

  // Prefer GPS-provided speed (typically Doppler-derived on-device) for pace stability when
  // the reported accuracy is not extreme. When accuracy is very poor, treat speed as unreliable.
  const hasSensorSpeed =
    speedFromSensor != null &&
    speedFromSensor <= APP_CONFIG.LIVE_TRACKING.RUN.OUTLIER_MAX_SPEED_MPS &&
    (accuracyMeters == null || accuracyMeters <= APP_CONFIG.LIVE_TRACKING.RUN.ACCURACY_REJECT_METERS);

  const sensorWeight =
    !hasSensorSpeed
      ? 0
      : deltaSeconds >= 3
      ? 0.55
      : confidence === 'high'
      ? 0.45
      : confidence === 'medium'
      ? 0.35
      : 0.25;

  const sensorSpeedMps = speedFromSensor ?? 0;
  const fusedSpeedMps = hasSensorSpeed
    ? (rawSpeedMpsFromDistance * (1 - sensorWeight)) + (sensorSpeedMps * sensorWeight)
    : rawSpeedMpsFromDistance;

  // For short location gaps, blend in distance estimated from speed to reduce corner-cutting,
  // but keep it bounded to avoid drift.
  const distanceFromSpeedMiles = hasSensorSpeed ? (fusedSpeedMps * deltaSeconds) / MILES_TO_METERS : rawDistanceMiles;
  const gapBlend = hasSensorSpeed && deltaSeconds >= 2.5;
  const blendedDistanceMiles = gapBlend ? (rawDistanceMiles * 0.4) + (distanceFromSpeedMiles * 0.6) : rawDistanceMiles;
  const outlier = isOutlierSegment({
    deltaDistanceMiles: blendedDistanceMiles,
    deltaSeconds,
    speedMps: fusedSpeedMps,
    confidence,
    previousSmoothedSpeedMps: state.smoothedSpeedMps,
    accuracyMeters,
  });

  const shouldIntegrateDistance = !outlier && (
    confidence !== 'low' || state.priority === 'responsiveness'
  );
  const shouldIncludePoint =
    !outlier && ((accuracyMeters ?? 999) <= APP_CONFIG.LIVE_TRACKING.RUN.ROUTE_INCLUDE_MAX_ACCURACY_METERS);

  const distanceDeltaMiles = shouldIntegrateDistance ? blendedDistanceMiles : 0;
  const totalDistanceMiles = state.totalDistanceMiles + distanceDeltaMiles;

  const targetWindow =
    state.priority === 'accuracy'
      ? APP_CONFIG.LIVE_TRACKING.RUN.SMOOTH_WINDOW_ACCURACY
      : APP_CONFIG.LIVE_TRACKING.RUN.SMOOTH_WINDOW_RESPONSIVE;
  const recentSpeedSamplesMps = shouldIntegrateDistance
    ? [...state.recentSpeedSamplesMps, fusedSpeedMps].slice(-targetWindow)
    : [...state.recentSpeedSamplesMps];
  const medianSpeedMps = median(recentSpeedSamplesMps);
  const alpha =
    state.priority === 'accuracy'
      ? APP_CONFIG.LIVE_TRACKING.RUN.SMOOTH_ALPHA_ACCURACY
      : APP_CONFIG.LIVE_TRACKING.RUN.SMOOTH_ALPHA_RESPONSIVE;
  const smoothedSpeedMps =
    medianSpeedMps > 0
      ? (state.smoothedSpeedMps == null
          ? medianSpeedMps
          : (state.smoothedSpeedMps * (1 - alpha)) + (medianSpeedMps * alpha))
      : state.smoothedSpeedMps;
  const currentPaceMinPerMile =
    smoothedSpeedMps && smoothedSpeedMps > APP_CONFIG.LIVE_TRACKING.RUN.PACE_MIN_SPEED_MPS
      ? toMinPerMileFromMps(smoothedSpeedMps)
      : null;
  const averagePaceMinPerMile =
    totalDistanceMiles > 0.01 && activeTimeSec > 0 ? calculatePace(totalDistanceMiles, activeTimeSec) : null;

  let paceState: LiveMetricDisplayState = 'acquiring';
  if (
    activeTimeSec <= APP_CONFIG.LIVE_TRACKING.RUN.ACQUIRING_MIN_ACTIVE_SEC ||
    recentSpeedSamplesMps.length < APP_CONFIG.LIVE_TRACKING.RUN.ACQUIRING_MIN_SAMPLES
  ) {
    paceState = 'acquiring';
  } else if (!currentPaceMinPerMile || !Number.isFinite(currentPaceMinPerMile)) {
    paceState = 'unavailable';
  } else if (confidence === 'low') {
    paceState = 'live_estimated';
  } else {
    paceState = 'live_confident';
  }

  const nextState: RunTrackingEngineState = {
    ...state,
    totalDistanceMiles,
    lastPoint: point,
    smoothedSpeedMps: smoothedSpeedMps ?? state.smoothedSpeedMps,
    recentSpeedSamplesMps,
    acceptedPointCount: shouldIntegrateDistance ? state.acceptedPointCount + 1 : state.acceptedPointCount,
  };

  return {
    state: nextState,
    metrics: {
      includePointInRoute: shouldIncludePoint,
      distanceDeltaMiles,
      totalDistanceMiles,
      gpsConfidence: confidence,
      paceState,
      currentPaceMinPerMile,
      averagePaceMinPerMile,
      sourceTag: confidence === 'low' ? 'estimated' : hasSensorSpeed ? 'fused' : 'gps',
    },
  };
}

/**
 * Calculate distance between two GPS points using Haversine formula
 * Returns distance in miles
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 3959; // Earth's radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  
  return distance;
}

function toRad(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Calculate pace in min/mile from speed
 */
export function calculatePace(distanceMiles: number, durationSeconds: number): number {
  if (distanceMiles === 0) return 0;
  const paceMinutesPerMile = durationSeconds / 60 / distanceMiles;
  return paceMinutesPerMile;
}

/**
 * Format pace as MM'SS"
 */
export function formatPace(paceMinPerMile: number): string {
  if (!paceMinPerMile || paceMinPerMile === 0 || !isFinite(paceMinPerMile)) {
    return "--'--\"";
  }
  
  const minutes = Math.floor(paceMinPerMile);
  const seconds = Math.round((paceMinPerMile - minutes) * 60);
  return `${minutes}'${seconds.toString().padStart(2, '0')}"`;
}

/**
 * Format time as HH:MM:SS
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Calculate calories burned from running
 * Formula: Distance (miles) × Weight (lbs) × 0.63
 */
export function calculateRunningCalories(distanceMiles: number, weightLbs: number): number {
  return Math.round(distanceMiles * weightLbs * 0.63);
}

/**
 * Generate splits for each mile
 */
export function generateSplits(
  route: LocationPoint[],
  totalDistance: number,
  totalDuration: number,
  options?: { pauseEvents?: PauseEvent[]; timeSource?: Split['timeSource'] }
): Split[] {
  if (route.length < 2) return [];
  
  const splits: Split[] = [];
  let currentMile = 1;
  let mileStartIndex = 0;
  let accumulatedDistance = 0;
  const pauseEvents = Array.isArray(options?.pauseEvents) ? options?.pauseEvents : [];
  const timeSource = options?.timeSource;

  const pausedSecondsBetween = (startMs: number, endMs: number) => {
    if (!pauseEvents.length || endMs <= startMs) return 0;
    let pausedSec = 0;
    for (const event of pauseEvents) {
      const pauseAt = new Date(event.pauseAtUtc).getTime();
      const resumeAt = event.resumeAtUtc ? new Date(event.resumeAtUtc).getTime() : endMs;
      const overlapStart = Math.max(startMs, pauseAt);
      const overlapEnd = Math.min(endMs, resumeAt);
      if (overlapEnd > overlapStart) {
        pausedSec += (overlapEnd - overlapStart) / 1000;
      }
    }
    return Math.max(0, pausedSec);
  };
  
  for (let i = 1; i < route.length; i++) {
    const segmentDistance = calculateDistance(
      route[i - 1].latitude,
      route[i - 1].longitude,
      route[i].latitude,
      route[i].longitude
    );
    
    accumulatedDistance += segmentDistance;
    
    // Check if we've completed a mile
    if (accumulatedDistance >= currentMile) {
      const rawSplitTime = (route[i].timestamp - route[mileStartIndex].timestamp) / 1000;
      const splitTime = Math.max(0, rawSplitTime - pausedSecondsBetween(route[mileStartIndex].timestamp, route[i].timestamp));
      const splitPace = calculatePace(1, splitTime);
      
      splits.push({
        mile: currentMile,
        time: Math.round(splitTime),
        pace: splitPace,
        ...(timeSource ? { timeSource } : {}),
      });
      
      currentMile++;
      mileStartIndex = i;
    }
  }
  
  // Handle partial mile at end
  if (accumulatedDistance > splits.length) {
    const remainingDistance = totalDistance - splits.length;
    if (remainingDistance > 0.1) { // Only if > 0.1 miles
      const rawSplitTime = (route[route.length - 1].timestamp - route[mileStartIndex].timestamp) / 1000;
      const splitTime = Math.max(
        0,
        rawSplitTime - pausedSecondsBetween(route[mileStartIndex].timestamp, route[route.length - 1].timestamp)
      );
      const splitPace = calculatePace(remainingDistance, splitTime);
      
      splits.push({
        mile: currentMile,
        time: Math.round(splitTime),
        pace: splitPace,
        partial: Number(remainingDistance.toFixed(2)),
        ...(timeSource ? { timeSource } : {}),
      });
    }
  }
  
  return splits;
}

/**
 * Detect if user is stationary (for auto-pause)
 * Returns true if movement is below threshold
 */
export function isStationary(
  currentLocation: LocationPoint,
  previousLocation: LocationPoint,
  thresholdMiles: number = 0.001 // ~5 feet
): boolean {
  const distance = calculateDistance(
    previousLocation.latitude,
    previousLocation.longitude,
    currentLocation.latitude,
    currentLocation.longitude
  );
  
  return distance < thresholdMiles;
}

/**
 * Calculate current pace from recent points
 * Uses last N points for smoothing
 */
export function calculateCurrentPace(
  route: LocationPoint[],
  sampleSize: number = 5
): number {
  if (route.length < 2) return 0;
  
  const recentPoints = route.slice(-Math.min(sampleSize, route.length));
  if (recentPoints.length < 2) return 0;
  
  let totalDistance = 0;
  for (let i = 1; i < recentPoints.length; i++) {
    totalDistance += calculateDistance(
      recentPoints[i - 1].latitude,
      recentPoints[i - 1].longitude,
      recentPoints[i].latitude,
      recentPoints[i].longitude
    );
  }
  
  const duration = (recentPoints[recentPoints.length - 1].timestamp - recentPoints[0].timestamp) / 1000;
  return calculatePace(totalDistance, duration);
}

/**
 * Request location permissions
 */
export async function requestLocationPermissions(): Promise<boolean> {
  try {
    const { status: foregroundStatus } = await Location.requestForegroundPermissionsAsync();
    if (foregroundStatus !== 'granted') {
      return false;
    }

    return foregroundStatus === 'granted';
  } catch (error) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('Error requesting location permissions:', error);
    } else {
      void captureException(error, { feature: 'gps', op: 'request_permissions' });
    }
    return false;
  }
}

/**
 * Request background location permission for lock-screen/background run tracking.
 * Returns false when not granted; foreground tracking can still continue.
 */
export async function requestBackgroundLocationPermissions(): Promise<boolean> {
  try {
    const current = await Location.getBackgroundPermissionsAsync();
    if (current.status === 'granted') return true;
    const requested = await Location.requestBackgroundPermissionsAsync();
    return requested.status === 'granted';
  } catch (error) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('Error requesting background location permissions:', error);
    } else {
      void captureException(error, { feature: 'gps', op: 'request_background_permissions' });
    }
    return false;
  }
}

/**
 * Start location tracking
 */
export async function startLocationTracking(
  onLocationUpdate: (location: LocationPoint) => void,
  profile: TrackingSampleProfile = 'balanced'
): Promise<Location.LocationSubscription | null> {
  try {
    const sampling = APP_CONFIG.LIVE_TRACKING.RUN.SAMPLING;
    const trackingOptions =
      profile === 'precision'
        ? {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: sampling.PRECISION.TIME_INTERVAL_MS,
            distanceInterval: sampling.PRECISION.DISTANCE_INTERVAL_M,
          }
        : profile === 'eco'
        ? {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: sampling.ECO.TIME_INTERVAL_MS,
            distanceInterval: sampling.ECO.DISTANCE_INTERVAL_M,
          }
        : {
            accuracy: Location.Accuracy.High,
            timeInterval: sampling.BALANCED.TIME_INTERVAL_MS,
            distanceInterval: sampling.BALANCED.DISTANCE_INTERVAL_M,
          };

    const subscription = await Location.watchPositionAsync(
      trackingOptions,
      (location) => {
        const point: LocationPoint = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          timestamp: location.timestamp,
          altitude: location.coords.altitude,
          accuracy: location.coords.accuracy,
          speed: location.coords.speed,
        };
        onLocationUpdate(point);
      }
    );
    
    return subscription;
  } catch (error) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('Error starting location tracking:', error);
    } else {
      void captureException(error, { feature: 'gps', op: 'start_tracking', profile });
    }
    return null;
  }
}

/**
 * Calculate total distance from route
 */
export function calculateTotalDistance(route: LocationPoint[]): number {
  if (route.length < 2) return 0;
  
  let totalDistance = 0;
  for (let i = 1; i < route.length; i++) {
    totalDistance += calculateDistance(
      route[i - 1].latitude,
      route[i - 1].longitude,
      route[i].latitude,
      route[i].longitude
    );
  }
  
  return totalDistance;
}
