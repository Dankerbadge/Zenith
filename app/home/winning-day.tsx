import { router } from 'expo-router'; import React, { useEffect, useState } from 'react'; import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../components/ui/GlassCard';
import { getDailyLog, getUserProfile, todayKey } from '../../utils/storageUtils';
import { getActiveDaySignals } from '../../utils/semanticTrust';
import { evaluateWinningDay } from '../../utils/winningSystem';

export default function WinningDayDetailsScreen() {
  const [streakChecks, setStreakChecks] = useState({
    food: false,
    water: false,
    workout: false,
    rest: false,
    weight: false,
  });

  const [winningChecks, setWinningChecks] = useState({
    winningDay: false,
    workout: false,
    rest: false,
  });

  useEffect(() => {
    const load = async () => {
      const [log, profile] = await Promise.all([getDailyLog(todayKey()), getUserProfile()]);
      const signals = getActiveDaySignals(log);
      const evaluated = evaluateWinningDay(log, profile.goals || {});
      setStreakChecks({
        food: signals.foodLogged,
        water: signals.waterLogged,
        workout: signals.workoutLogged,
        rest: signals.restLogged,
        weight: signals.weightLogged,
      });
      setWinningChecks({
        winningDay: evaluated.winningDay,
        workout: evaluated.workoutDone,
        rest: evaluated.restDone,
      });
    };
    void load();
  }, []);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}><Text style={styles.back}>Back</Text></Pressable>
          <Text style={styles.title}>Winning Day Details</Text>
          <View style={{ width: 40 }} />
        </View>

        <GlassCard>
          <Text style={styles.section}>What advances your streak</Text>
          <Text style={styles.item}>{streakChecks.food ? '✓' : '○'} Log food / calories</Text>
          <Text style={styles.item}>{streakChecks.water ? '✓' : '○'} Log water</Text>
          <Text style={styles.item}>{streakChecks.workout ? '✓' : '○'} Log a workout</Text>
          <Text style={styles.item}>{streakChecks.rest ? '✓' : '○'} Log active rest</Text>
          <Text style={styles.item}>{streakChecks.weight ? '✓' : '○'} Log weight</Text>
        </GlassCard>

        <View style={{ height: 10 }} />
        <GlassCard>
          <Text style={styles.section}>What secures a Winning Day</Text>
          <Text style={styles.item}>{winningChecks.winningDay ? '✓' : '○'} Winning Day secured</Text>
          <Text style={styles.item}>{winningChecks.workout ? '✓' : '○'} Workout logged</Text>
          <Text style={styles.item}>{winningChecks.rest ? '✓' : '○'} Active rest completed</Text>
        </GlassCard>

        <View style={{ height: 10 }} />
        <GlassCard>
          <Text style={styles.section}>Do this now</Text>
          <Pressable style={styles.button} onPress={() => router.push('/(modals)/workout' as any)}><Text style={styles.buttonText}>Log Workout</Text></Pressable>
          <Pressable style={styles.button} onPress={() => router.push('/(modals)/rest' as any)}><Text style={styles.buttonText}>Log Active Rest</Text></Pressable>
          <Pressable style={styles.button} onPress={() => router.push('/(modals)/food' as any)}><Text style={styles.buttonText}>Log Food</Text></Pressable>
          <Pressable style={styles.button} onPress={() => router.push('/(modals)/water' as any)}><Text style={styles.buttonText}>Log Water</Text></Pressable>
          <Pressable style={styles.button} onPress={() => router.push('/(modals)/weight' as any)}><Text style={styles.buttonText}>Log Weight</Text></Pressable>
        </GlassCard>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  content: { padding: 16, paddingBottom: 40 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  back: { color: '#7EDCFF', fontWeight: '700' },
  title: { color: '#FFF', fontWeight: '800', fontSize: 20 },
  section: { color: '#FFF', fontWeight: '800', marginBottom: 8 },
  item: { color: '#D0D0D0', fontWeight: '600', marginBottom: 8 },
  button: { marginTop: 8, backgroundColor: '#141414', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#2A2A2A' },
  buttonText: { color: '#FFF', fontWeight: '700' },
});
