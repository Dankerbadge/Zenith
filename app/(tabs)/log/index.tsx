import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, LayoutAnimation, Platform, Pressable, ScrollView, StyleSheet, Text, UIManager, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getDailyLog, getUserProfile, safeParseJson, WEIGHT_LOG_KEY, WorkoutEntry } from "@/utils/storageUtils";
import { evaluateWinningDay } from "@/utils/winningSystem";
import { subscribeDailyLogChanged } from "@/utils/dailyLogEvents";
import Badge from "@/components/ui/Badge";

type Gradient2 = readonly [string, string];
type CardKey = "food" | "workout" | "water" | "weight" | "rest";
type Snapshot = {
  calories: number;
  protein: number;
  water: number;
  workoutsCount: number;
  activeRestMinutes: number;
  weight?: number;
};

type DashboardState = {
  calories: number;
  protein: number;
  water: number;
  workoutsCount: number;
  activeRestMinutes: number;
  weight?: number;
  weightTrend?: number;
  proteinTarget: number;
  waterTargetOz: number;
  activeRestTargetMin: number;
  caloriesTarget?: number;
  winningDay: boolean;
};

type RecentDay = {
  date: string;
  sessions: WorkoutEntry[];
  totalSets: number;
  totalVolume: number;
  totalDurationMin: number;
  runDistanceMiles: number;
};

const DEFAULT_STATE: DashboardState = {
  calories: 0,
  protein: 0,
  water: 0,
  workoutsCount: 0,
  activeRestMinutes: 0,
  weight: undefined,
  weightTrend: undefined,
  proteinTarget: 170,
  waterTargetOz: 120,
  activeRestTargetMin: 20,
  caloriesTarget: undefined,
  winningDay: false,
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const formatKcal = (n: number) => `${Math.round(n).toLocaleString()} kcal`;
const formatNumber = (n: number) => `${Math.round(n).toLocaleString()}`;
const go = (href: string) => router.push(href as any);
const dateKey = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const METERS_PER_MILE = 1609.344;

function dateFromKey(key: string): Date | null {
  const [y, m, d] = String(key).split('-').map((v) => Number(v));
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function formatDayLabel(key: string) {
  const date = dateFromKey(key);
  if (!date) return key;
  try {
    return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  } catch {
    return key;
  }
}

function isRunSession(session: any) {
  const workoutClass = String(session?.workoutClass || '').toLowerCase();
  const type = String(session?.type || '').toLowerCase();
  return workoutClass === 'run' || type === 'running';
}

function sessionDurationMin(session: any): number {
  const value = Number(session?.durationMin ?? session?.minutes ?? session?.duration ?? 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value);
}

function runDistanceMiles(session: any): number {
  const directMiles = Number(session?.distanceMiles);
  if (Number.isFinite(directMiles) && directMiles > 0) return directMiles;

  const raw = Number(session?.distance);
  if (!Number.isFinite(raw) || raw <= 0) return 0;

  const unit = String(session?.distanceUnit || session?.unit || '').toLowerCase();
  if (unit === 'meter' || unit === 'meters' || unit === 'm') return raw / METERS_PER_MILE;
  if (unit === 'km' || unit === 'kilometer' || unit === 'kilometers') return raw / 1.609344;

  // Defensive heuristic: if a run "distance" is huge, it's almost always meters.
  if (raw > 500) return raw / METERS_PER_MILE;
  return raw;
}

function formatMiles(miles: number) {
  if (!Number.isFinite(miles) || miles <= 0) return '—';
  const m = Math.max(0, miles);
  if (m < 10) return `${m.toFixed(1)} mi`;
  if (m < 20) return `${m.toFixed(1)} mi`;
  return `${m.toFixed(0)} mi`;
}

function getWeightTrend(weightLog: any[]): number | undefined {
  const validEntries = weightLog
    .filter((entry) => typeof entry?.weight === "number" && entry?.ts)
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

  if (validEntries.length < 2) return undefined;
  return validEntries[0].weight - validEntries[1].weight;
}

function ProgressBar({ value }: { value: number }) {
  const widthAnim = useRef(new Animated.Value(clamp01(value))).current;

  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: clamp01(value),
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [value, widthAnim]);

  return (
    <View style={styles.progressTrack}>
      <Animated.View
        style={[
          styles.progressFill,
          {
            width: widthAnim.interpolate({
              inputRange: [0, 1],
              outputRange: ["0%", "100%"],
            }),
          },
        ]}
      />
    </View>
  );
}

function Pill({
  text,
  tone = "neutral",
}: {
  text: string;
  tone?: "neutral" | "good" | "warn";
}) {
  return (
    <View
      style={[
        styles.pill,
        tone === "good" ? styles.pillGood : tone === "warn" ? styles.pillWarn : styles.pillNeutral,
      ]}
    >
      <Text style={styles.pillText}>{text}</Text>
    </View>
  );
}

function MetricRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <View style={styles.metricRow}>
      <Text style={styles.metricLabel}>{label}</Text>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={styles.metricValue}>{value}</Text>
        {hint ? <Text style={styles.metricHint}>{hint}</Text> : null}
      </View>
    </View>
  );
}

