import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router'; import React, { useCallback, useEffect, useMemo, useState } from 'react'; import { Alert, Keyboard, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { createRunSegment, toSafeSegmentRange, validateSegmentSelection } from '../../utils/segmentService';
import { type LocationPoint } from '../../utils/gpsService';
import { type Visibility } from '../../utils/canonicalRunningSchema';
import { captureException } from '../../utils/crashReporter';

type SavedRun = {
  timestamp?: string;
  route?: LocationPoint[];
};

function safeParseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export default function CreateSegmentScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ runAt?: string }>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [runTimestamp, setRunTimestamp] = useState<string>('');
  const [route, setRoute] = useState<LocationPoint[]>([]);
  const [name, setName] = useState('Custom Segment');
  const [isPrivate, setIsPrivate] = useState(true);
  const [visibility, setVisibility] = useState<Visibility>('private');
  const [direction, setDirection] = useState<'forward' | 'reverse' | 'either'>('forward');
  const [startIndex, setStartIndex] = useState(0);
  const [endIndex, setEndIndex] = useState(1);

  const maxIndex = Math.max(1, route.length - 1);
  const safeRange = useMemo(() => toSafeSegmentRange(route.length, startIndex, endIndex), [route.length, startIndex, endIndex]);
  const selectedPoints = safeRange.endIndex - safeRange.startIndex + 1;
  const selectionValidation = useMemo(
    () => validateSegmentSelection(route, safeRange.startIndex, safeRange.endIndex),
    [route, safeRange.startIndex, safeRange.endIndex]
  );

  const loadRun = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem('runsHistory');
      const runs = safeParseJson<SavedRun[]>(raw, []);
      if (!runs.length) {
        setLoading(false);
        return;
      }

      const selectedRun =
        (params.runAt ? runs.find((run) => run.timestamp === params.runAt) : null) ||
        [...runs].reverse().find((run) => Array.isArray(run.route) && run.route.length >= 2);

      if (!selectedRun?.route || selectedRun.route.length < 2 || !selectedRun.timestamp) {
        setLoading(false);
        return;
      }

      setRunTimestamp(selectedRun.timestamp);
      setRoute(selectedRun.route);
      setStartIndex(0);
      setEndIndex(Math.min(selectedRun.route.length - 1, Math.max(1, Math.floor(selectedRun.route.length / 3))));
      setLoading(false);
    } catch (error) {
      if (__DEV__) {
        console.log('Failed to load run for segment creation:', error);
      } else {
        void captureException(error, { feature: 'segments', op: 'load_run_for_create' });
      }
      setLoading(false);
    }
  }, [params.runAt]);

  useEffect(() => {
    void loadRun();
  }, [loadRun]);

  const nudgeStart = (delta: number) => {
    const nextStart = Math.max(0, Math.min(maxIndex - 1, safeRange.startIndex + delta));
    setStartIndex(nextStart);
    if (safeRange.endIndex <= nextStart) {
      setEndIndex(Math.min(maxIndex, nextStart + 1));
    }
  };

  const nudgeEnd = (delta: number) => {
    const nextEnd = Math.max(safeRange.startIndex + 1, Math.min(maxIndex, safeRange.endIndex + delta));
    setEndIndex(nextEnd);
  };

  const onSave = async () => {
    if (!route.length || !runTimestamp) {
      Alert.alert('No route found', 'Open this from a saved run with route data.');
      return;
    }
    if (!selectionValidation.valid) {
      Alert.alert('Segment too short', 'Pick a slightly longer stretch so efforts are trustworthy.');
      return;
    }
    if (saving) return;

    setSaving(true);
    try {
      const segment = await createRunSegment({
        name,
        sourceRunTimestamp: runTimestamp,
        route,
        startIndex: safeRange.startIndex,
        endIndex: safeRange.endIndex,
        isPrivate,
        visibility,
        direction,
      });
      if (!segment) {
        Alert.alert('Could not create segment', 'Please adjust your start and end points and try again.');
        return;
      }
      Alert.alert(
        'Segment created',
        `${segment.name} saved (${segment.distanceMiles.toFixed(2)} mi). ${segment.isPrivate ? 'Private' : 'Public'} by default.`,
        [{ text: 'Done', onPress: () => router.back() }]
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.loadingText}>Loading route...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!route.length) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.title}>Create Segment</Text>
          <Text style={styles.emptyText}>No saved run route found. Save a run first, then create a segment.</Text>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => router.back()}>
            <Text style={styles.secondaryButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScrollBeginDrag={Keyboard.dismiss}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Create Segment</Text>
        <Text style={styles.subtitle}>Pick a start and finish point from this route.</Text>

        <View style={styles.card}>
          <Text style={styles.label}>Segment name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            style={styles.input}
            placeholder='Custom Segment'
            placeholderTextColor='#666'
            maxLength={48}
          />
        </View>

        <View style={styles.card}>
          <View style={styles.switchRow}>
            <View>
              <Text style={styles.label}>Private segment</Text>
              <Text style={styles.helper}>Private is the default for all new segments.</Text>
            </View>
            <Switch value={isPrivate} onValueChange={setIsPrivate} />
          </View>
          <Text style={[styles.label, { marginTop: 14 }]}>Visibility tier</Text>
          <View style={styles.stepperRow}>
            {(['private', 'friends', 'club', 'public'] as const).map((value) => (
              <TouchableOpacity
                key={value}
                style={[styles.pill, visibility === value && styles.pillOn]}
                onPress={() => {
                  setVisibility(value);
                  setIsPrivate(value === 'private');
                }}
              >
                <Text style={[styles.pillText, visibility === value && styles.pillTextOn]}>{value}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={[styles.label, { marginTop: 12 }]}>Direction</Text>
          <View style={styles.stepperRow}>
            {(['forward', 'reverse', 'either'] as const).map((value) => (
              <TouchableOpacity key={value} style={[styles.pill, direction === value && styles.pillOn]} onPress={() => setDirection(value)}>
                <Text style={[styles.pillText, direction === value && styles.pillTextOn]}>{value}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Start point</Text>
          <View style={styles.stepperRow}>
            <TouchableOpacity style={styles.stepperButton} onPress={() => nudgeStart(-1)}>
              <Text style={styles.stepperText}>-</Text>
            </TouchableOpacity>
            <Text style={styles.stepperValue}>{safeRange.startIndex}</Text>
            <TouchableOpacity style={styles.stepperButton} onPress={() => nudgeStart(1)}>
              <Text style={styles.stepperText}>+</Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.label, { marginTop: 14 }]}>End point</Text>
          <View style={styles.stepperRow}>
            <TouchableOpacity style={styles.stepperButton} onPress={() => nudgeEnd(-1)}>
              <Text style={styles.stepperText}>-</Text>
            </TouchableOpacity>
            <Text style={styles.stepperValue}>{safeRange.endIndex}</Text>
            <TouchableOpacity style={styles.stepperButton} onPress={() => nudgeEnd(1)}>
              <Text style={styles.stepperText}>+</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.helper}>Selected points: {selectedPoints} of {route.length}</Text>
          <Text style={styles.helper}>
            Length: {selectionValidation.distanceMiles.toFixed(2)} mi
            {selectionValidation.estimatedDurationSec ? ` · Est. ${Math.round(selectionValidation.estimatedDurationSec)} sec` : ''}
          </Text>
          {!selectionValidation.valid ? (
            <Text style={styles.warning}>
              Segment needs minimum distance/time to avoid noisy PRs.
            </Text>
          ) : null}
        </View>

        <TouchableOpacity style={[styles.primaryButton, (!selectionValidation.valid || saving) && styles.primaryButtonDisabled]} onPress={onSave} disabled={!selectionValidation.valid || saving}>
          <Text style={styles.primaryButtonText}>{saving ? 'Saving...' : 'Save Segment'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  content: { padding: 16, paddingBottom: 48, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  title: { color: '#fff', fontSize: 30, fontWeight: '900' },
  subtitle: { color: '#9ab4c0', marginTop: 4, marginBottom: 8 },
  loadingText: { color: '#c9c9c9' },
  emptyText: { color: '#a8a8a8', marginTop: 12, textAlign: 'center' },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    padding: 12,
  },
  label: { color: '#d6dde1', fontWeight: '700', marginBottom: 8 },
  helper: { color: '#9ab4c0', fontSize: 12, marginTop: 8 },
  input: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    color: '#fff',
    paddingHorizontal: 12,
    backgroundColor: '#121212',
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 },
  stepperButton: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#171717',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  stepperText: { color: '#fff', fontSize: 24, fontWeight: '700', lineHeight: 24 },
  stepperValue: { color: '#fff', fontSize: 20, fontWeight: '900', minWidth: 60, textAlign: 'center' },
  pill: {
    paddingHorizontal: 10,
    minHeight: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#151515',
  },
  pillOn: { borderColor: '#00D9FF', backgroundColor: 'rgba(0,217,255,0.18)' },
  pillText: { color: '#D8D8D8', fontWeight: '700', fontSize: 12 },
  pillTextOn: { color: '#DDF7FF' },
  primaryButton: {
    minHeight: 50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#00d9ff',
    marginTop: 6,
  },
  primaryButtonDisabled: { opacity: 0.5 },
  primaryButtonText: { color: '#00141a', fontWeight: '900' },
  warning: { color: '#FFD48A', fontSize: 12, marginTop: 6, fontWeight: '700' },
  secondaryButton: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#3a3a3a',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    paddingHorizontal: 16,
  },
  secondaryButtonText: { color: '#d0d0d0', fontWeight: '700' },
});
