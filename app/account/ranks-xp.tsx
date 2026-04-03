import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router'; import React, { useCallback, useEffect, useMemo, useState } from 'react'; import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../components/ui/GlassCard';
import { calculateCurrentRank, getNextRank } from '../../constants/ranks';
import { getWinningSnapshot } from '../../utils/winningSystem';
import { subscribeDailyLogChanged } from '../../utils/dailyLogEvents';

function parseProgress(raw: string | null) {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    return {
      totalXP: Number(parsed?.totalXP) || 0,
      totalWinningDays: Number(parsed?.totalWinningDays) || 0,
    };
  } catch {
    return { totalXP: 0, totalWinningDays: 0 };
  }
}

function formatInt(n: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return Math.round(v).toLocaleString();
}

export default function RanksXpScreen() {
  const [totalXP, setTotalXP] = useState(0);
  const [totalWinningDays, setTotalWinningDays] = useState(0);
  const [currentStreak, setCurrentStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);

  const load = useCallback(async () => {
    const [raw, winning] = await Promise.all([AsyncStorage.getItem('userProgress'), getWinningSnapshot()]);
    const progress = parseProgress(raw);
    setTotalXP(progress.totalXP);
    setTotalWinningDays(winning.totalWinningDays || progress.totalWinningDays);
    setCurrentStreak(winning.currentStreak);
    setBestStreak(winning.bestStreak);
  }, []);

  useEffect(() => {
    void load();
    const unsubscribe = subscribeDailyLogChanged(() => {
      void load();
    });
    return unsubscribe;
  }, [load]);

  const rank = useMemo(() => calculateCurrentRank(totalXP, totalWinningDays), [totalXP, totalWinningDays]);
  const next = useMemo(() => getNextRank(rank.id), [rank.id]);
  const xpRemaining = next ? Math.max(0, next.pointsRequired - totalXP) : null;
  const daysRemaining = next ? Math.max(0, next.winningDaysRequired - totalWinningDays) : null;

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.back}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Ranks & XP</Text>
          <View style={{ width: 40 }} />
        </View>

        <GlassCard>
          <Text style={styles.kicker}>Current rank</Text>
          <Text style={[styles.hero, { color: rank.color }]}>{rank.icon} {rank.name}</Text>
          <Text style={styles.meta}>Total XP: {formatInt(totalXP)}</Text>
          <Text style={styles.meta}>Winning days: {formatInt(totalWinningDays)}</Text>
          <Text style={styles.meta}>Streak: {formatInt(currentStreak)} (best {formatInt(bestStreak)})</Text>
        </GlassCard>

        <GlassCard style={{ marginTop: 12 }}>
          <Text style={styles.kicker}>Next rank</Text>
          {next ? (
            <>
              <Text style={styles.heroSmall}>{next.icon} {next.name}</Text>
              <Text style={styles.meta}>XP remaining: {formatInt(xpRemaining || 0)}</Text>
              <Text style={styles.meta}>Winning days remaining: {formatInt(daysRemaining || 0)}</Text>
            </>
          ) : (
            <>
              <Text style={styles.heroSmall}>⚡ Zenith</Text>
              <Text style={styles.meta}>You’ve reached the top rank.</Text>
            </>
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
  hero: { color: '#FFF', fontWeight: '900', fontSize: 24 },
  heroSmall: { color: '#FFF', fontWeight: '900', fontSize: 18 },
  meta: { color: '#A7A7A7', fontWeight: '700', marginTop: 8 },
});
