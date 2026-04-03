import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Animated, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import FlameMark from '../../components/icons/FlameMark';
import GlassCard from '../../components/ui/GlassCard';
import { getDailyLog, todayKey } from '../../utils/storageUtils';
import { getActiveDaySignals } from '../../utils/semanticTrust';
import { getWinningSnapshot } from '../../utils/winningSystem';

type StreakState = {
  currentStreak: number;
  bestStreak: number;
  checks: {
    food: boolean;
    water: boolean;
    workout: boolean;
    rest: boolean;
    weight: boolean;
  };
};

const DEFAULT_STREAK: StreakState = {
  currentStreak: 0,
  bestStreak: 0,
  checks: { food: false, water: false, workout: false, rest: false, weight: false },
};

function getTimeUntilMidnightLabel(now = new Date()) {
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const remainingMs = Math.max(0, midnight.getTime() - now.getTime());
  const totalSeconds = Math.floor(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export default function StreakDetailModal() {
  const [state, setState] = useState<StreakState>(DEFAULT_STREAK);
  const [countdown, setCountdown] = useState(getTimeUntilMidnightLabel());
  const [sheetY] = useState(() => new Animated.Value(0));

  const closeWithAnimation = useCallback(() => {
    Animated.timing(sheetY, {
      toValue: 520,
      duration: 170,
      useNativeDriver: true,
    }).start(() => {
      router.back();
      sheetY.setValue(0);
    });
  }, [sheetY]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dy) > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_, gesture) => {
          if (gesture.dy > 0) sheetY.setValue(gesture.dy);
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dy > 140 || gesture.vy > 0.9) {
            closeWithAnimation();
            return;
          }
          Animated.spring(sheetY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 5,
          }).start();
        },
      }),
    [sheetY, closeWithAnimation]
  );

  useEffect(() => {
    const load = async () => {
      const [snapshot, log] = await Promise.all([getWinningSnapshot(), getDailyLog(todayKey())]);
      const signals = getActiveDaySignals(log);
      setState({
        currentStreak: snapshot.currentStreak,
        bestStreak: snapshot.bestStreak,
        checks: {
          food: signals.foodLogged,
          water: signals.waterLogged,
          workout: signals.workoutLogged,
          rest: signals.restLogged,
          weight: signals.weightLogged,
        },
      });
    };
    void load();
  }, []);

  useEffect(() => {
    const handle = setInterval(() => {
      setCountdown(getTimeUntilMidnightLabel());
    }, 1000);
    return () => clearInterval(handle);
  }, []);

  const streakLabel = useMemo(
    () => (state.currentStreak === 1 ? 'day' : 'days'),
    [state.currentStreak]
  );

  return (
    <View style={styles.overlay}>
      <Pressable style={styles.backdrop} onPress={closeWithAnimation} />
      <Animated.View
        style={[styles.sheetWrap, { transform: [{ translateY: sheetY }] }]}
        {...panResponder.panHandlers}
      >
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Streak Details</Text>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <GlassCard>
              <View style={styles.streakRow}>
                <FlameMark
                  size={22}
                  color={state.currentStreak > 0 ? '#FF9F0A' : 'rgba(255,255,255,0.45)'}
                  style={state.currentStreak === 0 ? styles.flameMuted : null}
                />
                <View>
                  <Text style={styles.currentValue}>{state.currentStreak}</Text>
                  <Text style={styles.currentLabel}>Current streak ({streakLabel})</Text>
                </View>
              </View>
              <Text style={styles.bestText}>Longest streak: {state.bestStreak} days</Text>
            </GlassCard>

            <View style={{ height: 10 }} />
            <GlassCard>
              <Text style={styles.section}>What counts today</Text>
              <Text style={styles.item}>{state.checks.food ? '✓' : '○'} Log food / calories</Text>
              <Text style={styles.item}>{state.checks.water ? '✓' : '○'} Log water</Text>
              <Text style={styles.item}>{state.checks.workout ? '✓' : '○'} Log a workout (live or manual)</Text>
              <Text style={styles.item}>{state.checks.rest ? '✓' : '○'} Log active rest</Text>
              <Text style={styles.item}>{state.checks.weight ? '✓' : '○'} Log weight</Text>
            </GlassCard>

            <View style={{ height: 10 }} />
            <GlassCard>
              <Text style={styles.section}>Midnight reset</Text>
              <Text style={styles.item}>Time remaining: {countdown}</Text>
              <Text style={styles.note}>Streaks advance when you log at least one core metric before midnight local time.</Text>
              <Text style={styles.note}>Best practice: train, hydrate, and keep nutrition consistent.</Text>
            </GlassCard>
            <View style={{ height: 16 }} />
          </ScrollView>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.38)', justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject },
  sheetWrap: {
    width: '100%',
    maxHeight: '68%',
  },
  sheet: {
    backgroundColor: '#090909',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: '#1F1F1F',
    paddingTop: 10,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#3A3A3A',
    marginBottom: 10,
  },
  content: { padding: 16, paddingBottom: 22 },
  title: { color: '#FFF', fontWeight: '800', fontSize: 19, marginBottom: 12, textAlign: 'center' },
  streakRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flameMuted: { opacity: 0.45 },
  currentValue: { color: '#FFF', fontWeight: '900', fontSize: 28 },
  currentLabel: { color: '#A8C3CE', fontWeight: '700', marginTop: 2 },
  bestText: { marginTop: 10, color: '#D1E6EE', fontWeight: '700' },
  section: { color: '#FFF', fontWeight: '800', marginBottom: 8 },
  item: { color: '#D0D0D0', fontWeight: '600', marginBottom: 8 },
  note: { color: '#8DA4AE', fontWeight: '600', marginTop: 6, fontSize: 12 },
});
