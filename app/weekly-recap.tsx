import { useFocusEffect } from '@react-navigation/native'; import { router } from 'expo-router'; import React, { useCallback, useState } from 'react'; import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../components/ui/GlassCard';
import { acknowledgeSurfaceInsights, dismissSurfaceInsights, getWeeklyRecapInsights } from '../utils/aiInsightEngine';
import { captureException } from '../utils/crashReporter';
import { getDailyMetricsByDates } from '../utils/dailyMetrics';
import { getRangeConfidence, isActiveDay } from '../utils/semanticTrust';
import { getDailyLogsByDates, getUserProfile, todayKey } from '../utils/storageUtils';
import { shareWeeklyRecapJson } from '../utils/dataPortabilityService';
import type { AiInsight } from '../utils/aiTypes';

type RecapState = {
  hasAiInsight: boolean;
  activeDays: number;
  winningDays: number;
  workouts: number;
  runs: number;
  avgProtein: number | null;
  avgWater: number | null;
  summary: string;
};

const DEFAULT_RECAP: RecapState = {
  hasAiInsight: false,
  activeDays: 0,
  winningDays: 0,
  workouts: 0,
  runs: 0,
  avgProtein: null,
  avgWater: null,
  summary: 'Keep logging a few core signals this week to generate a reliable recap.',
};

function getLast7Dates() {
  const out: string[] = [];
  const dayMs = 24 * 60 * 60 * 1000;
  for (let i = 6; i >= 0; i -= 1) {
    out.push(todayKey(new Date(Date.now() - i * dayMs)));
  }
  return out;
}

