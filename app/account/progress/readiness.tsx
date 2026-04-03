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
import { computeReadiness } from '../../../utils/premiumComputeService';

function isoDay(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function joinReasons(reasons: unknown) {
  const arr = Array.isArray(reasons) ? reasons : [];
  return arr.map((r) => String(r || '').trim()).filter(Boolean);
}

export default function ReadinessScreen() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [row, setRow] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  const today = useMemo(() => isoDay(new Date()), []);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setErr('Supabase not configured.');
      setRow(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const { data, error } = await supabase.from('readiness_daily').select('*').eq('day', today).maybeSingle();
      if (error) throw error;
      setRow(data || null);
    } catch (e: any) {
      setErr(String(e?.message || e));
      setRow(null);
    } finally {
      setLoading(false);
    }
  }, [today]);

  const compute = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    if (busy) return;
    setBusy(true);
    try {
      await computeReadiness({ day: today });
      await refresh();
    } catch (e: any) {
      Alert.alert('Readiness', String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }, [busy, refresh, today]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const tier = String(row?.confidence || 'LOW').toUpperCase();
  const score = row?.readiness_score;
  const rec = String(row?.recommendation || 'MAINTAIN').toUpperCase();
  const reasons = joinReasons(row?.reasons);

  return (
    <Screen edges={['top']} aura>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.back}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Readiness</Text>
          <View style={{ width: 40 }} />
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color="#00D9FF" />
            <Text style={styles.meta}>Loading…</Text>
          </View>
        ) : err ? (
          <GlassCard>
            <Text style={styles.cardTitle}>Couldn’t load readiness</Text>
            <Text style={styles.meta}>{err}</Text>
            <NeonButton label="Retry" semantic="readiness" onPress={() => void refresh()} style={{ marginTop: 10 }} />
          </GlassCard>
        ) : (
          <>
            <PremiumGate feature="readiness">
              <GlassCard style={[styles.hero, styles.cardBlock]}>
                <View style={styles.heroTop}>
                  <View>
                    <Text style={styles.heroKicker}>TODAY</Text>
                    <Text style={styles.heroScore}>{typeof score === 'number' ? score : '--'}</Text>
                    <Text style={styles.heroRec}>{rec}</Text>
                  </View>
                  <ConfidenceBadge tier={(tier === 'HIGH' || tier === 'MEDIUM' || tier === 'LOW' ? tier : 'LOW') as any} />
                </View>

                <Text style={styles.meta}>
                  {reasons.length ? reasons.slice(0, 3).join(' · ') : 'Compute requires adequate sleep + recovery inputs.'}
                </Text>
                <Text style={styles.disclaimer}>Wellness guidance only. Not medical advice.</Text>
              </GlassCard>
            </PremiumGate>

            <GlassCard style={styles.cardBlock}>
              <Text style={styles.cardTitle}>Breakdown</Text>
              <View style={styles.breakdownTiles}>
                <View style={styles.breakdownTile}>
                  <Text style={styles.key}>Sleep</Text>
                  <Text style={styles.val}>{row?.sleep_score ?? '--'}</Text>
                </View>
                <View style={styles.breakdownTile}>
                  <Text style={styles.key}>Resting HR</Text>
                  <Text style={styles.val}>{row?.rhr_score ?? '--'}</Text>
                </View>
                <View style={styles.breakdownTile}>
                  <Text style={styles.key}>Strain</Text>
                  <Text style={styles.val}>{row?.strain_score ?? '--'}</Text>
                </View>
              </View>
            </GlassCard>

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
  cardBlock: { marginBottom: 4 },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  heroKicker: { color: NEON_THEME.color.textSecondary, fontWeight: '900', letterSpacing: 0.5 },
  heroScore: { color: NEON_THEME.color.neonCyan, fontWeight: '900', fontSize: 52, marginTop: 6, textShadowColor: 'rgba(14,210,244,0.35)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 14 },
  heroRec: { color: NEON_THEME.color.textSecondary, fontWeight: '900', marginTop: 2 },
  meta: { color: NEON_THEME.color.textSecondary, fontWeight: '700', marginTop: 10, lineHeight: 18 },
  disclaimer: { color: NEON_THEME.color.textTertiary, fontWeight: '700', marginTop: 10, fontSize: 12 },
  cardTitle: { color: NEON_THEME.color.textPrimary, fontWeight: '900', fontSize: 14 },
  breakdownTiles: { marginTop: 10, gap: 10 },
  breakdownTile: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  key: { color: NEON_THEME.color.neonCyan, fontWeight: '900' },
  val: { color: NEON_THEME.color.textPrimary, fontWeight: '900' },
  actions: { flexDirection: 'row', gap: 10 },
  cta: { flex: 1 },
  disabled: { opacity: 0.6 },
});
