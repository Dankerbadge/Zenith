import { useLocalSearchParams, router } from 'expo-router'; import React, { useEffect, useMemo, useState } from 'react'; import { Alert, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../../components/ui/GlassCard';
import MiniChartCard from '../../../components/ui/MiniChartCard';
import { getMetricDefinition } from '../../../utils/metricValidity';
import { isActiveDay, isTrainingDay } from '../../../utils/semanticTrust';
import { getDailyLog, getUserProfile, todayKey } from '../../../utils/storageUtils';
import { evaluateWinningDay } from '../../../utils/winningSystem';

const RANGE_DAYS: Record<string, number> = { '7D': 7, '30D': 30, '90D': 90, '6M': 182, '1Y': 365 };

function getDateRange(days: number) {
  const out: string[] = [];
  const dayMs = 24 * 60 * 60 * 1000;
  for (let i = days - 1; i >= 0; i -= 1) {
    out.push(todayKey(new Date(Date.now() - i * dayMs)));
  }
  return out;
}

export default function StatsMetricDetail() {
  const params = useLocalSearchParams<{ metric?: string; range?: string; mode?: 'logged' | 'calendar' }>();
  const metric = params.metric || 'calories';
  const range = params.range || '30D';
  const mode = params.mode === 'calendar' ? 'calendar' : 'logged';
  const definition = useMemo(() => getMetricDefinition(String(metric)), [metric]);

  const [values, setValues] = useState<number[]>([]);
  const [history, setHistory] = useState<{ date: string; value: number; logged: boolean }[]>([]);
  const [exerciseQuery, setExerciseQuery] = useState('');
  const [exerciseRows, setExerciseRows] = useState<{ date: string; exercise: string; sets: number; volume: number }[]>([]);

  useEffect(() => {
    const load = async () => {
      const days = RANGE_DAYS[range] || 30;
      const profile = await getUserProfile();
      const restTarget = Number(profile.goals?.activeRestTargetMin) || 20;
      const dates = getDateRange(days);
      const logs = await Promise.all(dates.map((date) => getDailyLog(date)));

      const rows = logs.map((log, index) => {
        const workouts = Array.isArray(log.workouts) ? log.workouts : [];
        const activeRest = Array.isArray(log.activeRest) ? log.activeRest : [];
        const foodEntries = Array.isArray(log.foodEntries) ? log.foodEntries : [];
        const restMinutes = activeRest.reduce((sum, r) => sum + (Number(r?.minutes) || 0), 0);
        const evaluated = evaluateWinningDay(log, {
          activeRestTargetMin: restTarget,
          caloriesTarget: Number(profile.goals?.caloriesTarget) || undefined,
        });

        let value = 0;
        let logged = false;
        if (metric === 'protein') value = Number(log.macros?.protein) || 0;
        else if (metric === 'water') value = Number(log.water) || 0;
        else if (metric === 'weight') value = Number(log.weight) || 0;
        else if (metric === 'training') value = (workouts.length > 0 ? 1 : 0) + restMinutes / Math.max(restTarget, 1);
        else if (metric === 'winning-rate') value = evaluated.winningDay ? 1 : 0;
        else if (metric === 'streaks') value = evaluated.winningDay ? 1 : 0;
        else value = Number(log.calories) || 0;
        if (metric === 'calories') logged = value > 0 || foodEntries.length > 0;
        else if (metric === 'protein') logged = value > 0 || foodEntries.length > 0;
        else if (metric === 'water') logged = value > 0;
        else if (metric === 'weight') logged = typeof log.weight === 'number';
        else if (metric === 'training') logged = isTrainingDay(log || {}) || restMinutes > 0;
        else if (metric === 'winning-rate' || metric === 'streaks') {
          logged = isActiveDay(log || {});
        } else {
          logged = value > 0;
        }

        return { date: dates[index], value, logged };
      });

      if (metric === 'training') {
        const trainingRows = logs.flatMap((log, index) => {
          const workouts = Array.isArray(log.workouts) ? log.workouts : [];
          return workouts.flatMap((session: any) => {
            const exercises = Array.isArray(session?.exercises) ? session.exercises : [];
            return exercises.map((exercise: any) => ({
              date: dates[index],
              exercise: String(exercise?.name || 'Unknown'),
              sets: Array.isArray(exercise?.sets) ? exercise.sets.length : 0,
              volume: Array.isArray(exercise?.sets)
                ? exercise.sets.reduce((sum: number, s: any) => sum + (Number(s?.weight) || 0) * (Number(s?.reps) || 0), 0)
                : 0,
            }));
          });
        });
        setExerciseRows(trainingRows);
      } else {
        setExerciseRows([]);
      }

      setHistory(rows);
      setValues(rows.map((row) => row.value));
    };

    void load();
  }, [metric, range]);

  const insights = useMemo(() => {
    if (!history.length) return { avg: null as number | null, best: null as number | null, worst: null as number | null, trend: null as number | null, loggedDays: 0 };
    const loggedRows = history.filter((row) => row.logged);
    const loggedValues = loggedRows.map((row) => row.value);
    const valuesOnly = history.map((row) => row.value);
    if (mode === 'calendar') {
      const calendarAvg = valuesOnly.length ? valuesOnly.reduce((s, v) => s + v, 0) / valuesOnly.length : null;
      const best = valuesOnly.length ? Math.max(...valuesOnly) : null;
      const worst = valuesOnly.length ? Math.min(...valuesOnly) : null;
      const trend = valuesOnly.length >= 2 ? valuesOnly[valuesOnly.length - 1] - valuesOnly[0] : null;
      return { avg: calendarAvg, best, worst, trend, loggedDays: valuesOnly.length };
    }
    const avg = loggedValues.length ? loggedValues.reduce((s, v) => s + v, 0) / loggedValues.length : null;
    const best = loggedValues.length ? Math.max(...loggedValues) : null;
    const worst = loggedValues.length ? Math.min(...loggedValues) : null;
    const trend = loggedRows.length >= 2 ? loggedRows[loggedRows.length - 1].value - loggedRows[0].value : null;
    return { avg, best, worst, trend, loggedDays: loggedValues.length };
  }, [history, mode]);

  const filteredExercises = useMemo(() => {
    const q = exerciseQuery.trim().toLowerCase();
    if (!q) return exerciseRows.slice(0, 40);
    return exerciseRows.filter((row) => row.exercise.toLowerCase().includes(q)).slice(0, 40);
  }, [exerciseRows, exerciseQuery]);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScrollBeginDrag={Keyboard.dismiss}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}><Text style={styles.back}>Back</Text></Pressable>
          <Text style={styles.title}>{String(metric).toUpperCase()}</Text>
          <Pressable
            onPress={() =>
              Alert.alert(
                `${definition.title} Formula`,
                `${definition.formula}\n\nRequires: ${definition.requires}${definition.approximation ? `\n\nNote: ${definition.approximation}` : ''}`
              )
            }
          >
            <Text style={styles.info}>i</Text>
          </Pressable>
        </View>

        <MiniChartCard title={`${String(metric)} (${range})`} values={values} color='#00D9FF' />

        <View style={{ height: 10 }} />
        <GlassCard>
          <Text style={styles.section}>Insights</Text>
          <Text style={styles.item}>Average ({mode === 'logged' ? 'logged days' : 'calendar days'}): {insights.avg === null ? '—' : Math.round(insights.avg)}</Text>
          <Text style={styles.item}>
            {mode === 'logged'
              ? (insights.loggedDays > 0 ? `${insights.loggedDays} logged days` : 'No logs in this range.')
              : `${insights.loggedDays} calendar days`}
          </Text>
          <Text style={styles.item}>Best day: {insights.best === null ? '—' : Math.round(insights.best)}</Text>
          <Text style={styles.item}>Lowest day: {insights.worst === null ? '—' : Math.round(insights.worst)}</Text>
          <Text style={styles.item}>Trend: {insights.trend === null ? '—' : `${insights.trend >= 0 ? '+' : ''}${Math.round(insights.trend)}`}</Text>
        </GlassCard>

        <View style={{ height: 10 }} />
        <GlassCard>
          <Text style={styles.section}>How this is computed</Text>
          <Text style={styles.item}>{definition.formula}</Text>
          <Text style={styles.item}>Requires: {definition.requires}</Text>
          {definition.approximation ? <Text style={styles.item}>Note: {definition.approximation}</Text> : null}
        </GlassCard>

        <View style={{ height: 10 }} />
        {metric === 'training' ? (
          <GlassCard>
            <Text style={styles.section}>Exercise Search</Text>
            <TextInput
              style={styles.input}
              placeholder='Search exercise name...'
              placeholderTextColor='#7B7B7B'
              value={exerciseQuery}
              onChangeText={setExerciseQuery}
            />
            {filteredExercises.length ? (
              filteredExercises.map((row, idx) => (
                <Pressable key={`${row.date}-${row.exercise}-${idx}`} style={styles.row} onPress={() => router.push(`/stats/day/${row.date}` as any)}>
                  <Text style={styles.rowDate}>{row.date} · {row.exercise}</Text>
                  <Text style={styles.rowValue}>{row.sets} sets</Text>
                </Pressable>
              ))
            ) : (
              <Text style={styles.item}>No matches in selected range.</Text>
            )}
          </GlassCard>
        ) : null}

        <View style={{ height: 10 }} />
        <GlassCard>
          <Text style={styles.section}>History</Text>
          {history.slice().reverse().map((row) => (
            <Pressable key={row.date} style={styles.row} onPress={() => router.push(`/stats/day/${row.date}` as any)}>
              <Text style={styles.rowDate}>{row.date}</Text>
              <Text style={styles.rowValue}>{mode === 'logged' && !row.logged ? '—' : Math.round(row.value)}</Text>
            </Pressable>
          ))}
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
  item: { color: '#D0D0D0', fontWeight: '600', marginBottom: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  rowDate: { color: '#D8D8D8', fontWeight: '600' },
  rowValue: { color: '#FFF', fontWeight: '800' },
  info: {
    color: '#8EDFFF',
    fontWeight: '900',
    width: 24,
    height: 24,
    textAlign: 'center',
    lineHeight: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(142,223,255,0.45)',
    backgroundColor: 'rgba(142,223,255,0.12)',
  },
  input: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    color: '#FFF',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
});
