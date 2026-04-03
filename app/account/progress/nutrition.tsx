import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import GlassCard from '../../../components/ui/GlassCard';
import PremiumGate from '../../../components/PremiumGate';
import NeonButton from '../../../components/ui/NeonButton';
import Screen from '../../../components/ui/Screen';
import { NEON_THEME } from '../../../constants/neonTheme';
import { isSupabaseConfigured, supabase } from '../../../utils/supabaseClient';
import { computeNutritionAggregates } from '../../../utils/premiumComputeService';
import { getFeatureLimits } from '../../../utils/featureGate';

function isoDay(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function mondayOfWeek(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  const wd = (d.getUTCDay() + 6) % 7;
  const monday = new Date(d.getTime() - wd * 86400000);
  return isoDay(monday);
}

export default function NutritionInsightsScreen() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [weekly, setWeekly] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const today = useMemo(() => isoDay(new Date()), []);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setErr('Supabase not configured.');
      setRows([]);
      setWeekly(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const limits = await getFeatureLimits();
      const days = limits.trainingLoadHistoryDays ?? 7;
      const from = isoDay(new Date(Date.now() - (days - 1) * 86400000));

      const [d1, d2] = await Promise.all([
        supabase.from('nutrition_daily').select('*').gte('day', from).lte('day', today).order('day', { ascending: true }),
        supabase.from('nutrition_weekly_summaries').select('*').eq('week_start', mondayOfWeek(today)).maybeSingle(),
      ]);
      if (d1.error) throw d1.error;
      if (d2.error) throw d2.error;
      setRows(Array.isArray(d1.data) ? d1.data : []);
      setWeekly(d2.data || null);
    } catch (e: any) {
      setErr(String(e?.message || e));
      setRows([]);
      setWeekly(null);
    } finally {
      setLoading(false);
    }
  }, [today]);

  const compute = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    if (busy) return;
    setBusy(true);
    try {
      await computeNutritionAggregates();
      await refresh();
    } catch (e: any) {
      Alert.alert('Nutrition Insights', String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }, [busy, refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <Screen edges={['top']} aura>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.back}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Nutrition Insights</Text>
          <View style={{ width: 40 }} />
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color="#00D9FF" />
            <Text style={styles.meta}>Loading…</Text>
          </View>
        ) : err ? (
          <GlassCard>
            <Text style={styles.cardTitle}>Couldn’t load nutrition insights</Text>
            <Text style={styles.meta}>{err}</Text>
            <NeonButton label="Retry" semantic="protein" onPress={() => void refresh()} style={{ marginTop: 10 }} />
          </GlassCard>
        ) : (
          <>
            {weekly ? (
              <PremiumGate feature="nutritionInsights">
                <GlassCard style={styles.hero}>
                  <Text style={styles.cardTitle}>Weekly digest</Text>
                  <Text style={styles.meta}>
                    {weekly.summary?.consistencyPct ?? '--'}% days logged · Avg {weekly.summary?.avgCalories ?? '--'} kcal · Protein {weekly.summary?.avgProteinG ?? '--'}g
                  </Text>
                  {Array.isArray(weekly.summary?.topFoods) && weekly.summary.topFoods.length ? (
                    <Text style={styles.meta}>
                      Top foods: {weekly.summary.topFoods.slice(0, 3).map((f: any) => String(f.name || '')).filter(Boolean).join(', ')}
                    </Text>
                  ) : null}
                </GlassCard>
              </PremiumGate>
            ) : null}

            <GlassCard>
              <Text style={styles.cardTitle}>Daily totals</Text>
              {rows.length ? (
                rows.map((r) => (
                  <View key={String(r.day)} style={styles.row}>
                    <Text style={styles.key}>{String(r.day).slice(5)}</Text>
                    <Text style={styles.val}>
                      {Math.round(Number(r.calories_kcal || 0))} kcal · P {Math.round(Number(r.protein_g || 0))} · C {Math.round(Number(r.carbs_g || 0))} · F {Math.round(Number(r.fat_g || 0))}
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={styles.meta}>No rows yet. Compute to populate.</Text>
              )}
            </GlassCard>

            <PremiumGate feature="nutritionInsights">
              <GlassCard>
                <Text style={styles.cardTitle}>Macros by meal</Text>
                <Text style={styles.meta}>
                  P0 note: meal breakdown is stored in `nutrition_daily.meal_breakdown`. This screen will render charts next.
                </Text>
              </GlassCard>
            </PremiumGate>

            <View style={styles.actions}>
              <NeonButton label="Refresh" semantic="protein" variant="secondary" onPress={() => void refresh()} disabled={busy} style={styles.cta} />
              <NeonButton
                label={busy ? 'Computing…' : 'Compute'}
                semantic="protein"
                variant="primary"
                onPress={() => void compute()}
                disabled={busy}
                style={styles.cta}
              />
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  back: { color: NEON_THEME.color.neonCyan, fontWeight: '900' },
  title: { color: NEON_THEME.color.textPrimary, fontWeight: '900', fontSize: 20 },
  center: { padding: 18, alignItems: 'center', gap: 10 },
  hero: { padding: 16 },
  cardTitle: { color: NEON_THEME.color.textPrimary, fontWeight: '900', fontSize: 14 },
  meta: { color: NEON_THEME.color.textSecondary, fontWeight: '700', marginTop: 10, lineHeight: 18 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, gap: 10 },
  key: { color: NEON_THEME.color.neonCyan, fontWeight: '900' },
  val: { color: NEON_THEME.color.textPrimary, fontWeight: '800', flex: 1, textAlign: 'right' },
  actions: { flexDirection: 'row', gap: 10 },
  cta: { flex: 1 },
  disabled: { opacity: 0.6 },
});
