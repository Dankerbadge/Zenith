import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useFocusEffect } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import Animated, {
  Easing,
  Extrapolate,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import FlameMark from '../../components/icons/FlameMark';
import GlassCard from '../../components/ui/GlassCard';
import MetricCard from '../../components/ui/MetricCard';
import SectionHeader from '../../components/ui/SectionHeader';
import { STATS_HIGHLIGHT_GLOSS, statsHighlightBorder, statsHighlightRail, statsHighlightWash } from '../../components/ui/statsHighlight';
import { NEON_THEME } from '../../constants/neonTheme';
import NumberPadTextInput from '../../components/inputs/NumberPadTextInput';
import { acknowledgeSurfaceInsights, dismissSurfaceInsights, getHomeInsights } from '../../utils/aiInsightEngine';
import { calculateCurrentRank, getNextRank, RANKS } from '../../constants/ranks';
import { getDailyMetric } from '../../utils/dailyMetrics';
import { scheduleContextualNudges } from '../../utils/notificationService';
import { getDayConfidence, type DayConfidence } from '../../utils/semanticTrust';
import { getDailyLog, getUserProfile, setStorageItem, todayKey, USER_PROFILE_KEY } from '../../utils/storageUtils';
import { getWorkoutLoadouts, type WorkoutLoadout } from '../../utils/effortEngine';
import { subscribeDailyLogChanged } from '../../utils/dailyLogEvents';
import {
  getBehaviorMultipliers,
  getBehaviorState,
  getEffortDebtTier,
} from '../../utils/behavioralCore';
import type { AiInsight } from '../../utils/aiTypes';
import { syncWearableSignalsIfEnabled } from '../../utils/wearableImportService';
import { getWinningSnapshot } from '../../utils/winningSystem';
import { APP_CONFIG } from '../../utils/appConfig';
import { isSupabaseConfigured, socialApi } from '../../utils/supabaseClient';
import { useAuth } from '../context/authcontext';
import TeamsModeDashboard from '../../components/teams/TeamsModeDashboard';
import {
  getQuickActionPersonalizationState,
  loadQuickActionUsage,
  recordQuickActionUse,
  rankQuickActions,
  type QuickActionUsageMap,
} from '../../utils/quickActionPersonalization';
import {
  clearRunCommandAck,
  createClientCommandId,
  getActiveRunSnapshot,
  getQueuedRunCommands,
  logRunSyncEvent,
  getRunCommandAck,
  queueRunCommand,
  setOrphanRunResolutionIntent,
  type RunCommandRequest,
  type RunCommandType,
  type RunSnapshot,
} from '../../utils/runControlSync';
import {
  getActiveLiftSnapshot,
  clearLiftCommandAck,
  createLiftClientCommandId,
  getLiftCommandAck,
  getQueuedLiftCommands,
  queueLiftCommand,
  type LiftSnapshot,
  type LiftCommandRequest,
  type LiftCommandType,
} from '../../utils/liftControlSync';
	import {
	  sendCommandToWatch,
	  hasRunNativeControlBridge,
	  subscribeNativeRunCommands,
	  subscribeNativeRunStateUpdates,
	  subscribeNativeRunFinalize,
	  pushTreadmillCalibrationUpdateToWatch,
	  pushWatchWorkoutCarouselOrderToWatch,
	  subscribeTreadmillCalibrationAcks,
	  syncLiveActivityWithSnapshot,
	} from '../../utils/runNativeBridge';
import {
  sendLiftCommandToWatch,
  hasLiftNativeControlBridge,
  subscribeNativeLiftCommands,
  subscribeNativeLiftStateUpdates,
  subscribeNativeLiftFinalize,
  syncLiftLiveActivityWithSnapshot,
	} from '../../utils/liftNativeBridge';
	import { importWatchFinalizedLift, importWatchFinalizedRun, importWatchFinalizedWorkout } from '../../utils/watchFinalizeImport';
	import { getWatchWorkoutCarouselOrder } from '../../utils/watchWorkoutCarouselOrder';
import {
  applyTreadmillDistanceCorrectionToCalibration,
  clearPendingTreadmillCorrection,
  clearPendingTreadmillFactorSync,
  getHandledTreadmillCorrection,
  getPendingTreadmillCorrection,
  getPendingTreadmillFactorSync,
  markHandledTreadmillCorrection,
  patchPendingTreadmillFactorSync,
  setPendingTreadmillCorrection,
  setPendingTreadmillFactorSync,
  TREADMILL_FACTOR_BOUNDS,
} from '../../utils/treadmillCalibration';
import { applyTreadmillDistanceCorrectionToWatchRun } from '../../utils/runReviewService';

type TodayState = {
  name: string;
  totalXP: number;
  dailyXP: number;
  calories: number;
  protein: number;
  water: number;
  workoutsCount: number;
  restMinutes: number;
  steps?: number;
  walkMinutesToday: number;
  weight?: number;
  proteinTarget?: number;
  waterTargetOz?: number;
  activeRestTargetMin: number;
  caloriesTarget?: number;
  targetConfidence: 'HIGH' | 'MEDIUM' | 'LOW';
  targetWarnings: string[];
  winningDay: boolean;
  currentStreak: number;
  bestStreak: number;
  totalWinningDays: number;
  dayConfidence: DayConfidence;
  xpEfficiency: number;
  silentAccountabilityActive: boolean;
  silentReason?: string | null;
  effortDebt: number;
  effortDebtTier: string;
  memoryHeadline?: string;
};

type QuickStartAction = {
  id: string;
  emoji: string;
  label: string;
  colors: readonly [string, string];
  route: string;
};

const DEFAULT_STATE: TodayState = {
  name: 'Athlete',
  totalXP: 0,
  dailyXP: 0,
  calories: 0,
  protein: 0,
  water: 0,
  workoutsCount: 0,
  restMinutes: 0,
  steps: undefined,
  walkMinutesToday: 0,
  weight: undefined,
  proteinTarget: undefined,
  waterTargetOz: undefined,
  activeRestTargetMin: 20,
  caloriesTarget: undefined,
  targetConfidence: 'LOW',
  targetWarnings: [],
  winningDay: false,
  currentStreak: 0,
  bestStreak: 0,
  totalWinningDays: 0,
  dayConfidence: 'none',
  xpEfficiency: 1,
  silentAccountabilityActive: false,
  silentReason: null,
  effortDebt: 0,
  effortDebtTier: 'none',
  memoryHeadline: undefined,
};

const LAST_CELEBRATED_RANK_KEY = 'zenith:lastCelebratedRankId:v1';

function formatDurationSec(totalSec: number) {
  const sec = Math.max(0, Math.floor(totalSec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatPaceMinPerMile(paceMinPerMile: number | null | undefined) {
  const pace = Number(paceMinPerMile);
  if (!Number.isFinite(pace) || pace <= 0) return '—';
  const totalSec = Math.max(0, Math.round(pace * 60));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')} /mi`;
}

function withAlpha(hex: string, alpha: number) {
  const a = Math.max(0, Math.min(1, Number(alpha)));
  if (typeof hex !== 'string') return `rgba(255,255,255,${a})`;
  let h = hex.trim();
  if (!h.startsWith('#')) return hex;
  h = h.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (![r, g, b].every((n) => Number.isFinite(n))) return hex;
  return `rgba(${r},${g},${b},${a})`;
}

function formatRunStripMetrics(snapshot: RunSnapshot) {
  const timeSec = Math.max(0, Math.round(Number(snapshot.movingTimeSec) || 0));
  const distMiles = Math.max(0, Number(snapshot.totalDistanceMiles) || 0);
  const pace = formatPaceMinPerMile(snapshot.paceMinPerMile);
  const line1 = `Time: ${formatDurationSec(timeSec)} · Distance: ${distMiles.toFixed(2)} mi · Pace: ${pace}`;

  const extras: string[] = [];
  const kcal = Number(snapshot.totalCalories);
  if (Number.isFinite(kcal) && kcal > 0) extras.push(`Energy: ${Math.round(kcal)} kcal`);
  const hr = Number(snapshot.avgHrBpm);
  if (Number.isFinite(hr) && hr > 0) extras.push(`HR: ${Math.round(hr)} bpm`);
  return extras.length ? `${line1}\n${extras.join(' · ')}` : line1;
}

function formatLiftStripMetrics(snapshot: LiftSnapshot) {
  const timeSec = Math.max(0, Math.round(Number(snapshot.movingTimeSec) || 0));
  const sets = Math.max(0, Math.round(Number(snapshot.setCount) || 0));
  const kcal = Math.max(0, Math.round(Number(snapshot.totalCalories) || 0));
  return `Time: ${formatDurationSec(timeSec)} · Energy: ${kcal} kcal · Sets: ${sets}`;
}

function getHoursUntilMidnight(now = new Date()) {
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const diffMs = Math.max(0, midnight.getTime() - now.getTime());
  return diffMs / (1000 * 60 * 60);
}

function toTitleCase(value: string) {
  return value
    .split(' ')
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');
}

function dedupeSentences(text: string) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  // Avoid regex lookbehind (Hermes compatibility).
  const parts = raw.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [raw];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out.join(' ');
}

function useReduceMotionEnabled() {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (!alive) return;
        setReduceMotion(Boolean(enabled));
      })
      .catch(() => {});

    // Not all platforms/RN versions support the event; treat as optional.
    const sub = (AccessibilityInfo as any)?.addEventListener?.('reduceMotionChanged', (enabled: boolean) => {
      setReduceMotion(Boolean(enabled));
    });

    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, []);

  return reduceMotion;
}

