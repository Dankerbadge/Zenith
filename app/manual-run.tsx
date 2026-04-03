import { router } from 'expo-router'; import React, { useMemo, useState } from 'react'; import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import NumberPadTextInput from '../components/inputs/NumberPadTextInput';
import { stagePendingRun } from '../utils/runReviewService';
import { calculateRunningDistanceXP } from '../utils/xpSystem';
import { calculateRunningCalories } from '../utils/gpsService';
import { getXpWeightForEngine } from '../utils/effortEngine';

type ManualKind = 'manual_treadmill' | 'manual_distance';
type Intensity = 'easy' | 'moderate' | 'hard';

export default function ManualRunScreen() {
  const [kind, setKind] = useState<ManualKind>('manual_treadmill');
  const [distanceMiles, setDistanceMiles] = useState('');
  const [durationMin, setDurationMin] = useState('');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [intensity, setIntensity] = useState<Intensity>('moderate');
  const [saving, setSaving] = useState(false);
  const [enduranceXpWeight, setEnduranceXpWeight] = useState(1);

  const distance = Math.max(0, Number(distanceMiles) || 0);
  const durationSeconds = Math.max(0, Math.round((Number(durationMin) || 0) * 60));

  const avgPace = useMemo(() => {
    if (distance <= 0 || durationSeconds <= 0) return 0;
    return durationSeconds / 60 / distance;
  }, [distance, durationSeconds]);
  const xpPreview = useMemo(
    () => Math.max(1, Math.round(calculateRunningDistanceXP(distance) * enduranceXpWeight)),
    [distance, enduranceXpWeight]
  );

  React.useEffect(() => {
    const loadWeight = async () => {
      const weight = await getXpWeightForEngine('endurance');
      setEnduranceXpWeight(weight);
    };
    void loadWeight();
  }, []);

  const canContinue = distance > 0 && durationSeconds > 0 && !saving;

  const submit = async () => {
    if (!canContinue) {
      Alert.alert('Missing values', 'Enter valid distance and duration.');
      return;
    }
    setSaving(true);
    try {
      await stagePendingRun({
        runId: `run_${Date.now()}`,
        kind,
        lifecycleState: 'ended',
        pausedTimeSec: 0,
        pauseEvents: [],
        hrAvailable: false,
        title: title.trim() || undefined,
        notes: notes.trim() || undefined,
        intensityLabel: intensity,
        distance,
        duration: durationSeconds,
        averagePace: avgPace,
        calories: calculateRunningCalories(distance, 180),
        xpEarned: xpPreview,
        route: [],
        reactions: [],
        timestamp: new Date().toISOString(),
      });
      router.replace('/run-review' as any);
    } catch {
      Alert.alert('Save failed', 'Could not prepare this manual run right now. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.back}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Manual Run</Text>
          <View style={{ width: 40 }} />
        </View>

        <Text style={styles.sub}>Log treadmill/manual runs with the same downstream XP and stats flow.</Text>

        <View style={styles.row}>
          <Pressable style={[styles.chip, kind === 'manual_treadmill' && styles.chipOn]} onPress={() => setKind('manual_treadmill')}>
            <Text style={[styles.chipText, kind === 'manual_treadmill' && styles.chipTextOn]}>Treadmill</Text>
          </Pressable>
          <Pressable style={[styles.chip, kind === 'manual_distance' && styles.chipOn]} onPress={() => setKind('manual_distance')}>
            <Text style={[styles.chipText, kind === 'manual_distance' && styles.chipTextOn]}>Manual Distance</Text>
          </Pressable>
        </View>

        <Text style={styles.label}>Distance (miles)</Text>
        <NumberPadTextInput value={distanceMiles} onChangeText={setDistanceMiles} keyboardType='decimal-pad' style={styles.input} placeholder='3.10' placeholderTextColor='#666' />

        <Text style={styles.label}>Duration (minutes)</Text>
        <NumberPadTextInput value={durationMin} onChangeText={setDurationMin} keyboardType='decimal-pad' style={styles.input} placeholder='30' placeholderTextColor='#666' />

        <Text style={styles.label}>Intensity</Text>
        <View style={styles.row}>
          {(['easy', 'moderate', 'hard'] as const).map((level) => (
            <Pressable key={level} style={[styles.chip, intensity === level && styles.chipOn]} onPress={() => setIntensity(level)}>
              <Text style={[styles.chipText, intensity === level && styles.chipTextOn]}>{level}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Title (optional)</Text>
        <TextInput value={title} onChangeText={setTitle} style={styles.input} placeholder='Morning treadmill' placeholderTextColor='#666' />

        <Text style={styles.label}>Notes (optional)</Text>
        <TextInput value={notes} onChangeText={setNotes} style={[styles.input, styles.notes]} placeholder='How did it feel?' placeholderTextColor='#666' multiline />

        <View style={styles.preview}>
          <Text style={styles.previewText}>Pace: {avgPace > 0 ? `${avgPace.toFixed(2)} min/mi` : '--'}</Text>
          <Text style={styles.previewText}>XP preview: +{xpPreview}</Text>
        </View>

        <Pressable style={[styles.cta, !canContinue && styles.ctaDisabled]} onPress={submit} disabled={!canContinue}>
          <Text style={styles.ctaText}>{saving ? 'Preparing Review...' : 'Continue to Review'}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  content: { padding: 16, paddingBottom: 40 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  back: { color: '#7EDCFF', fontWeight: '700' },
  title: { color: '#FFF', fontWeight: '900', fontSize: 22 },
  sub: { color: '#9AB4C0', marginTop: 8, marginBottom: 12 },
  label: { color: '#D2D2D2', fontWeight: '700', marginTop: 12, marginBottom: 8 },
  input: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: '#131313',
    color: '#FFF',
    paddingHorizontal: 12,
  },
  notes: { minHeight: 80, paddingTop: 10, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    minHeight: 36,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#333',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#151515',
  },
  chipOn: { borderColor: '#00D9FF', backgroundColor: 'rgba(0,217,255,0.2)' },
  chipText: { color: '#CFCFCF', fontWeight: '700' },
  chipTextOn: { color: '#DBF7FF' },
  preview: {
    marginTop: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: '#111',
    padding: 12,
  },
  previewText: { color: '#BDE6F2', fontWeight: '700', marginTop: 2 },
  cta: {
    marginTop: 16,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: '#00D9FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaDisabled: { opacity: 0.45 },
  ctaText: { color: '#001D26', fontWeight: '900' },
});
