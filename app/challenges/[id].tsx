import { Redirect, router, useLocalSearchParams } from 'expo-router'; import React, { useCallback, useMemo, useState } from 'react'; import { useFocusEffect } from '@react-navigation/native'; import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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

export default function ChallengeDetailScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const challengeId = String(params.id || '').trim();

  // Keep this literal reference for doctrine verification.
  void APP_CONFIG.FEATURES.SOCIAL_FEATURES_ENABLED;
  const socialEnabled = APP_CONFIG.FEATURES.SOCIAL_FEATURES_ENABLED || APP_CONFIG.RUNTIME.OVERRIDES.SOCIAL_FEATURES_ENABLED;

  const def = useMemo(() => CHALLENGES.find((c) => c.id === challengeId) || null, [challengeId]);
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
      void captureException(err, { feature: 'challenge_detail', op: 'load' });
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const computed = useMemo(() => {
    if (!def || !metrics) return null;
    const current = readMetric(metrics, def.window, def.metricKey);
    const progressPct = def.target > 0 ? clamp(current / def.target, 0, 1) : 0;
    const complete = current >= def.target && def.target > 0;
    return { current, progressPct, complete };
  }, [def, metrics]);

  if (!socialEnabled) return <Redirect href='/(tabs)/profile' />;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.back}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Challenge</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {!def ? (
          <GlassCard>
            <Text style={styles.rowTitle}>Unknown challenge</Text>
            <Text style={styles.sub}>This challenge ID is not recognized.</Text>
            <Pressable style={styles.primaryWide} onPress={() => router.replace('/challenges' as any)}>
              <Text style={styles.primaryWideText}>Back to Challenges</Text>
            </Pressable>
          </GlassCard>
        ) : (
          <>
            <GlassCard>
              <Text style={styles.rowTitle}>{def.title}</Text>
              <Text style={styles.sub}>{def.description}</Text>

              {loadState === 'loading' && !metrics ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator />
                  <Text style={styles.loadingText}>Computing progress…</Text>
                </View>
              ) : null}

              {loadState === 'error' && !metrics ? (
                <>
                  <Text style={[styles.rowMeta, { marginTop: 10, color: '#FFB7B7' }]}>
                    {loadError || 'Couldn’t load challenge data.'}
                  </Text>
                  <Pressable style={styles.ghostWide} onPress={() => void load()}>
                    <Text style={styles.ghostWideText}>Retry</Text>
                  </Pressable>
                </>
              ) : null}

              {computed ? (
                <>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${Math.round(computed.progressPct * 100)}%` }]} />
                  </View>
                  <Text style={styles.rowMeta}>
                    {formatValue(computed.current, def.unit)} / {formatValue(def.target, def.unit)} ·{' '}
                    {Math.round(computed.progressPct * 100)}% · {computed.complete ? 'DONE' : 'LIVE'}
                  </Text>
                </>
              ) : (
                <Text style={[styles.rowMeta, { marginTop: 10 }]}>
                  {loadState === 'loaded' ? 'No metrics computed yet.' : 'Waiting for metrics…'}
                </Text>
              )}

              <Pressable style={styles.ghostWide} onPress={() => void load()} disabled={loadState === 'loading'}>
                <Text style={styles.ghostWideText}>{loadState === 'loading' ? 'Refreshing…' : 'Refresh'}</Text>
              </Pressable>
            </GlassCard>

            <View style={{ height: 12 }} />
            <SectionHeader title="WHY THIS NUMBER EXISTS" />
            <GlassCard>
              <Text style={styles.sub}>
                This challenge is computed locally from your saved logs via `computeAchievementMetrics()`.
              </Text>
              <View style={{ height: 10 }} />
              <Text style={styles.detailLine}>Metric key: {def.metricKey}</Text>
              <Text style={styles.detailLine}>
                Window: {def.window === 'week' ? 'Last 7 days (deterministic UTC window)' : 'Lifetime'}
              </Text>
              <Text style={styles.detailLine}>Target: {formatValue(def.target, def.unit)}</Text>
              <Text style={styles.detailHint}>
                If your logs are missing days (offline, not logged, or no wearable sync), the value reflects only what was saved.
              </Text>
            </GlassCard>

            <View style={{ height: 12 }} />
            <SectionHeader title="NEXT" />
            <GlassCard>
              <Pressable style={styles.primaryWide} onPress={() => router.replace('/challenges' as any)}>
                <Text style={styles.primaryWideText}>Back to Challenges</Text>
              </Pressable>
            </GlassCard>
          </>
        )}
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

  rowTitle: { color: '#FFF', fontWeight: '900', fontSize: 18 },
  sub: { color: '#9CB4BB', fontWeight: '700', marginTop: 8, lineHeight: 18 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  loadingText: { color: '#9CB4BB', fontWeight: '800' },

  progressTrack: { height: 10, borderRadius: 999, backgroundColor: '#111111', borderWidth: 1, borderColor: '#262626', marginTop: 12, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 999, backgroundColor: '#00D9FF' },
  rowMeta: { color: '#7A9199', fontWeight: '800', marginTop: 10, fontSize: 12 },

  detailLine: { color: '#D0D0D0', fontWeight: '700', marginBottom: 6 },
  detailHint: { color: '#7A9199', fontWeight: '700', fontSize: 12, marginTop: 6, lineHeight: 16 },

  primaryWide: { minHeight: 44, borderRadius: 12, backgroundColor: '#00D9FF', alignItems: 'center', justifyContent: 'center' },
  primaryWideText: { color: '#01212A', fontWeight: '900' },
  ghostWide: { minHeight: 44, borderRadius: 12, backgroundColor: '#111111', borderWidth: 1, borderColor: '#262626', alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  ghostWideText: { color: '#D5D5D5', fontWeight: '900' },
});