function StreakChip({ streak }: { streak: number }) {
  const reduceMotion = useReduceMotionEnabled();
  const tier: 'inactive' | 'active' | 'hot' | 'blazing' =
    streak <= 0 ? 'inactive' : streak >= 30 ? 'blazing' : streak >= 7 ? 'hot' : 'active';

  const jitter = useSharedValue(0);
  const glowPulse = useSharedValue(0);
  const ember = useSharedValue(0);
  const emberX = useSharedValue(0);

  useEffect(() => {
    if (tier === 'inactive' || reduceMotion) {
      jitter.value = withTiming(0, { duration: 160 });
      return;
    }

    let alive = true;
    let timer: any;

    const tick = () => {
      if (!alive) return;
      // Small random jitter (-1..1) gives a campfire-like variance without looking arcade-y.
      const next = Math.max(-1, Math.min(1, (Math.random() - 0.5) * 2));
      const base = tier === 'active' ? 620 : tier === 'hot' ? 520 : 440;
      const duration = base + Math.round(Math.random() * 420);
      jitter.value = withTiming(next, { duration, easing: Easing.inOut(Easing.quad) });
      timer = setTimeout(tick, Math.max(220, duration - 80));
    };

    tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [reduceMotion, tier, jitter]);

  useEffect(() => {
    if (tier === 'inactive' || reduceMotion) {
      glowPulse.value = withTiming(0, { duration: 180 });
      return;
    }
    const duration = tier === 'active' ? 2400 : tier === 'hot' ? 2000 : 1700;
    glowPulse.value = withRepeat(withTiming(1, { duration, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [reduceMotion, tier, glowPulse]);

  useEffect(() => {
    if (tier !== 'blazing' || reduceMotion) {
      ember.value = withTiming(0, { duration: 0 });
      return;
    }

    let alive = true;
    let timer: any;

    const spark = () => {
      if (!alive) return;
      emberX.value = (Math.random() - 0.5) * 8;
      ember.value = 0;
      ember.value = withTiming(1, { duration: 900, easing: Easing.out(Easing.quad) });
      timer = setTimeout(spark, 3200 + Math.round(Math.random() * 4200));
    };

    timer = setTimeout(spark, 1700 + Math.round(Math.random() * 1600));
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [reduceMotion, tier, ember, emberX]);

  const palette = useMemo(() => {
    switch (tier) {
      case 'blazing':
        return { flame: '#FF6A00', highlight: '#FFF1A6', glow: '#FF6A00' } as const;
      case 'hot':
        return { flame: '#FF8A00', highlight: '#FFE17D', glow: '#FF8A00' } as const;
      case 'active':
        return { flame: '#FF9F0A', highlight: '#FFD60A', glow: '#FF9F0A' } as const;
      case 'inactive':
      default:
        return { flame: 'rgba(255,255,255,0.42)', highlight: 'rgba(255,255,255,0.0)', glow: 'rgba(0,0,0,0)' } as const;
    }
  }, [tier]);

  const flameMotion = useAnimatedStyle(() => {
    if (tier === 'inactive') return {};
    const amp = tier === 'active' ? 0.012 : tier === 'hot' ? 0.016 : 0.02;
    const rot = tier === 'active' ? 1.2 : tier === 'hot' ? 1.6 : 2.0;
    return {
      transform: [
        { translateY: jitter.value * -0.6 },
        { rotate: `${jitter.value * rot}deg` },
        { scale: 1 + jitter.value * amp },
      ],
    };
  }, [tier]);

  const glowLayer = useAnimatedStyle(() => {
    if (tier === 'inactive') return { opacity: 0 };
    const base = tier === 'active' ? 0.08 : tier === 'hot' ? 0.12 : 0.16;
    const amp = tier === 'active' ? 0.12 : tier === 'hot' ? 0.16 : 0.2;
    return {
      opacity: base + glowPulse.value * amp,
      transform: [{ scale: tier === 'blazing' ? 1.18 : tier === 'hot' ? 1.14 : 1.1 }],
    };
  }, [tier]);

  const highlightLayer = useAnimatedStyle(() => {
    if (tier === 'inactive') return { opacity: 0 };
    const base = tier === 'active' ? 0.22 : tier === 'hot' ? 0.28 : 0.32;
    const amp = tier === 'active' ? 0.18 : tier === 'hot' ? 0.22 : 0.26;
    return {
      opacity: base + glowPulse.value * amp,
      transform: [{ translateY: jitter.value * -0.2 }],
    };
  }, [tier]);

  const emberStyle = useAnimatedStyle(() => {
    if (tier !== 'blazing') return { opacity: 0 };
    return {
      opacity: interpolate(ember.value, [0, 0.12, 1], [0, 1, 0], Extrapolate.CLAMP),
      transform: [
        { translateX: emberX.value },
        { translateY: interpolate(ember.value, [0, 1], [6, -14], Extrapolate.CLAMP) },
        { scale: interpolate(ember.value, [0, 1], [0.6, 1.1], Extrapolate.CLAMP) },
      ],
    };
  }, [tier]);

  return (
    <View style={styles.streakChip}>
      <View style={styles.streakFlameSlot}>
        {tier === 'blazing' ? <Animated.View style={[styles.emberDot, emberStyle]} pointerEvents="none" /> : null}

        {tier === 'inactive' ? (
          <FlameMark size={20} color={palette.flame} />
        ) : (
          <Animated.View style={flameMotion}>
            <Animated.View style={[styles.flameGlow, glowLayer]} pointerEvents="none">
              <FlameMark size={22} color={palette.glow} />
            </Animated.View>
            <Animated.View style={[styles.flameHighlight, highlightLayer]} pointerEvents="none">
              <FlameMark size={20} color={palette.highlight} />
            </Animated.View>
            <FlameMark size={20} color={palette.flame} />
          </Animated.View>
        )}
      </View>

      <View style={styles.streakCountPill}>
        <Text style={styles.streakCountText}>{Math.max(0, Math.round(streak || 0))}</Text>
      </View>
    </View>
  );
}

function mapLoadoutToQuickStart(loadout: WorkoutLoadout): QuickStartAction {
  const loadoutName = typeof loadout?.name === 'string' ? loadout.name.trim() : '';
  const label = loadoutName ? `Start ${loadoutName}` : '';
  const hiitRoute = APP_CONFIG.FEATURES.LIVE_HIIT_ENABLED
    ? '/live-session?mode=hiit'
    : '/(modals)/workout?presetType=cardio&presetIntensity=hard&presetTemplate=Mixed%20Session';
  const mobilityRoute = APP_CONFIG.FEATURES.LIVE_MOBILITY_ENABLED
    ? '/live-session?mode=mobility'
    : '/(modals)/workout?presetType=mobility&presetIntensity=easy&presetTemplate=Recovery%20Session';
  const swimRoute = APP_CONFIG.FEATURES.LIVE_SWIM_ENABLED
    ? '/live-session?mode=swim'
    : '/(modals)/workout?presetType=cardio&presetIntensity=moderate&presetTemplate=Water%20Session';

  const byEngine = {
    endurance: { emoji: '🏃', colors: ['#00D9FF', '#00FF88'] as const, route: '/live-run' },
    strength: {
      emoji: '🏋️',
      colors: ['#00D9FF', '#4E5BFF'] as const,
      route: '/live-lift',
    },
    mixed_intensity: {
      emoji: '⚡',
      colors: ['#FFAA00', '#FF4F6A'] as const,
      route: hiitRoute,
    },
    recovery: {
      emoji: '🧘',
      colors: ['#7EDCFF', '#6CE8B5'] as const,
      route: mobilityRoute,
    },
    low_intensity: {
      emoji: '🧘',
      colors: ['#7EDCFF', '#6CE8B5'] as const,
      route: mobilityRoute,
    },
    water: {
      emoji: '🏊',
      colors: ['#00C2FF', '#008CFF'] as const,
      route: swimRoute,
    },
  } as const;

  const engineProfile =
    (byEngine as Record<string, { emoji: string; colors: readonly [string, string]; route: string }>)[loadout.engine] ||
    ({ emoji: '🏋️', colors: ['#888888', '#666666'] as const, route: '/(modals)/workout' } as const);
  return {
    id: loadout.id,
    label: label || `Start ${toTitleCase(String(loadout.engine || '').replace('_', ' '))}`,
    emoji: engineProfile.emoji,
    colors: engineProfile.colors,
    route: engineProfile.route,
  };
}

function buildQuickStartActions(loadouts: WorkoutLoadout[]): QuickStartAction[] {
  return (Array.isArray(loadouts) ? loadouts : [])
    .filter((loadout) => loadout.enabled)
    .slice(0, 3)
    .map(mapLoadoutToQuickStart);
}

function LegacyDashboardScreen() {
  const watchFeatureEnabled = APP_CONFIG.FEATURES.APPLE_WATCH_ENABLED;
  const insets = useSafeAreaInsets();
  const runBridgeAvailable = useMemo(() => watchFeatureEnabled && hasRunNativeControlBridge(), [watchFeatureEnabled]);
  const liftBridgeAvailable = useMemo(() => watchFeatureEnabled && hasLiftNativeControlBridge(), [watchFeatureEnabled]);
  const [state, setState] = useState<TodayState>(DEFAULT_STATE);
  const [aiInsights, setAiInsights] = useState<AiInsight[]>([]);
  const [coachExpanded, setCoachExpanded] = useState(false);
  const [runSnapshot, setRunSnapshot] = useState<RunSnapshot | null>(null);
  const [liftSnapshot, setLiftSnapshot] = useState<LiftSnapshot | null>(null);
  const [pendingCommand, setPendingCommand] = useState<{
    request: RunCommandRequest;
    retries: number;
    startedAtMs: number;
  } | null>(null);
  const [pendingLiftCommand, setPendingLiftCommand] = useState<{
    request: LiftCommandRequest;
    retries: number;
    startedAtMs: number;
  } | null>(null);
  const pendingCommandRef = useRef(pendingCommand);
  const pendingLiftCommandRef = useRef(pendingLiftCommand);
  const [endConfirmArmedUntil, setEndConfirmArmedUntil] = useState<number | null>(null);
  const [liftEndConfirmArmedUntil, setLiftEndConfirmArmedUntil] = useState<number | null>(null);
  const [orphanRunVisible, setOrphanRunVisible] = useState(false);
  const [orphanRunSnapshot, setOrphanRunSnapshot] = useState<RunSnapshot | null>(null);
  const [orphanActionInFlight, setOrphanActionInFlight] = useState(false);
  const [treadmillCorrection, setTreadmillCorrection] = useState<{
    sessionId: string;
    startedAtUtc: string;
    endedAtUtc: string;
    elapsedTimeSec: number;
    movingTimeSec: number;
    rawDistanceMiles: number;
    recordedDistanceMiles: number;
  } | null>(null);
  const [treadmillDistanceInput, setTreadmillDistanceInput] = useState('');
  const [treadmillSaving, setTreadmillSaving] = useState(false);
  const [controlHealth, setControlHealth] = useState<{
    runStale: boolean;
    liftStale: boolean;
    runQueue: number;
    liftQueue: number;
  }>({ runStale: false, liftStale: false, runQueue: 0, liftQueue: 0 });
  const [quickStarts, setQuickStarts] = useState<QuickStartAction[]>([]);
  const isMountedRef = useRef(true);
  const treadmillPromptedSessionIdsRef = useRef<Set<string>>(new Set());
  const lastAckNonceRef = useRef<string>('');
  const [quickActionUsage, setQuickActionUsage] = useState<QuickActionUsageMap | null>(null);
  const [quickActionFallbackReason, setQuickActionFallbackReason] = useState<string | null>(null);
  const [dashboardLoaded, setDashboardLoaded] = useState(false);
  const [rankCelebrationVisible, setRankCelebrationVisible] = useState(false);
  const rankSymbolReveal = useSharedValue(0);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    pendingCommandRef.current = pendingCommand;
  }, [pendingCommand]);

  useEffect(() => {
    pendingLiftCommandRef.current = pendingLiftCommand;
  }, [pendingLiftCommand]);

  const coachTipKey = aiInsights.length ? aiInsights[0].text : '';
  useEffect(() => {
    // New tips should start collapsed.
    setCoachExpanded(false);
  }, [coachTipKey]);

  useEffect(() => {
    void loadQuickActionUsage()
      .then((usage) => {
        setQuickActionUsage(usage);
        setQuickActionFallbackReason(null);
      })
      .catch(() => {
        setQuickActionUsage(null);
        setQuickActionFallbackReason('Usage history could not be read, so defaults are shown.');
      });
  }, []);

  const bumpQuickAction = useCallback((actionId: string) => {
    const id = String(actionId || '').trim();
    if (!id) return;
    // Optimistic local update so the next render uses the updated order.
    setQuickActionUsage((prev) => {
      const base = prev || {};
      const existing = base[id] || { count: 0, lastUsedAtMs: 0 };
      return {
        ...base,
        [id]: { count: Math.max(0, existing.count) + 1, lastUsedAtMs: Date.now() },
      };
    });
    void recordQuickActionUse(id)
      .then((next) => {
        setQuickActionUsage(next);
        setQuickActionFallbackReason(null);
      })
      .catch(() => {
        setQuickActionFallbackReason('Usage updates failed, so ordering will stay on defaults for now.');
      });
  }, []);

  const safeSnapshotAgeMs = useCallback((snapshot: RunSnapshot | null) => {
    if (!snapshot) return null;
    const raw = (snapshot as any).lastSyncedAtUtc || snapshot.lastUpdatedAtWatch;
    if (!raw || typeof raw !== 'string') return null;
    const ts = new Date(raw).getTime();
    if (!Number.isFinite(ts) || ts <= 0) return null;
    return Math.max(0, Date.now() - ts);
  }, []);

  const isOrphanPhoneRunSnapshot = useCallback(
    (snapshot: RunSnapshot | null) => {
      if (!snapshot) return false;
      if (snapshot.sourceDevice !== 'phone') return false;
      if (snapshot.state !== 'recording' && snapshot.state !== 'paused' && snapshot.state !== 'endingConfirm') return false;
      const ageMs = safeSnapshotAgeMs(snapshot);
      if (ageMs == null) return true; // Missing/unparsable timestamp is treated as stale.
      return ageMs > 15000;
    },
    [safeSnapshotAgeMs]
  );

  const loadToday = useCallback(async () => {
    const date = todayKey();
    await syncWearableSignalsIfEnabled(date);
    const [log, profile, loadouts, behaviorMultipliers, behaviorState, rawProgress] = await Promise.all([
      getDailyLog(date),
      getUserProfile(),
      getWorkoutLoadouts(),
      getBehaviorMultipliers(date),
      getBehaviorState(),
      AsyncStorage.getItem('userProgress'),
    ]);
    const metric = await getDailyMetric(date, { log, profile });
    const dayConfidence = getDayConfidence(log);
    const activeRest = Array.isArray((log as any)?.activeRest) ? (log as any).activeRest : [];
    const walkMinutesToday = activeRest
      .filter((entry: any) => entry?.type === 'walk')
      .reduce((sum: number, entry: any) => sum + (Number(entry?.minutes) || 0), 0);

    const winningSnapshot = await getWinningSnapshot();
    const totalXP = (() => {
      try {
        const parsed = rawProgress ? JSON.parse(rawProgress) : null;
        return Math.max(0, Number(parsed?.totalXP) || 0);
      } catch {
        return 0;
      }
    })();
    const nextAiInsights = await getHomeInsights({
      dateKey: date,
      dayConfidence,
      winningDay: metric.winningDay,
      workoutsCount: metric.workoutsCount,
      restMinutes: metric.activeRestMinutes,
      activeRestTargetMin: metric.activeRestTargetMin,
      water: metric.water,
      waterTargetOz: Number(metric.waterTargetOz) || 0,
      protein: metric.protein,
      proteinTarget: Number(metric.proteinTarget) || 0,
      pendingChallenges: 0,
    });
    if (nextAiInsights.length > 0) {
      await acknowledgeSurfaceInsights(nextAiInsights);
    }

    const [activeRun, activeLift] = await Promise.all([getActiveRunSnapshot(), getActiveLiftSnapshot()]);
    if (!isMountedRef.current) return;
    setQuickStarts(buildQuickStartActions(loadouts));
    setAiInsights(nextAiInsights);
    setRunSnapshot(activeRun);
    setLiftSnapshot(activeLift);
    if (isOrphanPhoneRunSnapshot(activeRun)) {
      setOrphanRunSnapshot(activeRun);
      setOrphanRunVisible(true);
      setOrphanActionInFlight(false);
    } else {
      setOrphanRunSnapshot(null);
      setOrphanRunVisible(false);
    }
    const recentMemory = behaviorState.memoryEvents.slice().reverse()[0];
    setState({
      name: (typeof profile.firstName === 'string' && profile.firstName) || 'Athlete',
      totalXP,
      dailyXP: Number((log as any)?.dailyXP) || 0,
      calories: metric.calories,
      protein: metric.protein,
      water: metric.water,
      workoutsCount: metric.workoutsCount,
      restMinutes: metric.activeRestMinutes,
      steps: metric.steps,
      walkMinutesToday,
      weight: metric.weight,
      proteinTarget: metric.proteinTarget,
      waterTargetOz: metric.waterTargetOz,
      activeRestTargetMin: metric.activeRestTargetMin,
      caloriesTarget: metric.caloriesTarget,
      targetConfidence: metric.recommended.confidence,
      targetWarnings: metric.recommended.warnings,
      winningDay: metric.winningDay,
      currentStreak: winningSnapshot.currentStreak,
      bestStreak: winningSnapshot.bestStreak,
      totalWinningDays: winningSnapshot.totalWinningDays,
      dayConfidence,
      xpEfficiency: behaviorMultipliers.xpEfficiency,
      silentAccountabilityActive: behaviorMultipliers.active,
      silentReason: behaviorMultipliers.reason,
      effortDebt: behaviorState.effortDebt,
      effortDebtTier: getEffortDebtTier(behaviorState.effortDebt),
      memoryHeadline: recentMemory ? `${recentMemory.title} · ${recentMemory.date}` : undefined,
    });
    setDashboardLoaded(true);
  }, [isOrphanPhoneRunSnapshot]);

  const syncRunControl = useCallback(async () => {
    const [snapshot, lift] = await Promise.all([getActiveRunSnapshot(), getActiveLiftSnapshot()]);
    if (!isMountedRef.current) return;
    setRunSnapshot(snapshot);
    setLiftSnapshot(lift);
    if (isOrphanPhoneRunSnapshot(snapshot)) {
      setOrphanRunSnapshot(snapshot);
      setOrphanRunVisible(true);
      setOrphanActionInFlight(false);
    } else {
      setOrphanRunSnapshot(null);
      setOrphanRunVisible(false);
    }
    const currentPendingCommand = pendingCommandRef.current;
    if (currentPendingCommand) {
      const ack = await getRunCommandAck(currentPendingCommand.request.clientCommandId);
      if (ack) {
        await clearRunCommandAck(currentPendingCommand.request.clientCommandId);
        if (!isMountedRef.current) return;
        logRunSyncEvent('command_ack_received', {
          commandType: currentPendingCommand.request.commandType,
          clientCommandId: currentPendingCommand.request.clientCommandId,
          accepted: ack.accepted,
          reasonCode: ack.reasonCode || null,
          seq: ack.snapshot?.seq || null,
          sessionId: currentPendingCommand.request.sessionId,
        });
        setPendingCommand(null);
        if (ack.snapshot) setRunSnapshot(ack.snapshot);
        if (!ack.accepted) {
          Alert.alert('Run control', ack.reasonCode ? `Could not apply command (${ack.reasonCode}).` : 'Could not apply command.');
        }
      }
    }
    const currentPendingLiftCommand = pendingLiftCommandRef.current;
    if (currentPendingLiftCommand) {
      const ack = await getLiftCommandAck(currentPendingLiftCommand.request.clientCommandId);
      if (ack) {
        await clearLiftCommandAck(currentPendingLiftCommand.request.clientCommandId);
        if (!isMountedRef.current) return;
        setPendingLiftCommand(null);
        if (ack.snapshot) setLiftSnapshot(ack.snapshot);
        if (!ack.accepted) {
          Alert.alert('Lift control', ack.reasonCode ? `Could not apply command (${ack.reasonCode}).` : 'Could not apply command.');
        }
      }
    }
  }, [isOrphanPhoneRunSnapshot]);

  useEffect(() => {
    const interval = setInterval(() => {
      void syncRunControl();
    }, 5000);
    return () => clearInterval(interval);
  }, [syncRunControl]);

  useEffect(() => {
    if (!runBridgeAvailable) return;
    const unsubscribe = subscribeNativeRunCommands((request) => {
      void queueRunCommand(request);
    });
    return unsubscribe;
  }, [runBridgeAvailable]);

  useEffect(() => {
    if (!liftBridgeAvailable) return;
    const unsubscribe = subscribeNativeLiftCommands((request) => {
      void queueLiftCommand(request);
    });
    return unsubscribe;
  }, [liftBridgeAvailable]);

	  useEffect(() => {
	    if (!runBridgeAvailable) return;
	    const unsubscribe = subscribeNativeRunStateUpdates((update) => {
	      if (!isMountedRef.current) return;
      if (update.snapshot) {
        setRunSnapshot((current) => {
          if (!current) return update.snapshot!;
          if (current.sessionId !== update.snapshot!.sessionId) return update.snapshot!;
          if (update.snapshot!.seq > current.seq) return update.snapshot!;
          return current;
        });
	      }
	      if (
	        pendingCommandRef.current &&
	        update.clientCommandId &&
	        update.clientCommandId === pendingCommandRef.current.request.clientCommandId
	      ) {
	        const current = pendingCommandRef.current;
	        if (!current) return;
	        logRunSyncEvent('command_ack_received', {
	          commandType: current.request.commandType,
	          clientCommandId: current.request.clientCommandId,
	          accepted: update.accepted ?? null,
	          reasonCode: update.reasonCode || null,
	          seq: update.snapshot?.seq || null,
	          sessionId: current.request.sessionId,
	        });
	        setPendingCommand(null);
	        if (update.accepted === false) {
	          Alert.alert('Run control', update.reasonCode ? `Could not apply command (${update.reasonCode}).` : 'Could not apply command.');
	        }
	      }

      if (update.connected === true) {
        void getPendingTreadmillFactorSync().then((pending) => {
          if (!pending || pending.status !== 'pending') return;
          const lastSentMs = pending.lastSentAtUtc ? new Date(pending.lastSentAtUtc).getTime() : 0;
          if (Number.isFinite(lastSentMs) && lastSentMs > 0 && Date.now() - lastSentMs < 30_000) return;
          void patchPendingTreadmillFactorSync({ lastSentAtUtc: new Date().toISOString() });
          void pushTreadmillCalibrationUpdateToWatch({
            factor: pending.factor,
            updatedAtUtc: pending.updatedAtUtc,
            nonce: pending.nonce,
          });
        });
      }
	    });
	    return unsubscribe;
	  }, [runBridgeAvailable]);

  useEffect(() => {
    if (!runBridgeAvailable) return;
    const unsubscribe = subscribeTreadmillCalibrationAcks((ack) => {
      if (!ack?.nonce || ack.nonce === lastAckNonceRef.current) return;
      lastAckNonceRef.current = ack.nonce;
      void getPendingTreadmillFactorSync().then((pending) => {
        if (!pending) return;
        if (pending.nonce !== ack.nonce) return;
        if (ack.status === 'applied' || ack.status === 'ignored_stale') {
          void clearPendingTreadmillFactorSync();
          return;
        }
        if (ack.status === 'invalid') {
          void patchPendingTreadmillFactorSync({ status: 'blocked' });
        }
      });
    });
    return unsubscribe;
  }, [runBridgeAvailable]);

  useEffect(() => {
    if (!runBridgeAvailable) return;
    // Keep the watch's launcher carousel synced with phone preferences (best-effort).
    void getWatchWorkoutCarouselOrder().then((order) => {
      void pushWatchWorkoutCarouselOrderToWatch(order as any);
    });
    void getPendingTreadmillCorrection().then((pending) => {
      if (!pending || !pending.sessionId) return;
      void getHandledTreadmillCorrection(pending.sessionId).then((handled) => {
        if (handled) return;
        if (!isMountedRef.current) return;
        setTreadmillCorrection({
          sessionId: pending.sessionId,
          startedAtUtc: pending.startedAtUtc,
          endedAtUtc: pending.endedAtUtc,
          elapsedTimeSec: pending.elapsedTimeSec,
          movingTimeSec: pending.movingTimeSec,
          rawDistanceMiles: pending.rawDistanceMiles,
          recordedDistanceMiles: pending.recordedDistanceMiles,
        });
        setTreadmillDistanceInput(pending.recordedDistanceMiles > 0 ? pending.recordedDistanceMiles.toFixed(2) : '');
      });
    });
    void getPendingTreadmillFactorSync().then((pendingFactor) => {
      if (!pendingFactor || pendingFactor.status !== 'pending') return;
      void pushTreadmillCalibrationUpdateToWatch({
        factor: pendingFactor.factor,
        updatedAtUtc: pendingFactor.updatedAtUtc,
        nonce: pendingFactor.nonce,
      });
    });
    const unsubscribe = subscribeNativeRunFinalize((payload) => {
      const kind = String((payload as any)?.kind || 'run');
      if (kind === 'lift') {
        void importWatchFinalizedLift(payload as any);
      } else if (kind === 'workout') {
        void importWatchFinalizedWorkout(payload as any);
      } else {
        // Idempotent import keyed by sessionId-derived runId.
        void importWatchFinalizedRun(payload as any);
      }

      // Prompt for treadmill correction on phone (fastest typing, lowest friction).
      const env = kind === 'run' ? String((payload as any)?.runEnvironment || '') : '';
      const sessionId = String((payload as any)?.sessionId || '');
      if (env === 'treadmill' && sessionId && !treadmillPromptedSessionIdsRef.current.has(sessionId)) {
        const startedAtUtc = String((payload as any)?.startedAtUtc || new Date().toISOString());
        const endedAtUtc = String((payload as any)?.endedAtUtc || new Date().toISOString());
        const elapsedTimeSec = Math.max(0, Math.round(Number((payload as any)?.elapsedTimeSec) || 0));
        const movingTimeSec = Math.max(0, Math.round(Number((payload as any)?.movingTimeSec) || 0));
        const recordedDistanceMiles = Math.max(0, Number((payload as any)?.totalDistanceMiles) || 0);
        const rawDistanceMiles = Math.max(
          0,
          ((payload as any)?.rawDistanceMiles == null ? recordedDistanceMiles : Number((payload as any)?.rawDistanceMiles) || 0)
        );
        treadmillPromptedSessionIdsRef.current.add(sessionId);
        void getHandledTreadmillCorrection(sessionId).then((handled) => {
          if (handled) return;
          void setPendingTreadmillCorrection({
            sessionId,
            startedAtUtc,
            endedAtUtc,
            elapsedTimeSec,
            movingTimeSec,
            rawDistanceMiles,
            recordedDistanceMiles,
            createdAtUtc: new Date().toISOString(),
          });
          if (!isMountedRef.current) return;
          setTreadmillCorrection({
            sessionId,
            startedAtUtc,
            endedAtUtc,
            elapsedTimeSec,
            movingTimeSec,
            rawDistanceMiles,
            recordedDistanceMiles,
          });
          setTreadmillDistanceInput(recordedDistanceMiles > 0 ? recordedDistanceMiles.toFixed(2) : '');
        });
      }

      // After finalize, refresh local snapshots.
      setTimeout(() => {
        void syncRunControl();
      }, 500);
    });
    return unsubscribe;
  }, [runBridgeAvailable, syncRunControl]);

  const adjustTreadmillDistance = useCallback((deltaMiles: number) => {
    const base = Number(treadmillDistanceInput);
    const next = Number.isFinite(base) ? base + deltaMiles : deltaMiles;
    if (!Number.isFinite(next) || next <= 0) return;
    setTreadmillDistanceInput(next.toFixed(2));
  }, [treadmillDistanceInput]);

  const saveTreadmillCorrection = useCallback(async () => {
    if (!treadmillCorrection || treadmillSaving) return;
    const entered = Number(treadmillDistanceInput);
    if (!Number.isFinite(entered) || entered <= 0) {
      Alert.alert('Treadmill distance', 'Enter a valid distance (miles).');
      return;
    }

    const raw = Number(treadmillCorrection.rawDistanceMiles);
    if (!Number.isFinite(raw) || raw <= 0) {
      Alert.alert('Treadmill distance', 'Zenith distance was unavailable for calibration.');
      return;
    }

    const newFactor = entered / raw;
    if (!Number.isFinite(newFactor) || newFactor <= 0) {
      Alert.alert('Treadmill distance', 'Could not compute a calibration factor.');
      return;
    }

    if (newFactor < TREADMILL_FACTOR_BOUNDS.hardMin || newFactor > TREADMILL_FACTOR_BOUNDS.hardMax) {
      Alert.alert('Treadmill distance', 'That correction looks too large. Double-check the number and try again.');
      return;
    }

    const proceed = async () => {
      setTreadmillSaving(true);
      try {
        const calibration = await applyTreadmillDistanceCorrectionToCalibration({
          sessionId: treadmillCorrection.sessionId,
          rawDistanceMiles: raw,
          treadmillDistanceMiles: entered,
        });
        if (!calibration.accepted) {
          Alert.alert('Treadmill distance', 'Could not apply correction.');
          return;
        }

        if (calibration.nextFactor != null) {
          const nonce = `nonce_${Date.now()}_${Math.round(Math.random() * 1e9)}`;
          const updatedAtUtc = new Date().toISOString();
          await setPendingTreadmillFactorSync({
            factor: calibration.nextFactor,
            updatedAtUtc,
            nonce,
            status: 'pending',
            lastSentAtUtc: updatedAtUtc,
          });
          await pushTreadmillCalibrationUpdateToWatch({
            factor: calibration.nextFactor,
            updatedAtUtc,
            nonce,
            sourceSessionId: treadmillCorrection.sessionId,
          });
        }

        await applyTreadmillDistanceCorrectionToWatchRun({
          sessionId: treadmillCorrection.sessionId,
          startedAtUtc: treadmillCorrection.startedAtUtc,
          endedAtUtc: treadmillCorrection.endedAtUtc,
          elapsedTimeSec: treadmillCorrection.elapsedTimeSec,
          movingTimeSec: treadmillCorrection.movingTimeSec,
          rawDistanceMiles: raw,
          treadmillDistanceMiles: entered,
        });

        await markHandledTreadmillCorrection(treadmillCorrection.sessionId, 'saved');
        await clearPendingTreadmillCorrection();
        setTreadmillCorrection(null);
      } finally {
        setTreadmillSaving(false);
      }
    };

    if (newFactor < TREADMILL_FACTOR_BOUNDS.acceptMin || newFactor > TREADMILL_FACTOR_BOUNDS.acceptMax) {
      Alert.alert(
        'Large correction',
        `Zenith vs treadmill differs by ${Math.round(Math.abs(1 - newFactor) * 100)}%. Save anyway?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Save', style: 'default', onPress: () => void proceed() },
        ]
      );
      return;
    }

    await proceed();
  }, [treadmillCorrection, treadmillDistanceInput, treadmillSaving]);

  useEffect(() => {
    if (!liftBridgeAvailable) return;
    const unsubscribe = subscribeNativeLiftStateUpdates((update) => {
      if (!isMountedRef.current) return;
      if (update.snapshot) {
        setLiftSnapshot((current) => {
          if (!current) return update.snapshot!;
          if (current.sessionId !== update.snapshot!.sessionId) return update.snapshot!;
          if (update.snapshot!.seq > current.seq) return update.snapshot!;
          return current;
        });
      }
      if (
        pendingLiftCommand &&
        update.clientCommandId &&
        update.clientCommandId === pendingLiftCommand.request.clientCommandId
      ) {
        setPendingLiftCommand(null);
        if (update.accepted === false) {
          Alert.alert('Lift control', update.reasonCode ? `Could not apply command (${update.reasonCode}).` : 'Could not apply command.');
        }
      }
    });
    return unsubscribe;
  }, [liftBridgeAvailable, pendingLiftCommand]);

  useEffect(() => {
    if (!liftBridgeAvailable) return;
    const unsubscribe = subscribeNativeLiftFinalize((payload) => {
      void importWatchFinalizedLift(payload);
      setTimeout(() => {
        void syncRunControl();
      }, 500);
    });
    return unsubscribe;
  }, [liftBridgeAvailable, syncRunControl]);

  useEffect(() => {
    if (!endConfirmArmedUntil) return;
    const remaining = endConfirmArmedUntil - Date.now();
    if (remaining <= 0) {
      setEndConfirmArmedUntil(null);
      return;
    }
    const timeout = setTimeout(() => setEndConfirmArmedUntil(null), remaining + 30);
    return () => clearTimeout(timeout);
  }, [endConfirmArmedUntil]);

  useEffect(() => {
    if (!liftEndConfirmArmedUntil) return;
    const remaining = liftEndConfirmArmedUntil - Date.now();
    if (remaining <= 0) {
      setLiftEndConfirmArmedUntil(null);
      return;
    }
    const timeout = setTimeout(() => setLiftEndConfirmArmedUntil(null), remaining + 30);
    return () => clearTimeout(timeout);
  }, [liftEndConfirmArmedUntil]);

  useEffect(() => {
    if (!runSnapshot || !endConfirmArmedUntil) return;
    if (runSnapshot.state !== 'endingConfirm') {
      setEndConfirmArmedUntil(null);
    }
  }, [endConfirmArmedUntil, runSnapshot]);

  useEffect(() => {
    if (!liftSnapshot || !liftEndConfirmArmedUntil) return;
    if (liftSnapshot.state !== 'endingConfirm') {
      setLiftEndConfirmArmedUntil(null);
    }
  }, [liftEndConfirmArmedUntil, liftSnapshot]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      const run = async () => {
        if (!alive) return;
        await loadToday();
        await syncRunControl();
        void scheduleContextualNudges();
      };
      void run();
      return () => {
        alive = false;
      };
    }, [loadToday, syncRunControl])
  );

  useEffect(() => {
    // Keep Home metrics/streaks live even when the screen doesn't lose focus (modal presentations),
    // and ensure midnight rollover updates without requiring a relaunch.
    const unsubscribe = subscribeDailyLogChanged((changedDate) => {
      const today = todayKey();
      if (changedDate === today) {
        void loadToday();
      }
    });
    return unsubscribe;
  }, [loadToday]);

  useEffect(() => {
    let alive = true;
    let timeout: any;

    const scheduleMidnightRefresh = () => {
      if (!alive) return;
      const now = new Date();
      const nextMidnight = new Date(now);
      nextMidnight.setHours(24, 0, 2, 0); // give storage writes a moment to settle
      const ms = Math.max(1000, nextMidnight.getTime() - now.getTime());
      timeout = setTimeout(() => {
        void loadToday();
        scheduleMidnightRefresh();
      }, ms);
    };

    scheduleMidnightRefresh();
    return () => {
      alive = false;
      if (timeout) clearTimeout(timeout);
    };
  }, [loadToday]);

  const sendRunCommand = useCallback(
    async (commandType: RunCommandType) => {
      if (!runSnapshot || pendingCommand) return;
      if (!runBridgeAvailable) {
        Alert.alert('Run control unavailable', 'Remote run controls are unavailable here. Open Live Run to control the session locally.');
        router.replace('/live-run' as any);
        return;
      }
      const request: RunCommandRequest = {
        sessionId: runSnapshot.sessionId,
        commandType,
        clientCommandId: createClientCommandId(commandType),
        sentAtPhone: new Date().toISOString(),
        phoneLastSeqKnown: runSnapshot.seq,
      };
      logRunSyncEvent('command_sent', {
        commandType: request.commandType,
        clientCommandId: request.clientCommandId,
        seq: request.phoneLastSeqKnown,
        sessionId: request.sessionId,
      });
      setPendingCommand({ request, retries: 0, startedAtMs: Date.now() });
      await queueRunCommand(request);
      await sendCommandToWatch(request);
      setTimeout(() => {
        void syncRunControl();
      }, 1200);
    },
    [pendingCommand, runBridgeAvailable, runSnapshot, syncRunControl]
  );

  const sendLiftCommand = useCallback(
    async (commandType: LiftCommandType) => {
      if (!liftSnapshot || pendingLiftCommand) return;
      if (!liftBridgeAvailable) {
        Alert.alert('Lift control unavailable', 'Remote lift controls are unavailable here. Open Live Lift to control the session locally.');
        router.push('/live-lift' as any);
        return;
      }
      const request: LiftCommandRequest = {
        sessionId: liftSnapshot.sessionId,
        commandType,
        clientCommandId: createLiftClientCommandId(commandType),
        sentAtPhone: new Date().toISOString(),
        phoneLastSeqKnown: liftSnapshot.seq,
      };
      logRunSyncEvent('lift_command_sent', {
        commandType: request.commandType,
        clientCommandId: request.clientCommandId,
        seq: request.phoneLastSeqKnown,
        sessionId: request.sessionId,
      });
      setPendingLiftCommand({ request, retries: 0, startedAtMs: Date.now() });
      await queueLiftCommand(request);
      await sendLiftCommandToWatch(request);
      setTimeout(() => {
        void syncRunControl();
      }, 1200);
    },
    [liftBridgeAvailable, liftSnapshot, pendingLiftCommand, syncRunControl]
  );

  useEffect(() => {
    if (!runBridgeAvailable) return;
    if (!pendingCommand) return;
    const interval = setInterval(() => {
      const elapsedMs = Date.now() - pendingCommand.startedAtMs;
      if (elapsedMs >= 10000) {
        logRunSyncEvent('command_timeout', {
          commandType: pendingCommand.request.commandType,
          clientCommandId: pendingCommand.request.clientCommandId,
          sessionId: pendingCommand.request.sessionId,
        });
        setPendingCommand(null);
        Alert.alert('Run control', 'Waiting for paired device. Please try again.');
        return;
      }
      if (
        elapsedMs >= 3000 &&
        pendingCommand.retries < 1 &&
        pendingCommand.request.commandType !== 'confirmEnd'
      ) {
        const next = { ...pendingCommand, retries: pendingCommand.retries + 1 };
        setPendingCommand(next);
        logRunSyncEvent('command_retry_once', {
          commandType: pendingCommand.request.commandType,
          clientCommandId: pendingCommand.request.clientCommandId,
          sessionId: pendingCommand.request.sessionId,
        });
        void sendCommandToWatch(pendingCommand.request);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [pendingCommand, runBridgeAvailable]);

  useEffect(() => {
    if (!liftBridgeAvailable) return;
    if (!pendingLiftCommand) return;
    const interval = setInterval(() => {
      const elapsedMs = Date.now() - pendingLiftCommand.startedAtMs;
      if (elapsedMs >= 10000) {
        setPendingLiftCommand(null);
        Alert.alert('Lift control', 'Waiting for Lift controller. Open Live Lift to continue.');
        return;
      }
      if (elapsedMs >= 3000 && pendingLiftCommand.retries < 1 && pendingLiftCommand.request.commandType !== 'confirmEnd') {
        const next = { ...pendingLiftCommand, retries: pendingLiftCommand.retries + 1, startedAtMs: Date.now() };
        setPendingLiftCommand(next);
        void queueLiftCommand(pendingLiftCommand.request);
        void sendLiftCommandToWatch(pendingLiftCommand.request);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [liftBridgeAvailable, pendingLiftCommand]);

  useEffect(() => {
    if (!runBridgeAvailable) return;
    void syncLiveActivityWithSnapshot(runSnapshot);
  }, [runBridgeAvailable, runSnapshot]);

  useEffect(() => {
    if (!liftBridgeAvailable) return;
    void syncLiftLiveActivityWithSnapshot(liftSnapshot);
  }, [liftBridgeAvailable, liftSnapshot]);

  useEffect(() => {
    if (!__DEV__) return;
    const readHealth = async () => {
      const [runQ, liftQ] = await Promise.all([getQueuedRunCommands(), getQueuedLiftCommands()]);
      const runAgeMs = runSnapshot?.lastUpdatedAtWatch ? Date.now() - new Date(runSnapshot.lastUpdatedAtWatch).getTime() : 0;
      const liftAgeMs = liftSnapshot?.lastUpdatedAtWatch ? Date.now() - new Date(liftSnapshot.lastUpdatedAtWatch).getTime() : 0;
      setControlHealth({
        runStale: Boolean(runSnapshot) && Number.isFinite(runAgeMs) && runAgeMs > 15000,
        liftStale: Boolean(liftSnapshot) && Number.isFinite(liftAgeMs) && liftAgeMs > 15000,
        runQueue: runQ.length,
        liftQueue: liftQ.length,
      });
    };
    void readHealth();
    const interval = setInterval(() => {
      void readHealth();
    }, 5000);
    return () => clearInterval(interval);
  }, [liftSnapshot, runSnapshot]);

  const renderRunControlStrip = () => {
    if (!runSnapshot) return null;
    if (runSnapshot.state === 'saved' || runSnapshot.state === 'discarded' || runSnapshot.state === 'idle') return null;
    const isOrphan = isOrphanPhoneRunSnapshot(runSnapshot);
    const isNeedsAttention = runSnapshot.needsRecovery === true && runSnapshot.recoveryVerified === false;
    const isDisconnected = runSnapshot.state === 'disconnected';
    const isPaused = runSnapshot.state === 'paused';
    const isEnded = runSnapshot.state === 'ended';
    const isEndingConfirm = runSnapshot.state === 'endingConfirm';
    const isArmed = Boolean(endConfirmArmedUntil && Date.now() <= endConfirmArmedUntil);
    const lastSyncedMsAgo = safeSnapshotAgeMs(runSnapshot) ?? 0;
    const isStaleSync = safeSnapshotAgeMs(runSnapshot) == null ? true : lastSyncedMsAgo > 15000;

    if (isOrphan || isNeedsAttention) {
      return (
        <GlassCard style={styles.runStrip}>
          <View style={styles.runStripTop}>
            <Text style={styles.runStripTitle}>Active run</Text>
            <Text style={styles.runStripStatus}>Needs attention</Text>
          </View>
          <Text style={styles.runStripMetrics}>{formatRunStripMetrics(runSnapshot)}</Text>
          <Text style={styles.runStripHint}>
            {isNeedsAttention ? 'Resolve on Apple Watch to continue.' : 'Run state is stale. Resolve to continue.'}
          </Text>
          {!isNeedsAttention ? (
            <View style={styles.runStripButtons}>
              <Pressable
                style={styles.runStripButton}
                onPress={() => {
                  if (orphanActionInFlight) return;
                  setOrphanActionInFlight(true);
                  setOrphanRunVisible(false);
                  router.replace('/live-run' as any);
                }}
              >
                <Text style={styles.runStripButtonText}>Resolve run</Text>
              </Pressable>
            </View>
          ) : null}
        </GlassCard>
      );
    }

    if (!runBridgeAvailable) {
      return (
        <GlassCard style={styles.runStrip}>
          <View style={styles.runStripTop}>
            <Text style={styles.runStripTitle}>Active run</Text>
            <Text style={styles.runStripStatus}>Local control</Text>
          </View>
          <Text style={styles.runStripMetrics}>{formatRunStripMetrics(runSnapshot)}</Text>
          <Text style={styles.runStripHint}>
            {isStaleSync ? 'Run state is stale. Resolve to continue.' : 'Open run controls to pause, resume, end, save, or discard.'}
          </Text>
          <View style={styles.runStripButtons}>
            <Pressable style={styles.runStripButton} onPress={() => router.replace('/live-run' as any)}>
              <Text style={styles.runStripButtonText}>{isStaleSync ? 'Resolve run' : 'Open Run Controls'}</Text>
            </Pressable>
          </View>
        </GlassCard>
      );
    }

    return (
      <GlassCard style={styles.runStrip}>
        <View style={styles.runStripTop}>
          <Text style={styles.runStripTitle}>Active run</Text>
          <Text style={styles.runStripStatus}>
            {isDisconnected
              ? 'Disconnected'
              : isEnded
              ? 'Ended'
              : isEndingConfirm || isArmed
              ? 'Confirm end'
              : isPaused
              ? 'Paused'
              : 'Recording'}
          </Text>
        </View>
        <Text style={styles.runStripMetrics}>{formatRunStripMetrics(runSnapshot)}</Text>
        {isStaleSync ? (
          <Text style={styles.runStripHint}>Last synced {Math.floor(lastSyncedMsAgo / 1000)}s ago.</Text>
        ) : null}
        {isDisconnected ? (
          <Text style={styles.runStripHint}>Run continues on paired device. Waiting for connection.</Text>
        ) : null}
        {pendingCommand ? <Text style={styles.runStripHint}>Updating…</Text> : null}
        {runSnapshot.sourceDevice === 'watch' && runSnapshot.runEnvironment === 'outdoor' ? (
          <Pressable style={styles.runStripLink} onPress={() => router.push('/watch-run-live' as any)}>
            <Text style={styles.runStripLinkText}>Open live map</Text>
          </Pressable>
        ) : null}
        <View style={styles.runStripButtons}>
          <Pressable
            style={styles.runStripButton}
            disabled={Boolean(pendingCommand) || isDisconnected}
            onPress={() => {
              if (isEnded) {
                void sendRunCommand('save');
                return;
              }
              if (isArmed || isEndingConfirm) {
                setEndConfirmArmedUntil(null);
                void sendRunCommand('cancelEnd');
                return;
              }
              void sendRunCommand(isPaused ? 'resume' : 'pause');
            }}
          >
            <Text style={styles.runStripButtonText}>{isArmed || isEndingConfirm ? 'Cancel' : isPaused ? 'Resume' : 'Pause'}</Text>
          </Pressable>
          <Pressable
            style={[styles.runStripButton, styles.runStripEndButton]}
            disabled={Boolean(pendingCommand) || isDisconnected}
            onPress={() => {
              if (isEnded) {
                Alert.alert('Discard run?', 'This cannot be undone.', [
                  { text: 'Keep', style: 'cancel' },
                  {
                    text: 'Discard',
                    style: 'destructive',
                    onPress: () => {
                      void sendRunCommand('discard');
                    },
                  },
                ]);
                return;
              }
              if (!isArmed) {
                setEndConfirmArmedUntil(Date.now() + 2500);
                void sendRunCommand('requestEnd');
                return;
              }
              setEndConfirmArmedUntil(null);
              void sendRunCommand('confirmEnd');
            }}
          >
            <Text style={styles.runStripButtonText}>
              {isEnded ? 'Discard' : isArmed ? 'Tap again' : 'End'}
            </Text>
          </Pressable>
        </View>
      </GlassCard>
    );
  };

  const renderLiftControlStrip = () => {
    if (!liftSnapshot) return null;
    if (liftSnapshot.state === 'saved' || liftSnapshot.state === 'discarded' || liftSnapshot.state === 'idle') return null;
    const isNeedsAttention = liftSnapshot.needsRecovery === true && liftSnapshot.recoveryVerified === false;
    const isDisconnected = liftSnapshot.state === 'disconnected';
    const isPaused = liftSnapshot.state === 'paused';
    const isEnded = liftSnapshot.state === 'ended';
    const isEndingConfirm = liftSnapshot.state === 'endingConfirm';
    const isArmed = Boolean(liftEndConfirmArmedUntil && Date.now() <= liftEndConfirmArmedUntil);
    const lastSyncedMsAgo = Math.max(0, Date.now() - new Date(liftSnapshot.lastUpdatedAtWatch).getTime());
    const isStaleSync = Number.isFinite(lastSyncedMsAgo) && lastSyncedMsAgo > 15000;

    if (isNeedsAttention) {
      return (
        <GlassCard style={styles.runStrip}>
          <View style={styles.runStripTop}>
            <Text style={styles.runStripTitle}>Active lift</Text>
            <Text style={styles.runStripStatus}>Needs attention</Text>
          </View>
          <Text style={styles.runStripMetrics}>{formatLiftStripMetrics(liftSnapshot)}</Text>
          <Text style={styles.runStripHint}>Resolve on Apple Watch to continue.</Text>
        </GlassCard>
      );
    }

    if (!liftBridgeAvailable) {
      return (
        <GlassCard style={styles.runStrip}>
          <View style={styles.runStripTop}>
            <Text style={styles.runStripTitle}>Active lift</Text>
            <Text style={styles.runStripStatus}>Local control</Text>
          </View>
          <Text style={styles.runStripMetrics}>{formatLiftStripMetrics(liftSnapshot)}</Text>
          <Text style={styles.runStripHint}>Open lift controls to pause, resume, end, save, or discard.</Text>
          <View style={styles.runStripButtons}>
            <Pressable style={styles.runStripButton} onPress={() => router.push('/live-lift' as any)}>
              <Text style={styles.runStripButtonText}>Open Lift Controls</Text>
            </Pressable>
          </View>
        </GlassCard>
      );
    }

    return (
      <GlassCard style={styles.runStrip}>
        <View style={styles.runStripTop}>
          <Text style={styles.runStripTitle}>Active lift</Text>
          <Text style={styles.runStripStatus}>
            {isDisconnected
              ? 'Disconnected'
              : isEnded
              ? 'Ended'
              : isEndingConfirm || isArmed
              ? 'Confirm end'
              : isPaused
              ? 'Paused'
              : 'Recording'}
          </Text>
        </View>
        <Text style={styles.runStripMetrics}>{formatLiftStripMetrics(liftSnapshot)}</Text>
        {isStaleSync ? <Text style={styles.runStripHint}>Last synced {Math.floor(lastSyncedMsAgo / 1000)}s ago.</Text> : null}
        <Text style={styles.runStripHint}>
          {isDisconnected ? 'Lift continues on paired device. Waiting for connection.' : 'Open lift controls for pause/resume/end.'}
        </Text>
        {pendingLiftCommand ? <Text style={styles.runStripHint}>Updating…</Text> : null}
        <View style={styles.runStripButtons}>
          <Pressable
            style={styles.runStripButton}
            disabled={Boolean(pendingLiftCommand) || isDisconnected}
            onPress={() => {
              if (isEnded) {
                void sendLiftCommand('save');
                return;
              }
              if (isArmed || isEndingConfirm) {
                setLiftEndConfirmArmedUntil(null);
                void sendLiftCommand('cancelEnd');
                return;
              }
              void sendLiftCommand(isPaused ? 'resume' : 'pause');
            }}
          >
            <Text style={styles.runStripButtonText}>{isArmed || isEndingConfirm ? 'Cancel' : isPaused ? 'Resume' : 'Pause'}</Text>
          </Pressable>
          <Pressable
            style={[styles.runStripButton, styles.runStripEndButton]}
            disabled={Boolean(pendingLiftCommand) || isDisconnected}
            onPress={() => {
              if (isEnded) {
                Alert.alert('Discard lift?', 'This cannot be undone.', [
                  { text: 'Keep', style: 'cancel' },
                  {
                    text: 'Discard',
                    style: 'destructive',
                    onPress: () => {
                      void sendLiftCommand('discard');
                    },
                  },
                ]);
                return;
              }
              if (!isArmed) {
                setLiftEndConfirmArmedUntil(Date.now() + 2500);
                void sendLiftCommand('requestEnd');
                return;
              }
              setLiftEndConfirmArmedUntil(null);
              void sendLiftCommand('confirmEnd');
            }}
          >
            <Text style={styles.runStripButtonText}>{isEnded ? 'Discard' : isArmed ? 'Tap again' : 'End'}</Text>
          </Pressable>
        </View>
        <View style={styles.runStripButtons}>
          <Pressable style={styles.runStripButton} onPress={() => router.push('/live-lift' as any)}>
            <Text style={styles.runStripButtonText}>Open Lift Controls</Text>
          </Pressable>
        </View>
      </GlassCard>
    );
  };

  const nudge = useMemo(() => {
    const waterTarget = Number(state.waterTargetOz) || 0;
    const proteinTarget = Number(state.proteinTarget) || 0;
    const workoutOrRestDone = state.workoutsCount > 0 || state.restMinutes >= state.activeRestTargetMin;
    if (!workoutOrRestDone) {
      return {
        text: 'Log 20 minutes of recovery to lock today.',
        ctaLabel: 'Log recovery',
        onPress: () => router.push('/(modals)/rest' as any),
      };
    }
    if (waterTarget > 0 && state.water < waterTarget) {
      return {
        text: `Drink ${Math.max(0, waterTarget - state.water)} oz to hit hydration.`,
        ctaLabel: 'Log water',
        onPress: () => router.push('/(modals)/water' as any),
      };
    }
    if (proteinTarget > 0 && state.protein < proteinTarget) {
      return {
        text: `${Math.max(0, proteinTarget - state.protein)}g protein left today.`,
        ctaLabel: 'Log food',
        onPress: () => router.push('/(modals)/food' as any),
      };
    }
    return {
      text: "You're on track. Keep stacking clean reps.",
      ctaLabel: 'View today',
      onPress: () => router.push('/home/today-detail' as any),
    };
  }, [state]);

  const quest = useMemo(() => {
    const waterTarget = Number(state.waterTargetOz) || 0;
    const proteinTarget = Number(state.proteinTarget) || 0;
    const activityDone = state.workoutsCount > 0 || state.restMinutes >= state.activeRestTargetMin;
    const waterDone = waterTarget > 0 ? state.water >= waterTarget : false;
    const proteinDone = proteinTarget > 0 ? state.protein >= proteinTarget : false;
    const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

    const items = [
      {
        id: 'activity',
        label: 'Workout or recovery',
        detail: state.workoutsCount > 0 ? 'Workout logged' : `${Math.round(state.restMinutes)} / ${Math.round(state.activeRestTargetMin)} min`,
        done: activityDone,
        progress01: state.workoutsCount > 0 ? 1 : clamp01(state.activeRestTargetMin > 0 ? state.restMinutes / state.activeRestTargetMin : 0),
        accent: '#34D399',
        onPress: () => router.push('/home/today-detail?focus=activity' as any),
        quickPress: () => router.push('/(modals)/workout' as any),
      },
      {
        id: 'water',
        label: 'Hydration',
        detail: waterTarget > 0 ? `${Math.round(state.water)} / ${Math.round(waterTarget)} oz` : 'Finish profile for target',
        done: waterDone,
        progress01: clamp01(waterTarget > 0 ? state.water / waterTarget : 0),
        accent: '#22D3EE',
        onPress: () => router.push('/home/today-detail?focus=water' as any),
        quickPress: () => router.push('/(modals)/water' as any),
      },
      {
        id: 'protein',
        label: 'Protein',
        detail: proteinTarget > 0 ? `${Math.round(state.protein)} / ${Math.round(proteinTarget)} g` : 'Finish profile for target',
        done: proteinDone,
        progress01: clamp01(proteinTarget > 0 ? state.protein / proteinTarget : 0),
        accent: '#A855F7',
        onPress: () => router.push('/home/today-detail?focus=food' as any),
        quickPress: () => router.push('/(modals)/food' as any),
      },
    ] as const;

    const completed = items.filter((i) => i.done).length;
    const total = items.length;
    const progress = total > 0 ? completed / total : 0;
    return { items, completed, total, progress };
  }, [state.activeRestTargetMin, state.protein, state.proteinTarget, state.restMinutes, state.water, state.waterTargetOz, state.workoutsCount]);
  const streakWarningActive = !state.winningDay && getHoursUntilMidnight() <= 2;

  const rank = useMemo(() => {
    const current = calculateCurrentRank(state.totalXP, state.totalWinningDays);
    const nextRank = getNextRank(current.id);
    const floorXp = current.pointsRequired;
    const capXp = nextRank?.pointsRequired ?? floorXp;
    const currentBandXp = Math.max(0, state.totalXP - floorXp);
    const bandCapXp = Math.max(1, capXp - floorXp);
    return {
      id: current.id,
      name: current.name,
      color: current.color,
      icon: current.icon?.includes('⚙') ? '🛡️' : current.icon,
      subtitle: current.subtitle,
      bandXp: currentBandXp,
      bandCapXp,
      nextName: nextRank?.name,
    };
  }, [state.totalWinningDays, state.totalXP]);

  useEffect(() => {
    if (!dashboardLoaded) return;
    let cancelled = false;

    const prevRankIndex = (id: string | null) => RANKS.findIndex((r) => r.id === id);

    void (async () => {
      try {
        const storedRankId = await AsyncStorage.getItem(LAST_CELEBRATED_RANK_KEY);
        if (cancelled) return;

        if (!storedRankId) {
          await AsyncStorage.setItem(LAST_CELEBRATED_RANK_KEY, rank.id);
          return;
        }

        const fromIndex = prevRankIndex(storedRankId);
        const toIndex = prevRankIndex(rank.id);

        if (toIndex > fromIndex) {
          setRankCelebrationVisible(true);
        }

        if (storedRankId !== rank.id) {
          await AsyncStorage.setItem(LAST_CELEBRATED_RANK_KEY, rank.id);
        }
      } catch {
        // Best effort only. Rank logic should never fail from celebration storage issues.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dashboardLoaded, rank.id]);

  useEffect(() => {
    if (!rankCelebrationVisible) {
      rankSymbolReveal.value = 0;
      return;
    }
    rankSymbolReveal.value = 0;
    rankSymbolReveal.value = withTiming(1, {
      duration: 480,
      easing: Easing.out(Easing.cubic),
    });
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [rankCelebrationVisible, rankSymbolReveal]);

  const rankSymbolRevealStyle = useAnimatedStyle(() => ({
    opacity: rankSymbolReveal.value,
    transform: [{ scale: 0.92 + rankSymbolReveal.value * 0.08 }],
  }));

  const HEADER_EXPANDED_HEIGHT = 116;
  const HEADER_COLLAPSED_HEIGHT = 76;
  const headerCollapseDistance = HEADER_EXPANDED_HEIGHT - HEADER_COLLAPSED_HEIGHT;

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
    },
  });

  // P0: keep the welcome bar full-size while scrolling (no header compression).
  const headerProgress = useDerivedValue(() => 0);

  const stickyHeaderStyle = useAnimatedStyle(() => {
    return {
      height: HEADER_EXPANDED_HEIGHT - headerProgress.value * headerCollapseDistance,
    };
  });

  const expandedIdentityStyle = useAnimatedStyle(() => {
    return {
      opacity: interpolate(headerProgress.value, [0, 0.8], [1, 0], Extrapolate.CLAMP),
      transform: [{ translateY: interpolate(headerProgress.value, [0, 1], [0, -8], Extrapolate.CLAMP) }],
    };
  });

  const compactIdentityStyle = useAnimatedStyle(() => {
    return {
      opacity: interpolate(headerProgress.value, [0.25, 1], [0, 1], Extrapolate.CLAMP),
      transform: [{ translateY: interpolate(headerProgress.value, [0, 1], [10, 0], Extrapolate.CLAMP) }],
    };
  });

  const nameAnimatedStyle = useAnimatedStyle(() => {
    return {
      fontSize: interpolate(headerProgress.value, [0, 1], [32, 18], Extrapolate.CLAMP),
      lineHeight: interpolate(headerProgress.value, [0, 1], [36, 22], Extrapolate.CLAMP),
    };
  });

  const streakScaleStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: interpolate(headerProgress.value, [0, 1], [1, 0.94], Extrapolate.CLAMP) }],
    };
  });

  const rankTheme = useMemo(
    () => ({
      accent: '#7C5CFF',
      gradient: ['rgba(124,92,255,0.22)', 'rgba(0,217,255,0.14)'] as const,
    }),
    []
  );

  const quickActionItems = useMemo(() => {
    const required = [
      {
        id: 'start_run',
        defaultRank: 0,
        emoji: '🏃',
        label: 'Start Run',
        xp: 25,
        colors: ['#00D9FF', '#00FF88'] as const,
        onPress: () => {
          bumpQuickAction('start_run');
          router.push('/live-run' as any);
        },
      },
      {
        id: 'start_lift',
        defaultRank: 1,
        emoji: '🏋️',
        label: 'Start Lift',
        xp: 25,
        colors: ['#A855F7', '#4E5BFF'] as const,
        onPress: () => {
          bumpQuickAction('start_lift');
          router.push('/live-lift' as any);
        },
      },
      {
        id: 'start_hiit',
        defaultRank: 2,
        emoji: '⚡',
        label: 'Start HIIT',
        xp: 25,
        colors: ['#FFAA00', '#FF4F6A'] as const,
        onPress: () => {
          bumpQuickAction('start_hiit');
          router.push(
            (APP_CONFIG.FEATURES.LIVE_HIIT_ENABLED
              ? '/live-session?mode=hiit'
              : '/(modals)/workout?presetType=cardio&presetIntensity=hard&presetTemplate=Mixed%20Session') as any
          );
        },
      },
      {
        id: 'start_walk',
        defaultRank: 3,
        emoji: '🚶',
        label: 'Log Walk',
        xp: 5,
        subtitle: `${Math.max(0, Math.round(state.walkMinutesToday))} min today`,
        meta: typeof state.steps === 'number' ? `Steps: ${Math.max(0, Math.round(state.steps))} steps` : undefined,
        colors: ['#60A5FA', '#2563EB'] as const,
        onPress: () => {
          bumpQuickAction('start_walk');
          router.push('/(modals)/walk' as any);
        },
      },
      {
        id: 'log_food',
        defaultRank: 4,
        emoji: '🍎',
        label: 'Log Food',
        xp: 10,
        colors: ['#FF7A18', '#F59E0B'] as const,
        onPress: () => {
          bumpQuickAction('log_food');
          router.push('/(modals)/food' as any);
        },
      },
      {
        id: 'log_water',
        defaultRank: 5,
        emoji: '💧',
        label: 'Log Water',
        xp: 5,
        colors: ['#22D3EE', '#0EA5E9'] as const,
        onPress: () => {
          bumpQuickAction('log_water');
          router.push('/(modals)/water' as any);
        },
      },
      {
        id: 'log_weight',
        defaultRank: 6,
        emoji: '⚖️',
        label: 'Log Weight',
        xp: 5,
        colors: ['#7A2BE2', '#FF2AA0'] as const,
        onPress: () => {
          bumpQuickAction('log_weight');
          router.push('/(modals)/weight' as any);
        },
      },
    ] as const;

    const reservedLabels = new Set<string>(required.map((item) => item.label));
    const extras = (Array.isArray(quickStarts) ? quickStarts : [])
      .filter((action) => action && typeof action.label === 'string' && action.label.trim().length > 0)
      .filter((action) => typeof action.route === 'string' && action.route.trim().length > 0)
      .filter((action) => !reservedLabels.has(action.label.trim()))
      .map((action, idx) => ({
        id: `loadout_${action.id}`,
        defaultRank: 20 + idx,
        emoji: action.emoji,
        label: action.label.trim(),
        xp: 25,
        colors: action.colors,
        onPress: () => {
          bumpQuickAction(`loadout_${action.id}`);
          router.push(action.route as any);
        },
      }));

    const remaining = [
      {
        id: 'log_workout',
        defaultRank: 10,
        emoji: '💪',
        label: 'Log Workout',
        xp: 25,
        colors: ['#A3E635', '#34D399'] as const,
        onPress: () => {
          bumpQuickAction('log_workout');
          router.push('/(modals)/workout' as any);
        },
      },
      ...extras,
    ];

    const gradientKey = (colors: readonly [string, string]) => [String(colors[0]).toLowerCase(), String(colors[1]).toLowerCase()].sort().join('|');

    const fallbackGradients: readonly (readonly [string, string])[] = [
      ['#6CE8B5', '#22D3EE'],
      ['#0EA5E9', '#1D4ED8'],
      ['#F472B6', '#A855F7'],
      ['#F97316', '#EF4444'],
      ['#A3E635', '#34D399'],
      ['#00C2FF', '#2563EB'],
      ['#FF4F6A', '#FF7A18'],
      ['#7EDCFF', '#6CE8B5'],
      ['#64748B', '#A855F7'],
      ['#FACC15', '#FF7A18'],
      ['#4E5BFF', '#00D9FF'],
    ];

    const used = new Set<string>();
    required.forEach((item) => {
      if ((item as any).colors) used.add(gradientKey((item as any).colors));
    });

    const normalizeColors = (item: any) => {
      const existingRaw = item?.colors;
      const existing =
        Array.isArray(existingRaw) &&
        existingRaw.length >= 2 &&
        typeof existingRaw[0] === 'string' &&
        typeof existingRaw[1] === 'string'
          ? ([existingRaw[0], existingRaw[1]] as const)
          : undefined;
      if (existing) {
        const key = gradientKey(existing);
        if (!used.has(key)) {
          used.add(key);
          return { ...item, colors: existing };
        }
      }

      const next = fallbackGradients.find((g) => !used.has(gradientKey(g)));
      if (!next) return item;
      used.add(gradientKey(next));
      return { ...item, colors: next };
    };

    const ranked = rankQuickActions({
      actions: [...required, ...remaining],
      usage: quickActionUsage,
    });
    return ranked.map(normalizeColors);
  }, [bumpQuickAction, quickStarts, quickActionUsage, state.steps, state.walkMinutesToday]);

  const quickActionPersonalizationMode = useMemo(() => {
    return getQuickActionPersonalizationState(quickActionUsage, quickActionFallbackReason);
  }, [quickActionUsage, quickActionFallbackReason]);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <Animated.ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: HEADER_EXPANDED_HEIGHT + 1,
            // Keep the last card comfortably above the tab bar + safe area.
            paddingBottom: 28 + 62 + Math.max(0, insets.bottom),
          },
        ]}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={onScroll}
      >

        {renderRunControlStrip()}
        {renderLiftControlStrip()}

        <Modal visible={orphanRunVisible} animationType="fade" transparent onRequestClose={() => {}}>
          <View style={styles.orphanBackdrop}>
            <View style={styles.orphanCard}>
              <Text style={styles.orphanTitle}>Resolve active run</Text>
              <Text style={styles.orphanBody}>
                This run state is stale. Choose an explicit resolution.
              </Text>
              {orphanRunSnapshot ? (
                <Text style={styles.orphanMeta}>
                  {formatRunStripMetrics(orphanRunSnapshot)}
                </Text>
              ) : null}

              <Pressable
                style={styles.orphanPrimary}
                onPress={() => {
                  if (orphanActionInFlight) return;
                  setOrphanActionInFlight(true);
                  setOrphanRunVisible(false);
                  router.replace('/live-run' as any);
                }}
              >
                <Text style={styles.orphanPrimaryText}>Resolve run</Text>
              </Pressable>

              <Pressable
                style={styles.orphanSecondary}
                onPress={() => {
                  if (orphanActionInFlight) return;
                  setOrphanActionInFlight(true);
                  setOrphanRunVisible(false);
                  void (async () => {
                    try {
                      await setOrphanRunResolutionIntent('end');
                    } finally {
                      router.replace('/live-run' as any);
                    }
                  })();
                }}
              >
                <Text style={styles.orphanSecondaryText}>End and save partial</Text>
              </Pressable>

              <Pressable
                style={styles.orphanDanger}
                onPress={() => {
                  if (orphanActionInFlight) return;
                  setOrphanActionInFlight(true);
                  setOrphanRunVisible(false);
                  void (async () => {
                    try {
                      await setOrphanRunResolutionIntent('discard');
                    } finally {
                      router.replace('/live-run' as any);
                    }
                  })();
                }}
              >
                <Text style={styles.orphanDangerText}>Discard</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        <Modal visible={Boolean(treadmillCorrection)} animationType="fade" transparent onRequestClose={() => {}}>
          <View style={styles.treadmillBackdrop}>
            <View style={styles.treadmillCard}>
              <Text style={styles.treadmillTitle}>Treadmill distance</Text>
              <Text style={styles.treadmillBody}>
                Zenith recorded {(Number(treadmillCorrection?.recordedDistanceMiles) || 0).toFixed(2)} mi. What did the treadmill show?
              </Text>

              <NumberPadTextInput
                style={styles.treadmillInput}
                value={treadmillDistanceInput}
                onChangeText={setTreadmillDistanceInput}
                placeholder="Miles"
                placeholderTextColor="rgba(255,255,255,0.35)"
                keyboardType="decimal-pad"
                editable={!treadmillSaving}
              />

              <View style={styles.treadmillQuickRow}>
                <Pressable style={styles.treadmillQuick} disabled={treadmillSaving} onPress={() => adjustTreadmillDistance(0.05)}>
                  <Text style={styles.treadmillQuickText}>+0.05</Text>
                </Pressable>
                <Pressable style={styles.treadmillQuick} disabled={treadmillSaving} onPress={() => adjustTreadmillDistance(0.1)}>
                  <Text style={styles.treadmillQuickText}>+0.10</Text>
                </Pressable>
                <Pressable style={styles.treadmillQuick} disabled={treadmillSaving} onPress={() => adjustTreadmillDistance(0.25)}>
                  <Text style={styles.treadmillQuickText}>+0.25</Text>
                </Pressable>
              </View>

                <Pressable style={styles.treadmillPrimary} disabled={treadmillSaving} onPress={() => void saveTreadmillCorrection()}>
                  <Text style={styles.treadmillPrimaryText}>{treadmillSaving ? 'Saving…' : 'Save'}</Text>
                </Pressable>
              <Pressable
                style={styles.treadmillSecondary}
                disabled={treadmillSaving}
                onPress={() => {
                  const sessionId = treadmillCorrection?.sessionId || '';
                  if (sessionId) {
                    void markHandledTreadmillCorrection(sessionId, 'skipped');
                    void clearPendingTreadmillCorrection();
                  }
                  setTreadmillCorrection(null);
                }}
              >
                <Text style={styles.treadmillSecondaryText}>Skip</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        <Modal visible={rankCelebrationVisible} animationType="fade" transparent onRequestClose={() => setRankCelebrationVisible(false)}>
          <View style={styles.rankUpBackdrop}>
            <View style={styles.rankUpCard}>
              <Text style={styles.rankUpKicker}>RANK UP</Text>
              <Animated.View style={[styles.rankUpSymbolWrap, rankSymbolRevealStyle]}>
                <Text style={[styles.rankUpSymbol, { color: rank.color || '#00D9FF' }]}>{rank.icon}</Text>
              </Animated.View>
              <Text style={[styles.rankUpTitle, { color: rank.color || '#00D9FF' }]}>
                {rank.name}
              </Text>
              <Text style={styles.rankUpBody}>Goal achievement locked in. Keep stacking winning days.</Text>
              <Pressable style={styles.rankUpPrimary} onPress={() => setRankCelebrationVisible(false)}>
                <Text style={styles.rankUpPrimaryText}>Continue</Text>
              </Pressable>
              <Pressable
                style={styles.rankUpSecondary}
                onPress={() => {
                  setRankCelebrationVisible(false);
                  router.push('/account/ranks-xp' as any);
                }}
              >
                <Text style={styles.rankUpSecondaryText}>View ranks</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        {__DEV__ && watchFeatureEnabled ? (
          <GlassCard style={styles.controlHealthCard}>
            <Text style={styles.controlHealthTitle}>Control Health (Debug)</Text>
            <Text style={styles.controlHealthText}>
              Run: {runSnapshot ? (controlHealth.runStale ? 'stale' : 'ok') : 'idle'} · Queue: {controlHealth.runQueue}
            </Text>
            <Text style={styles.controlHealthText}>
              Lift: {liftSnapshot ? (controlHealth.liftStale ? 'stale' : 'ok') : 'idle'} · Queue: {controlHealth.liftQueue}
            </Text>
            <Pressable style={styles.controlHealthButton} onPress={() => router.push('/account/control-diagnostics' as any)}>
              <Text style={styles.controlHealthButtonText}>Open Diagnostics</Text>
            </Pressable>
          </GlassCard>
        ) : null}

        <View style={styles.statusStrip}>
          <Pressable
            onPress={() => router.push('/account/progress' as any)}
            style={({ pressed }) => [styles.statusChip, styles.statusChipXp, pressed && styles.statusChipPressed]}
          >
            <LinearGradient
              pointerEvents="none"
              colors={['#7C5CFF44', '#7C5CFF18', 'rgba(0,0,0,0)']}
              start={{ x: 0.1, y: 0.0 }}
              end={{ x: 0.9, y: 1.0 }}
              style={styles.statusChipWash}
            />
            <Text style={styles.statusLabel}>XP today</Text>
            <Text style={styles.statusValue}>+{Math.max(0, Math.round(state.dailyXP))} XP</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/home/rank-details' as any)}
            style={({ pressed }) => [styles.statusChip, styles.statusChipRank, pressed && styles.statusChipPressed]}
          >
            <LinearGradient
              pointerEvents="none"
              colors={['#A855F744', '#A855F718', 'rgba(0,0,0,0)']}
              start={{ x: 0.1, y: 0.0 }}
              end={{ x: 0.9, y: 1.0 }}
              style={styles.statusChipWash}
            />
            <Text style={styles.statusLabel}>Rank</Text>
            <Text style={styles.statusValue}>{rank.name}</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/account/behavior-core' as any)}
            style={({ pressed }) => [
              styles.statusChip,
              state.effortDebt <= 0
                ? styles.statusChipReadyGood
                : state.effortDebtTier === 'high'
                ? styles.statusChipReadyDanger
                : styles.statusChipReadyWarn,
              pressed && styles.statusChipPressed,
            ]}
          >
            <LinearGradient
              pointerEvents="none"
              colors={
                state.effortDebt <= 0
                  ? ['#00FF8844', '#00FF8818', 'rgba(0,0,0,0)']
                  : state.effortDebtTier === 'high'
                  ? ['#FF446644', '#FF446618', 'rgba(0,0,0,0)']
                  : ['#FFB00044', '#FFB00018', 'rgba(0,0,0,0)']
              }
              start={{ x: 0.1, y: 0.0 }}
              end={{ x: 0.9, y: 1.0 }}
              style={styles.statusChipWash}
            />
            <Text style={styles.statusLabel}>Readiness</Text>
            <Text
              style={[
                styles.statusValue,
                state.effortDebtTier !== 'none' && state.effortDebt > 0
                  ? state.effortDebtTier === 'high'
                    ? styles.statusValueDanger
                    : styles.statusValueWarn
                  : null,
              ]}
            >
              {state.effortDebt <= 0 ? 'Good' : String(state.effortDebtTier || 'low').toUpperCase()}
            </Text>
          </Pressable>
        </View>

        <GlassCard style={styles.questCard} onPress={() => router.push('/home/today-detail' as any)} highlightColor="#00D9FF">
          <View style={styles.questTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.questTitle}>TODAY{"'"}S QUEST</Text>
              <Text style={styles.questSubtitle}>
                {quest.completed === quest.total
                  ? `Quest complete · All goals hit`
                  : `${quest.completed}/${quest.total} complete · ${quest.total - quest.completed} remaining`}
              </Text>
            </View>
            <View style={styles.questRewardPill}>
              <Text style={styles.questRewardText}>{quest.completed}/{quest.total}</Text>
            </View>
          </View>

          <View style={styles.questTrack}>
            <View style={[styles.questFill, { width: `${Math.round(quest.progress * 100)}%` }]} />
          </View>

          <View style={styles.questList}>
            {quest.items.map((item) => (
              <Pressable
                key={item.id}
                onPress={item.onPress}
                onLongPress={item.quickPress}
                style={({ pressed }) => [styles.questRow, pressed && styles.questRowPressed]}
              >
                <MaterialIcons
                  name={item.done ? 'check-circle' : 'radio-button-unchecked'}
                  size={18}
                  color={item.done ? '#00FF88' : 'rgba(255,255,255,0.32)'}
                />
                <View style={styles.questRowBody}>
                  <View style={styles.questRowHeader}>
                    <Text style={styles.questRowTitle} numberOfLines={1}>
                      {item.label}
                    </Text>
                    <Text style={styles.questRowValue} numberOfLines={1}>
                      {item.detail}
                    </Text>
                  </View>
                  <View style={styles.questMiniTrack}>
                    <View
                      style={[
                        styles.questMiniFill,
                        { width: `${Math.round(Math.max(0, Math.min(1, item.progress01)) * 100)}%`, backgroundColor: item.accent },
                      ]}
                    />
                  </View>
                </View>
              </Pressable>
            ))}
          </View>

          <View style={styles.questCtas}>
            <Pressable style={({ pressed }) => [styles.questPrimaryCta, pressed && styles.questCtaPressed]} onPress={nudge.onPress}>
              <Text style={styles.questPrimaryCtaText}>{nudge.ctaLabel}</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.questSecondaryCta, pressed && styles.questCtaPressed]}
              onPress={() => router.push('/home/today-detail' as any)}
            >
              <Text style={styles.questSecondaryCtaText}>View all</Text>
            </Pressable>
          </View>
        </GlassCard>

        {state.silentAccountabilityActive ? (
          <GlassCard style={styles.accountabilityCard} onPress={() => router.push('/account/behavior-core' as any)} highlightColor="#FFAA00">
            <Text style={styles.accountabilityTitle}>Momentum Reduced</Text>
            <Text style={styles.accountabilityText}>
              XP efficiency is {(state.xpEfficiency * 100).toFixed(0)}% until debt/discipline recovers.
            </Text>
            <Text style={styles.accountabilityMeta}>Reason: {(state.silentReason || 'system').replace(/_/g, ' ')}</Text>
          </GlassCard>
        ) : null}

        {streakWarningActive ? (
          <GlassCard style={styles.streakWarningCard} onPress={() => router.push('/(modals)/streak' as any)} highlightColor="#FF6A00">
            <Text style={styles.streakWarningTitle}>Streak check-in</Text>
            <Text style={styles.streakWarningText}>Less than 2 hours left today to keep your streak active.</Text>
          </GlassCard>
        ) : null}

	        <GlassCard onPress={() => router.push('/home/rank-details' as any)} style={styles.rankCard} highlightColor="#7C5CFF">
            <LinearGradient colors={rankTheme.gradient} start={{ x: 0.1, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFillObject} />
            <View style={[styles.rankAccent, { backgroundColor: rankTheme.accent }]} />
	          <View style={styles.rankRow}>
	            <Text style={styles.rankIcon}>{rank.icon}</Text>
	            <View style={{ flex: 1 }}>
	              <Text style={styles.rankName}>{rank.name}</Text>
	              <Text style={styles.rankHint}>{rank.subtitle}</Text>
	              <View style={styles.rankTrack}>
	                <View style={[styles.rankFill, { backgroundColor: rankTheme.accent, width: `${Math.min((rank.bandXp / rank.bandCapXp) * 100, 100)}%` }]} />
	              </View>
	            </View>
	            <View style={styles.xpBadge}>
	              <Text style={styles.xpValue}>{state.totalWinningDays}</Text>
	              <Text style={styles.xpLabel}>win days</Text>
	            </View>
	          </View>
	          <Text style={styles.rankNext}>
	            {rank.nextName
                ? `${Math.round(rank.bandXp)} / ${Math.round(rank.bandCapXp)} XP to ${rank.nextName}`
                : 'Top tier reached'}
	          </Text>
	        </GlassCard>

        <SectionHeader title="TODAY'S PROGRESS" actionLabel="Customize" onViewMore={() => router.push('/account/goals' as any)} />
        {state.targetConfidence !== 'HIGH' ? (
          <Pressable onPress={() => router.push('/account/manage-profile' as any)}>
            <Text style={styles.targetConfidenceText}>
              {state.targetConfidence === 'MEDIUM'
                ? 'Estimated targets. Add birthdate/sex for better accuracy.'
                : 'Targets unavailable. Finish profile to enable recommendations.'}
            </Text>
          </Pressable>
        ) : null}
        {state.targetWarnings.length > 0 ? <Text style={styles.targetWarningText}>{state.targetWarnings[0]}</Text> : null}

        <View style={styles.grid2x2}>
          <View style={styles.metricCell}>
            <MetricCard
              label='Calories'
              value={`${Math.round(state.calories)}${state.caloriesTarget ? ` / ${Math.round(state.caloriesTarget)}` : ''}`}
              hint='Today total'
              progress={state.caloriesTarget && state.caloriesTarget > 0 ? state.calories / state.caloriesTarget : 0}
              color='#FF7A18'
              icon="local-fire-department"
              onPress={() => router.push('/home/today-detail?focus=food' as any)}
              onLongPress={() => router.push('/(modals)/food' as any)}
            />
          </View>
          <View style={styles.metricCell}>
            <MetricCard
              label='Water'
              value={state.waterTargetOz ? `${Math.round(state.water)} / ${Math.round(state.waterTargetOz)} oz` : `${Math.round(state.water)} oz`}
              hint={state.waterTargetOz ? 'Hydration' : 'Finish onboarding for target'}
              progress={state.waterTargetOz && state.waterTargetOz > 0 ? state.water / state.waterTargetOz : 0}
              color='#22D3EE'
              icon="water-drop"
              onPress={() => router.push('/home/today-detail?focus=water' as any)}
              onLongPress={() => router.push('/(modals)/water' as any)}
            />
          </View>
          <View style={styles.metricCell}>
            <MetricCard
              label='Protein'
              value={state.proteinTarget ? `${Math.round(state.protein)} / ${Math.round(state.proteinTarget)} g` : `${Math.round(state.protein)} g`}
              hint={state.proteinTarget ? 'Macro focus' : 'Finish onboarding for target'}
              progress={state.proteinTarget && state.proteinTarget > 0 ? state.protein / state.proteinTarget : 0}
              color='#A855F7'
              icon="fitness-center"
              onPress={() => router.push('/home/today-detail?focus=food' as any)}
              onLongPress={() => router.push('/(modals)/food' as any)}
            />
          </View>
          <View style={styles.metricCell}>
            <MetricCard
              label='Activity'
              value={state.workoutsCount > 0 ? 'Workout logged' : `${state.restMinutes} min rest`}
              hint='Workout + recovery'
              progress={state.workoutsCount > 0 ? 1 : Math.min(1, state.restMinutes / state.activeRestTargetMin)}
              color='#34D399'
              icon="timer"
              onPress={() => router.push('/home/today-detail?focus=activity' as any)}
              onLongPress={() =>
                Alert.alert('Quick activity', 'Choose an action', [
                  { text: 'Log Workout', onPress: () => router.push('/(modals)/workout' as any) },
                  { text: 'Log Active Rest', onPress: () => router.push('/(modals)/rest' as any) },
                  { text: 'Cancel', style: 'cancel' },
                ])
              }
            />
          </View>
        </View>

	        <SectionHeader
            title='ACTIONS'
            actionLabel='Customize'
            onViewMore={() =>
              router.push(
                `/account/quick-actions?mode=${encodeURIComponent(quickActionPersonalizationMode)}&fallback=${encodeURIComponent(
                  quickActionFallbackReason || ''
                )}` as any
              )
            }
          />
          {quickActionFallbackReason ? (
            <Text style={styles.quickActionFallbackText}>{quickActionFallbackReason}</Text>
          ) : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actionsRow}>
            {quickActionItems.map((item: any) => (
              <Pressable
                key={item.id}
                onPress={item.onPress}
                style={({ pressed }) => [
                  styles.actionChip,
                  { borderColor: statsHighlightBorder(String(item?.colors?.[0] || NEON_THEME.color.neonCyan)) },
                  pressed && styles.actionChipPressed,
                ]}
              >
                <LinearGradient
                  pointerEvents="none"
                  colors={statsHighlightWash(String(item?.colors?.[0] || NEON_THEME.color.neonCyan))}
                  start={{ x: 0.1, y: 0.0 }}
                  end={{ x: 0.9, y: 1.0 }}
                  style={styles.actionChipBg}
                />
                <LinearGradient
                  pointerEvents="none"
                  colors={STATS_HIGHLIGHT_GLOSS}
                  start={{ x: 0.5, y: 0.0 }}
                  end={{ x: 0.5, y: 1.0 }}
                  style={styles.actionChipGloss}
                />
                <LinearGradient
                  pointerEvents="none"
                  colors={statsHighlightRail(String(item?.colors?.[0] || NEON_THEME.color.neonCyan))}
                  start={{ x: 0.5, y: 0.0 }}
                  end={{ x: 0.5, y: 1.0 }}
                  style={styles.actionChipRail}
                />
                <Text style={styles.actionEmoji}>{item.emoji}</Text>
                <Text style={styles.actionLabel} numberOfLines={2}>
                  {item.label}
                </Text>
                {typeof item.xp === 'number' && item.xp > 0 ? (
                  <Text style={styles.actionXp}>+{Math.round(item.xp)} XP</Text>
                ) : null}
              </Pressable>
            ))}
          </ScrollView>

        {aiInsights.length > 0 ? (
          <GlassCard style={styles.aiCard} highlightColor="#60A5FA">
            <View style={styles.aiHeaderRow}>
              <Text style={styles.aiTitle}>Coach Tip</Text>
              <View style={styles.aiHeaderActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={coachExpanded ? 'Collapse coach tip' : 'Expand coach tip'}
                  onPress={() => setCoachExpanded((v) => !v)}
                  style={({ pressed }) => [styles.aiIconButton, pressed && styles.aiIconButtonPressed]}
                >
                  <MaterialIcons name={coachExpanded ? 'expand-less' : 'expand-more'} size={20} color="#BFEFFF" />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss coach tip"
                  onPress={() => void dismissSurfaceInsights('home').then(() => setAiInsights([]))}
                  style={({ pressed }) => [styles.aiIconButton, pressed && styles.aiIconButtonPressed]}
                >
                  <MaterialIcons name="close" size={18} color="rgba(255,255,255,0.72)" />
                </Pressable>
              </View>
            </View>

            <Text style={styles.aiText} numberOfLines={coachExpanded ? undefined : 2}>
              {dedupeSentences(aiInsights[0].text)}
            </Text>

            {coachExpanded && aiInsights[0].evidenceSummary ? (
              <Text style={styles.aiMeta}>{dedupeSentences(aiInsights[0].evidenceSummary)}</Text>
            ) : null}
            {coachExpanded && String(aiInsights[0].confidenceLevel || '').toLowerCase() !== 'low' ? (
              <Text style={styles.aiMeta}>Confidence: {String(aiInsights[0].confidenceLevel || '').toUpperCase()}</Text>
            ) : null}

            {coachExpanded ? (
              <Pressable style={styles.aiLink} onPress={() => router.push('/(tabs)/profile' as any)}>
                <Text style={styles.aiLinkText}>Turn off AI Insights</Text>
              </Pressable>
            ) : null}
          </GlassCard>
        ) : null}
      </Animated.ScrollView>

      <Animated.View style={[styles.stickyHeader, stickyHeaderStyle]} pointerEvents="box-none">
        <View style={styles.stickyHeaderBase} pointerEvents="none" />
        <LinearGradient
          colors={['rgba(0,217,255,0.22)', 'rgba(0,0,0,0.0)']}
          start={{ x: 0.08, y: 0.0 }}
          end={{ x: 0.85, y: 1.0 }}
          style={styles.stickyHeaderGradient}
          pointerEvents="none"
        />
        <View style={styles.stickyHeaderContent} pointerEvents="auto">
          <View style={styles.stickyIdentityStack}>
            <Animated.View style={[styles.stickyIdentityExpanded, expandedIdentityStyle]} pointerEvents="none">
              <Text style={styles.welcome}>Welcome back,</Text>
              <Animated.Text style={[styles.name, nameAnimatedStyle]}>{state.name}</Animated.Text>
            </Animated.View>
            <Animated.View style={[styles.stickyIdentityCompact, compactIdentityStyle]} pointerEvents="none">
              <Text style={styles.compactWelcome}>Welcome back, {state.name}</Text>
            </Animated.View>
          </View>

          <Pressable
            onPress={() => router.push('/(modals)/streak' as any)}
            accessibilityRole="button"
            accessibilityLabel="Open streak details"
          >
            <Animated.View style={streakScaleStyle}>
              <StreakChip streak={state.currentStreak} />
            </Animated.View>
          </Pressable>
        </View>
      </Animated.View>
    </SafeAreaView>
  );
}

export default function DashboardTabScreen() {
  const { supabaseUserId } = useAuth();

  const [teamsModeEnabled, setTeamsModeEnabled] = useState(false);
  const [preferredTeamId, setPreferredTeamId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const loadMode = useCallback(async () => {
    setReady(false);
    try {
      const profile = await getUserProfile();
      const prefEnabled = Boolean((profile as any)?.preferences?.dashboardTeamsModeEnabled);
      const prefTeamIdRaw = (profile as any)?.preferences?.dashboardTeamsModeTeamId;
      const prefTeamId = typeof prefTeamIdRaw === 'string' ? prefTeamIdRaw : null;
      setPreferredTeamId(prefTeamId);

      if (!prefEnabled) {
        setTeamsModeEnabled(false);
        return;
      }

      const rawCoachReq = await AsyncStorage.getItem('teams:coach_access_requested_v1');
      const coachReq = rawCoachReq === 'true' || (rawCoachReq ? rawCoachReq.startsWith('{') : false);

      // If user is signed out and hasn't requested coach access, force back to the normal dashboard.
      if (!supabaseUserId && !coachReq) {
        setTeamsModeEnabled(false);
        return;
      }

      // If signed in, ensure there is still an eligible team membership; otherwise revert.
      if (supabaseUserId && isSupabaseConfigured) {
        try {
          const mine = await socialApi.getMyTeams(supabaseUserId);
          const rows = Array.isArray(mine) ? mine : [];
          if (rows.length === 0 && !coachReq) {
            setTeamsModeEnabled(false);
            // Persist the revert so the user does not get stuck in a broken Teams Mode state.
            try {
              await setStorageItem(USER_PROFILE_KEY, {
                ...profile,
                preferences: {
                  ...((profile as any)?.preferences || {}),
                  dashboardTeamsModeEnabled: false,
                  dashboardTeamsModeTeamId: null,
                },
              });
            } catch {
              // ignore; fallback dashboard remains available
            }
            return;
          }
        } catch {
          // If we can't verify eligibility, err on the safe side and show the normal dashboard.
          setTeamsModeEnabled(false);
          return;
        }
      }

      setTeamsModeEnabled(true);
    } finally {
      setReady(true);
    }
  }, [supabaseUserId]);

  useFocusEffect(
    useCallback(() => {
      void loadMode();
    }, [loadMode])
  );

  if (teamsModeEnabled && ready) {
    return <TeamsModeDashboard preferredTeamId={preferredTeamId} />;
  }

  return <LegacyDashboardScreen />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: NEON_THEME.color.bg0 },
  content: { padding: 16 },
  welcome: { color: NEON_THEME.color.textSecondary, fontWeight: '800', fontSize: 13 },
  name: { color: NEON_THEME.color.textPrimary, fontSize: 32, fontWeight: '900' },
  compactWelcome: { color: NEON_THEME.color.textPrimary, fontWeight: '900', fontSize: 14 },
  stickyHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 60,
    elevation: 22,
    overflow: 'hidden',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,217,255,0.12)',
  },
  stickyHeaderBase: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: NEON_THEME.color.bgTopTint,
    opacity: 0.98,
  },
  stickyHeaderGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  stickyHeaderContent: {
    flex: 1,
    paddingHorizontal: 16,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  stickyIdentityStack: { flex: 1, paddingRight: 12, position: 'relative', justifyContent: 'flex-end' },
  stickyIdentityExpanded: { alignSelf: 'flex-start' },
  stickyIdentityCompact: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  streakChip: {
    minHeight: 42,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 10,
  },
  streakFlameSlot: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  emberDot: {
    position: 'absolute',
    bottom: 2,
    left: 10,
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,214,10,0.95)',
  },
  flameGlow: { position: 'absolute', left: -1, top: -1 },
  flameHighlight: { position: 'absolute', left: 0, top: 0 },
  streakCountPill: {
    minWidth: 28,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(0,0,0,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  streakCountText: { color: '#F3FCFF', fontWeight: '900', fontSize: 13, letterSpacing: 0.2 },
  runStrip: { marginTop: 12 },
  runStripTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  runStripTitle: { color: '#FFF', fontSize: 14, fontWeight: '800' },
  runStripStatus: { color: '#9BD7EA', fontSize: 12, fontWeight: '700' },
  runStripMetrics: { color: '#D6EEF7', marginTop: 6, fontWeight: '700', fontSize: 12 },
  runStripHint: { color: '#9AB0BA', marginTop: 6, fontWeight: '600', fontSize: 11 },
  runStripLink: { marginTop: 8, alignSelf: 'flex-start' },
  runStripLinkText: { color: '#00D9FF', fontWeight: '800', fontSize: 12 },
  runStripButtons: { flexDirection: 'row', gap: 8, marginTop: 10 },
  runStripButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2F4A56',
    backgroundColor: '#13232A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  runStripEndButton: {
    borderColor: 'rgba(255,59,48,0.38)',
    backgroundColor: 'rgba(255,59,48,0.18)',
  },
  runStripButtonText: { color: '#EAF8FD', fontWeight: '800', fontSize: 13 },
  orphanBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
  },
  orphanCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#111111',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    padding: 16,
  },
  orphanTitle: { color: '#FFF', fontWeight: '900', fontSize: 18, marginBottom: 6 },
  orphanBody: { color: '#B9C8CF', fontWeight: '600', lineHeight: 18, marginBottom: 10 },
  orphanMeta: { color: '#D6EEF7', fontWeight: '700', marginBottom: 12 },
  orphanPrimary: {
    backgroundColor: '#00D9FF',
    borderRadius: 12,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orphanPrimaryText: { color: '#041A22', fontWeight: '900' },
  orphanSecondary: {
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2F4A56',
    backgroundColor: '#13232A',
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orphanSecondaryText: { color: '#EAF8FD', fontWeight: '900' },
  orphanDanger: {
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#4D2A2A',
    backgroundColor: '#2A1515',
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orphanDangerText: { color: '#FFD7D7', fontWeight: '900' },
  treadmillBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
  },
  treadmillCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#111111',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    padding: 16,
  },
  treadmillTitle: { color: '#FFF', fontWeight: '900', fontSize: 18, marginBottom: 6 },
  treadmillBody: { color: '#B9C8CF', fontWeight: '600', lineHeight: 18, marginBottom: 10 },
  treadmillInput: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    color: '#FFF',
    paddingHorizontal: 12,
    minHeight: 46,
    fontWeight: '800',
    marginBottom: 10,
  },
  treadmillQuickRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  treadmillQuick: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2F4A56',
    backgroundColor: '#13232A',
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  treadmillQuickText: { color: '#EAF8FD', fontWeight: '900', fontSize: 12 },
  treadmillPrimary: {
    backgroundColor: '#00D9FF',
    borderRadius: 12,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  treadmillPrimaryText: { color: '#041A22', fontWeight: '900' },
  treadmillSecondary: {
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2F4A56',
    backgroundColor: '#13232A',
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  treadmillSecondaryText: { color: '#EAF8FD', fontWeight: '900' },
  rankUpBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
  },
  rankUpCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(124,92,255,0.45)',
    backgroundColor: '#0F1114',
    padding: 18,
  },
  rankUpKicker: {
    color: '#BFEFFF',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  rankUpSymbolWrap: {
    marginTop: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankUpSymbol: { fontSize: 56, fontWeight: '900' },
  rankUpTitle: { marginTop: 8, fontSize: 27, fontWeight: '900' },
  rankUpBody: { marginTop: 8, color: '#B9C8CF', fontWeight: '700', lineHeight: 20 },
  rankUpPrimary: {
    marginTop: 14,
    minHeight: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#7C5CFF',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  rankUpPrimaryText: { color: '#FFFFFF', fontWeight: '900', fontSize: 14 },
  rankUpSecondary: {
    marginTop: 10,
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  rankUpSecondaryText: { color: '#D5EEF8', fontWeight: '900', fontSize: 13 },
  controlHealthCard: { marginTop: 10 },
  controlHealthTitle: { color: '#FFF', fontWeight: '800', fontSize: 13 },
  controlHealthText: { color: '#A9C8D3', marginTop: 4, fontSize: 12, fontWeight: '600' },
  controlHealthButton: {
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2D4956',
    backgroundColor: '#142126',
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlHealthButtonText: { color: '#D5EEF8', fontWeight: '800', fontSize: 12 },

  statusStrip: { marginTop: 12, flexDirection: 'row', gap: 12 },
  statusChip: {
    flex: 1,
    minHeight: 52,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingHorizontal: 12,
    paddingVertical: 12,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  statusChipWash: { ...StyleSheet.absoluteFillObject, opacity: 0.9 },
  statusChipXp: {
    borderColor: 'rgba(124,92,255,0.28)',
    backgroundColor: 'rgba(124,92,255,0.12)',
  },
  statusChipRank: {
    borderColor: 'rgba(124,92,255,0.22)',
  },
  statusChipReadyGood: {
    borderColor: 'rgba(0,255,136,0.22)',
    backgroundColor: 'rgba(0,255,136,0.07)',
  },
  statusChipReadyWarn: {
    borderColor: 'rgba(255,176,0,0.22)',
    backgroundColor: 'rgba(255,176,0,0.07)',
  },
  statusChipReadyDanger: {
    borderColor: 'rgba(255,68,102,0.22)',
    backgroundColor: 'rgba(255,68,102,0.07)',
  },
  statusChipPressed: { opacity: 0.96, transform: [{ scale: 0.995 }] },
  statusLabel: {
    color: 'rgba(255,255,255,0.62)',
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  statusValue: { color: '#FFFFFF', fontWeight: '900', marginTop: 4, fontSize: 13 },
  statusValueWarn: { color: '#FFB000' },
  statusValueDanger: { color: '#FF4466' },

  questCard: { marginTop: 12, borderColor: 'rgba(14,210,244,0.55)', backgroundColor: NEON_THEME.color.surface0 },
  questTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  questTitle: { color: NEON_THEME.color.textPrimary, fontWeight: '900', fontSize: 12, letterSpacing: 1.2 },
  questSubtitle: { color: NEON_THEME.color.textSecondary, fontWeight: '700', marginTop: 6, lineHeight: 18 },
  questRewardPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(14,210,244,0.55)',
    backgroundColor: 'rgba(14,210,244,0.18)',
  },
  questRewardText: { color: NEON_THEME.color.textPrimary, fontWeight: '900', fontSize: 12 },
  questTrack: { marginTop: 12, height: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.10)', overflow: 'hidden' },
  questFill: { height: 8, borderRadius: 999, backgroundColor: NEON_THEME.color.neonCyan },
  questList: { marginTop: 12, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  questRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  questRowPressed: { opacity: 0.96 },
  questRowBody: { flex: 1 },
  questRowHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  questRowTitle: { color: NEON_THEME.color.textPrimary, fontWeight: '900' },
  questRowValue: { color: NEON_THEME.color.textSecondary, fontWeight: '800', fontSize: 12 },
  questMiniTrack: {
    marginTop: 8,
    height: 6,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  questMiniFill: { height: 6, borderRadius: 999 },
  questCtas: { marginTop: 12, flexDirection: 'row', gap: 10 },
  questPrimaryCta: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(14,210,244,0.55)',
    backgroundColor: 'rgba(14,210,244,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  questPrimaryCtaText: { color: NEON_THEME.color.textPrimary, fontWeight: '900', fontSize: 13 },
  questSecondaryCta: {
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  questSecondaryCtaText: { color: NEON_THEME.color.textSecondary, fontWeight: '900', fontSize: 13 },
  questCtaPressed: { opacity: 0.92, transform: [{ scale: 0.99 }] },

  winCard: { marginTop: 8, padding: 0, overflow: 'hidden' },
  winGradient: { padding: 16, borderRadius: 20, flexDirection: 'row', gap: 12 },
  winLeft: { justifyContent: 'center' },
  winRing: { color: '#E8FEF4', fontSize: 24, fontWeight: '900' },
  winTitle: { color: '#FFF', fontSize: 15, fontWeight: '900', letterSpacing: 1.1 },
  winHint: { color: '#C9C9C9', fontSize: 12, marginTop: 4, fontWeight: '600' },
  winStatsRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  winStat: { color: '#E6E6E6', fontSize: 12, fontWeight: '700' },

  rankRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rankIcon: { fontSize: 26 },
  rankName: { color: '#FFF', fontSize: 18, fontWeight: '900' },
  rankHint: { color: '#A7A7A7', fontSize: 12, marginTop: 2, fontWeight: '600' },
	  rankTrack: { marginTop: 8, height: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
	  rankFill: { height: 8, borderRadius: 999, backgroundColor: '#00D9FF' },
  xpBadge: {
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(124,92,255,0.28)',
    backgroundColor: 'rgba(124,92,255,0.14)',
    alignItems: 'center',
  },
  xpValue: { color: '#FFF', fontWeight: '900' },
	  xpLabel: { color: '#AFAFAF', fontSize: 11, fontWeight: '600' },
	  rankNext: { color: '#91D5EC', fontSize: 11, fontWeight: '700', marginTop: 8 },
	  rankCard: { marginTop: 16, marginBottom: 12, overflow: 'hidden' },
	  rankAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, opacity: 0.85 },

  grid2x2: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 },
  targetConfidenceText: { color: NEON_THEME.color.textSecondary, fontWeight: '700', fontSize: 12, marginBottom: 4 },
  targetWarningText: { color: NEON_THEME.color.textTertiary, fontWeight: '600', fontSize: 11, marginBottom: 8 },
  metricCell: { width: '48%' },
  quickActionsGrid: { width: '100%' },
  quickActionsRow: { justifyContent: 'space-between' },
  quickActionsWrap: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  quickActionFallbackText: { color: NEON_THEME.color.neonOrange, fontWeight: '700', fontSize: 12, marginBottom: 8 },
  actionsRow: { gap: 12, paddingVertical: 8, paddingRight: 16 },
  actionChip: {
    width: 112,
    minHeight: 86,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: NEON_THEME.color.strokeSubtle,
    backgroundColor: NEON_THEME.color.surface0,
    paddingHorizontal: 12,
    paddingVertical: 12,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  actionChipBg: { ...StyleSheet.absoluteFillObject },
  actionChipGloss: { ...StyleSheet.absoluteFillObject, opacity: 0.55 },
  actionChipRail: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, opacity: 0.95 },
  actionChipPressed: { opacity: 0.96, transform: [{ scale: 0.995 }] },
  actionEmoji: { fontSize: 18 },
  actionLabel: { marginTop: 8, color: NEON_THEME.color.textPrimary, fontWeight: '900', fontSize: 12, textAlign: 'center', lineHeight: 16 },
  actionXp: { marginTop: 6, color: NEON_THEME.color.neonPurple, fontWeight: '900', fontSize: 11, letterSpacing: 0.2 },
  aiCard: { marginTop: 12, borderColor: 'rgba(34,211,238,0.22)' },
  aiHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  aiHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  aiIconButton: {
    width: 32,
    height: 32,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiIconButtonPressed: { opacity: 0.92, transform: [{ scale: 0.98 }] },
  aiTitle: { color: '#CBEAF4', fontWeight: '900', fontSize: 12, letterSpacing: 1 },
  aiText: { color: '#F3FCFF', marginTop: 8, fontWeight: '700', lineHeight: 18 },
  aiMeta: { color: '#86A6B0', marginTop: 6, fontWeight: '600', fontSize: 11 },
  aiLink: { marginTop: 8, alignSelf: 'flex-start' },
  aiLinkText: { color: '#8EDFFF', fontWeight: '700', fontSize: 12 },
  accountabilityCard: { marginTop: 12, borderColor: '#56442A' },
  accountabilityTitle: { color: '#FFE8C6', fontWeight: '800', fontSize: 12, letterSpacing: 1 },
  accountabilityText: { color: '#F7EBD9', marginTop: 6, fontWeight: '700' },
  accountabilityMeta: { color: '#C7B091', marginTop: 4, fontSize: 11, fontWeight: '600' },
  debtCard: { marginTop: 16, marginBottom: 12, borderColor: '#2D4A57', overflow: 'hidden' },
	  debtCardNeutral: { borderColor: 'rgba(255,255,255,0.08)', backgroundColor: 'rgba(20,20,20,0.86)' },
	  debtCardAlert: { borderColor: '#5B4125' },
	  debtAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, opacity: 0.85 },
	  debtRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  debtTitle: { color: '#CDECF7', fontWeight: '800', fontSize: 12, letterSpacing: 1 },
  debtTier: { color: '#8FDBFF', fontWeight: '800', fontSize: 11 },
  debtValue: { color: '#F1FCFF', fontWeight: '900', fontSize: 24, marginTop: 6 },
  debtBody: { color: '#C7E0E9', marginTop: 6, fontWeight: '700' },
  debtMemory: { color: '#8FB4C0', marginTop: 6, fontSize: 11, fontWeight: '600' },
  streakWarningCard: { marginTop: 10, borderColor: '#4A3F29' },
  streakWarningTitle: { color: '#FFE5B8', fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  streakWarningText: { color: '#F1E5CF', marginTop: 6, fontWeight: '700' },
});
