import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import GlassCard from '../../../components/ui/GlassCard';
import ConfidenceBadge from '../../../components/ui/ConfidenceBadge';
import PremiumGate from '../../../components/PremiumGate';
import { isSupabaseConfigured, supabase } from '../../../utils/supabaseClient';
import { computeInsights } from '../../../utils/premiumComputeService';

function isoDay(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export default function InsightsScreen() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const today = useMemo(() => isoDay(new Date()), []);
  const fromDay = useMemo(() => isoDay(new Date(Date.now() - 14 * 86400000)), []);

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
      const { data, error } = await supabase
        .from('insights')
        .select('*')
        .gte('day', fromDay)
        .lte('day', today)
        .is('dismissed_at', null)
        .order('day', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      setRows(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setErr(String(e?.message || e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [fromDay, today]);

  const compute = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    if (busy) return;
    setBusy(true);
    try {
      await computeInsights({ day: today });
      await refresh();
    } catch (e: any) {
      Alert.alert('Insights', String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }, [busy, refresh, today]);

  const dismiss = useCallback(async (id: string) => {
    if (!id) return;
    try {
      await supabase.from('insights').update({ dismissed_at: new Date().toISOString() }).eq('id', id);
      await refresh();
    } catch {
      // ignore
    }
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.back}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Insight Cards</Text>
          <View style={{ width: 40 }} />
        </View>

        <PremiumGate feature="aiInsights">
          <GlassCard>
            <Text style={styles.cardTitle}>Rules-first</Text>
            <Text style={styles.meta}>
              Insights are generated from your aggregated data with confidence tiers and evidence. No medical claims.
            </Text>
          </GlassCard>
        </PremiumGate>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color="#00D9FF" />
            <Text style={styles.meta}>Loading…</Text>
          </View>
        ) : err ? (
          <GlassCard>
            <Text style={styles.cardTitle}>Couldn’t load insights</Text>
            <Text style={styles.meta}>{err}</Text>
            <Pressable style={styles.btn} onPress={() => void refresh()}>
              <Text style={styles.btnText}>Retry</Text>
            </Pressable>
          </GlassCard>
        ) : rows.length ? (
          rows.map((r) => (
            <GlassCard key={String(r.id)} style={styles.insight}>
              <View style={styles.insightTop}>
                <Text style={styles.insightTitle}>{String(r.title || '')}</Text>
                <ConfidenceBadge tier={(String(r.confidence || 'LOW').toUpperCase() as any) || 'LOW'} />
              </View>
              <Text style={styles.insightBody}>{String(r.body || '')}</Text>
              <Text style={styles.insightMeta}>{String(r.type || '')} · {String(r.day || '')}</Text>
              <View style={styles.insightActions}>
                <Pressable style={styles.dismissBtn} onPress={() => void dismiss(String(r.id))}>
                  <Text style={styles.dismissText}>Dismiss</Text>
                </Pressable>
              </View>
            </GlassCard>
          ))
        ) : (
          <GlassCard>
            <Text style={styles.cardTitle}>No insights yet</Text>
            <Text style={styles.meta}>Compute after a few days of consistent logging to unlock high-confidence cards.</Text>
          </GlassCard>
        )}

        <View style={styles.actions}>
          <Pressable style={[styles.btn, busy && styles.disabled]} onPress={() => void refresh()} disabled={busy}>
            <Text style={styles.btnText}>Refresh</Text>
          </Pressable>
          <Pressable style={[styles.btnPrimary, busy && styles.disabled]} onPress={() => void compute()} disabled={busy}>
            <Text style={styles.btnPrimaryText}>{busy ? 'Computing…' : 'Compute'}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  back: { color: '#7EDCFF', fontWeight: '900' },
  title: { color: '#FFF', fontWeight: '900', fontSize: 20 },
  center: { padding: 18, alignItems: 'center', gap: 10 },
  cardTitle: { color: '#EAF8FD', fontWeight: '900', fontSize: 14 },
  meta: { color: '#A9C4CF', fontWeight: '700', marginTop: 10, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 10 },
  btn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { color: '#EAF2FF', fontWeight: '900' },
  btnPrimary: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: '#00D9FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimaryText: { color: '#00141A', fontWeight: '900' },
  disabled: { opacity: 0.6 },
  insight: { padding: 14 },
  insightTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  insightTitle: { color: '#FFF', fontWeight: '900', fontSize: 16, flex: 1 },
  insightBody: { color: '#BFD3DC', fontWeight: '700', marginTop: 10, lineHeight: 18 },
  insightMeta: { color: '#86A8B6', fontWeight: '800', marginTop: 10, fontSize: 12 },
  insightActions: { marginTop: 12, flexDirection: 'row', justifyContent: 'flex-end' },
  dismissBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  dismissText: { color: '#EAF2FF', fontWeight: '900' },
});