export default function WeeklyRecapScreen() {
  const [state, setState] = useState<RecapState>(DEFAULT_RECAP);
  const [insights, setInsights] = useState<AiInsight[]>([]);
  const [exporting, setExporting] = useState(false);
  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadState('loading');
    setLoadError(null);
    try {
      const profile = await getUserProfile();
      const dates = getLast7Dates();
      const logsByDate = await getDailyLogsByDates(dates);
      const metricsByDate = await getDailyMetricsByDates(dates, { logsByDate, profile });

      const logs = dates.map((date) => logsByDate[date] || {});
      const metrics = dates.map((date) => metricsByDate[date]);

      const activeDays = logs.filter((log) => isActiveDay(log)).length;
      const winningDays = metrics.filter((m) => Boolean(m?.winningDay)).length;
      const workouts = metrics.reduce((sum, m) => sum + (Number(m?.workoutsCount) || 0), 0);
      const runs = logs.reduce((sum, log) => {
        const ws = Array.isArray(log.workouts) ? log.workouts : [];
        return sum + ws.filter((w: any) => String(w?.type || '').toLowerCase() === 'running').length;
      }, 0);

      const proteinDays = metrics.filter((m) => (Number(m?.protein) || 0) > 0).length;
      const waterDays = metrics.filter((m) => (Number(m?.water) || 0) > 0).length;
      const avgProtein = proteinDays > 0 ? metrics.reduce((sum, m) => sum + (Number(m?.protein) || 0), 0) / proteinDays : null;
      const avgWater = waterDays > 0 ? metrics.reduce((sum, m) => sum + (Number(m?.water) || 0), 0) / waterDays : null;

      const confidence = getRangeConfidence(logs as any);
      const nextInsights = await getWeeklyRecapInsights({
        dateKey: todayKey(),
        dayConfidence: confidence,
        daysWithAnyLog: activeDays,
        avgProtein,
        avgWater,
        proteinTarget: Number(profile?.goals?.proteinTarget) || 170,
        waterTargetOz: Number(profile?.goals?.waterTargetOz) || 120,
        rangeLabel: 'Last 7 days',
        averageMode: 'logged',
      });
      if (nextInsights.length > 0) {
        await acknowledgeSurfaceInsights(nextInsights);
      }
      const summary = nextInsights[0]?.text || 'Keep logging a few core signals this week to generate a reliable recap.';

      setInsights(nextInsights);
      setState({
        hasAiInsight: nextInsights.length > 0,
        activeDays,
        winningDays,
        workouts,
        runs,
        avgProtein,
        avgWater,
        summary,
      });
      setLoadState('loaded');
    } catch (err: any) {
      setLoadState('error');
      setLoadError(String(err?.message || 'Unable to load recap data.'));
      setInsights([]);
      setState(DEFAULT_RECAP);
      void captureException(err, { feature: 'weekly_recap', op: 'load' });
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}><Text style={styles.back}>Back</Text></Pressable>
          <Text style={styles.title}>Weekly Recap</Text>
          <View style={{ width: 40 }} />
        </View>

        {loadState === 'loading' ? (
          <GlassCard>
            <Text style={styles.blockedTitle}>Loading recap…</Text>
            <Text style={styles.blockedText}>Collecting your latest data.</Text>
          </GlassCard>
        ) : loadState === 'error' ? (
          <GlassCard>
            <Text style={styles.blockedTitle}>Couldn’t load weekly recap</Text>
            <Text style={styles.blockedText}>{loadError || 'Try again.'}</Text>
            <Pressable style={styles.settingsBtn} onPress={() => void load()}>
              <Text style={styles.settingsText}>Retry</Text>
            </Pressable>
          </GlassCard>
        ) : (
          <>
            <GlassCard>
              <Text style={styles.section}>{state.hasAiInsight ? 'AI Summary' : 'Weekly Summary'}</Text>
              <Text style={styles.summary}>{state.summary}</Text>
              <Text style={styles.meta}>
                {state.hasAiInsight
                  ? insights[0]?.evidenceSummary || 'Based on the last 7 days of logged data.'
                  : 'Base recap generated from your logged data (workouts, nutrition, hydration, and winning days).'}
              </Text>
              <Text style={styles.meta}>Confidence: {insights[0]?.confidenceLevel?.toUpperCase() || 'LOW'}</Text>
              {state.hasAiInsight ? (
                <Pressable
                  style={styles.settingsBtn}
                  onPress={() => {
                    void dismissSurfaceInsights('weekly_recap')
                      .then(() => {
                        setInsights([]);
                        setState((prev) => ({
                          ...prev,
                          hasAiInsight: false,
                          summary: 'Base recap ready. Enable AI overlay for narrative coaching notes.',
                        }));
                      })
                      .catch((err: any) => {
                        Alert.alert('Dismiss failed', String(err?.message || 'Try again.'));
                        void captureException(err, { feature: 'weekly_recap', op: 'dismiss' });
                      });
                  }}
                >
                  <Text style={styles.settingsText}>Dismiss Today</Text>
                </Pressable>
              ) : (
                <Pressable style={styles.settingsBtn} onPress={() => router.push('/account/preferences' as any)}>
                  <Text style={styles.settingsText}>Enable AI summaries</Text>
                </Pressable>
              )}
              <Pressable
                style={[styles.settingsBtn, exporting && { opacity: 0.5 }]}
                disabled={exporting}
                onPress={() => {
                  if (exporting) return;
                  setExporting(true);
                  void (async () => {
                    try {
                      const payload = {
                        type: 'weekly_recap',
                        generatedAt: new Date().toISOString(),
                        rangeLabel: 'Last 7 days',
                        signals: {
                          activeDays: state.activeDays,
                          winningDays: state.winningDays,
                          workouts: state.workouts,
                          runs: state.runs,
                          avgProtein: state.avgProtein,
                          avgWater: state.avgWater,
                        },
                        summary: state.summary,
                        evidence: insights[0]?.evidenceSummary || null,
                        confidence: insights[0]?.confidenceLevel || null,
                      };
                      const ok = await shareWeeklyRecapJson(payload);
                      if (!ok) Alert.alert('Unavailable', 'Sharing is not available on this device.');
                    } catch (err: any) {
                      Alert.alert('Export failed', String(err?.message || 'Try again.'));
                    } finally {
                      setExporting(false);
                    }
                  })();
                }}
              >
                <Text style={styles.settingsText}>Export recap</Text>
              </Pressable>
            </GlassCard>

            <View style={{ height: 10 }} />
            <GlassCard>
              <Text style={styles.section}>Signals</Text>
              <Text style={styles.item}>Active days: {state.activeDays}/7</Text>
              <Text style={styles.item}>Winning days: {state.winningDays}/7</Text>
              <Text style={styles.item}>Workouts: {state.workouts}</Text>
              <Text style={styles.item}>Runs: {state.runs}</Text>
              <Text style={styles.item}>Avg protein (logged days): {state.avgProtein === null ? '—' : `${Math.round(state.avgProtein)}g`}</Text>
              <Text style={styles.item}>Avg water (logged days): {state.avgWater === null ? '—' : `${Math.round(state.avgWater)}oz`}</Text>
            </GlassCard>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  content: { padding: 16, paddingBottom: 40 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  back: { color: '#7EDCFF', fontWeight: '700' },
  title: { color: '#FFF', fontWeight: '800', fontSize: 20 },
  section: { color: '#FFF', fontWeight: '800', marginBottom: 8 },
  summary: { color: '#E9F8FF', fontWeight: '700', lineHeight: 20 },
  meta: { color: '#8AA8B3', marginTop: 8, fontSize: 12, fontWeight: '600' },
  item: { color: '#D0D0D0', fontWeight: '600', marginBottom: 6 },
  blockedTitle: { color: '#FFF', fontWeight: '800', marginBottom: 6 },
  blockedText: { color: '#C7D7DD', fontWeight: '600' },
  settingsBtn: {
    marginTop: 12,
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#3A3A3A',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#121212',
  },
  settingsText: { color: '#D6EEF7', fontWeight: '800' },
});