function LogCard({
  emoji,
  title,
  subtitle,
  colors,
  pill,
  pillTone,
  progress,
  progressText,
  metrics,
  footer,
  onPress,
  flashToken,
}: {
  emoji: string;
  title: string;
  subtitle: string;
  colors: Gradient2;
  pill: string;
  pillTone?: "neutral" | "good" | "warn";
  progress: number;
  progressText: string;
  metrics: { label: string; value: string; hint?: string }[];
  footer: string;
  onPress: () => void;
  flashToken: number;
}) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (flashToken <= 0) return;

    Animated.sequence([
      Animated.timing(pulse, {
        toValue: 1,
        duration: 160,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(pulse, {
        toValue: 0,
        duration: 180,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }, [flashToken, pulse]);

  const scale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.02],
  });

  const glowOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.09],
  });

  return (
    <Animated.View style={[styles.cardWrap, { transform: [{ scale }] }]}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.cardPressable, pressed && { transform: [{ scale: 0.985 }], opacity: 0.985 }]}
      >
        <LinearGradient colors={colors} style={styles.card}>
          <Animated.View pointerEvents="none" style={[styles.cardPulseOverlay, { opacity: glowOpacity }]} />
          <View style={styles.cardHeader}>
            <Text style={styles.emoji}>{emoji}</Text>

            <View style={{ flex: 1 }}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>{title}</Text>
                <Pill text={pill} tone={pillTone} />
              </View>
              <Text style={styles.cardSubtitle}>{subtitle}</Text>
            </View>

            <Text style={styles.arrow}>→</Text>
          </View>

          <View style={{ marginTop: 12 }}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressLabel}>Progress</Text>
              <Text style={styles.progressText}>{progressText}</Text>
            </View>
            <ProgressBar value={progress} />
          </View>

          <View style={styles.metricsBox}>
            {metrics.map((m, i) => (
              <View key={`${m.label}-${i}`} style={i > 0 ? styles.metricDivider : undefined}>
                <MetricRow {...m} />
              </View>
            ))}
          </View>

          <Text style={styles.footer}>{footer}</Text>
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

function RotatingChevron({ open, muted }: { open: boolean; muted?: boolean }) {
  const anim = useRef(new Animated.Value(open ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: open ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [open, anim]);

  const rotate = anim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] });

  return (
    <Animated.Text style={[styles.dayChevron, muted && styles.dayChevronEmpty, { transform: [{ rotate }] }]}>›</Animated.Text>
  );
}

