import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';

import GlassCard from '../../components/ui/GlassCard';
import {
  buildQuickActionTransparencyRows,
  getQuickActionPersonalizationState,
  loadQuickActionUsage,
  type QuickActionPersonalizationState,
} from '../../utils/quickActionPersonalization';
import { captureException } from '../../utils/crashReporter';

function prettyActionId(value: string) {
  return value
    .replace(/^loadout_/, '')
    .replaceAll('_', ' ')
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function prettyLastUsed(ms: number) {
  if (!ms) return 'Never';
  const diff = Date.now() - ms;
  if (!Number.isFinite(diff) || diff < 0) return 'Recently';
  const min = Math.floor(diff / (60 * 1000));
  if (min < 1) return 'Just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export default function QuickActionsPolicyScreen() {
  const params = useLocalSearchParams<{ mode?: string; fallback?: string }>();
  const hintedMode = String(params.mode || '').trim() as QuickActionPersonalizationState;
  const hintedFallback = String(params.fallback || '').trim();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [usage, setUsage] = useState<Record<string, { count: number; lastUsedAtMs: number }> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await loadQuickActionUsage();
      setUsage(next);
      setLoadError(null);
    } catch (err: any) {
      setUsage(null);
      setLoadError(String(err?.message || 'Unable to load quick-action usage.'));
      void captureException(err, { feature: 'quick_actions', op: 'load_usage' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mode = useMemo(() => {
    if (hintedMode === 'active' || hintedMode === 'insufficient_signal' || hintedMode === 'fallback') {
      return hintedMode;
    }
    return getQuickActionPersonalizationState(usage, hintedFallback);
  }, [hintedMode, usage, hintedFallback]);

  const ids = useMemo(() => Object.keys(usage || {}).sort(), [usage]);
  const rows = useMemo(
    () =>
      buildQuickActionTransparencyRows({
        actionIds: ids,
        usage,
        fallbackReason: hintedFallback,
      }),
    [ids, usage, hintedFallback]
  );

  const modeSummary =
    mode === 'active'
      ? 'Quick actions are personalized from your usage patterns.'
      : mode === 'fallback'
        ? 'Quick actions are currently using default ordering because personalization data is unavailable.'
        : 'Quick actions are using default ordering until enough usage signal is collected.';

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Quick Actions</Text>
          <View style={{ width: 52 }} />
        </View>

        <GlassCard style={styles.card}>
          <Text style={styles.section}>Personalization status</Text>
          <Text style={styles.body}>{loading ? 'Loading usage data…' : loadError ? 'Usage data failed to load.' : modeSummary}</Text>
          {loadError ? <Text style={styles.warn}>{loadError}</Text> : null}
          {hintedFallback ? <Text style={styles.warn}>{hintedFallback}</Text> : null}
          {loadError ? (
            <Pressable style={styles.retryBtn} onPress={() => void load()}>
              <Text style={styles.retryBtnText}>Retry</Text>
            </Pressable>
          ) : null}
        </GlassCard>

        <GlassCard>
          <Text style={styles.section}>Why these actions</Text>
          {rows.length ? (
            rows.map((row) => (
              <View key={row.actionId} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{prettyActionId(row.actionId)}</Text>
                  <Text style={styles.rowBody}>{row.reason}</Text>
                </View>
                <Text style={styles.meta}>{row.count}x</Text>
                <Text style={styles.meta}>{prettyLastUsed(row.lastUsedAtMs)}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.body}>No quick-action usage has been recorded yet.</Text>
          )}
        </GlassCard>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  content: { padding: 16, paddingBottom: 28 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  backBtn: { minHeight: 44, minWidth: 52, justifyContent: 'center' },
  backText: { color: '#8FDBFF', fontWeight: '800' },
  title: { color: '#FFFFFF', fontWeight: '900', fontSize: 20 },
  card: { marginBottom: 12 },
  section: { color: '#FFFFFF', fontWeight: '900', marginBottom: 8 },
  body: { color: '#C7D7DC', fontWeight: '700' },
  warn: { color: '#E8B182', fontWeight: '700', marginTop: 8 },
  retryBtn: {
    marginTop: 10,
    minHeight: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(232,177,130,0.45)',
    backgroundColor: 'rgba(232,177,130,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryBtnText: { color: '#FFD9B8', fontWeight: '900' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1C1C1C' },
  rowTitle: { color: '#F4FAFD', fontWeight: '800' },
  rowBody: { color: '#9EB0B8', fontWeight: '700', fontSize: 12, marginTop: 2 },
  meta: { color: '#8BBFD2', fontWeight: '800', fontSize: 12 },
});
