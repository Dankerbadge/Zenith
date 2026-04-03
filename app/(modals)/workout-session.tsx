import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, useLocalSearchParams } from "expo-router"; import React, { useEffect, useMemo, useState } from "react"; import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getDailyLog, safeParseJson, WorkoutEntry } from "../../utils/storageUtils";

const WORKOUT_TEMPLATES_KEY = "workoutTemplates";

export default function WorkoutSessionModal() {
  const params = useLocalSearchParams<{ date?: string; sessionId?: string }>();
  const date = typeof params.date === "string" ? params.date : "";
  const sessionId = typeof params.sessionId === "string" ? params.sessionId : "";
  const [session, setSession] = useState<WorkoutEntry | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (!date || !sessionId) return;
      const day = await getDailyLog(date);
      const sessions = (Array.isArray(day.workouts) ? day.workouts : []) as WorkoutEntry[];
      const found = sessions.find((row) => row.id === sessionId) || null;
      if (!alive) return;
      setSession(found);
    };
    void load();
    return () => {
      alive = false;
    };
  }, [date, sessionId]);

  const summary = useMemo(() => {
    if (!session) return null;
    return {
      sets: Number(session.totalSets) || 0,
      reps: Number(session.totalReps) || 0,
      volume: Number(session.totalVolume) || 0,
      exercises: Number(session.exerciseCount) || (Array.isArray(session.exercises) ? session.exercises.length : 0),
    };
  }, [session]);

  const copyAsTemplate = async () => {
    if (!session) return;
    const template = {
      id: `tpl_${Date.now()}`,
      name: session.label || `${session.type} template`,
      type: session.type,
      intensity: session.intensity,
      minutes: session.durationMin || session.minutes,
      sessionNote: session.note,
      exercises: Array.isArray(session.exercises) ? session.exercises : [],
      createdAt: new Date().toISOString(),
    };
    try {
      const raw = await AsyncStorage.getItem(WORKOUT_TEMPLATES_KEY);
      const parsed = safeParseJson<any[]>(raw, []);
      const next = [template, ...(Array.isArray(parsed) ? parsed : [])].slice(0, 30);
      await AsyncStorage.setItem(WORKOUT_TEMPLATES_KEY, JSON.stringify(next));
      Alert.alert("Saved", "Template copied to Workout templates.");
    } catch {
      Alert.alert("Error", "Could not save template.");
    }
  };

  const repeatToday = () => {
    if (!session || !date) return;
    router.push(`/(modals)/workout?repeatDate=${encodeURIComponent(date)}&repeatSessionId=${encodeURIComponent(session.id)}` as any);
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.back}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Session Detail</Text>
          <View style={{ width: 42 }} />
        </View>

        {!session ? (
          <View style={styles.card}>
            <Text style={styles.emptyText}>Session not found.</Text>
          </View>
        ) : (
          <>
            {session.sessionRecovered ? (
              <View style={styles.recoveredBanner}>
                <Text style={styles.recoveredTitle}>Recovered (partial)</Text>
                <Text style={styles.recoveredText}>Some metrics may be missing due to device restart/crash.</Text>
              </View>
            ) : null}
            <View style={styles.card}>
              <Text style={styles.primary}>{session.label || session.type}</Text>
              <Text style={styles.sub}>
                {date} · {session.intensity}
                {session.durationMin ? ` · ${session.durationMin} min` : ""}
              </Text>
              <Text style={styles.sub}>
                {summary?.sets || 0} sets · {Math.round(summary?.volume || 0).toLocaleString()} volume · {session.caloriesBurned || 0} kcal
              </Text>
              <View style={styles.actionsRow}>
                <Pressable style={styles.actionButton} onPress={copyAsTemplate}>
                  <Text style={styles.actionText}>Copy as template</Text>
                </Pressable>
                <Pressable style={styles.actionButton} onPress={repeatToday}>
                  <Text style={styles.actionText}>Repeat today</Text>
                </Pressable>
              </View>
            </View>

            {Array.isArray(session.exercises) && session.exercises.length ? (
              session.exercises.map((exercise, idx) => (
                <View key={`${exercise.name}-${idx}`} style={styles.card}>
                  <Text style={styles.exerciseTitle}>{exercise.name}</Text>
                  {exercise.sets.map((set, setIndex) => (
                    <Text key={`${exercise.name}-${setIndex}`} style={styles.setText}>
                      #{set.setIndex} · {set.weight}
                      {set.weightUnit} x {set.reps}
                      {typeof set.rpe === "number" ? ` @RPE ${set.rpe}` : ""}
                      {set.setType ? ` · ${set.setType}` : ""}
                    </Text>
                  ))}
                </View>
              ))
            ) : (
              <View style={styles.card}>
                <Text style={styles.emptyText}>No set breakdown for this session.</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0A0A0A" },
  container: { padding: 16, paddingBottom: 40 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  back: { color: "#00D9FF", fontWeight: "700" },
  title: { color: "#FFF", fontWeight: "800", fontSize: 20 },
  recoveredBanner: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.45)",
    backgroundColor: "rgba(251,191,36,0.12)",
    padding: 12,
    marginBottom: 10,
  },
  recoveredTitle: { color: "#FDE68A", fontWeight: "900" },
  recoveredText: { color: "#F5E9B7", fontWeight: "700", marginTop: 6, lineHeight: 18 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#262626",
    backgroundColor: "#121212",
    padding: 12,
    marginBottom: 10,
  },
  primary: { color: "#E7F8FF", fontWeight: "900", fontSize: 16 },
  sub: { color: "#9FC1CF", fontWeight: "600", marginTop: 4, fontSize: 12 },
  exerciseTitle: { color: "#FFF", fontWeight: "800", marginBottom: 6 },
  setText: { color: "#D6ECF5", fontWeight: "600", fontSize: 12, marginBottom: 3 },
  emptyText: { color: "#9CB0BA", fontWeight: "600" },
  actionsRow: { marginTop: 10, flexDirection: "row", gap: 8 },
  actionButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#2C3C44",
    backgroundColor: "#142026",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  actionText: { color: "#D3EDF7", fontWeight: "800", fontSize: 12 },
});