export default function LogIndex() {
  const [state, setState] = useState<DashboardState>(DEFAULT_STATE);
  const [flashTokens, setFlashTokens] = useState<Record<CardKey, number>>({
    food: 0,
    workout: 0,
    water: 0,
    weight: 0,
    rest: 0,
  });
  const [recentDays, setRecentDays] = useState<RecentDay[]>([]);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const lastSnapshotRef = useRef<Snapshot | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === 'android' && typeof UIManager.setLayoutAnimationEnabledExperimental === 'function') {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  const refresh = useCallback(async () => {
    const date = dateKey();
    const dateList = Array.from({ length: 7 }, (_, i) => dateKey(new Date(Date.now() - i * 24 * 60 * 60 * 1000)));
    const [log, profile, rawWeightLog, dayLogs] = await Promise.all([
      getDailyLog(date),
      getUserProfile(),
      AsyncStorage.getItem(WEIGHT_LOG_KEY),
      Promise.all(dateList.map((d) => getDailyLog(d))),
    ]);

    const goals = profile.goals || {};
    const proteinTarget = goals.proteinTarget ?? 170;
    const waterTargetOz = goals.waterTargetOz ?? 120;
    const activeRestTargetMin = goals.activeRestTargetMin ?? 20;
    const caloriesTarget = goals.caloriesTarget;

    const workouts = Array.isArray(log.workouts) ? log.workouts : [];
    const activeRest = Array.isArray(log.activeRest) ? log.activeRest : [];
    const workoutsCount = workouts.length;
    const activeRestMinutes = activeRest.reduce((sum, entry) => sum + (Number(entry?.minutes) || 0), 0);
    const calories = Number(log.calories) || 0;
    const protein = Number(log.macros?.protein) || 0;
    const water = Number(log.water) || 0;
    const weight = typeof log.weight === "number" ? log.weight : undefined;

    let weightLog: any[] = [];
    if (Array.isArray(profile.weightLog)) {
      weightLog = profile.weightLog;
    } else if (rawWeightLog) {
      const parsed = safeParseJson<unknown[]>(rawWeightLog, []);
      weightLog = Array.isArray(parsed) ? parsed : [];
    }

    const winningDay = evaluateWinningDay(log, {
      activeRestTargetMin,
      caloriesTarget,
    }).winningDay;

    const nextSnapshot: Snapshot = {
      calories,
      protein,
      water,
      workoutsCount,
      activeRestMinutes,
      weight,
    };

    const previousSnapshot = lastSnapshotRef.current;
    if (previousSnapshot) {
      const changed: CardKey[] = [];
      if (nextSnapshot.calories !== previousSnapshot.calories || nextSnapshot.protein !== previousSnapshot.protein) {
        changed.push("food");
      }
      if (nextSnapshot.water !== previousSnapshot.water) changed.push("water");
      if (nextSnapshot.workoutsCount !== previousSnapshot.workoutsCount) changed.push("workout");
      if (nextSnapshot.activeRestMinutes !== previousSnapshot.activeRestMinutes) changed.push("rest");
      if (nextSnapshot.weight !== previousSnapshot.weight) changed.push("weight");

      if (changed.length) {
        setFlashTokens((prev) => {
          const next = { ...prev };
          changed.forEach((key) => {
            next[key] = prev[key] + 1;
          });
          return next;
        });
      }
    }

    lastSnapshotRef.current = nextSnapshot;

    const weekRows: RecentDay[] = dateList.map((d, idx) => {
      const dayLog = dayLogs[idx] || {};
      const sessions = (Array.isArray(dayLog.workouts) ? dayLog.workouts : []) as WorkoutEntry[];
      const totalSets = sessions.reduce((sum, session) => sum + (Number(session.totalSets) || 0), 0);
      const totalVolume = sessions.reduce((sum, session) => sum + (Number(session.totalVolume) || 0), 0);
      const totalDurationMin = sessions.reduce((sum, session) => sum + sessionDurationMin(session as any), 0);
      const runDistanceMilesSum = sessions.reduce((sum, session) => (isRunSession(session) ? sum + runDistanceMiles(session) : sum), 0);
      return { date: d, sessions, totalSets, totalVolume, totalDurationMin, runDistanceMiles: runDistanceMilesSum };
    });
    setRecentDays(weekRows);
    setExpandedDay((prev) => {
      if (prev && weekRows.some((row) => row.date === prev)) return prev;
      const firstSessionDay = weekRows.find((row) => row.sessions.length > 0);
      return firstSessionDay?.date || null;
    });

    if (!isMountedRef.current) return;
    setState({
      calories,
      protein,
      water,
      workoutsCount,
      activeRestMinutes,
      weight,
      weightTrend: getWeightTrend(weightLog),
      proteinTarget,
      waterTargetOz,
      activeRestTargetMin,
      caloriesTarget: typeof caloriesTarget === "number" ? caloriesTarget : undefined,
      winningDay,
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      // No skeleton needed: keep UI stable and animate values after refresh.
      void refresh();
    }, [refresh])
  );

  useEffect(() => {
    const unsubscribe = subscribeDailyLogChanged((changedDate) => {
      if (changedDate === dateKey()) {
        void refresh();
      }
    });
    return unsubscribe;
  }, [refresh]);

  useEffect(() => {
    let alive = true;
    let timeout: any;

    const scheduleMidnightRefresh = () => {
      if (!alive) return;
      const now = new Date();
      const nextMidnight = new Date(now);
      nextMidnight.setHours(24, 0, 2, 0);
      const ms = Math.max(1000, nextMidnight.getTime() - now.getTime());
      timeout = setTimeout(() => {
        void refresh();
        scheduleMidnightRefresh();
      }, ms);
    };

    scheduleMidnightRefresh();
    return () => {
      alive = false;
      if (timeout) clearTimeout(timeout);
    };
  }, [refresh]);

  const {
    calories,
    protein,
    water,
    workoutsCount,
    activeRestMinutes,
    weight,
    weightTrend,
    proteinTarget,
    waterTargetOz,
    activeRestTargetMin,
    winningDay,
  } = state;

  const proteinLeft = Math.max(0, proteinTarget - protein);
  const waterLeft = Math.max(0, waterTargetOz - water);
  const activeRestLeft = Math.max(0, activeRestTargetMin - activeRestMinutes);
  const workoutsDone = workoutsCount > 0;
  const activeRestComplete = activeRestMinutes >= activeRestTargetMin;
  const weightLogged = typeof weight === "number";
  const weightTrendText =
    typeof weightTrend === "number" ? `${weightTrend > 0 ? "+" : ""}${weightTrend.toFixed(1)} lb` : "No trend yet";

  const foodSubtitle = protein >= proteinTarget ? "Protein on track" : protein > 0 ? "Add a protein win" : "Start with one meal";
  const waterSubtitle =
    water >= waterTargetOz
      ? "Hydration complete"
      : water >= waterTargetOz * 0.5
      ? "Halfway there"
      : water > 0
      ? "Keep sipping"
      : "Start with a glass";
  const workoutSubtitle = workoutsDone ? "Logged for today" : "Any movement counts";
  const restSubtitle = activeRestComplete ? "Recovery complete" : activeRestMinutes > 0 ? "Recovery counts" : "Mobility wins too";
  const weightSubtitle = weightLogged ? "Trend > single day" : "Log a weigh-in";

  const headerBadge = useMemo(() => {
    if (!winningDay) return null;
    return (
      <View style={styles.winBadge}>
        <Text style={styles.winBadgeText}>✓</Text>
      </View>
    );
  }, [winningDay]);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <Text style={styles.h1}>Quick Log</Text>
          {headerBadge}
        </View>
        <Text style={styles.h2}>Tap to log — opens a modal</Text>

        <View style={styles.list}>
          <LogCard
            emoji="🍎"
            title="Log Food"
            subtitle={foodSubtitle}
            colors={["#FF7A18", "#F59E0B"]}
            pill={proteinLeft > 0 ? `${formatNumber(proteinLeft)}g protein left` : "Protein target hit"}
            pillTone={proteinLeft > 0 ? "warn" : "good"}
            progress={protein / proteinTarget}
            progressText={`${formatNumber(protein)} / ${formatNumber(proteinTarget)} g`}
            metrics={[
              { label: "Calories Today", value: calories > 0 ? formatKcal(calories) : "Not logged yet", hint: "Total consumed" },
              { label: "Protein", value: `${formatNumber(protein)}g` },
            ]}
            footer="Open →"
            onPress={() => go("/(modals)/food")}
            flashToken={flashTokens.food}
          />

          <LogCard
            emoji="💪"
            title="Log Workout"
            subtitle={workoutSubtitle}
            colors={["#A855F7", "#4E5BFF"]}
            pill={workoutsDone ? `${workoutsCount} logged` : "No workout yet"}
            pillTone={workoutsDone ? "good" : "warn"}
            progress={workoutsDone ? 1 : 0}
            progressText={`${Math.min(workoutsCount, 1)} / 1`}
            metrics={[
              { label: "Sessions", value: workoutsDone ? formatNumber(workoutsCount) : "Not logged yet", hint: "Any intensity counts" },
              { label: "Status", value: workoutsDone ? "Logged" : "Not logged yet" },
            ]}
            footer="Open →"
            onPress={() => go("/(modals)/workout")}
            flashToken={flashTokens.workout}
          />

          <LogCard
            emoji="💧"
            title="Log Water"
            subtitle={waterSubtitle}
            colors={["#22D3EE", "#0EA5E9"]}
            pill={waterLeft > 0 ? `${formatNumber(waterLeft)} oz left` : "Hydration target hit"}
            pillTone={waterLeft > 0 ? "warn" : "good"}
            progress={water / waterTargetOz}
            progressText={`${formatNumber(water)} / ${formatNumber(waterTargetOz)} oz`}
            metrics={[
              { label: "Consumed", value: water > 0 ? `${formatNumber(water)} oz` : "Not logged yet", hint: `Goal ${formatNumber(waterTargetOz)} oz` },
              { label: "Status", value: waterLeft > 0 ? "In progress" : "Complete" },
            ]}
            footer="Open →"
            onPress={() => go("/(modals)/water")}
            flashToken={flashTokens.water}
          />

          <LogCard
            emoji="⚖️"
            title="Log Weight"
            subtitle={weightSubtitle}
            colors={["#7A2BE2", "#FF2AA0"]}
            pill={weightTrendText}
            pillTone={typeof weightTrend === "number" ? (weightTrend <= 0 ? "good" : "warn") : "neutral"}
            progress={weightLogged ? 1 : 0}
            progressText={weightLogged ? "Logged today" : "Not logged"}
            metrics={[
              { label: "Current", value: weightLogged ? `${weight!.toFixed(1)} lb` : "Not logged yet", hint: "Morning fasted best" },
              { label: "Trend", value: weightTrendText },
            ]}
            footer="Open →"
            onPress={() => go("/(modals)/weight")}
            flashToken={flashTokens.weight}
          />

          <LogCard
            emoji="🧘"
            title="Log Active Rest"
            subtitle={restSubtitle}
            colors={["#34D399", "#10B981"]}
            pill={activeRestComplete ? "Recovery complete" : `${formatNumber(activeRestLeft)} min to win`}
            pillTone={activeRestComplete ? "good" : "warn"}
            progress={activeRestMinutes / activeRestTargetMin}
            progressText={`${formatNumber(activeRestMinutes)} / ${formatNumber(activeRestTargetMin)} min`}
            metrics={[
              { label: "Completed", value: activeRestMinutes > 0 ? `${formatNumber(activeRestMinutes)} min` : "Not logged yet", hint: "Stack throughout day" },
              { label: "Status", value: activeRestComplete ? "Complete" : "In progress" },
            ]}
            footer="Open →"
            onPress={() => go("/(modals)/rest")}
            flashToken={flashTokens.rest}
          />
        </View>

        <View style={styles.historyWrap}>
          <Text style={styles.historyTitle}>Recent Sessions (7 days)</Text>
          {recentDays.map((day) => {
            const isOpen = expandedDay === day.date;
            const dayHasSessions = day.sessions.length > 0;
            const dayLabel = formatDayLabel(day.date);
            const meta = dayHasSessions
              ? `${day.sessions.length} session${day.sessions.length === 1 ? '' : 's'} · ${day.totalDurationMin > 0 ? `${day.totalDurationMin} min` : `${day.totalSets} sets`}`
              : 'Rest day';
            const rightMetric = dayHasSessions
              ? day.runDistanceMiles > 0
                ? formatMiles(day.runDistanceMiles)
                : day.totalVolume > 0
                ? `${Math.round(day.totalVolume).toLocaleString()} vol`
                : day.totalDurationMin > 0
                ? `${day.totalDurationMin} min`
                : `${day.totalSets} sets`
              : '';
            return (
              <View key={day.date} style={[styles.dayCard, !dayHasSessions && styles.dayCardEmpty]}>
                <LinearGradient
                  pointerEvents="none"
                  colors={
                    dayHasSessions
                      ? ['rgba(0,217,255,0.26)', 'rgba(0,217,255,0.10)', 'rgba(0,0,0,0)']
                      : ['rgba(124,92,255,0.20)', 'rgba(124,92,255,0.08)', 'rgba(0,0,0,0)']
                  }
                  start={{ x: 0.1, y: 0.0 }}
                  end={{ x: 0.9, y: 1.0 }}
                  style={styles.dayCardWash}
                />
                <View pointerEvents="none" style={styles.timelineLine} />
                <View pointerEvents="none" style={[styles.timelineDot, !dayHasSessions && styles.timelineDotEmpty]} />

                <Pressable
                  style={({ pressed }) => [styles.dayHeader, pressed && dayHasSessions && styles.dayHeaderPressed]}
                  onPress={() => {
                    if (!dayHasSessions) return;
                    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                    void Haptics.selectionAsync().catch(() => {});
                    setExpandedDay((prev) => (prev === day.date ? null : day.date));
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.dayDate, !dayHasSessions && styles.dayDateEmpty]}>{dayLabel}</Text>
                    <Text style={[styles.dayMeta, !dayHasSessions && styles.dayMetaEmpty]}>{meta}</Text>
                  </View>
                  <View style={styles.dayHeaderRight}>
                    {rightMetric ? <Text style={styles.dayVolume}>{rightMetric}</Text> : null}
                    {dayHasSessions ? <RotatingChevron open={isOpen} /> : null}
                  </View>
                </Pressable>
                {isOpen ? (
                  <View style={styles.sessionsList}>
                    {dayHasSessions ? (
                      day.sessions.map((session, idx) => {
                        const isRun = isRunSession(session);
                        const recovered = (session as any)?.sessionRecovered === true;
                        const resolvedRunId = String((session as any)?.runId || session?.id || '').trim();
                        const resolvedTimestamp = String((session as any)?.time || (session as any)?.ts || '').trim();

                        const open = () => {
                          void Haptics.selectionAsync().catch(() => {});
                          if (isRun) {
                            const qs = resolvedRunId
                              ? `runId=${encodeURIComponent(resolvedRunId)}`
                              : resolvedTimestamp
                              ? `timestamp=${encodeURIComponent(resolvedTimestamp)}`
                              : '';
                            if (!qs) {
                              return;
                            }
                            go(`/run-summary?${qs}`);
                            return;
                          }
                          if (!session?.id) return;
                          go(`/(modals)/workout-session?date=${encodeURIComponent(day.date)}&sessionId=${encodeURIComponent(session.id)}`);
                        };

                        const distanceMiles = isRun ? runDistanceMiles(session) : 0;
                        const durationMin = sessionDurationMin(session);
                        const intensity = String((session as any)?.intensity || '').toLowerCase();
                        const intensityTone = intensity === 'hard' ? 'warning' : intensity === 'easy' ? 'muted' : 'accent';
                        const icon = isRun ? '🏃' : String((session as any)?.type || '').toLowerCase() === 'mobility' ? '🧘' : '🏋️';
                        const title = isRun ? 'Run' : String(session.label || (session as any)?.type || 'Workout');
                        const stats = isRun
                          ? `${durationMin > 0 ? `${durationMin} min` : '—'} · ${distanceMiles > 0 ? formatMiles(distanceMiles) : '—'}`
                          : `${Number(session.totalSets) || 0} sets · ${Math.round(Number(session.totalVolume) || 0).toLocaleString()} vol${
                              durationMin > 0 ? ` · ${durationMin} min` : ''
                            }`;

                        return (
                        <Pressable
                          key={session?.id || `${day.date}_${idx}`}
                          style={({ pressed }) => [styles.sessionRow, pressed && styles.sessionRowPressed]}
                          onPress={open}
                          disabled={isRun ? !resolvedRunId && !resolvedTimestamp : !session?.id}
                        >
                          <Text style={styles.sessionIcon}>{icon}</Text>
                          <View style={{ flex: 1 }}>
                            <View style={styles.sessionTitleRow}>
                              <Text style={styles.sessionTitle} numberOfLines={1}>
                                {title}
                              </Text>
                              {intensity ? <Badge label={intensity} tone={intensityTone as any} /> : null}
                              {recovered ? <Badge label="Recovered" tone="warning" /> : null}
                            </View>
                            <Text style={styles.sessionMeta} numberOfLines={1}>
                              {stats}
                            </Text>
                          </View>
                          <Text style={styles.sessionChevron}>›</Text>
                        </Pressable>
                        );
                      })
                    ) : (
                      <Text style={styles.emptySessionText}>No sessions logged</Text>
                    )}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0A0A0A" },
  scroll: { padding: 16, paddingBottom: 120 },

  headerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  h1: { color: "#FFF", fontSize: 42, fontWeight: "800" },
  h2: { color: "#999", marginTop: 6 },

  winBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "rgba(0,255,136,0.25)",
    borderWidth: 1,
    borderColor: "rgba(0,255,136,0.65)",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  winBadgeText: { color: "#D2FFE9", fontSize: 12, fontWeight: "900" },

  list: { marginTop: 16, gap: 16 },
  historyWrap: { marginTop: 18, gap: 10 },
  historyTitle: { color: "#FFF", fontWeight: "800", fontSize: 18 },
  dayCard: {
    position: "relative",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.02)",
    overflow: "hidden",
  },
  dayCardWash: { ...StyleSheet.absoluteFillObject, opacity: 0.9 },
  dayCardEmpty: {
    borderColor: "rgba(255,255,255,0.04)",
    backgroundColor: "rgba(255,255,255,0.01)",
  },
  timelineLine: { position: "absolute", left: 16, top: 0, bottom: 0, width: 2, backgroundColor: "rgba(255,255,255,0.06)" },
  timelineDot: {
    position: "absolute",
    left: 12,
    top: 18,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: "rgba(0,217,255,0.70)",
    backgroundColor: "rgba(0,217,255,0.40)",
  },
  timelineDotEmpty: { borderColor: "rgba(255,255,255,0.20)", backgroundColor: "rgba(255,255,255,0.10)" },

  dayHeader: { paddingVertical: 12, paddingRight: 12, paddingLeft: 28, flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 58 },
  dayHeaderPressed: { backgroundColor: "rgba(255,255,255,0.03)" },
  dayDate: { color: "#E7F8FF", fontWeight: "800" },
  dayDateEmpty: { color: "#9CB3BD" },
  dayMeta: { color: "#8CB8C8", fontSize: 12, fontWeight: "700", marginTop: 2 },
  dayMetaEmpty: { color: "#6F858E" },
  dayVolume: { color: "#D4EAF3", fontWeight: "800", fontSize: 12 },
  dayVolumeEmpty: { color: "#7E929A" },
  dayHeaderRight: { alignItems: "flex-end", gap: 4 },
  dayChevron: { color: "#CFEAF4", fontWeight: "900", fontSize: 18 },
  dayChevronEmpty: { color: "#6E8088" },
  sessionsList: { borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)" },
  sessionRow: {
    paddingRight: 12,
    paddingLeft: 28,
    paddingVertical: 10,
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
  },
  sessionRowPressed: { backgroundColor: "rgba(255,255,255,0.03)" },
  sessionIcon: { width: 24, textAlign: "center", fontSize: 16 },
  sessionTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  sessionTitle: { color: "#FFF", fontWeight: "700", fontSize: 12, flexShrink: 1 },
  sessionMeta: { color: "#A8C3CF", fontWeight: "600", fontSize: 11, marginTop: 2 },
  sessionChevron: { color: "#CFEAF4", fontSize: 16, fontWeight: "900" },
  emptySessionText: { color: "#9EB2BC", fontWeight: "600", paddingRight: 12, paddingLeft: 28, paddingVertical: 10, fontSize: 12 },

  cardWrap: { borderRadius: 22, overflow: "hidden" },
  cardPressable: { borderRadius: 22, overflow: "hidden" },
  card: { padding: 16, borderRadius: 22 },
  cardPulseOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#FFFFFF",
  },

  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  emoji: { fontSize: 30 },
  cardTitleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  cardTitle: { color: "#FFF", fontSize: 20, fontWeight: "800" },
  cardSubtitle: { color: "rgba(255,255,255,0.85)", fontSize: 13, marginTop: 4 },
  arrow: { color: "#FFF", fontSize: 24, fontWeight: "900" },

  progressHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  progressLabel: { color: "#FFF", fontSize: 12, fontWeight: "800" },
  progressText: { color: "#FFF", fontSize: 12, fontWeight: "800" },

  progressTrack: { height: 8, backgroundColor: "rgba(0,0,0,0.25)", borderRadius: 999, overflow: "hidden" },
  progressFill: { height: 8, backgroundColor: "#FFF", borderRadius: 999 },

  metricsBox: { marginTop: 12, backgroundColor: "rgba(0,0,0,0.2)", borderRadius: 14, overflow: "hidden" },
  metricDivider: { borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)" },
  metricRow: { padding: 10, flexDirection: "row", justifyContent: "space-between", gap: 12 },
  metricLabel: { color: "#FFF", fontSize: 12, fontWeight: "800" },
  metricValue: { color: "#FFF", fontSize: 12, fontWeight: "900" },
  metricHint: { color: "rgba(255,255,255,0.65)", fontSize: 11, marginTop: 3, fontWeight: "700" },

  footer: { marginTop: 10, color: "rgba(0,0,0,0.70)", fontWeight: "900" },

  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  pillText: { color: "#FFF", fontSize: 11, fontWeight: "900" },
  pillNeutral: { backgroundColor: "rgba(255,255,255,0.1)", borderColor: "rgba(255,255,255,0.2)" },
  pillGood: { backgroundColor: "rgba(0,255,136,0.2)", borderColor: "rgba(0,255,136,0.4)" },
  pillWarn: { backgroundColor: "rgba(255,176,0,0.2)", borderColor: "rgba(255,176,0,0.4)" },
});
