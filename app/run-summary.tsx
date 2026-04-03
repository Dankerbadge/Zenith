import React, { useState, useEffect, useCallback } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, Pressable, Alert } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { acknowledgeSurfaceInsights, dismissSurfaceInsights, getPostRunInsights } from '../utils/aiInsightEngine';
import { formatPace, formatDuration, generateSplits } from '../utils/gpsService';
import type { AiInsight } from '../utils/aiTypes';
import { updateRunHistoryEntry } from '../utils/runReviewService';
import { patchCanonicalRun } from '../utils/canonicalRunService';
import { getDailyLog, saveDailyLog } from '../utils/storageUtils';
import { captureException } from '../utils/crashReporter';

type MapsModule = typeof import('react-native-maps');
let cachedMapsModule: MapsModule | null = null;
let attemptedMapsModuleLoad = false;

function getMapsModule(): MapsModule | null {
  if (attemptedMapsModuleLoad) return cachedMapsModule;
  attemptedMapsModuleLoad = true;
  try {
    // Keep this lazy so the screen still works in clients without native maps.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedMapsModule = require('react-native-maps');
  } catch (error) {
    // Non-fatal: native maps may be absent in some clients. Avoid noisy production logs.
    if (__DEV__) {
      console.log('react-native-maps unavailable:', error);
    }
    cachedMapsModule = null;
  }
  return cachedMapsModule;
}

interface RunData {
  runId?: string;
  distance: number;
  duration: number;
  pausedTimeSec?: number;
  averagePace: number;
  calories: number;
  xpEarned: number;
  timestamp?: string;
  route: any[];
  reactions: any[];
  // Optional: attribution for split timing (e.g. synthesized timestamps from watch route previews).
  splitTimeSource?: 'gps' | 'estimated_route_preview';
  detectedSegments?: {
    segmentId: string;
    name: string;
    direction: 'forward' | 'reverse';
    score: number;
    distanceMiles: number;
    isPrHit?: boolean;
    quality?: 'high' | 'medium' | 'low' | 'unknown';
    qualityReasons?: string[];
  }[];
  rewardMeta?: {
    xpAwarded: number;
    routePrHit: boolean;
    segmentPrHits: number;
    totalPrHits: number;
    distanceConfidence?: number;
    prEligibleByConfidence?: boolean;
    routePrBlockedByConfidence?: boolean;
    segmentPrBlockedByConfidence?: number;
    winningBefore: boolean;
    winningAfter: boolean;
    streakBefore: number;
    streakAfter: number;
  };
  insightPacket?: {
    lines?: string[];
    evidence?: {
      runId?: string;
      routeId?: string | null;
      routePrHit?: boolean;
      segmentPrHits?: number;
      recentRunCount7d?: number;
    };
  };
  refinement?: {
    applied: boolean;
    distanceBefore?: number;
    distanceAfter?: number;
    caloriesBefore?: number;
    caloriesAfter?: number;
    note?: string;
  };
  diagnostics?: {
    samples: number;
    confidence: { high: number; medium: number; low: number };
    sourceTags: { gps: number; fused: number; estimated: number };
    gpsGapSeconds?: number;
    estimatedGapDistanceMiles?: number;
    gpsStates?: { good: number; degraded: number; lost: number; recovered: number };
  };
  gapSegments?: {
    gapId: string;
    startTimeUtc: string;
    endTimeUtc: string;
    type: 'degraded_gap' | 'lost_gap';
    estimatorUsed: 'none' | 'watch_motion' | 'interpolate' | 'hybrid';
    estimatedDistanceMiles: number;
    confidenceScore: number;
  }[];
  confidenceSummary?: {
    distanceConfidence: number;
    paceConfidence: number;
    hrConfidence: number | null;
  };
  hrAvailable?: boolean;
  metricVersions?: {
    accuracyModelVersion?: string;
    gpsProcessingVersion?: string;
    strideModelVersion?: string;
    calorieFormulaVersion?: string;
    splitLogicVersion?: string;
    confidenceModelVersion?: string;
    refinementModelVersion?: string;
  };
  metricsLock?: {
    metricsImmutable?: boolean;
    metricsLockedAtUtc?: string;
    sessionIntegrityState?: 'open' | 'locked' | 'reconciled' | 'pending' | 'finalized';
  };
  loggedAtUtc?: string;
  xpEligibleByTime?: boolean;
  lateLoggedNoXP?: boolean;
  accuracyIssueFlagged?: boolean;
  accuracyIssueReason?: string;
  accuracyIssueFlaggedAtUtc?: string;
  accuracyIssueNote?: string;
  splits: any[];
  splitsSuppressed?: boolean;
  pauseEvents?: { pauseAtUtc: string; resumeAtUtc?: string }[];

  // Garmin crash recovery UX: surface everywhere a run is shown.
  sessionRecovered?: boolean;
  recoveryReason?: string | null;
  recoveryDetectedAt?: string | null;
  recoveryNotes?: string | null;
}

function safeParseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function localDayKeyFromIso(iso: string): string | null {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function previousDayKey(dayKey: string): string {
  const [y0, m0, d0] = String(dayKey).split('-').map(Number);
  const dt =
    Number.isFinite(y0) && Number.isFinite(m0) && Number.isFinite(d0) ? new Date(y0, m0 - 1, d0, 0, 0, 0, 0) : new Date(NaN);
  if (!Number.isFinite(dt.getTime())) return dayKey;
  dt.setDate(dt.getDate() - 1);
  const y1 = dt.getFullYear();
  const m1 = String(dt.getMonth() + 1).padStart(2, '0');
  const d1 = String(dt.getDate()).padStart(2, '0');
  return `${y1}-${m1}-${d1}`;
}

export default function RunSummaryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const [runData, setRunData] = useState<RunData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [aiInsights, setAiInsights] = useState<AiInsight[]>([]);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [flaggingAccuracy, setFlaggingAccuracy] = useState(false);

  const loadRunData = useCallback(async () => {
    try {
      // Get the most recent run from history
      const runsHistory = await AsyncStorage.getItem('runsHistory');
      const runs = safeParseJson<any[]>(runsHistory, []);
      if (Array.isArray(runs) && runs.length > 0) {
        const requestedRunId = String(params.runId || '').trim();
        const requestedTimestamp = String(params.timestamp || '').trim();
        const resolvedRun =
          (requestedRunId ? runs.find((entry) => String(entry?.runId || '') === requestedRunId) : null) ||
          (requestedTimestamp ? runs.find((entry) => String(entry?.timestamp || '') === requestedTimestamp) : null) ||
          runs[runs.length - 1];
        const latestRun = resolvedRun;
        
        const shouldSuppressSplits = (() => {
          const estimatedFromDiagnostics = Number((latestRun as any)?.diagnostics?.estimatedGapDistanceMiles) || 0;
          if (estimatedFromDiagnostics > 0) return true;
          const gaps = Array.isArray((latestRun as any)?.gapSegments) ? ((latestRun as any).gapSegments as any[]) : [];
          const sumEstimated = gaps.reduce((sum, gap) => sum + (Number(gap?.estimatedDistanceMiles) || 0), 0);
          if (sumEstimated > 0) return true;
          const hasLowConfidenceEstimator = gaps.some((gap) => {
            const conf = Number(gap?.confidenceScore);
            const estimator = String(gap?.estimatorUsed || '');
            return Number.isFinite(conf) && conf < 1 && estimator && estimator !== 'none';
          });
          return hasLowConfidenceEstimator;
        })();

        // Generate splits from route (moving-time based). Suppress if any distance was estimated during GPS gaps.
        const movingDuration = Math.max(0, Number(latestRun.duration) - Math.max(0, Number(latestRun.pausedTimeSec) || 0));
        const derivedPace =
          Number(latestRun.distance) > 0 && movingDuration > 0
            ? movingDuration / 60 / Number(latestRun.distance)
            : Number(latestRun.averagePace) || 0;
        const splits = shouldSuppressSplits
          ? []
          : generateSplitsFromRoute(
              latestRun.route,
              latestRun.distance,
              movingDuration,
              latestRun.pauseEvents,
              (latestRun as any)?.splitTimeSource
            );
        
        const resolvedRunData = {
          ...latestRun,
          duration: movingDuration,
          averagePace: derivedPace,
          splits,
          splitsSuppressed: shouldSuppressSplits,
        };
        setRunData(resolvedRunData);
        setLoadError(false);
        const insights = await getPostRunInsights({
          dateKey: new Date(resolvedRunData.timestamp || Date.now()).toISOString().slice(0, 10),
          runId: String((resolvedRunData as any).runId || `run_${Date.now()}`),
          distanceMiles: Number(resolvedRunData.distance) || 0,
          durationSec: Number(resolvedRunData.duration) || 0,
          avgPaceSecPerMile: Number(resolvedRunData.averagePace) || 0,
          routePrHit: Boolean(resolvedRunData.rewardMeta?.routePrHit),
          segmentPrHits: Number(resolvedRunData.rewardMeta?.segmentPrHits) || 0,
          winningDayAfter: Boolean(resolvedRunData.rewardMeta?.winningAfter),
          streakAfter: Number(resolvedRunData.rewardMeta?.streakAfter) || 0,
        });
        setAiInsights(insights);
        if (insights.length > 0) {
          await acknowledgeSurfaceInsights(insights);
        }
      } else {
        // Fallback to params if no history
        const fallbackData = {
          distance: Number(params.distance) || 0,
          duration: Number(params.duration) || 0,
          averagePace: Number(params.pace) || 0,
          calories: Number(params.calories) || 0,
          xpEarned: Number(params.xp) || 0,
          route: [],
          reactions: [],
          splits: []
        };
        setRunData(fallbackData);
        setLoadError(false);
      }
    } catch (error) {
      setLoadError(true);
      if (__DEV__) {
        console.log('Error loading run data:', error);
      } else {
        void captureException(error, { feature: 'run_summary', op: 'load_run_data' });
      }
    } finally {
      setLoading(false);
    }
  }, [params.calories, params.distance, params.duration, params.pace, params.runId, params.timestamp, params.xp]);

  useEffect(() => {
    void loadRunData();
  }, [loadRunData]);

  const flagAccuracyIssue = useCallback(() => {
    if (!runData || flaggingAccuracy) return;
    const runId = String(runData.runId || '').trim();
    const timestamp = String(runData.timestamp || '').trim();
    if (!runId && !timestamp) return;

    Alert.alert(
      'Flag GPS accuracy issue?',
      'This keeps your recorded metrics unchanged and adds a review marker for this run.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Flag',
          onPress: async () => {
            setFlaggingAccuracy(true);
            try {
              const flaggedAt = new Date().toISOString();
              const distanceConfidence = Number(
                runData.confidenceSummary?.distanceConfidence ??
                  runData.rewardMeta?.distanceConfidence ??
                  0
              );
              const reason =
                runData.diagnostics?.gpsGapSeconds && runData.diagnostics.gpsGapSeconds > 0
                  ? 'gps_gap_present'
                  : Number.isFinite(distanceConfidence) && distanceConfidence < 70
                  ? 'low_distance_confidence'
                  : 'user_reported_accuracy';

              const historyPatch = {
                accuracyIssueFlagged: true,
                accuracyIssueReason: reason,
                accuracyIssueFlaggedAtUtc: flaggedAt,
                accuracyIssueNote: 'User flagged potential GPS accuracy issue. Metrics unchanged.',
              };
              await updateRunHistoryEntry({ runId, timestamp }, historyPatch);
              const timestampDayKey = localDayKeyFromIso(timestamp);
              const candidateDayKeys = timestampDayKey
                ? Array.from(new Set([timestampDayKey, previousDayKey(timestampDayKey)]))
                : [];
              for (const dayKey of candidateDayKeys) {
                const dailyLog = await getDailyLog(dayKey);
                const workouts = Array.isArray((dailyLog as any)?.workouts) ? [...(dailyLog as any).workouts] : [];
                const targetIdx = workouts.findIndex((row: any) => {
                  const isRun = String(row?.workoutClass || '').toLowerCase() === 'run';
                  const tsMatch = String(row?.time || row?.ts || '') === timestamp;
                  return isRun && tsMatch;
                });
                if (targetIdx >= 0) {
                  workouts[targetIdx] = {
                    ...workouts[targetIdx],
                    ...historyPatch,
                  };
                  await saveDailyLog(dayKey, {
                    ...(dailyLog as any),
                    workouts,
                  });
                  break;
                }
              }
              if (runId) {
                await patchCanonicalRun(runId, {
                  dataQualityNotes: Array.from(
                    new Set([
                      ...((runData as any)?.dataQualityNotes || []),
                      'user_flagged_accuracy',
                      reason,
                    ])
                  ),
                });
              }
              setRunData((prev) => (prev ? { ...prev, ...historyPatch } : prev));
              Alert.alert('Flag saved', 'Accuracy marker added. Core run metrics were not changed.');
            } finally {
              setFlaggingAccuracy(false);
            }
          },
        },
      ]
    );
  }, [flaggingAccuracy, runData]);

  const generateSplitsFromRoute = (
    route: any[],
    totalDistance: number,
    totalDuration: number,
    pauseEvents?: { pauseAtUtc: string; resumeAtUtc?: string }[],
    splitTimeSource?: unknown
  ) => {
    if (!route || route.length < 2) return [];
    const timeSource = splitTimeSource === 'estimated_route_preview' ? 'estimated_route_preview' : undefined;
    const deterministic = generateSplits(route, totalDistance, totalDuration, { pauseEvents, timeSource });
    return deterministic.map((split) => ({
      mile: split.mile,
      time: split.time,
      pace: split.pace,
      partial: split.partial,
      timeSource: split.timeSource,
    }));
  };

  const getMapRegion = () => {
    if (!runData || !runData.route || runData.route.length === 0) {
      return {
        latitude: 37.78825,
        longitude: -122.4324,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };
    }
    
    const lats = runData.route.map(p => p.latitude);
    const lngs = runData.route.map(p => p.longitude);
    
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: (maxLat - minLat) * 1.5,
      longitudeDelta: (maxLng - minLng) * 1.5,
    };
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, styles.centerContent]} edges={['top', 'bottom', 'left', 'right']}>
        <Text style={styles.loadingText}>Loading summary...</Text>
      </SafeAreaView>
    );
  }

  if (!runData) {
    return (
      <SafeAreaView style={[styles.container, styles.centerContent]} edges={['top', 'bottom', 'left', 'right']}>
        <Text style={styles.errorTitle}>Couldn’t load run summary</Text>
        <Text style={styles.errorSub}>
          {loadError
            ? 'The summary failed to load. You can retry or return home.'
            : 'No run summary is currently available.'}
        </Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => {
            setLoadError(false);
            setLoading(true);
            void loadRunData();
          }}
        >
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.replace('/(tabs)' as any)} style={{ marginTop: 12 }}>
          <Text style={styles.backText}>Back to home</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const hasRoute = runData.route && runData.route.length > 0;
  const mapsModule = hasRoute ? getMapsModule() : null;
  const MapView = mapsModule?.default;
  const Polyline = mapsModule?.Polyline;
  const Marker = mapsModule?.Marker;
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.replace('/(tabs)')}>
            <Text style={styles.closeButton}>✕</Text>
          </TouchableOpacity>
          <Pressable onLongPress={() => setShowDebugPanel((prev) => !prev)} delayLongPress={350}>
            <Text style={styles.title}>Run Complete!</Text>
          </Pressable>
          <View style={{ width: 30 }} />
        </View>

        {runData.sessionRecovered ? (
          <View style={styles.recoveredBanner}>
            <Text style={styles.recoveredTitle}>Recovered (partial)</Text>
            <Text style={styles.recoveredText}>Some metrics may be missing due to device restart/crash.</Text>
          </View>
        ) : null}

        {/* XP Reward Banner */}
        <View style={styles.xpBanner}>
          <LinearGradient
            colors={['#00FF88', '#00D9FF']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.xpGradient}
          >
            <Text style={styles.xpIcon}>⚡</Text>
            <Text style={styles.xpText}>+{runData.xpEarned} XP</Text>
            <Text style={styles.xpSubtext}>
              {runData.lateLoggedNoXP ? 'Logged later — XP window closed' : 'Great work!'}
            </Text>
          </LinearGradient>
        </View>

        {runData.lateLoggedNoXP ? (
          <View style={styles.policyCard}>
            <Text style={styles.policyTitle}>Timing policy applied</Text>
            <Text style={styles.policyText}>
              This run was saved more than 24 hours after its training day. History and stats are updated, but XP and streak
              outcomes stay locked for fairness.
            </Text>
          </View>
        ) : null}

        {runData.rewardMeta ? (
          <View style={styles.rewardCard}>
            <Text style={styles.rewardTitle}>Reward Loop</Text>
            <Text style={styles.rewardLine}>XP +{runData.rewardMeta.xpAwarded}</Text>
            <Text style={styles.rewardLine}>
              PR hits {runData.rewardMeta.totalPrHits} (route: {runData.rewardMeta.routePrHit ? '1' : '0'} · segments: {runData.rewardMeta.segmentPrHits})
            </Text>
            <Text style={styles.rewardLine}>
              Winning Day {runData.rewardMeta.winningBefore ? 'YES' : 'NO'} → {runData.rewardMeta.winningAfter ? 'YES' : 'NO'}
            </Text>
            <Text style={styles.rewardLine}>
              Streak {runData.rewardMeta.streakBefore} → {runData.rewardMeta.streakAfter}
            </Text>
            {runData.rewardMeta.totalPrHits > 0 && Number(runData.diagnostics?.estimatedGapDistanceMiles || 0) > 0 ? (
              <Text style={styles.rewardLine}>
                PR and pace context include estimated segments ({Number(runData.diagnostics?.estimatedGapDistanceMiles || 0).toFixed(2)} mi).
              </Text>
            ) : null}
          </View>
        ) : null}

        {runData.rewardMeta ? (
          <View style={styles.prCard}>
            <Text style={styles.prTitle}>PR Eligibility</Text>
            <Text style={styles.prLine}>
              Distance confidence: {Number(runData.rewardMeta.distanceConfidence ?? runData.confidenceSummary?.distanceConfidence ?? 0).toFixed(0)}/100
            </Text>
            <Text style={styles.prLine}>
              Confidence gate: {runData.rewardMeta.prEligibleByConfidence === false ? 'Protected (PR lock active)' : 'Eligible'}
            </Text>
            {runData.rewardMeta.routePrBlockedByConfidence ? (
              <Text style={styles.prLine}>Route PR candidate was held due to low confidence.</Text>
            ) : null}
            {Number(runData.rewardMeta.segmentPrBlockedByConfidence || 0) > 0 ? (
              <Text style={styles.prLine}>
                Segment PR holds: {Number(runData.rewardMeta.segmentPrBlockedByConfidence)} due to confidence protection.
              </Text>
            ) : null}
          </View>
        ) : null}

        {runData.insightPacket?.lines?.length ? (
          <View style={styles.insightCard}>
            <Text style={styles.insightTitle}>Insight Packet</Text>
            {runData.insightPacket.lines.slice(0, 3).map((line, idx) => (
              <Text key={`${line}_${idx}`} style={styles.insightLine}>- {line}</Text>
            ))}
          </View>
        ) : null}

        {runData.refinement?.applied && runData.refinement.note ? (
          <View style={styles.refinementCard}>
            <Text style={styles.refinementTitle}>Post-session refinement</Text>
            <Text style={styles.refinementText}>{runData.refinement.note}</Text>
            <Text style={styles.refinementMeta}>
              Distance {Number(runData.refinement.distanceBefore || runData.distance).toFixed(2)} → {Number(runData.refinement.distanceAfter || runData.distance).toFixed(2)} mi ·
              Calories {Math.round(Number(runData.refinement.caloriesBefore || runData.calories))} → {Math.round(Number(runData.refinement.caloriesAfter || runData.calories))}
            </Text>
          </View>
        ) : null}

        {runData.accuracyIssueFlagged ? (
          <View style={styles.accuracyFlagCard}>
            <Text style={styles.accuracyFlagTitle}>Accuracy marker on file</Text>
            <Text style={styles.accuracyFlagText}>
              This run was flagged for review ({runData.accuracyIssueReason || 'user_reported_accuracy'}). Metrics remain unchanged.
            </Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.accuracyFlagButton, flaggingAccuracy && styles.accuracyFlagButtonDisabled]}
            onPress={flagAccuracyIssue}
            disabled={flaggingAccuracy}
          >
            <Text style={styles.accuracyFlagButtonText}>
              {flaggingAccuracy ? 'Saving marker…' : 'Flag GPS accuracy issue'}
            </Text>
            <Text style={styles.accuracyFlagSubtext}>Adds a review marker only. No distance, pace, XP, or streak edits.</Text>
          </TouchableOpacity>
        )}

        {aiInsights.length > 0 ? (
          <View style={styles.aiCard}>
            <Text style={styles.aiTitle}>AI Insight</Text>
            {aiInsights.map((insight) => (
              <View key={insight.insightId} style={styles.aiInsightRow}>
                <Text style={styles.aiText}>- {insight.text}</Text>
                <Text style={styles.aiMeta}>{insight.evidenceSummary}</Text>
              </View>
            ))}
            <Pressable style={styles.dismissAiButton} onPress={() => void dismissSurfaceInsights('post_run').then(() => setAiInsights([]))}>
              <Text style={styles.dismissAiText}>Dismiss</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Map */}
        {hasRoute && MapView && Polyline && Marker ? (
          <View style={styles.mapContainer}>
            <MapView
              style={styles.map}
              region={getMapRegion()}
              scrollEnabled={false}
              zoomEnabled={false}
              pitchEnabled={false}
              rotateEnabled={false}
            >
              <Polyline
                coordinates={runData.route.map(p => ({
                  latitude: p.latitude,
                  longitude: p.longitude
                }))}
                strokeColor="#00D9FF"
                strokeWidth={4}
              />
              
              {/* Start marker */}
              {runData.route.length > 0 && (
                <Marker
                  coordinate={{
                    latitude: runData.route[0].latitude,
                    longitude: runData.route[0].longitude
                  }}
                  title="Start"
                >
                  <View style={styles.startMarker}>
                    <Text style={styles.markerText}>S</Text>
                  </View>
                </Marker>
              )}
              
              {/* End marker */}
              {runData.route.length > 1 && (
                <Marker
                  coordinate={{
                    latitude: runData.route[runData.route.length - 1].latitude,
                    longitude: runData.route[runData.route.length - 1].longitude
                  }}
                  title="Finish"
                >
                  <View style={styles.endMarker}>
                    <Text style={styles.markerText}>F</Text>
                  </View>
                </Marker>
              )}
              
              {/* Reaction markers */}
              {runData.reactions && runData.reactions.map((reaction, index) => (
                <Marker
                  key={index}
                  coordinate={{
                    latitude:
                      reaction.latitude ||
                      runData.route[
                        Math.min(
                          runData.route.length - 1,
                          Math.max(0, Math.floor(runData.route.length * (reaction.distance / runData.distance)))
                        )
                      ].latitude,
                    longitude:
                      reaction.longitude ||
                      runData.route[
                        Math.min(
                          runData.route.length - 1,
                          Math.max(0, Math.floor(runData.route.length * (reaction.distance / runData.distance)))
                        )
                      ].longitude
                  }}
                >
                  <Text style={styles.reactionMarker}>{reaction.type}</Text>
                </Marker>
              ))}
            </MapView>
          </View>
        ) : hasRoute ? (
          <View style={styles.mapUnavailableCard}>
            <Text style={styles.mapUnavailableTitle}>Route map unavailable</Text>
            <Text style={styles.mapUnavailableText}>
              Your run stats are saved. Open this screen in a native dev build to render maps.
            </Text>
          </View>
        ) : null}

        {/* Stats Summary */}
        <View style={styles.statsContainer}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{runData.distance.toFixed(2)}</Text>
            <Text style={styles.statLabel}>Miles</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{formatDuration(runData.duration)}</Text>
            <Text style={styles.statLabel}>Time</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{formatPace(runData.averagePace)}</Text>
            <Text style={styles.statLabel}>Avg Pace (moving)</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{runData.calories}</Text>
            <Text style={styles.statLabel}>Calories</Text>
          </View>
        </View>

        {runData.diagnostics?.samples ? (
          <View style={styles.liveQualityCard}>
            <Text style={styles.liveQualityTitle}>Live signal quality</Text>
            <Text style={styles.liveQualityLine}>
              GPS confidence: high {Math.round((runData.diagnostics.confidence.high / runData.diagnostics.samples) * 100)}% ·
              medium {Math.round((runData.diagnostics.confidence.medium / runData.diagnostics.samples) * 100)}% ·
              low {Math.round((runData.diagnostics.confidence.low / runData.diagnostics.samples) * 100)}%
            </Text>
            <Text style={styles.liveQualityLine}>
              Source mix: GPS {Math.round((runData.diagnostics.sourceTags.gps / runData.diagnostics.samples) * 100)}% ·
              fused {Math.round((runData.diagnostics.sourceTags.fused / runData.diagnostics.samples) * 100)}% ·
              estimated {Math.round((runData.diagnostics.sourceTags.estimated / runData.diagnostics.samples) * 100)}%
            </Text>
            {typeof runData.diagnostics.gpsGapSeconds === 'number' ? (
              <Text style={styles.liveQualityLine}>
                GPS gaps: {runData.diagnostics.gpsGapSeconds.toFixed(0)}s · estimated distance {Number(runData.diagnostics.estimatedGapDistanceMiles || 0).toFixed(2)} mi
              </Text>
            ) : null}
            {runData.diagnostics.gpsStates ? (
              <Text style={styles.liveQualityLine}>
                GPS states: good {runData.diagnostics.gpsStates.good} · degraded {runData.diagnostics.gpsStates.degraded} · lost {runData.diagnostics.gpsStates.lost} · recovered {runData.diagnostics.gpsStates.recovered}
              </Text>
            ) : null}
            {runData.confidenceSummary ? (
              <>
                {runData.hrAvailable !== true || runData.confidenceSummary.hrConfidence == null ? (
                  <Text style={styles.liveQualityLine}>Heart rate: Unavailable</Text>
                ) : null}
                <Text style={styles.liveQualityLine}>
                  {runData.hrAvailable === true && runData.confidenceSummary.hrConfidence != null
                    ? `Confidence: distance ${runData.confidenceSummary.distanceConfidence}/100 · pace ${runData.confidenceSummary.paceConfidence}/100 · HR ${runData.confidenceSummary.hrConfidence}/100`
                    : `Confidence: distance ${runData.confidenceSummary.distanceConfidence}/100 · pace ${runData.confidenceSummary.paceConfidence}/100`}
                </Text>
              </>
            ) : null}
            {runData.metricVersions?.gpsProcessingVersion ? (
              <Text style={styles.liveQualityLine}>
                Accuracy model: {runData.metricVersions.gpsProcessingVersion}
              </Text>
            ) : null}
          </View>
        ) : null}

        {showDebugPanel ? (
          <View style={styles.debugCard}>
            <Text style={styles.debugTitle}>Support debug</Text>
            <Text style={styles.debugLine}>Run ID: {String(runData.runId || 'unknown')}</Text>
            <Text style={styles.debugLine}>Source: {String((runData as any).source || 'unknown')}</Text>
            <Text style={styles.debugLine}>Recorded at: {String(runData.timestamp || 'unknown')}</Text>
            <Text style={styles.debugLine}>
              Integrity: {String(runData.metricsLock?.sessionIntegrityState || 'unknown')} · immutable {runData.metricsLock?.metricsImmutable ? 'yes' : 'no'}
            </Text>
            <Text style={styles.debugLine}>Locked at: {String(runData.metricsLock?.metricsLockedAtUtc || 'n/a')}</Text>
            <Text style={styles.debugLine}>
              Accuracy model: {String(runData.metricVersions?.accuracyModelVersion || runData.metricVersions?.gpsProcessingVersion || 'n/a')}
            </Text>
            <Text style={styles.debugLine}>Gap segments: {Array.isArray(runData.gapSegments) ? runData.gapSegments.length : 0}</Text>
            {(runData.gapSegments || []).slice(0, 5).map((gap) => (
              <Text key={gap.gapId} style={styles.debugLine}>
                - {gap.type} {gap.estimatorUsed} · {gap.estimatedDistanceMiles.toFixed(2)} mi · conf {Math.round(gap.confidenceScore)}
              </Text>
            ))}
          </View>
        ) : null}

        {/* Splits */}
        {runData.splitsSuppressed ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>SPLITS</Text>
            <Text style={styles.splitNote}>
              Splits are unavailable for this run because part of distance was estimated during GPS gaps.
            </Text>
          </View>
        ) : runData.splits && runData.splits.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>SPLITS</Text>
            <Text style={styles.splitNote}>
              Split timing excludes paused segments when present.
              {runData.splits.some((s: any) => s?.timeSource === 'estimated_route_preview') ? ' Estimated from route preview.' : ''}
            </Text>
            <View style={styles.splitsCard}>
              {runData.splits.map((split) => (
                <View key={split.mile} style={styles.splitRow}>
                  <View style={styles.splitMile}>
                    <Text style={styles.splitMileText}>
                      Mile {split.mile}
                      {split.partial && (
                        <Text style={styles.splitPartialText}> ({split.partial.toFixed(2)} mi)</Text>
                      )}
                    </Text>
                  </View>
                  <Text style={styles.splitTime}>
                    {formatDuration(split.time)}
                    {split.timeSource === 'estimated_route_preview' ? ' ~' : ''}
                  </Text>
                  <Text style={styles.splitPace}>{formatPace(split.pace)}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* Reactions Timeline */}
        {runData.reactions && runData.reactions.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>REACTIONS</Text>
            <View style={styles.reactionsCard}>
              {runData.reactions.map((reaction, index) => (
                <View key={index} style={styles.reactionRow}>
                  <Text style={styles.reactionIcon}>{reaction.type}</Text>
                  <Text style={styles.reactionDistance}>{reaction.distance.toFixed(2)} mi</Text>
                  <Text style={styles.reactionText}>
                    {reaction.type === '👍' ? 'Feeling good' :
                     reaction.type === '👎' ? 'Struggling' :
                     reaction.type === '🔥' ? 'On fire!' :
                     'Getting tired'}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {runData.detectedSegments && runData.detectedSegments.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>SEGMENT MATCHES</Text>
            <View style={styles.reactionsCard}>
              {runData.detectedSegments.map((segment) => (
                <View key={`${segment.segmentId}-${segment.direction}`} style={styles.reactionRow}>
                  <Text style={styles.reactionIcon}>{segment.direction === 'forward' ? '↗' : '↘'}</Text>
                  <Text style={styles.reactionDistance}>{segment.distanceMiles.toFixed(2)} mi</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.reactionText}>
                      {segment.name} · {Math.round(segment.score * 100)}% match
                    </Text>
                    <Text style={styles.reactionSubtext}>
                      Quality {String(segment.quality || 'unknown').toUpperCase()}
                      {segment.isPrHit ? ' · PR hit' : ''}
                      {segment.quality === 'low' ? ' · PR protected' : ''}
                    </Text>
                    {segment.quality === 'low' && Array.isArray(segment.qualityReasons) && segment.qualityReasons.length ? (
                      <Text style={styles.reactionSubtext}>
                        {segment.qualityReasons.slice(0, 2).join(' · ')}
                      </Text>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
            <TouchableOpacity style={styles.segmentHistoryButton} onPress={() => router.push('/segments' as any)}>
              <Text style={styles.segmentHistoryButtonText}>View Segment History</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {hasRoute ? (
          <TouchableOpacity
            style={styles.segmentButton}
            onPress={() =>
              router.push(
                {
                  pathname: '/segments/create',
                  params: runData.timestamp ? { runAt: runData.timestamp } : undefined,
                } as any
              )
            }
          >
            <Text style={styles.segmentButtonText}>Create Segment</Text>
          </TouchableOpacity>
        ) : null}

        {/* Done Button */}
        <TouchableOpacity 
          style={styles.doneButton}
          onPress={() => router.replace('/(tabs)')}
        >
          <LinearGradient
            colors={['#00D9FF', '#8A2BE2']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.doneGradient}
          >
            <Text style={styles.doneButtonText}>Done</Text>
          </LinearGradient>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: '#888',
  },
  errorTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'center',
  },
  errorSub: {
    color: '#9AAAB0',
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 24,
    lineHeight: 18,
    fontWeight: '700',
  },
  retryButton: {
    marginTop: 12,
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#00D9FF',
    backgroundColor: 'rgba(0,217,255,0.16)',
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: {
    color: '#BFF3FF',
    fontWeight: '900',
  },
  backText: {
    color: '#9FB5BC',
    fontWeight: '800',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: 60,
  },
  recoveredBanner: {
    marginHorizontal: 20,
    marginTop: -6,
    marginBottom: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.45)',
    backgroundColor: 'rgba(251,191,36,0.12)',
    padding: 12,
  },
  recoveredTitle: { color: '#FDE68A', fontWeight: '900', fontSize: 14 },
  recoveredText: { color: '#F5E9B7', fontWeight: '700', marginTop: 6, lineHeight: 18 },
  closeButton: {
    fontSize: 28,
    color: '#888',
    fontWeight: '300',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  xpBanner: {
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 16,
    overflow: 'hidden',
  },
  xpGradient: {
    padding: 24,
    alignItems: 'center',
  },
  xpIcon: {
    fontSize: 48,
    marginBottom: 8,
  },
  xpText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#000000',
    marginBottom: 4,
  },
  xpSubtext: {
    fontSize: 14,
    color: '#000000',
    opacity: 0.7,
  },
  rewardCard: {
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(0,255,136,0.35)',
    backgroundColor: 'rgba(0,255,136,0.08)',
    padding: 14,
  },
  rewardTitle: {
    color: '#C9FFE8',
    fontWeight: '900',
    fontSize: 15,
    marginBottom: 6,
  },
  rewardLine: {
    color: '#BDEFD8',
    fontWeight: '700',
    marginTop: 2,
    fontSize: 12,
  },
  prCard: {
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(142,223,255,0.35)',
    backgroundColor: 'rgba(142,223,255,0.09)',
    padding: 14,
  },
  prTitle: {
    color: '#E2F8FF',
    fontWeight: '900',
    fontSize: 15,
    marginBottom: 6,
  },
  prLine: {
    color: '#C7E8F5',
    fontWeight: '700',
    marginTop: 2,
    fontSize: 12,
  },
  policyCard: {
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,191,71,0.35)',
    backgroundColor: 'rgba(255,191,71,0.10)',
    padding: 14,
  },
  policyTitle: {
    color: '#FFE1B4',
    fontWeight: '900',
    fontSize: 15,
    marginBottom: 6,
  },
  policyText: {
    color: '#F6E9D3',
    fontWeight: '600',
    fontSize: 12,
    lineHeight: 18,
  },
  insightCard: {
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    padding: 14,
  },
  insightTitle: {
    color: '#EFEFEF',
    fontWeight: '900',
    fontSize: 15,
    marginBottom: 6,
  },
  insightLine: {
    color: '#D8D8D8',
    fontWeight: '700',
    marginTop: 2,
    fontSize: 12,
    lineHeight: 18,
  },
  refinementCard: {
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(0,217,255,0.30)',
    backgroundColor: 'rgba(0,217,255,0.09)',
    padding: 14,
  },
  refinementTitle: {
    color: '#E5F9FF',
    fontWeight: '900',
    fontSize: 15,
    marginBottom: 6,
  },
  refinementText: {
    color: '#C5E8F5',
    fontWeight: '700',
    fontSize: 12,
    lineHeight: 18,
  },
  refinementMeta: {
    color: '#A5D5E7',
    fontWeight: '600',
    marginTop: 6,
    fontSize: 11,
  },
  accuracyFlagButton: {
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,191,71,0.45)',
    backgroundColor: 'rgba(255,191,71,0.10)',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  accuracyFlagButtonDisabled: {
    opacity: 0.65,
  },
  accuracyFlagButtonText: {
    color: '#FFE1B0',
    fontWeight: '800',
    fontSize: 14,
  },
  accuracyFlagSubtext: {
    marginTop: 4,
    color: '#D9B885',
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  accuracyFlagCard: {
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,191,71,0.48)',
    backgroundColor: 'rgba(255,191,71,0.14)',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  accuracyFlagTitle: {
    color: '#FFE6BC',
    fontWeight: '800',
    fontSize: 14,
  },
  accuracyFlagText: {
    marginTop: 4,
    color: '#E5CDA0',
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  aiCard: {
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(0,217,255,0.35)',
    backgroundColor: 'rgba(0,217,255,0.10)',
    padding: 14,
  },
  aiTitle: {
    color: '#DDF5FF',
    fontWeight: '900',
    fontSize: 15,
    marginBottom: 6,
  },
  aiText: {
    color: '#EAF8FF',
    fontWeight: '700',
    fontSize: 13,
    lineHeight: 18,
  },
  aiMeta: {
    color: '#9FBECA',
    fontWeight: '600',
    marginTop: 6,
    fontSize: 11,
  },
  aiInsightRow: {
    marginBottom: 8,
  },
  dismissAiButton: {
    marginTop: 8,
    alignSelf: 'flex-start',
    minHeight: 30,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,217,255,0.35)',
    paddingHorizontal: 10,
    justifyContent: 'center',
    backgroundColor: 'rgba(16,32,38,0.8)',
  },
  dismissAiText: {
    color: '#CFEFF9',
    fontWeight: '700',
    fontSize: 12,
  },
  mapContainer: {
    marginHorizontal: 20,
    height: 250,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 20,
  },
  map: {
    flex: 1,
  },
  startMarker: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#00FF88',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  endMarker: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#FF4466',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  markerText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  reactionMarker: {
    fontSize: 24,
  },
  mapUnavailableCard: {
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: '#111',
    padding: 16,
  },
  mapUnavailableTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  mapUnavailableText: {
    color: '#aaa',
    fontSize: 13,
    lineHeight: 18,
  },
  statsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: 20,
    gap: 12,
    marginBottom: 20,
  },
  liveQualityCard: {
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    padding: 14,
  },
  liveQualityTitle: {
    color: '#F2F2F2',
    fontWeight: '900',
    fontSize: 14,
    marginBottom: 6,
  },
  liveQualityLine: {
    color: '#C8D8E0',
    fontWeight: '600',
    fontSize: 12,
    lineHeight: 18,
  },
  debugCard: {
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    padding: 14,
  },
  debugTitle: {
    color: '#E4F4FA',
    fontWeight: '900',
    fontSize: 13,
    marginBottom: 4,
  },
  debugLine: {
    color: '#A6C0CC',
    fontWeight: '600',
    fontSize: 11,
    lineHeight: 17,
    marginTop: 2,
  },
  statCard: {
    width: '48%',
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  statValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#00D9FF',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#888',
  },
  section: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#888',
    letterSpacing: 1,
    marginBottom: 12,
  },
  splitsCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  splitRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A',
  },
  splitNote: {
    color: '#8AA8B3',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 6,
    marginLeft: 2,
  },
  splitMile: {
    flex: 1,
  },
  splitMileText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  splitPartialText: {
    fontSize: 12,
    color: '#666',
  },
  splitTime: {
    fontSize: 14,
    color: '#00D9FF',
    marginRight: 16,
    minWidth: 60,
  },
  splitPace: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    minWidth: 60,
    textAlign: 'right',
  },
  reactionsCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  reactionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A',
  },
  reactionIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  reactionDistance: {
    fontSize: 14,
    fontWeight: '600',
    color: '#00D9FF',
    marginRight: 12,
    minWidth: 50,
  },
  reactionText: {
    fontSize: 14,
    color: '#888',
    flex: 1,
  },
  reactionSubtext: {
    fontSize: 12,
    color: '#6FB9CF',
    marginTop: 2,
  },
  doneButton: {
    marginTop: 8,
    marginHorizontal: 20,
    borderRadius: 16,
    overflow: 'hidden',
  },
  doneGradient: {
    padding: 20,
    alignItems: 'center',
  },
  doneButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  segmentButton: {
    marginHorizontal: 20,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(0,217,255,0.5)',
    backgroundColor: 'rgba(0,217,255,0.12)',
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentButtonText: {
    color: '#BDEFF8',
    fontWeight: '800',
    fontSize: 15,
  },
  segmentHistoryButton: {
    marginTop: 10,
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#151515',
  },
  segmentHistoryButtonText: {
    color: '#D3D3D3',
    fontWeight: '700',
  },
});
