import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import WinningDayToast from '../../components/WinningDayToast';
import NumberPadTextInput from '../../components/inputs/NumberPadTextInput';
import ZenithScrollView from '../../components/layout/ZenithScrollView';
import ModalHeader from '../../components/ui/ModalHeader';
import {
  getDailyLog,
  getUserProfile,
  saveDailyLog,
  safeParseJson,
  setStorageItem,
  todayKey,
  USER_PROFILE_KEY,
  WEIGHT_LOG_KEY,
  WeightLogEntry,
} from '../../utils/storageUtils';
import { enqueueCloudStateSyncWrite } from '../../utils/cloudStateSync';
import { getWinningSnapshot } from '../../utils/winningSystem';

type WeightUnit = 'lb' | 'kg';
const XP_PER_WEIGHT_LOG = 4;

export default function WeightModal() {
  const [weight, setWeight] = useState('');
  const [note, setNote] = useState('');
  const [unit, setUnit] = useState<WeightUnit>('lb');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [todayWeight, setTodayWeight] = useState<number | null>(null);
  const [lastWeight, setLastWeight] = useState<number | null>(null);
  const [weekAverage, setWeekAverage] = useState<number | null>(null);

  const [saving, setSaving] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastSubtitle, setToastSubtitle] = useState<string | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [today, profile, rawWeightLog] = await Promise.all([
        getDailyLog(todayKey()),
        getUserProfile(),
        AsyncStorage.getItem(WEIGHT_LOG_KEY),
      ]);
      if (!alive) return;

      setTodayWeight(typeof today.weight === 'number' ? today.weight : null);
      const prefUnits = (profile as any)?.preferences?.units;
      setUnit(prefUnits === 'kg-ml' ? 'kg' : 'lb');

      const parsed = safeParseJson<WeightLogEntry[]>(rawWeightLog, []);
      const list = Array.isArray(parsed) ? parsed.filter((row) => typeof row?.weight === 'number') : [];
      setLastWeight(list[0]?.weight ?? null);

      const weekRows = list.slice(0, 7);
      if (weekRows.length) {
        const avg = weekRows.reduce((sum, row) => sum + row.weight, 0) / weekRows.length;
        setWeekAverage(Number(avg.toFixed(1)));
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, []);

  const toStoredLb = (value: number) => {
    if (unit === 'kg') return Number((value * 2.20462).toFixed(1));
    return Number(value.toFixed(1));
  };

  const fromStoredLb = (value: number) => {
    if (unit === 'kg') return Number((value / 2.20462).toFixed(1));
    return Number(value.toFixed(1));
  };

  const numericInput = Math.max(0, Number(weight) || 0);
  const projectedStored = numericInput > 0 ? toStoredLb(numericInput) : null;
  const trendDelta = projectedStored && todayWeight ? Number((projectedStored - todayWeight).toFixed(1)) : null;

  const trendArrow = useMemo(() => {
    if (trendDelta === null) return '→';
    if (trendDelta > 0) return '↑';
    if (trendDelta < 0) return '↓';
    return '→';
  }, [trendDelta]);

  const onSave = async () => {
    if (saving || !projectedStored || projectedStored <= 0) return;

    setSaving(true);
    const date = todayKey();
    const entry: WeightLogEntry = {
      id: String(Date.now()),
      ts: new Date().toISOString(),
      date,
      weight: projectedStored,
      note: note.trim() || undefined,
    };

    try {
      const beforeSnapshot = await getWinningSnapshot();
      const current = await getDailyLog(date);
      await saveDailyLog(date, { ...current, weight: projectedStored });

      const profile = await getUserProfile();
      const rawWeightLog = Array.isArray(profile.weightLog) ? profile.weightLog : [];
      const nextWeightLog = [entry, ...rawWeightLog];

      await AsyncStorage.setItem(WEIGHT_LOG_KEY, JSON.stringify(nextWeightLog));
      void enqueueCloudStateSyncWrite(WEIGHT_LOG_KEY, nextWeightLog);
      await setStorageItem(USER_PROFILE_KEY, { ...profile, currentWeight: projectedStored, weightLog: nextWeightLog });

      const afterSnapshot = await getWinningSnapshot();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setToastSubtitle(
        `+${XP_PER_WEIGHT_LOG} XP · ${projectedStored.toFixed(1)} lb logged · Streak ${beforeSnapshot.currentStreak}->${afterSnapshot.currentStreak} · Winning ${afterSnapshot.today.winningDay ? 'YES' : 'NO'}`
      );
      setShowToast(true);
      setTimeout(() => router.back(), 420);
    } finally {
      setSaving(false);
    }
  };

  const onBack = () => {
    if (!weight.trim() && !note.trim()) {
      router.back();
      return;
    }
    Alert.alert('Discard change?', 'You have unsaved weight input.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => router.back() },
    ]);
  };

  const unitLabel = unit === 'kg' ? 'kg' : 'lb';
  const doneEnabled = !saving && projectedStored != null && projectedStored > 0;

  return (
    <SafeAreaView style={styles.screen}>
      <ZenithScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      >
        <ModalHeader title="Log Weight" onBack={onBack} rightLabel="Done" onRight={onSave} rightDisabled={!doneEnabled} />

          <Text style={styles.hook}>Log your trend to keep momentum visible.</Text>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Weight</Text>
            <NumberPadTextInput
              style={styles.input}
              placeholder={`Weight (${unitLabel})`}
              placeholderTextColor="#888"
              keyboardType="decimal-pad"
              value={weight}
              onChangeText={setWeight}
            />
            {projectedStored ? (
              <Text style={styles.inlinePreview}>
                +{XP_PER_WEIGHT_LOG} XP · Trend {trendArrow} {trendDelta === null ? '--' : `${Math.abs(trendDelta).toFixed(1)} ${unitLabel}`}
              </Text>
            ) : null}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>At a glance</Text>
            <Text style={styles.previewLine}>Today: {todayWeight ? `${fromStoredLb(todayWeight).toFixed(1)} ${unitLabel}` : '—'}</Text>
            <Text style={styles.previewLine}>Last: {lastWeight ? `${fromStoredLb(lastWeight).toFixed(1)} ${unitLabel}` : '—'}</Text>
            <Text style={styles.previewLine}>7-day avg: {weekAverage ? `${fromStoredLb(weekAverage).toFixed(1)} ${unitLabel}` : '—'}</Text>
          </View>

          <Pressable style={styles.detailsToggle} onPress={() => setDetailsOpen((prev) => !prev)}>
            <Text style={styles.detailsToggleText}>{detailsOpen ? 'Hide details' : 'Details'}</Text>
          </Pressable>

          {detailsOpen ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Details</Text>
              <View style={styles.chipRow}>
                <Pressable style={[styles.chip, unit === 'lb' && styles.chipOn]} onPress={() => setUnit('lb')}>
                  <Text style={[styles.chipText, unit === 'lb' && styles.chipTextOn]}>lb</Text>
                </Pressable>
                <Pressable style={[styles.chip, unit === 'kg' && styles.chipOn]} onPress={() => setUnit('kg')}>
                  <Text style={[styles.chipText, unit === 'kg' && styles.chipTextOn]}>kg</Text>
                </Pressable>
                {lastWeight ? (
                  <Pressable style={styles.chip} onPress={() => setWeight(String(fromStoredLb(lastWeight)))}>
                    <Text style={styles.chipText}>Fill last</Text>
                  </Pressable>
                ) : null}
              </View>
              <TextInput
                style={[styles.input, styles.noteInput]}
                placeholder="Notes (optional)"
                placeholderTextColor="#888"
                value={note}
                onChangeText={setNote}
                multiline
              />
            </View>
          ) : null}
      </ZenithScrollView>

      <View style={styles.stickyFooter}>
        <Pressable style={[styles.stickyButton, !doneEnabled && styles.buttonDisabled]} onPress={onSave} disabled={!doneEnabled}>
          <Text style={styles.stickyButtonText}>{saving ? 'SAVING...' : 'DONE'}</Text>
        </Pressable>
      </View>

      <WinningDayToast visible={showToast} title="Logged" subtitle={toastSubtitle} onHide={() => setShowToast(false)} />
    </SafeAreaView>
  );
}

	const styles = StyleSheet.create({
	  screen: { flex: 1, backgroundColor: '#0A0A0A' },
	  keyboard: { flex: 1 },
	  container: { flexGrow: 1, padding: 16, paddingBottom: 120 },
	  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
	  topAction: { minWidth: 44, minHeight: 44, justifyContent: 'center' },
	  topActionText: { color: '#00D9FF', fontWeight: '700' },
	  title: { color: '#FFF', fontSize: 22, fontWeight: '800' },
	  hook: { color: '#9EC6D4', marginBottom: 10, fontWeight: '600' },

  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#232323',
    backgroundColor: '#121212',
    padding: 12,
    marginBottom: 10,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44 },
  cardTitle: { color: '#FFF', fontWeight: '800', marginBottom: 8 },
  cardToggle: { color: '#8BBFD5', fontWeight: '700', fontSize: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: 44,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    backgroundColor: '#171717',
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  chipOn: { borderColor: '#00D9FF', backgroundColor: 'rgba(0,217,255,0.18)' },
  chipText: { color: '#C5C5C5', fontWeight: '700', fontSize: 12 },
  chipTextOn: { color: '#E6F8FF' },

	  previewLine: { color: '#CFB2EE', fontSize: 12, fontWeight: '600', marginBottom: 3 },
	  inlinePreview: { color: 'rgba(255,255,255,0.66)', marginTop: 10, fontWeight: '700', fontSize: 12, lineHeight: 16 },

  input: {
    backgroundColor: '#151515',
    color: '#FFF',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#232323',
    minHeight: 44,
  },
	  noteInput: { minHeight: 84, textAlignVertical: 'top' },

	  detailsToggle: {
	    alignSelf: 'flex-start',
	    minHeight: 34,
	    paddingHorizontal: 10,
	    borderRadius: 999,
	    borderWidth: 1,
	    borderColor: 'rgba(0,217,255,0.26)',
	    backgroundColor: 'rgba(0,217,255,0.10)',
	    alignItems: 'center',
	    justifyContent: 'center',
	    marginBottom: 10,
	  },
	  detailsToggleText: { color: '#BFF3FF', fontWeight: '900', fontSize: 12 },

	  stickyFooter: {
	    position: 'absolute',
	    left: 0,
	    right: 0,
	    bottom: 0,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#202020',
    backgroundColor: 'rgba(9,9,9,0.98)',
  },
  stickyButton: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: '#00D9FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stickyButtonText: { color: '#00131A', fontWeight: '900', fontSize: 15 },
  buttonDisabled: { opacity: 0.6 },
});
