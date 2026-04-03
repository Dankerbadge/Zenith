import { Redirect, router } from 'expo-router'; import React, { useCallback, useMemo, useState } from 'react'; import { useFocusEffect } from '@react-navigation/native'; import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../components/ui/GlassCard';
import SectionHeader from '../../components/ui/SectionHeader';
import { computeAchievementMetrics, type AchievementMetrics } from '../../utils/achievementsEngine';
import { APP_CONFIG } from '../../utils/appConfig';
import { captureException } from '../../utils/crashReporter';

type ChallengeWindow = 'week' | 'lifetime';

type ChallengeDef = {
  id: string;
  title: string;
  description: string;
  window: ChallengeWindow;
  metricKey: string;
  target: number;
  unit: 'count' | 'min';
};

const CHALLENGES: ChallengeDef[] = [
  {
    id: 'winning-streak-7',
    title: 'Winning Streak',
    description: 'Keep your winning-day streak alive for 7 days.',
    window: 'lifetime',
    metricKey: 'winning_day_streak_current',
    target: 7,
    unit: 'count',
  },
  {
    id: 'workouts-3-week',
    title: '3 Workouts (7D)',
    description: 'Log 3 workouts in the last 7 days.',
    window: 'week',
    metricKey: 'workouts_total',
    target: 3,
    unit: 'count',
  },
  {
    id: 'walk-60-min-week',
    title: '60 Minutes Walking (7D)',
    description: 'Log 60 total walking minutes in the last 7 days.',
    window: 'week',
    metricKey: 'walk_minutes_total',
    target: 60,
    unit: 'min',
  },
  {
    id: 'food-5-days-week',
    title: 'Log Food 5 Days (7D)',
    description: 'Log calories or any food entry on 5 different days in the last 7 days.',
    window: 'week',
    metricKey: 'calories_logged_days_total',
    target: 5,
    unit: 'count',
  },
];

function clamp(n: number, low: number, high: number) {
  return Math.max(low, Math.min(high, n));
}

function readMetric(metrics: AchievementMetrics, window: ChallengeWindow, key: string) {
  const bucket = window === 'week' ? metrics.week : metrics.lifetime;
  return Number((bucket as any)?.[key] || 0);
}

function formatValue(value: number, unit: ChallengeDef['unit']) {
  if (unit === 'min') return `${Math.round(value)} min`;
  return `${Math.round(value)}`;
}

