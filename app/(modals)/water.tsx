import * as Haptics from 'expo-haptics';
import { router } from 'expo-router'; import React, { useEffect, useMemo, useRef, useState } from 'react'; import {   Alert, Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import WinningDayToast from '../../components/WinningDayToast';
import NumberPadTextInput from '../../components/inputs/NumberPadTextInput';
import ZenithScrollView from '../../components/layout/ZenithScrollView';
import ModalHeader from '../../components/ui/ModalHeader';
import { getDailyLog, getUserProfile, saveDailyLog, setStorageItem, todayKey, USER_PROFILE_KEY } from '../../utils/storageUtils';
import { evaluateWinningDay, getWinningSnapshot } from '../../utils/winningSystem';

type Preset = { id: string; label: string; oz: number };

const PRESETS: Preset[] = [
  { id: 'bottle', label: 'Bottle', oz: 16 },
  { id: 'glass', label: 'Glass', oz: 12 },
  { id: 'shaker', label: 'Shaker', oz: 24 },
  { id: 'quick', label: 'Quick', oz: 8 },
];

const XP_PER_WATER_LOG = 3;

export default function WaterModal() {
  const [custom, setCustom] = useState('');
  const [lastQuickAdd, setLastQuickAdd] = useState<number | null>(null);
  const [todayWaterOz, setTodayWaterOz] = useState(0);
  const [waterGoalOz, setWaterGoalOz] = useState(120);
  const [adjustMode, setAdjustMode] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [didLog, setDidLog] = useState(false);
  const [dismissLockedUntil, setDismissLockedUntil] = useState<number | null>(null);
  const loggedAnim = useRef(new Animated.Value(0)).current;

  const [saving, setSaving] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastTitle, setToastTitle] = useState('Logged');
  const [toastSubtitle, setToastSubtitle] = useState<string | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    const loadContext = async () => {
      const [today, profile] = await Promise.all([getDailyLog(todayKey()), getUserProfile()]);
      if (!alive) return;
      setTodayWaterOz(Number(today.water) || 0);
      setWaterGoalOz(Number((profile as any)?.goals?.waterTargetOz) || 120);
      const prefs = (profile as any)?.uiPrefs || {};
      const amount = Number(prefs.lastWaterQuickAddOz ?? prefs.lastWaterQuickAdd);
      if (Number.isFinite(amount) && amount > 0) setLastQuickAdd(amount);
    };
    void loadContext();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!dismissLockedUntil) return;
    const delay = Math.max(0, dismissLockedUntil - Date.now());
    const timer = setTimeout(() => setDismissLockedUntil(null), delay);
    return () => clearTimeout(timer);
  }, [dismissLockedUntil]);

  const rememberQuickAdd = async (oz: number) => {
    try {
      const profile = await getUserProfile();
      await setStorageItem(USER_PROFILE_KEY, {
        ...profile,
        uiPrefs: {
          ...((profile as any)?.uiPrefs || {}),
          lastWaterQuickAddOz: oz,
        },
      });
      setLastQuickAdd(oz);
    } catch {}
  };

  const winningPreview = useMemo(() => {
    const before = evaluateWinningDay({ water: todayWaterOz }, { activeRestTargetMin: 20 });
    const projected = Math.max(0, todayWaterOz + Math.max(0, Number(custom) || 0));
    const after = evaluateWinningDay({ water: projected }, { activeRestTargetMin: 20 });
    return { before: before.winningDay, after: after.winningDay };
  }, [todayWaterOz, custom]);

  const saveWater = async (deltaOz: number, rememberAdd = false, options?: { dismissAfter?: boolean }) => {
    if (saving || deltaOz === 0) return;
    setSaving(true);
    const date = todayKey();

    try {
      const beforeSnapshot = await getWinningSnapshot();
      const current = await getDailyLog(date);
      const currentWater = Number(current.water) || 0;
      const nextWater = Math.max(0, currentWater + deltaOz);
      const appliedDelta = nextWater - currentWater;
      if (appliedDelta === 0) {
        setToastTitle('Already at 0 oz');
        setToastSubtitle(undefined);
        setShowToast(true);
        return;
      }

      const unlockAt = Date.now() + 650;
      setDismissLockedUntil(unlockAt);

      await saveDailyLog(date, {
        ...current,
        water: nextWater,
      });
      setDidLog(true);
      setTodayWaterOz(nextWater);
      setCustom('');

      if (rememberAdd && appliedDelta > 0) {
        await rememberQuickAdd(appliedDelta);
      }

      const afterSnapshot = await getWinningSnapshot();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      loggedAnim.stopAnimation();
      loggedAnim.setValue(0);
      Animated.sequence([
        Animated.timing(loggedAnim, { toValue: 1, duration: 160, useNativeDriver: true }),
        Animated.delay(350),
        Animated.timing(loggedAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
      ]).start();
      setToastTitle('Logged');
      setToastSubtitle(
        `+${XP_PER_WATER_LOG} XP · ${appliedDelta > 0 ? '+' : ''}${appliedDelta} oz · Streak ${beforeSnapshot.currentStreak}->${afterSnapshot.currentStreak} · Winning ${afterSnapshot.today.winningDay ? 'YES' : 'NO'}`
      );
      setShowToast(true);

      if (options?.dismissAfter) {
        setTimeout(() => {
          try {
            router.back();
          } catch {}
        }, 720);
      }
    } finally {
      setSaving(false);
    }
  };

  const hasDraft = !!custom.trim();
  const canDismiss = !dismissLockedUntil;

  const onBack = () => {
    if (!canDismiss) return;
    if (!hasDraft) {
      router.back();
      return;
    }
    Alert.alert('Discard change?', 'You have unsaved water input.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => router.back() },
    ]);
  };

  const customDelta = Math.max(0, Number(custom) || 0);
  const doneEnabled = canDismiss && !saving && (didLog || customDelta > 0);

  const onDone = () => {
    if (!doneEnabled) return;
    if (customDelta > 0) {
      void saveWater(customDelta, true, { dismissAfter: true });
      return;
    }
    onBack();
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ZenithScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      >
        <ModalHeader title="Log Water" onBack={onBack} rightLabel="Done" onRight={onDone} rightDisabled={!doneEnabled} />

          <Text style={styles.hook}>Log hydration to protect your streak.</Text>

          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardTitle}>Quick Add</Text>
              <Pressable style={styles.detailsPill} onPress={() => setDetailsOpen((prev) => !prev)}>
                <Text style={styles.detailsPillText}>{detailsOpen ? 'Hide details' : 'Details'}</Text>
              </Pressable>
            </View>
            <View style={styles.grid}>
              {PRESETS.map((preset) => (
                <Pressable
                  key={preset.id}
                  style={[styles.quick, lastQuickAdd === preset.oz && styles.quickActive]}
                  onPress={async () => {
                    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                    void saveWater(adjustMode ? -preset.oz : preset.oz, !adjustMode);
                  }}
                  disabled={saving}
                >
                  <Text style={styles.quickLabel}>{preset.label}</Text>
                  <Text style={styles.quickText}>
                    {adjustMode ? '-' : '+'}
                    {preset.oz} oz
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.helper}>{adjustMode ? 'Adjust mode removes water quickly.' : 'Tap once to log instantly.'}</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Custom amount</Text>
            <NumberPadTextInput
              style={styles.input}
              placeholder="Enter ounces"
              placeholderTextColor="#888"
              keyboardType="number-pad"
              value={custom}
              onChangeText={setCustom}
            />
            {customDelta > 0 ? (
              <Text style={styles.inlinePreview}>
                +{XP_PER_WATER_LOG} XP · Remaining {Math.max(0, waterGoalOz - (todayWaterOz + customDelta))} oz · Winning {winningPreview.after ? 'YES' : 'NO'}
              </Text>
            ) : (
              <Text style={styles.inlinePreview}>
                Today {Math.round(todayWaterOz)} / {Math.round(waterGoalOz)} oz
              </Text>
            )}
          </View>

          {detailsOpen ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Details</Text>
              <View style={styles.modeRow}>
                <Pressable style={[styles.modeChip, !adjustMode && styles.modeChipOn]} onPress={() => setAdjustMode(false)} disabled={saving}>
                  <Text style={[styles.modeText, !adjustMode && styles.modeTextOn]}>Add</Text>
                </Pressable>
                <Pressable style={[styles.modeChip, adjustMode && styles.modeChipOn]} onPress={() => setAdjustMode(true)} disabled={saving}>
                  <Text style={[styles.modeText, adjustMode && styles.modeTextOn]}>Adjust</Text>
                </Pressable>
              </View>
              <Text style={styles.previewLine}>Before: {todayWaterOz} oz</Text>
              <Text style={styles.previewLine}>After: {todayWaterOz + customDelta} oz</Text>
              <Text style={styles.previewLine}>Remaining to goal: {Math.max(0, waterGoalOz - (todayWaterOz + customDelta))} oz</Text>
              <Text style={styles.previewLine}>XP preview: +{XP_PER_WATER_LOG}</Text>
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

	      <Animated.View
	        pointerEvents="none"
	        style={[
	          styles.loggedToast,
	          {
	            opacity: loggedAnim,
	            transform: [
	              {
	                scale: loggedAnim.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }),
	              },
	            ],
	          },
	        ]}
	      >
	        <Text style={styles.loggedToastIcon}>✓</Text>
	        <Text style={styles.loggedToastText}>Logged</Text>
	      </Animated.View>

	      <WinningDayToast visible={showToast} title={toastTitle} subtitle={toastSubtitle} onHide={() => setShowToast(false)} />
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
  cardTitle: { color: '#FFF', fontWeight: '800' },
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  quick: {
    width: '47%',
    minHeight: 74,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2B2B2B',
    backgroundColor: '#151515',
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: 'center',
  },
  quickActive: { borderColor: '#00D9FF', backgroundColor: 'rgba(0,217,255,0.18)' },
  quickLabel: { color: '#A6C9D6', fontSize: 12, fontWeight: '700' },
  quickText: { color: '#FFF', fontWeight: '900', marginTop: 4, fontSize: 16 },
  helper: { color: '#8FAFBB', marginTop: 8, fontSize: 12, fontWeight: '600' },

  previewLine: { color: '#B6EED0', fontSize: 12, fontWeight: '600', marginBottom: 3 },
  inlinePreview: { color: 'rgba(255,255,255,0.66)', marginTop: 10, fontWeight: '700', fontSize: 12, lineHeight: 16 },

  modeRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  modeChip: {
    flex: 1,
    minHeight: 40,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    backgroundColor: '#171717',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeChipOn: { borderColor: '#00D9FF', backgroundColor: 'rgba(0,217,255,0.18)' },
  modeText: { color: '#C5C5C5', fontWeight: '800', fontSize: 12 },
  modeTextOn: { color: '#E6F8FF' },

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
  loggedToast: {
    position: 'absolute',
    top: 74,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(0,217,255,0.35)',
    backgroundColor: 'rgba(7,18,24,0.94)',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  loggedToastIcon: { color: '#8CFABF', fontWeight: '900' },
  loggedToastText: { color: '#E6F8FF', fontWeight: '900' },
  buttonDisabled: { opacity: 0.6 },
});
