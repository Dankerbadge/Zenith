import { useLocalSearchParams, router } from 'expo-router'; import React, { useEffect, useState } from 'react'; import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../../components/ui/GlassCard';
import { getDailyLog, WorkoutEntry } from '../../../utils/storageUtils';

export default function StatsDayDetailScreen() {
  const { date } = useLocalSearchParams<{ date: string }>();
  const [log, setLog] = useState<any>({});

  useEffect(() => {
    const load = async () => {
      if (!date) return;
      setLog(await getDailyLog(date));
    };
    void load();
  }, [date]);

  const workouts = (Array.isArray(log.workouts) ? log.workouts : []) as WorkoutEntry[];
  const restEntries = Array.isArray(log.activeRest) ? log.activeRest : [];
  const restMinutes = restEntries.reduce(
    (sum: number, r: { minutes?: number }) => sum + (Number(r?.minutes) || 0),
    0
  );

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}><Text style={styles.back}>Back</Text></Pressable>
          <Text style={styles.title}>Day Detail</Text>
          <View style={{ width: 40 }} />
        </View>

        <GlassCard>
          <Text style={styles.section}>{date}</Text>
          <Text style={styles.item}>Calories: {Math.round(Number(log.calories) || 0)}</Text>
          <Text style={styles.item}>Protein: {Math.round(Number(log.macros?.protein) || 0)}g</Text>
          <Text style={styles.item}>Water: {Math.round(Number(log.water) || 0)}oz</Text>
          <Text style={styles.item}>Weight: {typeof log.weight === 'number' ? `${log.weight.toFixed(1)} lb` : 'Not logged'}</Text>
          <Text style={styles.item}>Workouts: {workouts.length}</Text>
          <Text style={styles.item}>Active rest: {restMinutes} min</Text>
        </GlassCard>

        {workouts.map((session) => (
          <GlassCard key={session.id}>
            <Text style={styles.section}>{session.label || session.type} · {session.intensity}</Text>
            <Text style={styles.item}>
              {session.totalSets || 0} sets · {Math.round(Number(session.totalVolume) || 0).toLocaleString()} volume
              {session.durationMin ? ` · ${session.durationMin} min` : ''}
            </Text>
            {String((session as any).workoutClass || '').toLowerCase() === 'run' ? (
              <View style={styles.lockTag}>
                <Text style={styles.lockTagText}>Run metrics lock after save (title/notes only)</Text>
              </View>
            ) : null}
            {(session as any).lateLoggedNoXP === true ? (
              <View style={styles.policyTag}>
                <Text style={styles.policyTagText}>Logged later · XP and streak outcomes were locked</Text>
              </View>
            ) : null}
            {Array.isArray(session.exercises) && session.exercises.length ? (
              session.exercises.map((exercise, idx) => (
                <View key={`${exercise.name}-${idx}`} style={styles.exerciseWrap}>
                  <Text style={styles.exerciseTitle}>{exercise.name}</Text>
                  {exercise.sets.map((set, setIndex) => (
                    <Text key={`${exercise.name}-${setIndex}`} style={styles.exerciseSet}>
                      #{set.setIndex} · {set.weight}{set.weightUnit} x {set.reps}
                      {typeof set.rpe === 'number' ? ` @RPE ${set.rpe}` : ''}
                    </Text>
                  ))}
                </View>
              ))
            ) : (
              <Text style={styles.item}>No set detail for this session.</Text>
            )}
          </GlassCard>
        ))}
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
  item: { color: '#D0D0D0', fontWeight: '600', marginBottom: 6 },
  lockTag: {
    borderWidth: 1,
    borderColor: 'rgba(126,220,255,0.35)',
    backgroundColor: 'rgba(126,220,255,0.10)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginBottom: 8,
  },
  lockTagText: { color: '#D7F3FF', fontWeight: '700', fontSize: 11 },
  policyTag: {
    borderWidth: 1,
    borderColor: 'rgba(255,191,71,0.45)',
    backgroundColor: 'rgba(255,191,71,0.12)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginBottom: 8,
  },
  policyTagText: { color: '#FFE3B9', fontWeight: '700', fontSize: 11 },
  exerciseWrap: { marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' },
  exerciseTitle: { color: '#EAF8FF', fontWeight: '700', marginBottom: 4, fontSize: 12 },
  exerciseSet: { color: '#C4DBE5', fontWeight: '600', fontSize: 12, marginBottom: 2 },
});
