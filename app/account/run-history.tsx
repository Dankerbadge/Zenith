import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../components/ui/GlassCard';
import Badge from '../../components/ui/Badge';
import { captureException } from '../../utils/crashReporter';

function safeParseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

type RunRow = {
  runId?: string;
  timestamp?: string;
  title?: string;
  distance?: number;
  duration?: number;
  pausedTimeSec?: number;
  averagePace?: number;
  xpEarned?: number;
  sessionRecovered?: boolean;
};

function formatDateTime(iso: string): string {
  const dt = new Date(iso);
  if (!Number.isFinite(dt.getTime())) return iso;
  return dt.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatMiles(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '—';
  return `${v.toFixed(2)} mi`;
}

function formatMinutes(durationSec: unknown, pausedSec: unknown): string {
  const d = Number(durationSec);
  if (!Number.isFinite(d) || d <= 0) return '—';
  const p = Math.max(0, Number(pausedSec) || 0);
  const moving = Math.max(0, d - p);
  return `${Math.round(moving / 60)} min`;
}

export default function RunHistoryScreen() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const raw = await AsyncStorage.getItem('runsHistory');
      const parsed = safeParseJson<any[]>(raw, []);
      const list = (Array.isArray(parsed) ? parsed : []) as RunRow[];
      list.sort((a, b) => new Date(String(a?.timestamp || 0)).getTime() - new Date(String(b?.timestamp || 0)).getTime());
      setRuns(list.reverse());
    } catch (err: any) {
      void captureException(err, { feature: 'run_history', op: 'load' });
      setError(String(err?.message || 'Unable to load run history.'));
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const hasRuns = runs.length > 0;
  const visible = useMemo(() => runs.slice(0, 200), [runs]);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.back}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Run history</Text>
          <Pressable onPress={() => void load()} disabled={loading}>
            <Text style={[styles.back, loading && { opacity: 0.5 }]}>{loading ? '…' : 'Refresh'}</Text>
          </Pressable>
        </View>

        {error ? (
          <GlassCard>
            <Text style={styles.errorTitle}>Run history error</Text>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable style={styles.retryBtn} onPress={() => void load()} disabled={loading}>
              <Text style={styles.retryText}>{loading ? 'Retrying…' : 'Retry'}</Text>
            </Pressable>
          </GlassCard>
        ) : null}

        <GlassCard>
          <Text style={styles.kicker}>Runs</Text>
          {loading ? (
            <Text style={styles.empty}>Loading…</Text>
          ) : !hasRuns ? (
            <Text style={styles.empty}>No runs saved yet.</Text>
          ) : (
            visible.map((run, idx) => {
              const runId = String(run?.runId || '').trim();
              const ts = String(run?.timestamp || '').trim();
              const recovered = run?.sessionRecovered === true;
              const canOpen = Boolean(runId);
              const label = String(run?.title || 'Run');

              return (
                <Pressable
                  key={runId || ts || String(idx)}
                  style={[styles.row, !canOpen && { opacity: 0.6 }]}
                  disabled={!canOpen}
                  onPress={() => router.push({ pathname: '/run-summary', params: { runId } } as any)}
                >
                  <View style={{ flex: 1 }}>
                    <View style={styles.rowTop}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {label}
                      </Text>
                      {recovered ? <Badge label="Recovered (partial)" tone="warning" /> : null}
                    </View>
                    <Text style={styles.rowMeta}>
                      {ts ? formatDateTime(ts) : '—'} · {formatMiles(run?.distance)} · {formatMinutes(run?.duration, run?.pausedTimeSec)}
                    </Text>
                  </View>
                  <Text style={styles.chevron}>→</Text>
                </Pressable>
              );
            })
          )}
        </GlassCard>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  back: { color: '#7EDCFF', fontWeight: '900' },
  title: { color: '#FFF', fontWeight: '900', fontSize: 20 },
  kicker: { color: '#9EB8C1', fontWeight: '900', fontSize: 11, letterSpacing: 1, marginBottom: 8 },
  empty: { color: '#A7A7A7', fontWeight: '700', marginTop: 6 },
  row: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowTitle: { color: '#FFF', fontWeight: '900', flexShrink: 1 },
  rowMeta: { color: '#9FC1CF', fontWeight: '700', marginTop: 6 },
  chevron: { color: '#CFEAF4', fontSize: 18, fontWeight: '900' },
  errorTitle: { color: '#FFF', fontWeight: '900' },
  errorText: { color: '#A7A7A7', fontWeight: '700', marginTop: 8 },
  retryBtn: {
    marginTop: 10,
    minHeight: 40,
    alignSelf: 'flex-start',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0,217,255,0.35)',
    backgroundColor: 'rgba(0,217,255,0.14)',
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: { color: '#BFF3FF', fontWeight: '900' },
});

