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
  ActiveRestEntry,
  getDailyLog,
  getUserProfile,
  saveDailyLog,
  todayKey,
} from '../../utils/storageUtils';
import {
  calculateActiveRestCaloriesBurned,
  INTENSITY_HELP,
  Intensity,
  resolveWeightKg,
} from '../../utils/calorieBurn';
import { evaluateWinningDay, getWinningSnapshot } from '../../utils/winningSystem';

type RestType = ActiveRestEntry['type'];
type RestTemplate = { label: string; type: RestType; intensity: Intensity; minutes: number };

const REST_TEMPLATES: RestTemplate[] = [
  { label: 'Recovery Walk', type: 'walk', intensity: 'easy', minutes: 20 },
  { label: 'Mobility Reset', type: 'mobility', intensity: 'easy', minutes: 15 },
  { label: 'Stretch Break', type: 'stretch', intensity: 'easy', minutes: 10 },
  { label: 'Recovery Flow', type: 'recovery', intensity: 'moderate', minutes: 25 },
];

const XP_PER_REST_LOG = 5;

export default function RestModal() {
  const [type, setType] = useState<RestType>('walk');
  const [intensity, setIntensity] = useState<Intensity>('moderate');
  const [minutes, setMinutes] = useState('');
  const [distance, setDistance] = useState('');
  const [note, setNote] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);

  const [weightKg, setWeightKg] = useState(80);
  const [todayRestMinutes, setTodayRestMinutes] = useState(0);
  const [todayBurnKcal, setTodayBurnKcal] = useState(0);
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
      setTodayRestMinutes(activeRest.reduce((sum, entry) => sum + (Number(entry?.minutes) || 0), 0));
      setTodayBurnKcal(activeRest.reduce((sum, entry) => sum + (Number(entry?.caloriesBurned) || 0), 0));
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
    type,
    intensity,
    minutes: draftMinutes,
    weightKg,
  });

  const winningPreview = useMemo(() => {
    const before = evaluateWinningDay(
      { activeRest: [{ id: 'before', ts: new Date().toISOString(), type, minutes: todayRestMinutes }] },
      { activeRestTargetMin: goalsRestMin }
    );
    const after = evaluateWinningDay(
      { activeRest: [{ id: 'after', ts: new Date().toISOString(), type, minutes: todayRestMinutes + draftMinutes }] },
      { activeRestTargetMin: goalsRestMin }
    );
    return { before: before.winningDay, after: after.winningDay };
  }, [todayRestMinutes, goalsRestMin, draftMinutes, type]);

  const saveRest = async () => {
    if (saving || !Number.isFinite(draftMinutes) || draftMinutes <= 0) return;
    setSaving(true);
    const date = todayKey();

    try {
      const beforeSnapshot = await getWinningSnapshot();
      const [current, profile] = await Promise.all([getDailyLog(date), getUserProfile()]);
      const { weightKg, source } = resolveWeightKg(current, profile);
      const caloriesBurned = calculateActiveRestCaloriesBurned({ type, intensity, minutes: draftMinutes, weightKg });
      const entry: ActiveRestEntry = {
        id: String(Date.now()),
        ts: new Date().toISOString(),
        type,
        intensity,
        minutes: draftMinutes,
        label: type,
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
        `+${XP_PER_REST_LOG} XP · ${draftMinutes} min logged · Streak ${beforeSnapshot.currentStreak}->${afterSnapshot.currentStreak} · Winning ${afterSnapshot.today.winningDay ? 'YES' : 'NO'}`
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
    Alert.alert('Discard change?', 'You have unsaved active rest input.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => router.back() },
    ]);
  };

  const doneEnabled = !saving && draftMinutes > 0;
  const onDone = () => {
    if (!doneEnabled) return;
    void saveRest();
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ZenithScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      >
        <ModalHeader title="Log Active Rest" onBack={onBack} rightLabel="Done" onRight={onDone} rightDisabled={!doneEnabled} />

          <Text style={styles.hook}>Recovery keeps your streak alive.</Text>

          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardTitle}>Primary entry</Text>
              <Pressable
                style={styles.detailsPill}
                onPress={() => setDetailsOpen((prev) => !prev)}
              >
                <Text style={styles.detailsPillText}>{detailsOpen ? 'Hide details' : 'Details'}</Text>
              </Pressable>
            </View>

            <View style={styles.chipRow}>
              {(['walk', 'mobility', 'stretch', 'recovery'] as const).map((value) => (
                <Pressable key={value} onPress={() => setType(value)} style={[styles.chip, type === value && styles.chipOn]}>
                  <Text style={[styles.chipText, type === value && styles.chipTextOn]}>{value}</Text>
                </Pressable>
              ))}
            </View>

            <NumberPadTextInput
              style={styles.input}
              placeholder="Minutes"
              placeholderTextColor="#888"
              value={minutes}
              onChangeText={setMinutes}
              keyboardType="number-pad"
            />
            {draftMinutes > 0 ? (
              <Text style={styles.inlinePreview}>
                +{XP_PER_REST_LOG} XP · Est burn {Math.round(draftBurnKcal)} kcal · Winning {winningPreview.after ? 'YES' : 'NO'}
              </Text>
            ) : (
              <Text style={styles.inlinePreview}>
                Today {todayRestMinutes} / {goalsRestMin} min
              </Text>
            )}
          </View>

          {detailsOpen ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Details</Text>

              <Text style={styles.sectionLabel}>Templates</Text>
              <View style={styles.chipRow}>
                {REST_TEMPLATES.map((template) => (
                  <Pressable
                    key={template.label}
                    style={styles.chip}
                    onPress={() => {
                      setType(template.type);
                      setIntensity(template.intensity);
                      setMinutes(String(template.minutes));
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                    }}
                  >
                    <Text style={styles.chipText}>{template.label}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.sectionLabel}>Intensity</Text>
              <View style={styles.chipRow}>
                {(['easy', 'moderate', 'hard'] as const).map((value) => (
                  <Pressable key={value} onPress={() => setIntensity(value)} style={[styles.chip, intensity === value && styles.chipOn]}>
                    <Text style={[styles.chipText, intensity === value && styles.chipTextOn]}>{value}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.helper}>{INTENSITY_HELP[intensity]}</Text>

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

              <Text style={styles.sectionLabel}>Impact preview</Text>
              <Text style={styles.previewLine}>Estimated burn: {Math.round(draftBurnKcal)} kcal</Text>
              <Text style={styles.previewLine}>
                Active minutes: {todayRestMinutes} to {todayRestMinutes + draftMinutes}
              </Text>
              <Text style={styles.previewLine}>
                Daily burn: {todayBurnKcal} to {todayBurnKcal + draftBurnKcal} kcal
              </Text>
              <Text style={styles.previewLine}>XP preview: +{XP_PER_REST_LOG}</Text>
              <Text style={styles.previewLine}>
                Winning Day: {winningPreview.before ? 'YES' : 'NO'} to {winningPreview.after ? 'YES' : 'NO'}
              </Text>
            </View>
          ) : null}
      </ZenithScrollView>

      <View style={styles.stickyFooter}>
        <Pressable style={[styles.stickyButton, !doneEnabled && styles.buttonDisabled]} onPress={onDone} disabled={!doneEnabled}>
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
	  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 },
	  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44 },
	  cardTitle: { color: '#FFF', fontWeight: '800', marginBottom: 8 },
	  cardToggle: { color: '#8BBFD5', fontWeight: '700', fontSize: 12 },
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

	  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
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

	  helper: { color: '#B8B8B8', fontSize: 12, fontWeight: '600' },
	  sectionLabel: { color: '#A6C9D6', fontSize: 12, fontWeight: '800', marginTop: 6, marginBottom: 8 },
	  previewLine: { color: '#F0D29A', fontSize: 12, fontWeight: '600', marginBottom: 3 },
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
    marginBottom: 10,
  },
  noteInput: { minHeight: 84, textAlignVertical: 'top', marginBottom: 0 },

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
