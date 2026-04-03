import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import GlassCard from './ui/GlassCard';
import ConfidenceBadge, { type ConfidenceTier } from './ui/ConfidenceBadge';
import { isSupabaseConfigured, supabase } from '../utils/supabaseClient';
import { computeInsights, computeNutritionAggregates, computeReadiness, computeTrainingLoad } from '../utils/premiumComputeService';
import { getFeatureLimits, isProEntitled } from '../utils/featureGate';

function isoDay(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function joinReasons(reasons: unknown) {
  const arr = Array.isArray(reasons) ? reasons : [];
  return arr.map((r) => String(r || '').trim()).filter(Boolean).slice(0, 3).join(' · ');
}

function asTier(v: any): ConfidenceTier {
  const s = String(v || '').toUpperCase();
  if (s === 'HIGH' || s === 'MEDIUM' || s === 'LOW') return s as ConfidenceTier;
  return 'LOW';
}

export default function DailyBriefingCard(props: { onOpenDetails?: () => void }) {
  const [loading, setLoading] = useState(true);
  const [busyCompute, setBusyCompute] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brief, setBrief] = useState<any>(null);
  const [dismissed, setDismissed] = useState(false);

  const today = useMemo(() => isoDay(new Date()), []);
  const dismissKey = useMemo(() => `zenith:daily-briefing-dismissed:${today}`, [today]);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setBrief(null);
      setError('Supabase not configured.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const limits = await getFeatureLimits();
      const days = limits.trainingLoadHistoryDays ?? 7;
      const from = isoDay(new Date(Date.now() - (days - 1) * 86400000));

      const [isPro, rd, tl, nut, ins] = await Promise.all([
        isProEntitled(),
        supabase.from('readiness_daily').select('*').eq('day', today).maybeSingle(),
        supabase.from('training_load_daily').select('*').eq('day', today).maybeSingle(),
        supabase.from('nutrition_daily').select('*').eq('day', today).maybeSingle(),
        supabase.from('insights').select('*').gte('day', from).lte('day', today).order('day', { ascending: false }).order('created_at', { ascending: false }).limit(20),
      ]);

      const readiness = rd.data || null;
      const training = tl.data || null;
      const nutrition = nut.data || null;
      const insights = Array.isArray(ins.data) ? ins.data : [];

      // One priority heuristic (rules-first):
      // - If readiness suggests RECOVER: prioritize recovery action.
      // - Else if there's a protein insight: prioritize fueling action.
      // - Else: prioritize completing today's quest (app already has this loop).
      let priority = { title: 'If you do one thing today…', action: 'Finish today’s quest.' };
      const rec = String(readiness?.recommendation || '').toUpperCase();
      if (rec === 'RECOVER') priority = { title: 'If you do one thing today…', action: 'Do a recovery session (walk + mobility) and sleep early.' };
      const proteinInsight = insights.find((i: any) => String(i.type || '') === 'FUELING_PROTEIN');
      if (rec !== 'RECOVER' && proteinInsight) priority = { title: 'If you do one thing today…', action: 'Hit your protein target today.' };

      setBrief({
        isPro,
        readiness,
        training,
        nutrition,
        insightsToday: insights.filter((i: any) => String(i.day) === today).slice(0, 3),
        priority,
      });
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [today]);

  const computeNow = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    if (busyCompute) return;
    setBusyCompute(true);
    setError(null);
    try {
      await computeNutritionAggregates();
      await computeTrainingLoad();
      await computeReadiness({ day: today });
      await computeInsights({ day: today });
      await refresh();
    } catch (e: any) {
      Alert.alert('Daily Briefing', String(e?.message || e));
    } finally {
      setBusyCompute(false);
    }
  }, [busyCompute, refresh, today]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(dismissKey);
        if (!alive) return;
        setDismissed(raw === '1');
      } catch {
        if (!alive) return;
        setDismissed(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [dismissKey]);

  const dismissForToday = useCallback(async () => {
    setDismissed(true);
    try {
      await AsyncStorage.setItem(dismissKey, '1');
    } catch {}
  }, [dismissKey]);

  const showAgain = useCallback(async () => {
    setDismissed(false);
    try {
      await AsyncStorage.removeItem(dismissKey);
    } catch {}
  }, [dismissKey]);

  const readinessTier = asTier(brief?.readiness?.confidence);
  const rec = String(brief?.readiness?.recommendation || 'MAINTAIN').toUpperCase();

  const headline = useMemo(() => {
    if (!brief?.readiness) return 'Readiness unavailable';
    const score = Number(brief.readiness.readiness_score);
    const scoreText = Number.isFinite(score) ? `${score}` : '--';
    return `${scoreText} · ${rec}`;
  }, [brief, rec]);

  const why = useMemo(() => {
    const reasons = joinReasons(brief?.readiness?.reasons);
    if (reasons) return reasons;
    if (!brief?.readiness) return 'Compute requires sleep + recovery inputs.';
    return 'Keep consistency. Numbers update as inputs improve.';
  }, [brief]);

  const fueling = useMemo(() => {
    const n = brief?.nutrition;
    if (!n) return 'Fueling: log meals to unlock targets.';
    const kcal = Math.round(Number(n.calories_kcal || 0));
    const p = Math.round(Number(n.protein_g || 0));
    const c = Math.round(Number(n.carbs_g || 0));
    const f = Math.round(Number(n.fat_g || 0));
    if (kcal <= 0 && p + c + f <= 0) return 'Fueling: no food logs yet today.';
    return `Fueling: ${kcal} kcal · P ${p} · C ${c} · F ${f}`;
  }, [brief]);

  if (dismissed) {
    return (
      <GlassCard style={styles.dismissedCard} highlightColor="#4A5870">
        <View style={styles.dismissedRow}>
          <Text style={styles.dismissedText}>Daily Briefing dismissed for today.</Text>
          <Pressable style={({ pressed }) => [styles.showBtn, pressed && styles.actionBtnPressed]} onPress={() => void showAgain()}>
            <Text style={styles.showBtnText}>Show</Text>
          </Pressable>
        </View>
      </GlassCard>
    );
  }

  return (
    <GlassCard style={styles.card} onPress={props.onOpenDetails} highlightColor="#00D9FF">
      <View style={styles.topRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>DAILY BRIEFING</Text>
          <Text style={styles.headline}>{headline}</Text>
        </View>
        {brief?.readiness ? <ConfidenceBadge tier={readinessTier} /> : null}
      </View>

      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color="#00D9FF" />
          <Text style={styles.loadingText}>Updating…</Text>
        </View>
      ) : error ? (
        <Text style={styles.meta}>Error: {error}</Text>
      ) : (
        <>
          <Text style={styles.meta}>{why}</Text>
          <Text style={styles.meta}>{fueling}</Text>
          <View style={styles.priorityRow}>
            <Text style={styles.priorityTitle}>{brief?.priority?.title || 'If you do one thing today…'}</Text>
            <Text style={styles.priorityAction}>{brief?.priority?.action || 'Finish today’s quest.'}</Text>
          </View>
        </>
      )}

      <View style={styles.actions}>
        <Pressable style={({ pressed }) => [styles.actionBtn, pressed && styles.actionBtnPressed]} onPress={() => void refresh()}>
          <Text style={styles.actionText}>Refresh</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.actionBtn, pressed && styles.actionBtnPressed]} onPress={() => void computeNow()} disabled={busyCompute}>
          <Text style={styles.actionText}>{busyCompute ? 'Computing…' : 'Compute'}</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.actionBtn, pressed && styles.actionBtnPressed]} onPress={() => void dismissForToday()}>
          <Text style={styles.actionText}>Dismiss</Text>
        </Pressable>
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 14,
    minHeight: 92,
    overflow: 'hidden',
  },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  kicker: { color: 'rgba(175, 242, 255, 0.88)', fontWeight: '900', fontSize: 12, letterSpacing: 0.5 },
  headline: { color: '#FFF', fontWeight: '900', fontSize: 20, marginTop: 6 },
  meta: { color: '#A9C4CF', fontWeight: '700', marginTop: 10, lineHeight: 18 },
  priorityRow: { marginTop: 12, gap: 6 },
  priorityTitle: { color: '#EAF8FD', fontWeight: '900' },
  priorityAction: { color: '#DDE7F2', fontWeight: '800', lineHeight: 18 },
  actions: { marginTop: 12, flexDirection: 'row', gap: 10 },
  actionBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnPressed: { backgroundColor: 'rgba(255,255,255,0.08)' },
  actionText: { color: '#EAF2FF', fontWeight: '900' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  loadingText: { color: '#BFEFFF', fontWeight: '800' },
  dismissedCard: {
    padding: 12,
    minHeight: 64,
    justifyContent: 'center',
  },
  dismissedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  dismissedText: { color: '#9DB0C5', fontWeight: '800', flex: 1 },
  showBtn: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(126,220,255,0.28)',
    backgroundColor: 'rgba(126,220,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  showBtnText: { color: '#C7F3FF', fontWeight: '900' },
});