export default function ChallengesScreen() {
  // Keep this literal reference for doctrine verification.
  void APP_CONFIG.FEATURES.SOCIAL_FEATURES_ENABLED;
  const socialEnabled = APP_CONFIG.FEATURES.SOCIAL_FEATURES_ENABLED || APP_CONFIG.RUNTIME.OVERRIDES.SOCIAL_FEATURES_ENABLED;

  const [metrics, setMetrics] = useState<AchievementMetrics | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadState('loading');
    setLoadError(null);
    try {
      setMetrics(await computeAchievementMetrics());
      setLoadState('loaded');
    } catch (err: any) {
      setMetrics(null);
      setLoadState('error');
      setLoadError(String(err?.message || 'Unable to compute challenge progress.'));
      void captureException(err, { feature: 'challenges', op: 'load' });
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const rows = useMemo(() => {
    if (!metrics) return [];
    return CHALLENGES.map((def) => {
      const current = readMetric(metrics, def.window, def.metricKey);
      const progressPct = def.target > 0 ? clamp(current / def.target, 0, 1) : 0;
      const complete = current >= def.target && def.target > 0;
      return { def, current, progressPct, complete };
    });
  }, [metrics]);

  if (!socialEnabled) return <Redirect href='/(tabs)/profile' />;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.back}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Challenges</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <GlassCard>
          <Text style={styles.kicker}>Social workout challenges</Text>
          <Text style={styles.sub}>Create custom friend/team challenges with strict rules, acceptance, and leaderboard tracking.</Text>
          <View style={styles.socialRow}>
            <Pressable style={styles.socialBtn} onPress={() => router.push('/challenges/social' as any)}>
              <Text style={styles.socialBtnText}>Open Social</Text>
            </Pressable>
            <Pressable style={styles.socialBtn} onPress={() => router.push('/challenges/create' as any)}>
              <Text style={styles.socialBtnText}>Create</Text>
            </Pressable>
          </View>
        </GlassCard>

        <View style={{ height: 12 }} />
        <GlassCard>
          <Text style={styles.kicker}>Personal challenges</Text>
          <Text style={styles.sub}>
            These are computed locally from your logs. Each challenge has a clear source metric and a fixed window.
          </Text>
          <View style={styles.metaRow}>
            <Text style={styles.meta}>Window: last 7 days uses a deterministic 7-day UTC window</Text>
          </View>
        </GlassCard>

        <View style={{ height: 12 }} />
        <SectionHeader title="AVAILABLE" />

        {loadState === 'loading' && !metrics ? (
          <GlassCard>
            <View style={styles.loadingRow}>
              <ActivityIndicator />
              <Text style={styles.loadingText}>Computing progress…</Text>
            </View>
          </GlassCard>
        ) : null}

        {loadState === 'error' && !metrics ? (
          <GlassCard>
            <Text style={styles.errorTitle}>Couldn’t load challenges</Text>
            <Text style={styles.errorText}>{loadError || 'Try again.'}</Text>
            <Pressable style={styles.primaryWide} onPress={() => void load()}>
              <Text style={styles.primaryWideText}>Retry</Text>
            </Pressable>
          </GlassCard>
        ) : null}

        {!metrics && loadState === 'loaded' ? (
          <GlassCard>
            <Text style={styles.sub}>No metrics loaded yet.</Text>
            <Pressable style={styles.primaryWide} onPress={() => void load()}>
              <Text style={styles.primaryWideText}>Refresh</Text>
            </Pressable>
          </GlassCard>
        ) : null}

        {rows.map((row) => (
          <Pressable
            key={row.def.id}
            onPress={() => router.push(`/challenges/${row.def.id}` as any)}
            style={styles.cardPress}
          >
            <GlassCard>
              <View style={styles.rowTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{row.def.title}</Text>
                  <Text style={styles.rowDesc}>{row.def.description}</Text>
                </View>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{row.complete ? 'DONE' : 'LIVE'}</Text>
                </View>
              </View>

              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.round(row.progressPct * 100)}%` }]} />
              </View>

              <Text style={styles.rowMeta}>
                {formatValue(row.current, row.def.unit)} / {formatValue(row.def.target, row.def.unit)} ·{' '}
                {Math.round(row.progressPct * 100)}%
              </Text>
            </GlassCard>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  backBtn: { minHeight: 44, minWidth: 60, justifyContent: 'center' },
  back: { color: '#7EDCFF', fontWeight: '700' },
  title: { color: '#FFF', fontWeight: '900', fontSize: 22 },
  content: { padding: 16, paddingBottom: 28 },

  kicker: { color: '#BFF3FF', fontWeight: '900', letterSpacing: 0.3 },
  sub: { color: '#9CB4BB', fontWeight: '700', marginTop: 8, lineHeight: 18 },
  metaRow: { marginTop: 10 },
  meta: { color: '#7A9199', fontWeight: '700', fontSize: 12 },

  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  loadingText: { color: '#9CB4BB', fontWeight: '800' },
  errorTitle: { color: '#FFD7D7', fontWeight: '900' },
  errorText: { color: '#FFB7B7', fontWeight: '700', marginTop: 6 },

  cardPress: { marginTop: 10 },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  rowTitle: { color: '#FFF', fontWeight: '900', fontSize: 16 },
  rowDesc: { color: '#9CB4BB', fontWeight: '700', marginTop: 6, lineHeight: 18 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: 'rgba(0,217,255,0.14)', borderWidth: 1, borderColor: 'rgba(0,217,255,0.24)' },
  badgeText: { color: '#BFF3FF', fontWeight: '900', fontSize: 12 },

  progressTrack: { height: 10, borderRadius: 999, backgroundColor: '#111111', borderWidth: 1, borderColor: '#262626', marginTop: 12, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 999, backgroundColor: '#00D9FF' },
  rowMeta: { color: '#7A9199', fontWeight: '800', marginTop: 10, fontSize: 12 },

  primaryWide: { minHeight: 44, borderRadius: 12, backgroundColor: '#00D9FF', alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  primaryWideText: { color: '#01212A', fontWeight: '900' },
  socialRow: { marginTop: 12, flexDirection: 'row', gap: 10 },
  socialBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,217,255,0.35)',
    backgroundColor: 'rgba(0,217,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialBtnText: { color: '#BFF3FF', fontWeight: '900' },
});
