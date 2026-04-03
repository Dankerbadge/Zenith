import { router } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../components/ui/GlassCard';
import SectionHeader from '../../components/ui/SectionHeader';

const OPTIONS = [
  { key: 'weekly_distance', title: 'Weekly Distance (Run)', unit: 'mi' },
  { key: 'weekly_active_calories', title: 'Weekly Active Calories', unit: 'kcal' },
  { key: 'weekly_workout_count', title: 'Weekly Workout Count', unit: 'sessions' },
  { key: 'weekly_xp', title: 'Weekly XP', unit: 'xp' },
];

export default function LeaderboardsHomeScreen() {
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Leaderboards</Text>
          <View style={{ width: 60 }} />
        </View>

        <SectionHeader title="CATEGORIES" />
        <GlassCard>
          {OPTIONS.map((entry) => (
            <Pressable key={entry.key} style={styles.card} onPress={() => router.push(`/leaderboards/${entry.key}?timeframe=WEEK` as any)}>
              <Text style={styles.cardTitle}>{entry.title}</Text>
              <Text style={styles.cardMeta}>Tap to view ranking · {entry.unit}</Text>
            </Pressable>
          ))}
        </GlassCard>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  content: { padding: 16, paddingBottom: 32 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { minHeight: 44, minWidth: 60, justifyContent: 'center' },
  backText: { color: '#8FDBFF', fontWeight: '800' },
  title: { color: '#FFFFFF', fontWeight: '900', fontSize: 20 },
  card: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1B1B1B' },
  cardTitle: { color: '#EAF8FD', fontWeight: '900' },
  cardMeta: { color: '#8FA6AE', marginTop: 4, fontWeight: '700', fontSize: 12 },
});
