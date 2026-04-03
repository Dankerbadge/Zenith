import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import FlameMark from '../../components/icons/FlameMark';
import GlassCard from '../../components/ui/GlassCard';
import { getWinningSnapshot, type WinningHistoryRow } from '../../utils/winningSystem';

function formatInt(n: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return Math.round(v).toLocaleString();
}

function formatDate(dateKey: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return dateKey;
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function StreakHistoryScreen() {
  const [history, setHistory] = useState<WinningHistoryRow[]>([]);
  const [currentStreak, setCurrentStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [totalWinningDays, setTotalWinningDays] = useState(0);

  const load = useCallback(async () => {
    const snap = await getWinningSnapshot(120);
    setHistory(snap.history || []);
    setCurrentStreak(snap.currentStreak);
    setBestStreak(snap.bestStreak);
    setTotalWinningDays(snap.totalWinningDays);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const recent = useMemo(() => [...history].slice(-30).reverse(), [history]);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.back}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Streak history</Text>
          <View style={{ width: 40 }} />
        </View>

        <GlassCard>
          <Text style={styles.kicker}>Snapshot</Text>
          <View style={styles.heroRow}>
            <FlameMark size={18} color={currentStreak > 0 ? '#FF9F0A' : 'rgba(255,255,255,0.45)'} />
            <Text style={styles.heroText}>{formatInt(currentStreak)} day streak</Text>
          </View>
          <Text style={styles.meta}>Best streak: {formatInt(bestStreak)}</Text>
          <Text style={styles.meta}>Total winning days: {formatInt(totalWinningDays)}</Text>
        </GlassCard>

        <GlassCard style={{ marginTop: 12 }}>
          <Text style={styles.kicker}>Last 30 days</Text>
          {recent.length ? (
            recent.map((row) => (
              <View key={row.date} style={styles.row}>
                <Text style={styles.rowDate}>{formatDate(row.date)}</Text>
                <Text style={[styles.rowStatus, row.winningDay ? styles.win : styles.miss]}>
                  {row.winningDay ? 'Winning day' : 'Miss'}
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.empty}>No history yet.</Text>
          )}
        </GlassCard>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  content: { padding: 16, paddingBottom: 40 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  back: { color: '#7EDCFF', fontWeight: '800' },
  title: { color: '#FFF', fontWeight: '900', fontSize: 20 },
  kicker: { color: '#9EB8C1', fontWeight: '900', fontSize: 11, letterSpacing: 1, marginBottom: 8 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroText: { color: '#FFF', fontWeight: '900', fontSize: 20 },
  meta: { color: '#A7A7A7', fontWeight: '700', marginTop: 8 },
  row: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowDate: { color: '#EAEAEA', fontWeight: '800' },
  rowStatus: { fontWeight: '900' },
  win: { color: '#00FF88' },
  miss: { color: '#FF8A8A' },
  empty: { color: '#A7A7A7', fontWeight: '700', marginTop: 8 },
});
