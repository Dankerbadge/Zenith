import { useFocusEffect } from '@react-navigation/native'; import { router } from 'expo-router'; import React, { useCallback, useRef, useState } from 'react'; import { ActionSheetIOS, Alert, Keyboard, NativeModules, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { calculateCurrentRank } from '../constants/ranks';
import { type LocationPoint, formatDuration, formatPace, generateSplits } from '../utils/gpsService';
import { assignSessionDayKey } from '../utils/dayAssignment';
import { patchCanonicalRun } from '../utils/canonicalRunService';
import { findRouteMatches, registerRouteProfile } from '../utils/routeMatchingService';
import { getRouteStats, recordRouteAttempt } from '../utils/routeStatsService';
import { detectAndStoreSegmentAttempts } from '../utils/segmentService';
import { refreshChallengeProgressForUser } from '../utils/challengeService';
import { listAutoShareClubIdsForUser } from '../utils/clubsService';
import { APP_CONFIG } from '../utils/appConfig';
import {
  emitRankUpEvent,
  emitRoutePrEvent,
  emitRunCompletedEvent,
  emitSegmentPrEvent,
  emitStreakMilestoneEvent,
  emitWinningDayMilestoneEvent,
} from '../utils/activityEventService';
import { clearPendingRun, commitPendingRun, getPendingRun, updatePendingRun, updateRunHistoryEntry } from '../utils/runReviewService';
import { getWinningSnapshot } from '../utils/winningSystem';
import { calculateRunningXPAward } from '../utils/xpSystem';
import { getDailyLog, getUserProfile, todayKey } from '../utils/storageUtils';
import { clearActiveRunSnapshot, clearOrphanRunResolutionIntent } from '../utils/runControlSync';
import { captureException } from '../utils/crashReporter';
import { clearRunBackgroundLocationQueue, stopRunBackgroundLocationTracking } from '../utils/runBackgroundLocation';
import { syncLiveActivityWithSnapshot } from '../utils/runNativeBridge';
import { useAuth } from './context/authcontext';
import { upsertWorkoutForChallengeEngine } from '../utils/workoutChallengesApi';

type ReviewRun = {
  kind: 'gps_outdoor' | 'manual_treadmill' | 'manual_distance';
  distance: number;
  duration: number;
  pausedTimeSec: number;
  averagePace: number;
  calories: number;
  xpEarned: number;
  timestamp: string;
  routePoints: number;
  title?: string;
  notes?: string;
  intensityLabel?: 'easy' | 'moderate' | 'hard';
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
    gpsStates?: { good: number; degraded: number; lost: number; recovered: number };
    gpsGapSeconds?: number;
    estimatedGapDistanceMiles?: number;
    paceStates: {
      live_confident: number;
      live_estimated: number;
      acquiring: number;
      unavailable: number;
      paused: number;
    };
    sourceTags: { gps: number; fused: number; estimated: number };
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
};

function safeParseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export default function RunReviewScreen() {
  const { supabaseUserId } = useAuth();
  const [run, setRun] = useState<ReviewRun | null>(null);
  const [saving, setSaving] = useState(false);
  const saveLockRef = useRef(false);
  const routeRef = useRef<LocationPoint[]>([]);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftNotes, setDraftNotes] = useState('');
  const [xpPreview, setXpPreview] = useState<number | null>(null);
  const [xpPolicyHint, setXpPolicyHint] = useState<string | null>(null);
  const [winningHint, setWinningHint] = useState('Evaluating winning-day eligibility...');
  const [splitPreview, setSplitPreview] = useState<string | null>(null);
  const [splitsSuppressionNote, setSplitsSuppressionNote] = useState<string | null>(null);
  const [elevationGainFt, setElevationGainFt] = useState<number | null>(null);
  const [loadError, setLoadError] = useState(false);

  const loadPending = useCallback(async () => {
    try {
      const pending = await getPendingRun();
      if (!pending) {
        router.replace('/(tabs)' as any);
        return;
      }
      const profile = await getUserProfile();
      const today = await getDailyLog(todayKey());
      const dailyXp = Number((today as any)?.dailyXP) || 0;
      const runningXp = (Array.isArray((today as any)?.workouts) ? (today as any).workouts : []).reduce((sum: number, workout: any) => {
        const type = String(workout?.type || '').toLowerCase();
        if (type !== 'running') return sum;
        return sum + (Number(workout?.xp) || 0);
      }, 0);
      const xpForecast = calculateRunningXPAward({
        distanceMiles: Number(pending.distance) || 0,
        currentDailyXP: dailyXp,
        currentRunningXP: runningXp,
      });
      const normalizedDistance = Number(pending.distance) || 0;
      const normalizedDuration = Math.max(0, Number(pending.duration) || 0);
      const derivedPace = normalizedDistance > 0 && normalizedDuration > 0 ? normalizedDuration / 60 / normalizedDistance : 0;

      const runEndTime = new Date(String((pending as any).timestamp || new Date().toISOString()));
      const runStartTime = new Date(runEndTime.getTime() - normalizedDuration * 1000);
      const assignedDayKey = assignSessionDayKey(runStartTime.toISOString(), runEndTime.toISOString());
      const [y, m, d] = String(assignedDayKey).split('-').map(Number);
      const dayEndMs =
        Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d) ? new Date(y, m - 1, d, 23, 59, 59, 999).getTime() : NaN;
      const dayEndPlus24h = dayEndMs + 24 * 60 * 60 * 1000;
      const xpEligibleByTime = Number.isFinite(dayEndPlus24h) ? Date.now() <= dayEndPlus24h : false;
      const minMiles = Number((profile as any)?.goals?.runWinningMinDistanceMiles) || 0.75;
      const minDurationMin = Number((profile as any)?.goals?.runWinningMinDurationMin) || 10;
      const meetsDistance = normalizedDistance >= minMiles;
      const meetsDuration = normalizedDuration / 60 >= minDurationMin;
      setWinningHint(
        xpEligibleByTime
          ? meetsDistance || meetsDuration
            ? `Winning Day eligible (${meetsDistance ? `distance >= ${minMiles} mi` : `duration >= ${minDurationMin} min`}).`
            : `Not yet eligible. Need ${minMiles.toFixed(2)} mi or ${minDurationMin} min.`
          : 'Outside the 24-hour settlement window. Winning Day and streak outcomes remain locked.'
      );
      setXpPreview(xpEligibleByTime ? xpForecast.awardedXP : 0);
      setXpPolicyHint(
        xpEligibleByTime
          ? null
          : 'This run is outside the 24-hour XP window. It will still save to history and update stats, but XP and streak outcomes remain locked.'
      );

    const shouldSuppressSplits = (() => {
      const estimatedFromDiagnostics = Number((pending as any)?.diagnostics?.estimatedGapDistanceMiles) || 0;
      if (estimatedFromDiagnostics > 0) return true;
      const gaps = Array.isArray((pending as any)?.gapSegments) ? ((pending as any).gapSegments as any[]) : [];
      const sumEstimated = gaps.reduce((sum, gap) => sum + (Number(gap?.estimatedDistanceMiles) || 0), 0);
      if (sumEstimated > 0) return true;
      const hasLowConfidenceEstimator = gaps.some((gap) => {
        const conf = Number(gap?.confidenceScore);
        const estimator = String(gap?.estimatorUsed || '');
        return Number.isFinite(conf) && conf < 1 && estimator && estimator !== 'none';
      });
      return hasLowConfidenceEstimator;
    })();

    const route = Array.isArray((pending as any).route) ? (pending as any).route : [];
    routeRef.current = route;
    if (shouldSuppressSplits) {
      setSplitPreview(null);
      setSplitsSuppressionNote('Splits are unavailable because part of distance was estimated during GPS gaps.');
    } else {
      setSplitsSuppressionNote(null);
      if (route.length >= 2) {
        const splits = generateSplits(route, normalizedDistance, normalizedDuration, {
          pauseEvents: Array.isArray((pending as any).pauseEvents) ? (pending as any).pauseEvents : [],
        });
        setSplitPreview(
          splits.length ? `${splits.length} split${splits.length === 1 ? '' : 's'} available (moving-time based)` : null
        );
      } else {
        setSplitPreview(null);
      }
    }
    if (route.length >= 2) {
      let gainMeters = 0;
      for (let i = 1; i < route.length; i++) {
        const prevAlt = Number(route[i - 1]?.altitude);
        const nextAlt = Number(route[i]?.altitude);
        if (!Number.isFinite(prevAlt) || !Number.isFinite(nextAlt)) continue;
        const delta = nextAlt - prevAlt;
        if (delta > 0) gainMeters += delta;
      }
      setElevationGainFt(gainMeters > 0 ? Math.round(gainMeters * 3.28084) : null);
    } else {
      setElevationGainFt(null);
    }
      setDraftTitle(String((pending as any).title || '').trim());
      setDraftNotes(String((pending as any).notes || '').trim());
      setRun({
        kind: (pending.kind || (pending.route?.length ? 'gps_outdoor' : 'manual_treadmill')) as ReviewRun['kind'],
        distance: normalizedDistance,
        duration: normalizedDuration,
        pausedTimeSec: Math.max(0, Number((pending as any).pausedTimeSec) || 0),
        averagePace: derivedPace || Number(pending.averagePace) || 0,
        calories: pending.calories,
        xpEarned: pending.xpEarned,
        timestamp: pending.timestamp,
        routePoints: Array.isArray(pending.route) ? pending.route.length : 0,
        title: (pending as any).title,
        notes: (pending as any).notes,
        intensityLabel: (pending as any).intensityLabel || 'moderate',
        refinement: (pending as any).refinement || undefined,
        diagnostics: (pending as any).diagnostics || undefined,
        gapSegments: (pending as any).gapSegments || undefined,
        confidenceSummary: (pending as any).confidenceSummary || undefined,
        metricVersions: (pending as any).metricVersions || undefined,
      });
      setLoadError(false);
    } catch (err) {
      setLoadError(true);
      void captureException(err, { feature: 'run_review', op: 'load_pending' });
    }
  }, []);

  const shareRunSummary = useCallback(() => {
    if (Platform.OS !== 'ios') {
      Alert.alert('Share', 'Share cards are currently available on iOS only.');
      return;
    }
    if (!run) return;

    const route = routeRef.current || [];
    const routeCoordinates = route.map((p) => ({ latitude: p.latitude, longitude: p.longitude }));

    // Canonical numbers for rendering + preformatted strings for exact in-app parity.
    const distanceMeters = run.distance * 1609.344;
    const paceSecondsPerKm = run.averagePace / 1.609344;
    const elevationGainMeters = elevationGainFt != null ? elevationGainFt / 3.28084 : undefined;

    const payload = {
      workoutId: run.timestamp, // stable enough for cache key; we don't have a UUID here yet.
      activityType: run.kind === 'gps_outdoor' ? 'Run' : 'Run',
      startDate: new Date(run.timestamp).toISOString(),
      durationSeconds: run.duration,
      distanceMeters,
      paceSecondsPerKm,
      elevationGainMeters,
      caloriesKcal: run.calories,
      avgHeartRate: undefined,
      routeCoordinates,
      template: 'story1080x1920',
      hideMap: run.kind !== 'gps_outdoor' || routeCoordinates.length < 2,
      display: {
        distance: `${run.distance.toFixed(2)} mi`,
        time: formatDuration(run.duration),
        pace: `${formatPace(run.averagePace)}/mi`,
        elevation: elevationGainFt != null ? `${elevationGainFt} ft` : undefined,
        calories: String(run.calories),
        heartRate: undefined,
      },
    };

    const mod = (NativeModules as any)?.WorkoutShareNativeBridge;
    if (!mod) {
      Alert.alert('Share', 'Native share module unavailable in this build.');
      return;
    }

    const options = [
      'Share Image (Story)',
      'Share Image (Feed)',
      'Share Image (Square)',
      'Share to Instagram Stories (Sticker)',
      'Share to Instagram Stories (Full Background)',
      'Cancel',
    ];

    ActionSheetIOS.showActionSheetWithOptions(
      {
        options,
        cancelButtonIndex: options.length - 1,
        title: 'Share',
      },
      (idx) => {
        if (idx === 0) {
          void mod.shareImage({ ...payload, template: 'story1080x1920' });
        } else if (idx === 1) {
          void mod.shareImage({ ...payload, template: 'feed1080x1350' });
        } else if (idx === 2) {
          void mod.shareImage({ ...payload, template: 'square1080x1080' });
        } else if (idx === 3) {
          void mod.shareInstagramStoriesSticker({ ...payload, template: 'story1080x1920' });
        } else if (idx === 4) {
          void mod.shareInstagramStoriesBackground({ ...payload, template: 'story1080x1920' });
        }
      }
    );
  }, [run, elevationGainFt]);

  useFocusEffect(
    useCallback(() => {
      void loadPending();
    }, [loadPending])
  );

  const saveRun = async () => {
    if (saving || saveLockRef.current) return;
    saveLockRef.current = true;
    setSaving(true);
    try {
      await updatePendingRun({
        title: draftTitle.trim() || undefined,
        notes: draftNotes.trim() || undefined,
      });
      const pending = await getPendingRun();
      const beforeProgressRaw = await AsyncStorage.getItem('userProgress');
      const beforeProgress = safeParseJson<any>(beforeProgressRaw, { totalXP: 0, totalWinningDays: 0 });
      const beforeSnapshot = await getWinningSnapshot();
      const beforeRank = calculateCurrentRank(Number(beforeProgress.totalXP) || 0, beforeSnapshot.totalWinningDays || 0);
      const committed = await commitPendingRun();
      if (!committed) {
        Alert.alert('No run found', 'Could not find a pending run to save.');
        router.replace('/(tabs)' as any);
        return;
      }
      const committedDerivedPace =
        Number(committed.distance) > 0 && Number(committed.duration) > 0
          ? Number(committed.duration) / 60 / Number(committed.distance)
          : Number(committed.averagePace) || 0;
      const runDistanceConfidence = Number(
        (committed as any)?.confidenceSummary?.distanceConfidence ??
          (pending as any)?.confidenceSummary?.distanceConfidence ??
          100
      );
      const prEligibleByConfidence = runDistanceConfidence >= APP_CONFIG.LIVE_TRACKING.RUN.PR_MIN_DISTANCE_CONFIDENCE;

      let routeProfileId = '';
      let routePrHit = false;
      let routePrBlockedByConfidence = false;
      let routeInsightLines: string[] = [];
      if (pending?.route?.length) {
        const matches = await findRouteMatches(pending.route);
        if (matches.length > 0) {
          const best = matches[0];
          await new Promise<void>((resolve) => {
            Alert.alert(
              'Similar route detected',
              `This run looks like a previous route (${Math.round(best.score * 100)}% match · ${best.overlapPercent}% overlap · ${best.direction}).`,
              [
                {
                  text: 'Keep Separate',
                  style: 'cancel',
                  onPress: async () => {
                    const result = await registerRouteProfile({
                      route: pending.route,
                      runAt: committed.timestamp,
                      mode: 'separate',
                    });
                    routeProfileId = result.profileId;
                    resolve();
                  },
                },
                {
                  text: 'Merge',
                  onPress: async () => {
                    const result = await registerRouteProfile({
                      route: pending.route,
                      runAt: committed.timestamp,
                      mode: 'merge',
                      mergeTargetId: best.profile.id,
                    });
                    routeProfileId = result.profileId;
                    resolve();
                  },
                },
              ]
            );
          });
        } else {
          const result = await registerRouteProfile({
            route: pending.route,
            runAt: committed.timestamp,
            mode: 'separate',
          });
          routeProfileId = result.profileId;
        }
      }

      if (routeProfileId) {
        const priorRouteStats = await getRouteStats(routeProfileId);
        await recordRouteAttempt({
          routeId: routeProfileId,
          timestamp: committed.timestamp,
          distance: committed.distance,
          pace: committedDerivedPace,
          duration: committed.duration,
          distanceConfidence: runDistanceConfidence,
          prEligible: prEligibleByConfidence,
        });
        const latestRouteStats = await getRouteStats(routeProfileId);
        const routeWouldBePr = Boolean(
          priorRouteStats &&
            committedDerivedPace > 0 &&
            committedDerivedPace < priorRouteStats.bestPace - 0.01
        );
        routePrHit = prEligibleByConfidence && routeWouldBePr;
        routePrBlockedByConfidence = !prEligibleByConfidence && routeWouldBePr;
        if (routeWouldBePr && !prEligibleByConfidence) {
          routeInsightLines.push(
            `Fastest pace observed, but PR was protected because distance confidence was ${runDistanceConfidence}/100.`
          );
        }
        if (latestRouteStats) {
          if (priorRouteStats?.lastPace && committedDerivedPace > 0) {
            const delta = committedDerivedPace - priorRouteStats.lastPace;
            if (Math.abs(delta) >= 0.05) {
              routeInsightLines.push(
                delta < 0
                  ? `You improved by ${Math.abs(delta).toFixed(2)} min/mi vs your last attempt on this route.`
                  : `You were ${Math.abs(delta).toFixed(2)} min/mi slower vs your last attempt on this route.`
              );
            } else {
              routeInsightLines.push('Pace held steady versus your last attempt on this route.');
            }
          }
          if (latestRouteStats.bestPace > 0 && committedDerivedPace > 0) {
            const bestDelta = committedDerivedPace - latestRouteStats.bestPace;
            if (Math.abs(bestDelta) < 0.01) {
              routeInsightLines.push('This is your best recorded pace on this route.');
            } else {
              routeInsightLines.push(`Best pace remains ${latestRouteStats.bestPace.toFixed(2)} min/mi on this route.`);
            }
          }
          if (latestRouteStats.attempts >= 3) {
            routeInsightLines.push(
              latestRouteStats.trendLabel === 'improving'
                ? 'Recent route trend is improving.'
                : latestRouteStats.trendLabel === 'slower'
                ? 'Recent route trend has dipped; an easier repeat can stabilize momentum.'
                : 'Recent route trend is stable.'
            );
          }
        }
        if ((committed as any).runId) {
          await patchCanonicalRun((committed as any).runId, { routeId: routeProfileId });
        }
      }

      const segmentAttempts = committed.route?.length
        ? await detectAndStoreSegmentAttempts({
            runTimestamp: committed.timestamp,
            route: committed.route,
            maxMatches: 3,
            runDistanceMiles: committed.distance,
            runDurationSec: committed.duration,
            pauseEvents: (pending as any)?.pauseEvents,
            runDistanceConfidence,
            prDistanceConfidenceMin: APP_CONFIG.LIVE_TRACKING.RUN.PR_MIN_DISTANCE_CONFIDENCE,
          })
        : [];
      const segmentPrHits = segmentAttempts.filter((attempt) => attempt.isPrHit).length;
      const confidenceBlockedSegments = segmentAttempts.filter((attempt) =>
        (attempt.qualityReasons || []).includes('run_distance_confidence_low')
      ).length;
      if (confidenceBlockedSegments > 0) {
        routeInsightLines.push(
          `Segment PR updates were held for ${confidenceBlockedSegments} segment${confidenceBlockedSegments === 1 ? '' : 's'} due to low confidence.`
        );
      }
      const afterSnapshot = await getWinningSnapshot();
      const totalPrHits = (routePrHit ? 1 : 0) + segmentPrHits;
      const historyRaw = await AsyncStorage.getItem('runsHistory');
      const history = safeParseJson<any[]>(historyRaw, []);
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const recentRuns = Array.isArray(history)
        ? history.filter((row: any) => new Date(String(row?.timestamp || '')).getTime() >= sevenDaysAgo).length
        : 0;
      if (recentRuns >= 4) {
        routeInsightLines.push(`Consistency marker: ${recentRuns} runs logged in the last 7 days.`);
      }
      if (!routeInsightLines.length) {
        routeInsightLines = ['Run saved with clean data. Repeatable sessions build stronger trend confidence.'];
      }

      const afterProgressRaw = await AsyncStorage.getItem('userProgress');
      const afterProgress = safeParseJson<any>(afterProgressRaw, { totalXP: 0, totalWinningDays: 0 });
      const afterRank = calculateCurrentRank(Number(afterProgress.totalXP) || 0, afterSnapshot.totalWinningDays || 0);
      const committedRunId = String((committed as any)?.runId || '');

      await updateRunHistoryEntry({ timestamp: committed.timestamp, runId: committedRunId }, {
        rewardMeta: {
          xpAwarded: committed.xpEarned,
          routePrHit,
          segmentPrHits,
          totalPrHits,
          distanceConfidence: runDistanceConfidence,
          prEligibleByConfidence: prEligibleByConfidence,
          routePrBlockedByConfidence,
          segmentPrBlockedByConfidence: confidenceBlockedSegments,
          winningBefore: beforeSnapshot.today.winningDay,
          winningAfter: afterSnapshot.today.winningDay,
          streakBefore: beforeSnapshot.currentStreak,
          streakAfter: afterSnapshot.currentStreak,
        },
        insightPacket: {
          lines: routeInsightLines.slice(0, 3),
          evidence: {
            runId: String((committed as any)?.runId || committed.timestamp),
            routeId: routeProfileId || null,
            routePrHit,
            segmentPrHits,
            recentRunCount7d: recentRuns,
          },
        },
      });
      if (segmentAttempts.length) {
        await updateRunHistoryEntry({ timestamp: committed.timestamp, runId: committedRunId }, {
          detectedSegments: segmentAttempts.map((attempt) => ({
            segmentId: attempt.segmentId,
            name: attempt.name,
            direction: attempt.direction,
            score: attempt.score,
            distanceMiles: attempt.distanceMiles,
            isPrHit: attempt.isPrHit,
            quality: attempt.quality || 'unknown',
            qualityReasons: Array.isArray(attempt.qualityReasons) ? attempt.qualityReasons : [],
          })),
        });
      }

      const runId = committedRunId || String(committed.timestamp);
      if (supabaseUserId) {
        await emitRunCompletedEvent({
          actorUserId: supabaseUserId,
          runId,
          distanceMeters: (Number(committed.distance) || 0) * 1609.344,
          elapsedTimeSec: Number(committed.duration) || 0,
          paceSecPerMile: (Number(committedDerivedPace) || 0) * 60,
          xpDelta: Number(committed.xpEarned) || 0,
        });
        const clubIds = await listAutoShareClubIdsForUser(supabaseUserId);
        for (const clubId of clubIds) {
          await emitRunCompletedEvent({
            actorUserId: supabaseUserId,
            runId,
            distanceMeters: (Number(committed.distance) || 0) * 1609.344,
            elapsedTimeSec: Number(committed.duration) || 0,
            paceSecPerMile: (Number(committedDerivedPace) || 0) * 60,
            xpDelta: Number(committed.xpEarned) || 0,
            visibility: 'club',
            clubId,
          });
        }

        if (routePrHit && routeProfileId) {
          await emitRoutePrEvent({
            actorUserId: supabaseUserId,
            routeId: routeProfileId,
            runId,
          });
        }

        if (segmentPrHits > 0) {
          await emitSegmentPrEvent({
            actorUserId: supabaseUserId,
            runId,
            segmentCount: segmentPrHits,
          });
        }

        const streakMilestones = new Set([3, 7, 14, 21, 30, 50, 75, 100, 150, 200, 365]);
        if (afterSnapshot.currentStreak > beforeSnapshot.currentStreak && streakMilestones.has(afterSnapshot.currentStreak)) {
          await emitStreakMilestoneEvent({
            actorUserId: supabaseUserId,
            streakCount: afterSnapshot.currentStreak,
          });
        }

        const winningMilestones = new Set([7, 14, 30, 50, 75, 100, 150, 200, 300, 365]);
        if (afterSnapshot.totalWinningDays > beforeSnapshot.totalWinningDays && winningMilestones.has(afterSnapshot.totalWinningDays)) {
          await emitWinningDayMilestoneEvent({
            actorUserId: supabaseUserId,
            winningDayCount: afterSnapshot.totalWinningDays,
          });
        }

        if (afterRank.id !== beforeRank.id) {
          await emitRankUpEvent({
            actorUserId: supabaseUserId,
            rankName: afterRank.name,
          });
        }

        await refreshChallengeProgressForUser(supabaseUserId);
        try {
          const mappedActivity =
            committed.kind === 'manual_treadmill'
              ? 'RUN_TREADMILL'
              : committed.kind === 'gps_outdoor'
              ? 'RUN_OUTDOOR'
              : 'RUN_OUTDOOR';
          await upsertWorkoutForChallengeEngine({
            userId: supabaseUserId,
            runId,
            startedAtIso: committed.timestamp,
            durationSec: Number(committed.duration) || 0,
            distanceMeters: (Number(committed.distance) || 0) * 1609.344,
            caloriesKcal: Number(committed.calories) || 0,
            activityType: mappedActivity as any,
            locationType: mappedActivity === 'RUN_TREADMILL' ? 'indoor' : 'outdoor',
            source: 'WATCH',
            raw: { runId, localKind: committed.kind },
          });
        } catch (err) {
          void captureException(err, { feature: 'run_review', op: 'sync_challenge_workout' });
        }
      }
      await clearActiveRunSnapshot();
      await syncLiveActivityWithSnapshot(null);
      await stopRunBackgroundLocationTracking();
      await clearRunBackgroundLocationQueue();

      router.replace({
        pathname: '/run-summary',
        params: {
          runId,
          timestamp: committed.timestamp,
          distance: committed.distance.toFixed(2),
          duration: committed.duration.toString(),
          pace: committedDerivedPace.toFixed(2),
          calories: committed.calories.toString(),
          xp: committed.xpEarned.toString(),
        },
      });
    } catch {
      Alert.alert('Save failed', 'Could not save this run right now. Please try again.');
    } finally {
      saveLockRef.current = false;
      setSaving(false);
    }
  };

  const discardPendingAndExit = useCallback(async () => {
    try {
      await clearPendingRun();
      await clearActiveRunSnapshot();
      await syncLiveActivityWithSnapshot(null);
      await clearOrphanRunResolutionIntent();
      await stopRunBackgroundLocationTracking();
      await clearRunBackgroundLocationQueue();
      router.replace('/(tabs)' as any);
    } catch (err) {
      void captureException(err, { feature: 'run_review', op: 'discard' });
      Alert.alert('Discard failed', 'Couldn’t clear run data.', [
        { text: 'Try again', onPress: () => void discardPendingAndExit() },
        { text: 'Go home', onPress: () => router.replace('/(tabs)' as any) },
      ]);
    }
  }, []);

  const discardRun = () => {
    if (saving || saveLockRef.current) return;
    Alert.alert('Discard run?', 'This run review will be removed and not saved.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => void discardPendingAndExit(),
      },
    ]);
  };

  if (!run) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          {loadError ? (
            <>
              <Text style={styles.loading}>Couldn’t load review.</Text>
              <Pressable style={styles.retryBtn} onPress={() => { setLoadError(false); void loadPending(); }}>
                <Text style={styles.retryBtnText}>Retry</Text>
              </Pressable>
              <Pressable style={styles.retryBtn} onPress={() => router.replace('/(tabs)' as any)}>
                <Text style={styles.retryBtnText}>Back to home</Text>
              </Pressable>
            </>
          ) : (
            <Text style={styles.loading}>Loading review...</Text>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScrollBeginDrag={Keyboard.dismiss}
      >
        <View style={styles.titleRow}>
          <Text style={styles.title}>Post-Run Review</Text>
          <Pressable onPress={shareRunSummary} style={({ pressed }) => [styles.shareBtn, pressed && styles.shareBtnPressed]}>
            <Text style={styles.shareBtnText}>Share</Text>
          </Pressable>
        </View>
        <Text style={styles.subtitle}>Preview your metrics, then save or discard.</Text>

        <LinearGradient colors={['#00D9FF22', '#00FF8822']} style={styles.hero}>
          <Text style={styles.heroDistance}>{run.distance.toFixed(2)} mi</Text>
          <Text style={styles.heroMeta}>{formatDuration(run.duration)} · {formatPace(run.averagePace)}/mi</Text>
        </LinearGradient>

        <View style={styles.contextCard}>
          <Text style={styles.contextTitle}>{run.kind === 'gps_outdoor' ? 'GPS run' : run.kind === 'manual_treadmill' ? 'Manual treadmill run' : 'Manual distance run'}</Text>
          <Text style={styles.contextText}>
            {run.kind === 'gps_outdoor'
              ? `Route preview ready (${run.routePoints} points simplified on save).`
              : 'No route object will be created. Run still contributes to stats, XP, and winning-day checks.'}
          </Text>
        </View>

        <View style={styles.metricsRow}>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Calories</Text>
            <Text style={styles.metricValue}>{run.calories}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>XP Preview</Text>
            <Text style={styles.metricValue}>+{xpPreview ?? run.xpEarned}</Text>
          </View>
        </View>

        <View style={styles.metricsRow}>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Moving Time</Text>
            <Text style={styles.metricValue}>{formatDuration(run.duration)}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Paused Time</Text>
            <Text style={styles.metricValue}>{run.pausedTimeSec > 0 ? formatDuration(run.pausedTimeSec) : '--'}</Text>
          </View>
        </View>

        <View style={styles.contextCard}>
          <Text style={styles.contextTitle}>Training load (estimated)</Text>
          <Text style={styles.contextText}>
            {Math.round((run.duration / 60) * (run.intensityLabel === 'hard' ? 1.3 : run.intensityLabel === 'easy' ? 0.8 : 1.0))} load points · {winningHint}
          </Text>
        </View>

        {xpPolicyHint ? (
          <View style={styles.policyCard}>
            <Text style={styles.policyTitle}>Timing policy</Text>
            <Text style={styles.policyText}>{xpPolicyHint}</Text>
          </View>
        ) : null}

        {run.kind === 'gps_outdoor' && (
            <View style={styles.contextCard}>
              <Text style={styles.contextTitle}>GPS details</Text>
              <Text style={styles.contextText}>
              {splitsSuppressionNote || splitPreview || 'Splits unavailable for this run.'}
              {elevationGainFt ? ` · Elevation gain ~${elevationGainFt} ft` : ' · Elevation unavailable'}
              </Text>
            </View>
          )}

        {run.metricVersions?.accuracyModelVersion ? (
          <View style={styles.contextCard}>
            <Text style={styles.contextTitle}>Run integrity</Text>
            <Text style={styles.contextText}>
              {`Accuracy model ${run.metricVersions.accuracyModelVersion}. Metrics lock after save to protect streak, XP, and PR consistency.`}
            </Text>
          </View>
        ) : null}

        {run.diagnostics?.samples ? (
          <View style={styles.contextCard}>
            <Text style={styles.contextTitle}>Live signal quality</Text>
            <Text style={styles.contextText}>
              {`GPS confidence — high ${Math.round((run.diagnostics.confidence.high / run.diagnostics.samples) * 100)}% · medium ${Math.round((run.diagnostics.confidence.medium / run.diagnostics.samples) * 100)}% · low ${Math.round((run.diagnostics.confidence.low / run.diagnostics.samples) * 100)}%`}
            </Text>
            <Text style={styles.contextText}>
              {`Source blend — GPS ${Math.round((run.diagnostics.sourceTags.gps / run.diagnostics.samples) * 100)}% · fused ${Math.round((run.diagnostics.sourceTags.fused / run.diagnostics.samples) * 100)}% · estimated ${Math.round((run.diagnostics.sourceTags.estimated / run.diagnostics.samples) * 100)}%`}
            </Text>
            {typeof run.diagnostics.gpsGapSeconds === 'number' && run.diagnostics.gpsGapSeconds > 0 ? (
              <Text style={styles.contextText}>
                {`GPS gaps ${run.diagnostics.gpsGapSeconds.toFixed(0)}s · estimated distance ${Number(run.diagnostics.estimatedGapDistanceMiles || 0).toFixed(2)} mi`}
              </Text>
            ) : (
              <Text style={styles.contextText}>No GPS gaps detected.</Text>
            )}
            {run.diagnostics.gpsStates ? (
              <Text style={styles.contextText}>
                {`GPS states — good ${run.diagnostics.gpsStates.good} · degraded ${run.diagnostics.gpsStates.degraded} · lost ${run.diagnostics.gpsStates.lost} · recovered ${run.diagnostics.gpsStates.recovered}`}
              </Text>
            ) : null}
            {run.confidenceSummary ? (
              <>
                {run.hrAvailable !== true || run.confidenceSummary.hrConfidence == null ? (
                  <Text style={styles.contextText}>Heart rate: Unavailable</Text>
                ) : null}
                <Text style={styles.contextText}>
                  {run.hrAvailable === true && run.confidenceSummary.hrConfidence != null
                    ? `Confidence — distance ${run.confidenceSummary.distanceConfidence}/100 · pace ${run.confidenceSummary.paceConfidence}/100 · HR ${run.confidenceSummary.hrConfidence}/100`
                    : `Confidence — distance ${run.confidenceSummary.distanceConfidence}/100 · pace ${run.confidenceSummary.paceConfidence}/100`}
                </Text>
              </>
            ) : null}
          </View>
        ) : null}

        {run.refinement?.applied && run.refinement.note ? (
          <View style={styles.refinementCard}>
            <Text style={styles.refinementTitle}>Post-session refinement</Text>
            <Text style={styles.refinementText}>{run.refinement.note}</Text>
            <Text style={styles.refinementMeta}>
              Distance {Number(run.refinement.distanceBefore || 0).toFixed(2)} → {Number(run.refinement.distanceAfter || run.distance).toFixed(2)} mi ·
              Calories {Math.round(Number(run.refinement.caloriesBefore || 0))} → {Math.round(Number(run.refinement.caloriesAfter || run.calories))}
            </Text>
          </View>
        ) : null}

        <Text style={styles.inputLabel}>Run title (optional)</Text>
        <TextInput value={draftTitle} onChangeText={setDraftTitle} style={styles.input} placeholder='Morning tempo' placeholderTextColor='#6B6B6B' />

        <Text style={styles.inputLabel}>Notes (optional)</Text>
        <TextInput
          value={draftNotes}
          onChangeText={setDraftNotes}
          style={[styles.input, styles.notes]}
          placeholder='How did this run feel?'
          placeholderTextColor='#6B6B6B'
          multiline
        />

        <Text style={styles.lockNote}>
          Core run metrics lock after save. You can still edit title and notes later.
        </Text>

        <View style={styles.actions}>
          <Pressable style={[styles.primaryBtn, saving && styles.disabled]} onPress={saveRun} disabled={saving}>
            <Text style={styles.primaryBtnText}>{saving ? 'Saving...' : 'Save Run'}</Text>
          </Pressable>
          <Pressable style={[styles.secondaryBtn, saving && styles.disabled]} onPress={discardRun} disabled={saving}>
            <Text style={styles.secondaryBtnText}>Discard</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loading: { color: '#D0D0D0' },
  retryBtn: {
    marginTop: 10,
    minHeight: 40,
    minWidth: 120,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0,217,255,0.30)',
    backgroundColor: 'rgba(0,217,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  retryBtnText: { color: '#BFF3FF', fontWeight: '900' },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: { color: '#FFF', fontSize: 30, fontWeight: '900' },
  shareBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  shareBtnPressed: {
    transform: [{ scale: 0.98 }],
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  shareBtnText: {
    color: '#EAF2FF',
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  subtitle: { color: '#9AB4C0', marginTop: 6, marginBottom: 14 },
  hero: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,217,255,0.3)',
    padding: 18,
    marginBottom: 14,
  },
  heroDistance: { color: '#FFF', fontSize: 34, fontWeight: '900' },
  heroMeta: { color: '#BCE4F1', marginTop: 4, fontWeight: '700' },
  metricsRow: { flexDirection: 'row', gap: 10 },
  metricCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    padding: 12,
  },
  metricLabel: { color: '#9BAAB0', fontWeight: '700', fontSize: 12 },
  metricValue: { color: '#FFF', fontSize: 22, fontWeight: '900', marginTop: 4 },
  contextCard: {
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.02)',
    padding: 10,
  },
  contextTitle: { color: '#EAF8FF', fontWeight: '800', fontSize: 13 },
  contextText: { color: '#A9C4CF', marginTop: 5, fontWeight: '600', fontSize: 12 },
  policyCard: {
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,191,71,0.45)',
    backgroundColor: 'rgba(255,191,71,0.12)',
    padding: 10,
  },
  policyTitle: { color: '#FFE1B4', fontWeight: '800', fontSize: 13 },
  policyText: { color: '#F6E9D3', marginTop: 5, fontWeight: '600', fontSize: 12, lineHeight: 17 },
  refinementCard: {
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0, 217, 255, 0.24)',
    backgroundColor: 'rgba(0, 217, 255, 0.08)',
    padding: 10,
  },
  refinementTitle: { color: '#E8FAFF', fontWeight: '800', fontSize: 13 },
  refinementText: { color: '#BFE6F3', marginTop: 5, fontWeight: '700', fontSize: 12 },
  refinementMeta: { color: '#9FD0E2', marginTop: 6, fontWeight: '600', fontSize: 11 },
  inputLabel: { color: '#D6DFE2', fontWeight: '700', marginTop: 12, marginBottom: 6 },
  input: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: '#141414',
    color: '#FFF',
    paddingHorizontal: 12,
  },
  notes: { minHeight: 80, paddingTop: 10, textAlignVertical: 'top' },
  lockNote: {
    color: '#86A8B6',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 10,
  },
  actions: { marginTop: 22, gap: 10 },
  primaryBtn: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: '#00D9FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { color: '#00141A', fontWeight: '900' },
  secondaryBtn: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3A3A3A',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#151515',
  },
  secondaryBtnText: { color: '#D3D3D3', fontWeight: '700' },
  disabled: { opacity: 0.6 },
});
