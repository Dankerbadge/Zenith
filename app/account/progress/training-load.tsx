import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import GlassCard from '../../../components/ui/GlassCard';
import ConfidenceBadge from '../../../components/ui/ConfidenceBadge';
import PremiumGate from '../../../components/PremiumGate';
import NeonButton from '../../../components/ui/NeonButton';
import Screen from '../../../components/ui/Screen';
import { NEON_THEME } from '../../../constants/neonTheme';
import { isSupabaseConfigured, supabase } from '../../../utils/supabaseClient';
import { computeTrainingLoad } from '../../../utils/premiumComputeService';
import { getFeatureLimits } from '../../../utils/featureGate';

function isoDay(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export default function TrainingLoadScreen() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const today = useMemo(() => isoDay(new Date()), []);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setErr('Supabase not configured.');
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const limits = await getFeatureLimits();
      const days = limits.trainingLoadHistoryDays ?? 7;
      const from = isoDay(new Date(Date.now() - (days - 1) * 86400000));
      const { data, error } = await supabase
        .from('training_load_daily')
        .select('*')
        .gte('day', from)
        .lte('day', today)
        .order('day', { ascending: true });
      if (error) throw error;
      setRows(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setErr(String(e?.message || e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [today]);

  const compute = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    if (busy) return;
    setBusy(true);
    try {
      await computeTrainingLoad();
      await refresh();
    } catch (e: any) {
      Alert.alert('Training Load', String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }, [busy, refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const last = rows.length ? rows[rows.length - 1] : null;
  const prev = rows.length >= 2 ? rows[rows.length - 2] : null;
  const changed =
    last && prev
      ? `ATL ${(Number(last.atl || 0) - Number(prev.atl || 0)).toFixed(1)} · CTL ${(Number(last.ctl || 0) - Number(prev.ctl || 0)).toFixed(1)} · FORM ${(Number(last.form || 0) - Number(prev.form || 0)).toFixed(1)}`
      : 'Not enough history yet.';

  return (
    <Screen edges={['top']} aura>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.back}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Training Load</Text>
          <View style={{ width: 40 }} />
        </View>

        <PremiumGate feature="trainingLoad">
          <GlassCard style={styles.hero}>
            <View style={styles.heroTop}>
              <View>
                <Text style={styles.heroKicker}>TODAY</Text>
                <Text style={styles.heroValue}>{last ? Number(last.form || 0).toFixed(1) : '--'}</Text>
                <Text style={styles.heroMeta}>Form (CTL - ATL)</Text>
              </View>
              <ConfidenceBadge tier={rows.length >= 7 ? 'MEDIUM' : 'LOW'} label={rows.length >= 7 ? 'MEDIUM' : 'LOW'} />
            </View>
            <Text style={styles.meta}>What changed: {changed}</Text>
            <Text style={styles.meta}>Ramp rate: {last && Number.isFinite(Number(last.ramp_rate)) ? Number(last.ramp_rate).toFixed(1) : '--'}</Text>
          </GlassCard>
        </PremiumGate>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color="#00D9FF" />
            <Text style={styles.meta}>Loading…</Text>
          </View>
        ) : err ? (
          <GlassCard>
            <Text style={styles.cardTitle}>Couldn’t load training load</Text>
            <Text style={styles.meta}>{err}</Text>
            <NeonButton label="Retry" semantic="readiness" onPress={() => void refresh()} style={{ marginTop: 10 }} />
          </GlassCard>
        ) : (
          <GlassCard>
            <Text style={styles.cardTitle}>History</Text>
            {rows.length ? (
              rows.map((r) => (
                <View key={String(r.day)} style={styles.row}>
                  <Text style={styles.key}>{String(r.day).slice(5)}</Text>
                  <Text style={styles.val}>
                    ATL {Number(r.atl || 0).toFixed(1)} · CTL {Number(r.ctl || 0).toFixed(1)} · FORM {Number(r.form || 0).toFixed(1)}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={styles.meta}>No rows yet. Compute to populate.</Text>
            )}
          </GlassCard>
        )}

        <View style={styles.actions}>
          <NeonButton label="Refresh" semantic="readiness" variant="secondary" onPress={() => void refresh()} disabled={busy} style={styles.cta} />
          <NeonButton
            label={busy ? 'Computing…' : 'Compute'}
            semantic="readiness"
            variant="primary"
            onPress={() => void compute()}
            disabled={busy}
            style={styles.cta}
          />
        </View>

        <GlassCard>
          <Text style={styles.cardTitle}>Method</Text>
          <Text style={styles.meta}>
            Zenith computes per-workout effort using HR TRIMP when HR baselines are available. If the required inputs are missing, load is not computed.
          </Text>
        </GlassCard>
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
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  heroKicker: { color: NEON_THEME.color.textSecondary, fontWeight: '900', letterSpacing: 0.5 },
  heroValue: { color: NEON_THEME.color.neonCyan, fontWeight: '900', fontSize: 44, marginTop: 6, textShadowColor: 'rgba(14,210,244,0.35)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 12 },
  heroMeta: { color: NEON_THEME.color.textSecondary, fontWeight: '800', marginTop: 2 },
  meta: { color: NEON_THEME.color.textSecondary, fontWeight: '700', marginTop: 10, lineHeight: 18 },
  cardTitle: { color: NEON_THEME.color.textPrimary, fontWeight: '900', fontSize: 14 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, gap: 10 },
  key: { color: NEON_THEME.color.neonCyan, fontWeight: '900' },
  val: { color: NEON_THEME.color.textPrimary, fontWeight: '800', flex: 1, textAlign: 'right' },
  actions: { flexDirection: 'row', gap: 10 },
  cta: { flex: 1 },
  disabled: { opacity: 0.6 },
});
