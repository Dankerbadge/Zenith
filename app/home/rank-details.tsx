import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router'; import React, { useEffect, useState } from 'react'; import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../components/ui/GlassCard';
import { calculateCurrentRank, RANKS } from '../../constants/ranks';
import { getWinningSnapshot } from '../../utils/winningSystem';

export default function RankDetailsScreen() {
  const [totalWinningDays, setTotalWinningDays] = useState(0);
  const [totalXP, setTotalXP] = useState(0);

  useEffect(() => {
    const load = async () => {
      const [snapshot, rawProgress] = await Promise.all([getWinningSnapshot(), AsyncStorage.getItem('userProgress')]);
      let xp = 0;
      try {
        const parsed = rawProgress ? JSON.parse(rawProgress) : null;
        xp = Math.max(0, Number(parsed?.totalXP) || 0);
      } catch {
        xp = 0;
      }
      setTotalWinningDays(snapshot.totalWinningDays);
      setTotalXP(xp);
    };
    void load();
  }, []);

  const currentRank = calculateCurrentRank(totalXP, totalWinningDays);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}><Text style={styles.back}>Back</Text></Pressable>
          <Text style={styles.title}>Rank Details</Text>
          <View style={{ width: 40 }} />
        </View>

        <GlassCard style={styles.heroCard}>
          <Text style={styles.section}>Current Rank</Text>
          <Text style={styles.current}>{currentRank.icon} {currentRank.name}</Text>
          <Text style={styles.req}>{totalWinningDays}+ winning days · {totalXP.toLocaleString()} XP</Text>
        </GlassCard>

        <Text style={styles.sectionTitle}>Tier List</Text>
        {RANKS.map((tier) => (
          <GlassCard key={tier.id} style={styles.tierCard}>
            <Text style={styles.name}>{tier.icon} {tier.name}</Text>
            <Text style={styles.req}>{tier.winningDaysRequired}+ winning days</Text>
          </GlassCard>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  content: { padding: 16, paddingBottom: 40, gap: 10 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  back: { color: '#7EDCFF', fontWeight: '700' },
  title: { color: '#FFF', fontWeight: '800', fontSize: 20 },
  heroCard: { marginBottom: 2 },
  sectionTitle: { color: 'rgba(255,255,255,0.72)', fontWeight: '800', fontSize: 12, letterSpacing: 1.1, marginTop: 4 },
  current: { color: '#C5EEFF', fontWeight: '900', fontSize: 18, marginTop: 6 },
  section: { color: '#FFF', fontWeight: '800', marginBottom: 2 },
  tierCard: { marginBottom: 2 },
  name: { color: '#FFF', fontWeight: '700' },
  req: { color: '#AFAFAF', marginTop: 4, fontWeight: '600' },
});
