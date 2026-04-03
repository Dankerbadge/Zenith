import * as Haptics from 'expo-haptics';
import { router } from 'expo-router'; import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'; import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { calculateWorkoutCaloriesBurned, type Intensity, resolveWeightKg } from '../utils/calorieBurn';
import { settleBehaviorDay, getBehaviorMultipliers } from '../utils/behavioralCore';
import { assignSessionDayKey } from '../utils/dayAssignment';
import { saveWorkoutToHealth } from '../utils/healthService';
import { saveLiftTagSession, type LiftClassificationTag } from '../utils/liftTagService';
import {
  clearActiveLiftSnapshot,
  consumeLiftCommand,
  createLiftSessionId,
  getActiveLiftSnapshot,
  getQueuedLiftCommands,
  putLiftCommandAck,
  upsertActiveLiftSnapshot,
  type LiftControlState,
  type LiftSyncReason,
} from '../utils/liftControlSync';
import { getDailyLog, getUserProfile, todayKey } from '../utils/storageUtils';
import { liftTransitionOrThrow, type LiftLifecycleState } from '../utils/liftStateMachine';
import { captureException } from '../utils/crashReporter';

function formatDuration(totalSec: number) {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function intensityFromElapsed(sec: number): Intensity {
  if (sec >= 45 * 60) return 'hard';
  if (sec >= 20 * 60) return 'moderate';
  return 'easy';
}

export default function LiveLiftScreen() {
  const [state, setState] = useState<LiftLifecycleState>('ready');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [setCount, setSetCount] = useState(0);
  const [classification, setClassification] = useState<LiftClassificationTag>('strength');
  const [endConfirmArmedUntil, setEndConfirmArmedUntil] = useState<number | null>(null);
  const [setUndoUntil, setSetUndoUntil] = useState<number | null>(null);
  const [setUndoBaseline, setSetUndoBaseline] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [weightKg, setWeightKg] = useState(80);

  const stateRef = useRef<LiftLifecycleState>('ready');
  const startMsRef = useRef<number | null>(null);
  const pausedMsRef = useRef(0);
  const pausedStartedRef = useRef<number | null>(null);
  const sessionIdRef = useRef(createLiftSessionId());
  const seqRef = useRef(0);
  const lastPublishedCaloriesRef = useRef(0);
  const elapsedRef = useRef(0);
  const setCountRef = useRef(0);
  const caloriesRef = useRef(0);
  const intensityBandRef = useRef<'low' | 'moderate' | 'high'>('low');
  const endConfirmArmedUntilRef = useRef<number | null>(null);
  const classificationRef = useRef<LiftClassificationTag>('strength');
  const savingRef = useRef(false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    elapsedRef.current = elapsedSec;
  }, [elapsedSec]);
  useEffect(() => {
    setCountRef.current = setCount;
  }, [setCount]);
  useEffect(() => {
    endConfirmArmedUntilRef.current = endConfirmArmedUntil;
  }, [endConfirmArmedUntil]);

  useEffect(() => {
    if (!setUndoUntil) return;
    const remaining = setUndoUntil - Date.now();
    if (remaining <= 0) {
      setSetUndoUntil(null);
      setSetUndoBaseline(null);
      return;
    }
    const timeout = setTimeout(() => {
      setSetUndoUntil(null);
      setSetUndoBaseline(null);
    }, remaining + 30);
    return () => clearTimeout(timeout);
  }, [setUndoUntil]);
  useEffect(() => {
    classificationRef.current = classification;
  }, [classification]);
  useEffect(() => {
    savingRef.current = saving;
  }, [saving]);

  useEffect(() => {
    let alive = true;
    const loadWeight = async () => {
      const date = todayKey();
      const [log, profile] = await Promise.all([getDailyLog(date), getUserProfile()]);
      if (!alive) return;
      setWeightKg(resolveWeightKg(log, profile).weightKg);
    };
    void loadWeight();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const reattach = async () => {
      const snapshot = await getActiveLiftSnapshot();
      if (!alive || !snapshot) return;
      sessionIdRef.current = snapshot.sessionId;
      seqRef.current = snapshot.seq;
      startMsRef.current = new Date(snapshot.startedAtWatch).getTime();
      pausedMsRef.current = (Number(snapshot.pausedTotalSec) || 0) * 1000;
      setElapsedSec(Math.max(0, Math.floor(Number(snapshot.elapsedTimeSec) || 0)));
      setSetCount(Math.max(0, Math.floor(Number(snapshot.setCount) || 0)));
      if (snapshot.state === 'recording') setState('recording');
      else if (snapshot.state === 'paused') {
        pausedStartedRef.current = Date.now();
        setState('paused');
      } else if (snapshot.state === 'endingConfirm') {
        setState('endingConfirm');
        setEndConfirmArmedUntil(Date.now() + 1500);
      } else if (snapshot.state === 'ended') setState('ended');
    };
    void reattach();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (state !== 'recording') return;
    const timer = setInterval(() => {
      if (!startMsRef.current) return;
      const paused = pausedMsRef.current;
      const now = Date.now();
      setElapsedSec(Math.max(0, Math.floor((now - startMsRef.current - paused) / 1000)));
    }, 1000);
    return () => clearInterval(timer);
  }, [state]);

  const intensity = useMemo(() => intensityFromElapsed(elapsedSec), [elapsedSec]);
  const calories = useMemo(
    () =>
      calculateWorkoutCaloriesBurned({
        type: 'strength',
        intensity,
        minutes: Math.max(1, Math.round(elapsedSec / 60)),
        weightKg,
      }),
    [elapsedSec, intensity, weightKg]
  );
  const intensityText = intensity === 'hard' ? 'High' : intensity === 'moderate' ? 'Moderate' : 'Low';
  const intensityBand: 'low' | 'moderate' | 'high' =
    intensity === 'hard' ? 'high' : intensity === 'moderate' ? 'moderate' : 'low';
  useEffect(() => {
    caloriesRef.current = calories;
    intensityBandRef.current = intensityBand;
  }, [calories, intensityBand]);

  const currentControlState = useCallback((): LiftControlState => {
    if (stateRef.current === 'recording') return 'recording';
    if (stateRef.current === 'paused') return 'paused';
    if (stateRef.current === 'endingConfirm') return 'endingConfirm';
    if (stateRef.current === 'ended') return 'ended';
    if (stateRef.current === 'saved') return 'saved';
    if (stateRef.current === 'discarded') return 'discarded';
    return 'idle';
  }, []);

  const publishSnapshot = useCallback(async (reasonCode: LiftSyncReason) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    const snapshot = {
      sessionId,
      state: currentControlState(),
      startedAtWatch: new Date(startMsRef.current || Date.now()).toISOString(),
      endedAtWatch: stateRef.current === 'ended' || stateRef.current === 'saved' || stateRef.current === 'discarded' ? new Date().toISOString() : null,
      elapsedTimeSec: elapsedRef.current,
      movingTimeSec: elapsedRef.current,
      pausedTotalSec: Math.floor(pausedMsRef.current / 1000),
      totalCalories: Math.round(caloriesRef.current),
      setCount: setCountRef.current,
      intensityBand: intensityBandRef.current,
      lastUpdatedAtWatch: new Date().toISOString(),
      seq: seqRef.current + 1,
      sourceDevice: 'phone' as const,
      reasonCode,
    };
    seqRef.current = snapshot.seq;
    await upsertActiveLiftSnapshot(snapshot);
  }, [currentControlState]);

  useEffect(() => {
    if (!endConfirmArmedUntil) return;
    const timer = setInterval(() => {
      if (Date.now() > endConfirmArmedUntil) {
        setEndConfirmArmedUntil(null);
        if (stateRef.current === 'endingConfirm') {
          const fallbackState = pausedStartedRef.current ? 'paused' : 'recording';
          try {
            setState(liftTransitionOrThrow('endingConfirm', fallbackState));
          } catch {
            setState('paused');
          }
          void publishSnapshot('stateChange');
        }
      }
    }, 200);
    return () => clearInterval(timer);
  }, [endConfirmArmedUntil, publishSnapshot]);

  const startOrResume = useCallback(async () => {
    if (savingRef.current) return;
    if (stateRef.current === 'ready') {
      startMsRef.current = Date.now();
      pausedMsRef.current = 0;
      pausedStartedRef.current = null;
      setElapsedSec(0);
      setSetCount(0);
      setSetUndoUntil(null);
      setSetUndoBaseline(null);
      setEndConfirmArmedUntil(null);
      sessionIdRef.current = createLiftSessionId();
      seqRef.current = 0;
      lastPublishedCaloriesRef.current = 0;
      setState(liftTransitionOrThrow('ready', 'recording'));
      await publishSnapshot('stateChange');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return;
    }

    if (stateRef.current === 'paused') {
      if (pausedStartedRef.current) {
        pausedMsRef.current += Date.now() - pausedStartedRef.current;
      }
      pausedStartedRef.current = null;
      setState(liftTransitionOrThrow('paused', 'recording'));
      await publishSnapshot('stateChange');
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  }, [publishSnapshot]);

  const pause = useCallback(async () => {
    if (savingRef.current) return;
    if (stateRef.current !== 'recording') return;
    pausedStartedRef.current = Date.now();
    setState(liftTransitionOrThrow('recording', 'paused'));
    await publishSnapshot('stateChange');
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [publishSnapshot]);

  const armEnd = useCallback(async () => {
    if (savingRef.current) return;
    if (stateRef.current !== 'recording' && stateRef.current !== 'paused') return;
    const from = stateRef.current;
    setState(liftTransitionOrThrow(from, 'endingConfirm'));
    setEndConfirmArmedUntil(Date.now() + 2500);
    await publishSnapshot('stateChange');
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [publishSnapshot]);

  const cancelEnd = useCallback(async () => {
    if (savingRef.current) return;
    if (stateRef.current !== 'endingConfirm') return;
    const next = pausedStartedRef.current ? 'paused' : 'recording';
    setState(liftTransitionOrThrow('endingConfirm', next));
    setEndConfirmArmedUntil(null);
    await publishSnapshot('stateChange');
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [publishSnapshot]);

  const confirmEnd = useCallback(async () => {
    if (savingRef.current) return;
    if (stateRef.current !== 'endingConfirm') return;
    if (!endConfirmArmedUntilRef.current || Date.now() > endConfirmArmedUntilRef.current) {
      setEndConfirmArmedUntil(null);
      return;
    }
    if (pausedStartedRef.current) {
      pausedMsRef.current += Date.now() - pausedStartedRef.current;
      pausedStartedRef.current = null;
    }
    setElapsedSec(Math.max(0, Math.floor((Date.now() - (startMsRef.current || Date.now()) - pausedMsRef.current) / 1000)));
    setState(liftTransitionOrThrow('endingConfirm', 'ended'));
    setEndConfirmArmedUntil(null);
    await publishSnapshot('stateChange');
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [publishSnapshot]);

  const discardSession = useCallback(async () => {
    if (savingRef.current) return;
    if (stateRef.current !== 'ended') return;
    try {
      setState(liftTransitionOrThrow('ended', 'discarded'));
      await publishSnapshot('stateChange');
      await clearActiveLiftSnapshot();
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      router.back();
    } catch (err) {
      void captureException(err, { feature: 'live_lift', op: 'discard_session' });
      Alert.alert('Discard failed', 'Couldn’t clear this session. Returning to home.', [
        { text: 'OK', onPress: () => router.replace('/(tabs)' as any) },
      ]);
    }
  }, [publishSnapshot]);

  const saveSession = useCallback(async () => {
    if (savingRef.current) return;
    if (stateRef.current !== 'ended') return;
    savingRef.current = true;
    setSaving(true);
    try {
      const startMs = startMsRef.current || Date.now();
      const endMs = Date.now();
      const startTimeUtc = new Date(startMs).toISOString();
      const endTimeUtc = new Date(endMs).toISOString();
      const date = assignSessionDayKey(startTimeUtc, endTimeUtc);
      const behavior = await getBehaviorMultipliers(date);

      await saveLiftTagSession({
        sessionId: sessionIdRef.current,
        startTimeUtc,
        endTimeUtc,
        activeCalories: caloriesRef.current,
        setCount: setCountRef.current,
        classificationTag: classificationRef.current,
        sourceAuthority: 'phone',
        xpEfficiency: behavior.xpEfficiency,
      }, date);

      await saveWorkoutToHealth('strength', new Date(startMs), new Date(endMs), caloriesRef.current);
      await settleBehaviorDay(date);

      setState(liftTransitionOrThrow('ended', 'saved'));
      await publishSnapshot('stateChange');
      await clearActiveLiftSnapshot();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/(tabs)/log');
    } catch (err) {
      void captureException(err, { feature: 'live_lift', op: 'save_session' });
      Alert.alert('Save failed', 'Your workout may not have been recorded. Try again?', [
        { text: 'Retry', onPress: () => void saveSession() },
        { text: 'Discard', style: 'destructive', onPress: () => void discardSession() },
      ]);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [publishSnapshot, discardSession]);

  useEffect(() => {
    if (state !== 'recording') return;
    const interval = setInterval(() => {
      void publishSnapshot('tick');
    }, 10000);
    return () => clearInterval(interval);
  }, [publishSnapshot, state]);

  useEffect(() => {
    if (state !== 'recording') return;
    if (Math.round(calories) - lastPublishedCaloriesRef.current >= 8) {
      lastPublishedCaloriesRef.current = Math.round(calories);
      void publishSnapshot('metricThreshold');
    }
  }, [calories, publishSnapshot, state]);

  useEffect(() => {
    const interval = setInterval(() => {
      void (async () => {
        const queue = await getQueuedLiftCommands();
        const command = queue.find((row) => row.sessionId === sessionIdRef.current);
        if (!command) return;

        let accepted = false;
        let reasonCode: string | undefined;
        try {
          if (command.commandType === 'pause') {
            if (stateRef.current === 'recording') {
              await pause();
              accepted = true;
            } else reasonCode = 'invalid_state';
          } else if (command.commandType === 'resume') {
            if (stateRef.current === 'paused') {
              await startOrResume();
              accepted = true;
            } else reasonCode = 'invalid_state';
          } else if (command.commandType === 'requestEnd') {
            if (stateRef.current === 'recording' || stateRef.current === 'paused') {
              await armEnd();
              accepted = true;
            } else reasonCode = 'invalid_state';
          } else if (command.commandType === 'confirmEnd') {
            if (
              stateRef.current === 'endingConfirm' &&
              endConfirmArmedUntilRef.current &&
              Date.now() <= endConfirmArmedUntilRef.current
            ) {
              await confirmEnd();
              accepted = true;
            } else reasonCode = 'confirmWindowExpired';
          } else if (command.commandType === 'cancelEnd') {
            if (stateRef.current === 'endingConfirm') {
              await cancelEnd();
              accepted = true;
            } else {
              accepted = true;
            }
          } else if (command.commandType === 'save') {
            if (stateRef.current === 'ended') {
              await saveSession();
              accepted = true;
            } else reasonCode = 'invalid_state';
          } else if (command.commandType === 'discard') {
            if (stateRef.current === 'ended') {
              await discardSession();
              accepted = true;
            } else reasonCode = 'invalid_state';
          } else {
            reasonCode = 'unsupported_command';
          }
        } catch {
          accepted = false;
          reasonCode = reasonCode || 'command_failed';
        }

        const snapshot = await getActiveLiftSnapshot();
        await putLiftCommandAck({
          clientCommandId: command.clientCommandId,
          accepted,
          reasonCode,
          snapshot: snapshot || undefined,
          ackedAt: new Date().toISOString(),
        });
        await consumeLiftCommand(command.clientCommandId);
      })();
    }, 500);
    return () => clearInterval(interval);
  }, [armEnd, cancelEnd, confirmEnd, discardSession, pause, saveSession, startOrResume]);

  const statusText =
    state === 'ready'
      ? 'Ready'
      : state === 'recording'
      ? 'Recording'
      : state === 'paused'
      ? 'Paused'
      : state === 'endingConfirm'
      ? 'Confirm End'
      : state === 'ended'
      ? 'Ended'
      : state === 'saved'
      ? 'Saved'
      : 'Discarded';

  const canIncrementSet = state === 'recording' || state === 'paused';
  const canUndoSet = canIncrementSet && Boolean(setUndoUntil && Date.now() <= setUndoUntil && setUndoBaseline !== null);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.back}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Lift Tag</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.metricsCard}>
        <Text style={styles.status}>{statusText}</Text>
        <Text style={styles.time}>{formatDuration(elapsedSec)}</Text>
        <Text style={styles.metric}>Calories: {Math.round(calories)} kcal</Text>
        <Text style={styles.metric}>Intensity: {intensityText}</Text>
        <Text style={styles.metric}>Sets: {setCount}</Text>
      </View>

      <View style={styles.controls}>
        {state === 'ready' || state === 'paused' ? (
          <Pressable style={[styles.button, styles.primary]} onPress={startOrResume}>
            <Text style={styles.primaryText}>{state === 'ready' ? 'START LIFT' : 'RESUME'}</Text>
          </Pressable>
        ) : null}
        {state === 'recording' ? (
          <Pressable style={[styles.button, styles.neutral]} onPress={pause}>
            <Text style={styles.neutralText}>PAUSE</Text>
          </Pressable>
        ) : null}
        {(state === 'recording' || state === 'paused') ? (
          <>
            <Pressable style={[styles.button, styles.danger]} onPress={armEnd}>
              <Text style={styles.dangerText}>END</Text>
            </Pressable>
            <Pressable
              style={[styles.button, styles.neutral]}
              onPress={async () => {
                if (!canIncrementSet) return;
                const baseline = setCountRef.current;
                setSetUndoBaseline(baseline);
                setSetCount((value) => value + 1);
                setSetUndoUntil(Date.now() + 5000);
                await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              }}
              disabled={!canIncrementSet}
            >
              <Text style={styles.neutralText}>+ SET</Text>
            </Pressable>
            {canUndoSet ? (
              <Pressable
                style={[styles.button, styles.neutral]}
                onPress={async () => {
                  const baseline = setUndoBaseline;
                  if (baseline === null) return;
                  setSetCount(Math.max(0, baseline));
                  setSetUndoUntil(null);
                  setSetUndoBaseline(null);
                  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
              >
                <Text style={styles.neutralText}>UNDO SET</Text>
              </Pressable>
            ) : null}
          </>
        ) : null}
      </View>

      {state === 'endingConfirm' ? (
        <View style={styles.confirmCard}>
          <Text style={styles.confirmTitle}>End lift?</Text>
          <Text style={styles.confirmSub}>Double tap END within 2.5s</Text>
          <View style={styles.confirmRow}>
            <Pressable style={[styles.button, styles.neutral, styles.flex]} onPress={cancelEnd}>
              <Text style={styles.neutralText}>CANCEL</Text>
            </Pressable>
            <Pressable style={[styles.button, styles.danger, styles.flex]} onPress={confirmEnd}>
              <Text style={styles.dangerText}>END</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {state === 'ended' ? (
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Session Summary</Text>
          <Text style={styles.summaryText}>Duration: {formatDuration(elapsedSec)}</Text>
          <Text style={styles.summaryText}>Calories: {Math.round(calories)} kcal</Text>
          <Text style={styles.summaryText}>Sets: {setCount}</Text>
          <Text style={[styles.summaryTitle, { marginTop: 8 }]}>Classification</Text>
          <View style={styles.classRow}>
            {(['strength', 'hypertrophy', 'conditioning', 'mobility'] as LiftClassificationTag[]).map((row) => (
              <Pressable
                key={row}
                onPress={() => setClassification(row)}
                style={[styles.classChip, classification === row && styles.classChipOn]}
              >
                <Text style={[styles.classChipText, classification === row && styles.classChipTextOn]}>{row}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.confirmRow}>
            <Pressable style={[styles.button, styles.neutral, styles.flex]} onPress={discardSession}>
              <Text style={styles.neutralText}>DISCARD</Text>
            </Pressable>
            <Pressable style={[styles.button, styles.primary, styles.flex, saving && styles.disabled]} onPress={saveSession} disabled={saving}>
              <Text style={styles.primaryText}>{saving ? 'SAVING...' : 'SAVE'}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909', padding: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { color: '#7EDCFF', fontWeight: '700' },
  title: { color: '#FFF', fontWeight: '900', fontSize: 22 },
  metricsCard: {
    marginTop: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#252525',
    backgroundColor: '#121212',
    padding: 16,
  },
  status: { color: '#8FB8C7', fontWeight: '700' },
  time: { color: '#F2FCFF', fontWeight: '900', fontSize: 42, marginTop: 6 },
  metric: { color: '#D4EAF2', fontWeight: '700', marginTop: 6 },
  controls: { marginTop: 14, gap: 10 },
  button: { minHeight: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: '#00D9FF' },
  primaryText: { color: '#04232C', fontWeight: '900', letterSpacing: 0.5 },
  neutral: { backgroundColor: '#192327', borderWidth: 1, borderColor: '#2F4E5B' },
  neutralText: { color: '#DBF4FD', fontWeight: '800' },
  secondary: { borderWidth: 1, borderColor: '#53636A', backgroundColor: '#141719' },
  secondaryText: { color: '#E5EDF0', fontWeight: '800' },
  // P0: destructive actions must read as destructive even before the confirmation state.
  danger: { backgroundColor: '#FF3B30', borderWidth: 1, borderColor: '#B00020' },
  dangerText: { color: '#FFFFFF', fontWeight: '900', letterSpacing: 0.4 },
  confirmCard: {
    marginTop: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#5F2932',
    backgroundColor: '#1D1215',
    padding: 14,
  },
  confirmTitle: { color: '#FFF2F5', fontWeight: '900', fontSize: 18 },
  confirmSub: { color: '#F5CAD4', marginTop: 4, fontWeight: '600' },
  confirmRow: { marginTop: 10, flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
  summaryCard: {
    marginTop: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2B2B2B',
    backgroundColor: '#131313',
    padding: 14,
  },
  summaryTitle: { color: '#EAF9FF', fontWeight: '900', fontSize: 16 },
  summaryText: { color: '#CDE2EA', marginTop: 5, fontWeight: '700' },
  classRow: { marginTop: 8, flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  classChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#35505B',
    backgroundColor: '#172126',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  classChipOn: { borderColor: '#00D9FF', backgroundColor: '#0D3B46' },
  classChipText: { color: '#CFE7EF', fontWeight: '700', textTransform: 'capitalize' },
  classChipTextOn: { color: '#E9FBFF', fontWeight: '900' },
  disabled: { opacity: 0.65 },
});
