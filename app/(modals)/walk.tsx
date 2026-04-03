import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Easing, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import WinningDayToast from '../../components/WinningDayToast';
import NumberPadTextInput from '../../components/inputs/NumberPadTextInput';
import ZenithScrollView from '../../components/layout/ZenithScrollView';
import ModalHeader from '../../components/ui/ModalHeader';
import {
  type ActiveRestEntry,
  getDailyLog,
  getUserProfile,
  saveDailyLog,
  todayKey,
} from '../../utils/storageUtils';
import {
  calculateActiveRestCaloriesBurned,
  INTENSITY_HELP,
  type Intensity,
  resolveWeightKg,
} from '../../utils/calorieBurn';
import { evaluateWinningDay, getWinningSnapshot } from '../../utils/winningSystem';

type WalkTemplate = { label: string; minutes: number };

const WALK_TEMPLATES: WalkTemplate[] = [
  { label: '10 min', minutes: 10 },
  { label: '20 min', minutes: 20 },
  { label: '30 min', minutes: 30 },
  { label: '45 min', minutes: 45 },
  { label: '60 min', minutes: 60 },
] as const;

const XP_PER_WALK_LOG = 5;

export default function WalkModal() {
  const [intensity, setIntensity] = useState<Intensity>('easy');
  const [minutes, setMinutes] = useState('');
  const [distance, setDistance] = useState('');
  const [note, setNote] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const minutesRef = useRef<React.ElementRef<typeof TextInput> | null>(null);
  const [segWidth, setSegWidth] = useState(0);
  const segAnim = useRef(new Animated.Value(0)).current;

  const [weightKg, setWeightKg] = useState(80);
  const [todayWalkMinutes, setTodayWalkMinutes] = useState(0);
  const [todayActiveRestMinutes, setTodayActiveRestMinutes] = useState(0);
  const [goalsRestMin, setGoalsRestMin] = useState(20);

  const [saving, setSaving] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastSubtitle, setToastSubtitle] = useState<string | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    const loadTodayContext = async () => {
      const [log, profile] = await Promise.all([getDailyLog(todayKey()), getUserProfile()]);
      if (!alive) return;
      const activeRest = Array.isArray(log.activeRest) ? log.activeRest : [];
      const walkMinutes = activeRest
        .filter((entry: any) => entry?.type === 'walk')
        .reduce((sum: number, entry: any) => sum + (Number(entry?.minutes) || 0), 0);
      const activeRestMinutes = activeRest.reduce((sum: number, entry: any) => sum + (Number(entry?.minutes) || 0), 0);
      setTodayWalkMinutes(walkMinutes);
      setTodayActiveRestMinutes(activeRestMinutes);
      setWeightKg(resolveWeightKg(log, profile).weightKg);
      setGoalsRestMin(Number((profile as any)?.goals?.activeRestTargetMin) || 20);
    };
    void loadTodayContext();
    return () => {
      alive = false;
    };
  }, []);

  const draftMinutes = Math.max(0, Number(minutes) || 0);
  const draftBurnKcal = calculateActiveRestCaloriesBurned({
    type: 'walk',
    intensity,
    minutes: draftMinutes,
    weightKg,
  });

  const winningPreview = useMemo(() => {
    const before = evaluateWinningDay(
      { activeRest: [{ id: 'before', ts: new Date().toISOString(), type: 'walk', minutes: todayActiveRestMinutes }] },
      { activeRestTargetMin: goalsRestMin }
    );
    const after = evaluateWinningDay(
      { activeRest: [{ id: 'after', ts: new Date().toISOString(), type: 'walk', minutes: todayActiveRestMinutes + draftMinutes }] },
      { activeRestTargetMin: goalsRestMin }
    );
    return { before: before.winningDay, after: after.winningDay };
  }, [draftMinutes, goalsRestMin, todayActiveRestMinutes]);

  const selectedTemplateMinutes = WALK_TEMPLATES.some((t) => t.minutes === draftMinutes) ? draftMinutes : null;
  const intensityIndex = intensity === 'easy' ? 0 : intensity === 'moderate' ? 1 : 2;

  useEffect(() => {
    Animated.timing(segAnim, {
      toValue: intensityIndex,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [intensityIndex, segAnim]);

  const bumpMinutes = (delta: number) => {
    const next = Math.max(0, Math.min(600, draftMinutes + delta));
    setMinutes(next > 0 ? String(next) : '');
    void Haptics.selectionAsync().catch(() => {});
  };

  const saveWalk = async () => {
    if (saving || !Number.isFinite(draftMinutes) || draftMinutes <= 0) return;
    setSaving(true);
    const date = todayKey();

    try {
      const beforeSnapshot = await getWinningSnapshot();
      const [current, profile] = await Promise.all([getDailyLog(date), getUserProfile()]);
      const { weightKg, source } = resolveWeightKg(current, profile);
      const caloriesBurned = calculateActiveRestCaloriesBurned({ type: 'walk', intensity, minutes: draftMinutes, weightKg });
      const entry: ActiveRestEntry = {
        id: String(Date.now()),
        ts: new Date().toISOString(),
        type: 'walk',
        intensity,
        minutes: draftMinutes,
        label: 'walk',
        caloriesBurned,
        weightSource: source,
        note: [note.trim(), distance.trim() ? `Distance: ${distance.trim()}` : ''].filter(Boolean).join(' · ') || undefined,
      };

      await saveDailyLog(date, {
        ...current,
        activeRest: [entry, ...(Array.isArray(current.activeRest) ? current.activeRest : [])],
      });

      const afterSnapshot = await getWinningSnapshot();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setToastSubtitle(
        `+${XP_PER_WALK_LOG} XP · ${draftMinutes} min logged · Streak ${beforeSnapshot.currentStreak}->${afterSnapshot.currentStreak} · Winning ${afterSnapshot.today.winningDay ? 'YES' : 'NO'}`
      );
      setShowToast(true);
      setTimeout(() => router.back(), 420);
    } finally {
      setSaving(false);
    }
  };

  const onBack = () => {
    if (!minutes.trim() && !note.trim() && !distance.trim()) {
      router.back();
      return;
    }
    Alert.alert('Discard change?', 'You have unsaved walk input.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => router.back() },
    ]);
  };

  const doneEnabled = !saving && draftMinutes > 0;

  return (
    <SafeAreaView style={styles.screen}>
      <ZenithScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      >
        <ModalHeader title="Log Walk" onBack={onBack} rightLabel="Done" onRight={saveWalk} rightDisabled={!doneEnabled} />

        <Text style={styles.hook}>Quick walk logging. Keep the streak alive.</Text>

        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle}>Quick Add</Text>
            <Pressable style={styles.detailsPill} onPress={() => setDetailsOpen((prev) => !prev)}>
              <Text style={styles.detailsPillText}>{detailsOpen ? 'Hide details' : 'Details'}</Text>
            </Pressable>
          </View>
          <View style={styles.quickGrid}>
            {WALK_TEMPLATES.map((template) => {
              const selected = selectedTemplateMinutes === template.minutes;
              return (
                <Pressable
                  key={template.label}
                  style={({ pressed }) => [styles.quickChip, selected && styles.quickChipOn, pressed && styles.chipPressed]}
                  onPress={() => {
                    setMinutes(String(template.minutes));
                    void Haptics.selectionAsync().catch(() => {});
                  }}
                >
                  <Text style={[styles.quickChipText, selected && styles.quickChipTextOn]}>{template.label}</Text>
                </Pressable>
              );
            })}
            <Pressable
              style={({ pressed }) => [
                styles.quickChip,
                selectedTemplateMinutes === null && draftMinutes > 0 && styles.quickChipOn,
                pressed && styles.chipPressed,
              ]}
              onPress={() => {
                void Haptics.selectionAsync().catch(() => {});
                setMinutes(minutes.trim());
                setTimeout(() => minutesRef.current?.focus?.(), 80);
              }}
            >
              <Text style={[styles.quickChipText, selectedTemplateMinutes === null && draftMinutes > 0 && styles.quickChipTextOn]}>Custom</Text>
            </Pressable>
          </View>
          <Text style={styles.helper}>Today: {todayWalkMinutes} min</Text>
        </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Intensity</Text>
            <View
              style={styles.segment}
              onLayout={(e) => {
                const w = e.nativeEvent.layout.width;
                setSegWidth(w / 3);
              }}
            >
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.segmentHighlight,
                  {
                    width: segWidth || 0,
                    transform: [
                      {
                        translateX: segAnim.interpolate({
                          inputRange: [0, 1, 2],
                          outputRange: [0, segWidth || 0, (segWidth || 0) * 2],
                        }),
                      },
                    ],
                  },
                ]}
              />
              {(['easy', 'moderate', 'hard'] as const).map((value) => {
                const selected = intensity === value;
                return (
                  <Pressable
                    key={value}
                    style={({ pressed }) => [styles.segmentItem, pressed && styles.chipPressed]}
                    onPress={() => {
                      setIntensity(value);
                      void Haptics.selectionAsync().catch(() => {});
                    }}
                  >
                    <Text style={[styles.segmentText, selected && styles.segmentTextOn]}>{value}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.helper}>{INTENSITY_HELP[intensity]}</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Primary Entry</Text>
            <View style={styles.primaryRow}>
              <Pressable style={[styles.stepper, draftMinutes <= 0 && styles.stepperDisabled]} onPress={() => bumpMinutes(-1)} disabled={draftMinutes <= 0}>
                <Text style={styles.stepperText}>−</Text>
              </Pressable>
              <NumberPadTextInput
                ref={minutesRef as any}
                style={[styles.input, styles.primaryInput]}
                placeholder="Minutes"
                placeholderTextColor="#888"
                value={minutes}
                onChangeText={setMinutes}
                keyboardType="number-pad"
              />
              <Pressable style={styles.stepper} onPress={() => bumpMinutes(1)}>
                <Text style={styles.stepperText}>+</Text>
              </Pressable>
            </View>
            <Text style={styles.inlinePreview}>
              {draftMinutes > 0 ? `+${XP_PER_WALK_LOG} XP · Winning ${winningPreview.after ? 'YES' : 'NO'}` : `Goal: ${goalsRestMin} min active rest`}
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Impact Preview</Text>
            <View style={styles.statsGrid}>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Calories</Text>
                <Text style={styles.statValue}>{Math.round(draftBurnKcal)} kcal</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Walk</Text>
                <Text style={styles.statValue}>
                  {todayWalkMinutes} → {todayWalkMinutes + draftMinutes} min
                </Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Active Rest</Text>
                <Text style={styles.statValue}>
                  {todayActiveRestMinutes} → {todayActiveRestMinutes + draftMinutes} min
                </Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>XP</Text>
                <Text style={styles.statValue}>+{XP_PER_WALK_LOG}</Text>
              </View>
            </View>
            <View style={styles.winRow}>
              <Text style={styles.winLabel}>Winning Day</Text>
              <Text style={styles.winValue}>
                {winningPreview.before ? 'YES' : 'NO'} → {winningPreview.after ? 'YES' : 'NO'}
              </Text>
            </View>
          </View>

        {detailsOpen ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Details</Text>
            <NumberPadTextInput
              style={styles.input}
              placeholder="Distance (optional)"
              placeholderTextColor="#888"
              value={distance}
              onChangeText={setDistance}
              keyboardType="decimal-pad"
            />
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
        <Pressable style={[styles.stickyButton, !doneEnabled && styles.buttonDisabled]} onPress={saveWalk} disabled={!doneEnabled}>
          <View style={{ alignItems: 'center' }}>
            <Text style={styles.stickyButtonText}>{saving ? 'SAVING...' : draftMinutes > 0 ? `Log ${draftMinutes} min Walk` : 'Log Walk'}</Text>
            {draftMinutes > 0 ? <Text style={styles.stickySubText}>+{XP_PER_WALK_LOG} XP</Text> : null}
          </View>
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
  hook: { color: '#9EC6D4', marginBottom: 10, fontWeight: '600' },

  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#232323',
    backgroundColor: '#121212',
    padding: 12,
    marginBottom: 10,
  },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 },
  cardTitle: { color: '#FFF', fontWeight: '800', marginBottom: 8 },

  detailsPill: {
    minHeight: 34,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(0,217,255,0.26)',
    backgroundColor: 'rgba(0,217,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailsPillText: { color: '#BFF3FF', fontWeight: '900', fontSize: 12 },

  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  quickChip: {
    width: '31%',
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    backgroundColor: '#171717',
    paddingHorizontal: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickChipOn: { borderColor: '#00D9FF', backgroundColor: 'rgba(0,217,255,0.18)' },
  quickChipText: { color: '#C5C5C5', fontWeight: '900', fontSize: 12 },
  quickChipTextOn: { color: '#E6F8FF' },
  chipPressed: { opacity: 0.86, transform: [{ scale: 0.99 }] },

  segment: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: '#151515',
    overflow: 'hidden',
    flexDirection: 'row',
    marginBottom: 10,
  },
  segmentHighlight: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    left: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(0,217,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(0,217,255,0.34)',
  },
  segmentItem: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  segmentText: { color: '#C5C5C5', fontWeight: '900', fontSize: 12, textTransform: 'capitalize' },
  segmentTextOn: { color: '#E6F8FF' },

  helper: { color: '#B8B8B8', fontSize: 12, fontWeight: '600' },
  inlinePreview: { color: 'rgba(255,255,255,0.66)', marginTop: 10, fontWeight: '700', fontSize: 12, lineHeight: 16 },

  primaryRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepper: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    backgroundColor: '#171717',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperDisabled: { opacity: 0.55 },
  stepperText: { color: '#FFF', fontWeight: '900', fontSize: 20 },

  input: {
    backgroundColor: '#151515',
    color: '#FFF',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#232323',
    minHeight: 44,
    marginBottom: 10,
  },
  primaryInput: { flex: 1, marginBottom: 0 },
  noteInput: { minHeight: 84, textAlignVertical: 'top', marginBottom: 0 },

  statsGrid: { marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  stat: {
    width: '47%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(0,0,0,0.22)',
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  statLabel: { color: '#A6C9D6', fontWeight: '900', fontSize: 12 },
  statValue: { color: '#FFF', fontWeight: '900', fontSize: 13, marginTop: 4 },
  winRow: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  winLabel: { color: '#A6C9D6', fontWeight: '900', fontSize: 12 },
  winValue: { color: '#FFF', fontWeight: '900', fontSize: 12 },

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
  stickySubText: { color: 'rgba(0,19,26,0.70)', fontWeight: '900', fontSize: 11, marginTop: 2 },
  buttonDisabled: { opacity: 0.6 },
});
