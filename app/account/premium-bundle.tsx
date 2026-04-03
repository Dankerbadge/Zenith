import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import PremiumGate from '../../components/PremiumGate';
import { supabase, isSupabaseConfigured } from '../../utils/supabaseClient';
import { computeInsights, computeNutritionAggregates, computeReadiness, computeTrainingLoad } from '../../utils/premiumComputeService';
import { getFeatureLimits } from '../../utils/featureGate';

function isoDay(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export default function PremiumBundleDebugScreen() {
  const [busy, setBusy] = useState<'none' | 'compute' | 'refresh'>('none');
  const [rows, setRows] = useState<any>({
    trainingLoad: [],
    readiness: null,
    insights: [],
    nutrition: [],
    weekly: null,
  });

  const today = useMemo(() => isoDay(new Date()), []);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) {
      Alert.alert('Supabase', 'Supabase is not configured in this build.');
      return;
    }
    if (busy !== 'none') return;
    setBusy('refresh');
    try {
      const limits = await getFeatureLimits();
      const days = limits.trainingLoadHistoryDays ?? 7;
      const from = isoDay(new Date(Date.now() - (days - 1) * 86400000));

      const [tl, rd, ins, nut, wk] = await Promise.all([
        supabase.from('training_load_daily').select('*').gte('day', from).lte('day', today).order('day', { ascending: true }),
        supabase.from('readiness_daily').select('*').eq('day', today).maybeSingle(),
        supabase.from('insights').select('*').eq('day', today).order('created_at', { ascending: false }),
        supabase.from('nutrition_daily').select('*').gte('day', from).lte('day', today).order('day', { ascending: true }),
        supabase.from('nutrition_weekly_summaries').select('*').eq('week_start', isoDay(new Date(new Date(today).getTime() - ((new Date(today).getDay() + 6) % 7) * 86400000))).maybeSingle(),
      ]);

      setRows({
        trainingLoad: tl.data || [],
        readiness: rd.data || null,
        insights: ins.data || [],
        nutrition: nut.data || [],
        weekly: wk.data || null,
      });
    } finally {
      setBusy('none');
    }
  }, [busy, today]);

  const computeAll = useCallback(async () => {
    if (!isSupabaseConfigured) {
      Alert.alert('Supabase', 'Supabase is not configured in this build.');
      return;
    }
    if (busy !== 'none') return;
    setBusy('compute');
    try {
      await computeNutritionAggregates();
      await computeTrainingLoad();
      await computeReadiness({ day: today });
      await computeInsights({ day: today });
      await refresh();
      Alert.alert('Computed', 'Premium bundle aggregates updated.');
    } catch (e: any) {
      Alert.alert('Compute failed', String(e?.message || e));
    } finally {
      setBusy('none');
    }
  }, [busy, refresh, today]);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Premium Bundle v1</Text>
        <Text style={styles.subtitle}>P0 debug view: compute + inspect server-side aggregates.</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Compute</Text>
          <Text style={styles.cardBody}>Runs nutrition aggregates, training load, readiness, and insights using your cloud snapshots.</Text>

          <Pressable style={[styles.primaryBtn, busy !== 'none' && styles.disabled]} onPress={computeAll} disabled={busy !== 'none'}>
            <Text style={styles.primaryBtnText}>{busy === 'compute' ? 'Computing…' : 'Compute Now'}</Text>
          </Pressable>

          <Pressable style={[styles.secondaryBtn, busy !== 'none' && styles.disabled]} onPress={refresh} disabled={busy !== 'none'}>
            <Text style={styles.secondaryBtnText}>{busy === 'refresh' ? 'Refreshing…' : 'Refresh'}</Text>
          </Pressable>
        </View>

        <PremiumGate feature="trainingLoad">
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Training Load</Text>
            {rows.trainingLoad?.length ? (
              rows.trainingLoad.map((r: any) => (
                <View key={String(r.day)} style={styles.row}>
                  <Text style={styles.key}>{String(r.day)}</Text>
                  <Text style={styles.value}>
                    ATL {Number(r.atl || 0).toFixed(1)} · CTL {Number(r.ctl || 0).toFixed(1)} · FORM {Number(r.form || 0).toFixed(1)}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={styles.empty}>No training load rows yet. Compute to populate.</Text>
            )}
          </View>
        </PremiumGate>

        <PremiumGate feature="readiness">
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Readiness</Text>
            {rows.readiness ? (
              <>
                <View style={styles.row}>
                  <Text style={styles.key}>Score</Text>
                  <Text style={styles.value}>{String(rows.readiness.readiness_score ?? '--')}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.key}>Recommendation</Text>
                  <Text style={styles.value}>{String(rows.readiness.recommendation ?? '--')}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.key}>Confidence</Text>
                  <Text style={styles.value}>{String(rows.readiness.confidence ?? '--')}</Text>
                </View>
              </>
            ) : (
              <Text style={styles.empty}>No readiness row for today. Compute to populate.</Text>
            )}
          </View>
        </PremiumGate>

        <PremiumGate feature="aiInsights">
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Insight Cards</Text>
            {rows.insights?.length ? (
              rows.insights.map((i: any) => (
                <View key={String(i.id)} style={styles.insight}>
                  <Text style={styles.insightTitle}>{String(i.title || '')}</Text>
                  <Text style={styles.insightBody}>{String(i.body || '')}</Text>
                  <Text style={styles.insightMeta}>{String(i.type || '')} · {String(i.confidence || '')}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.empty}>No insights for today. Compute to populate.</Text>
            )}
          </View>
        </PremiumGate>

        <PremiumGate feature="nutritionInsights">
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Nutrition Daily</Text>
            {rows.nutrition?.length ? (
              rows.nutrition.map((r: any) => (
                <View key={String(r.day)} style={styles.row}>
                  <Text style={styles.key}>{String(r.day)}</Text>
                  <Text style={styles.value}>
                    {Math.round(Number(r.calories_kcal || 0))} kcal · P {Number(r.protein_g || 0).toFixed(0)} · C {Number(r.carbs_g || 0).toFixed(0)} · F {Number(r.fat_g || 0).toFixed(0)}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={styles.empty}>No nutrition rows yet. Compute to populate.</Text>
            )}
          </View>
        </PremiumGate>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  title: { color: '#FFF', fontSize: 28, fontWeight: '900' },
  subtitle: { color: '#9AB4C0', marginTop: 6, marginBottom: 6, fontWeight: '700' },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    padding: 14,
    gap: 10,
  },
  cardTitle: { color: '#EAF2FF', fontWeight: '900', fontSize: 16 },
  cardBody: { color: '#A9C4CF', fontWeight: '700', lineHeight: 18 },
  primaryBtn: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: '#00D9FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { color: '#00141A', fontWeight: '900' },
  secondaryBtn: {
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: { color: '#EAF2FF', fontWeight: '900' },
  disabled: { opacity: 0.6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  key: { color: '#7EDCFF', fontWeight: '900' },
  value: { color: '#DDE7F2', fontWeight: '800', flex: 1, textAlign: 'right' },
  empty: { color: '#8FA9B4', fontWeight: '700' },
  insight: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(0,0,0,0.15)',
    padding: 12,
    gap: 6,
  },
  insightTitle: { color: '#FFF', fontWeight: '900' },
  insightBody: { color: '#BFD3DC', fontWeight: '700', lineHeight: 18 },
  insightMeta: { color: '#86A8B6', fontWeight: '800', fontSize: 12 },
});

