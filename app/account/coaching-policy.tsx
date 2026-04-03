import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import GlassCard from '../../components/ui/GlassCard';
import { getUserProfile, setStorageItem, USER_PROFILE_KEY } from '../../utils/storageUtils';

type PolicyMode = 'strict' | 'balanced' | 'flexible';

type PolicyState = {
  mode: PolicyMode;
  coachingEnabled: boolean;
  loading: boolean;
  saving: boolean;
};

const DEFAULT_STATE: PolicyState = {
  mode: 'balanced',
  coachingEnabled: true,
  loading: true,
  saving: false,
};

function describe(mode: PolicyMode, coachingEnabled: boolean) {
  if (mode === 'strict') return 'Strict applies maximum coaching prompts and enforcement checks.';
  if (mode === 'balanced') return 'Balanced applies coaching guidance with practical enforcement defaults.';
  if (mode === 'flexible') return 'Flexible minimizes interruptions while keeping essential guidance active.';
  return coachingEnabled ? 'Coaching guidance is enabled.' : 'Coaching guidance is off.';
}

export default function CoachingPolicyScreen() {
  const [state, setState] = useState<PolicyState>(DEFAULT_STATE);

  const refresh = useCallback(async () => {
    try {
      const profile = await getUserProfile();
      const prefs = (profile.preferences || {}) as any;
      const rawMode = String(prefs.coachingPolicyMode || 'balanced');
      const mode: PolicyMode = rawMode === 'strict' || rawMode === 'flexible' ? (rawMode as PolicyMode) : 'balanced';
      const coachingEnabled = prefs.coachingEnabled !== false;
      setState((prev) => ({ ...prev, mode, coachingEnabled, loading: false }));
    } catch {
      setState((prev) => ({ ...prev, loading: false }));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const persist = useCallback(
    async (nextEnabled: boolean) => {
      setState((prev) => ({ ...prev, saving: true, coachingEnabled: nextEnabled }));
      try {
        const profile = await getUserProfile();
        await setStorageItem(USER_PROFILE_KEY, {
          ...profile,
          preferences: {
            ...(profile.preferences || {}),
            coachingEnabled: nextEnabled,
          },
        });
      } catch {
        setState((prev) => ({ ...prev, coachingEnabled: !nextEnabled }));
        Alert.alert('Update failed', 'Could not update coaching preference. Please try again.');
      } finally {
        setState((prev) => ({ ...prev, saving: false }));
      }
    },
    []
  );

  const subtitle = describe(state.mode, state.coachingEnabled);
  const persistMode = useCallback(async (nextMode: PolicyMode) => {
    setState((prev) => ({ ...prev, mode: nextMode, saving: true }));
    try {
      const profile = await getUserProfile();
      await setStorageItem(USER_PROFILE_KEY, {
        ...profile,
        preferences: {
          ...(profile.preferences || {}),
          coachingPolicyMode: nextMode,
          coachingEnabled: state.coachingEnabled,
        },
      });
    } catch {
      Alert.alert('Update failed', 'Could not update coaching mode. Please try again.');
    } finally {
      setState((prev) => ({ ...prev, saving: false }));
    }
  }, [state.coachingEnabled]);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Coaching Policy</Text>
          <View style={{ width: 52 }} />
        </View>

        <GlassCard style={styles.card}>
          <Text style={styles.label}>Coaching guidance</Text>
          <View style={styles.modeRow}>
            {(['strict', 'balanced', 'flexible'] as PolicyMode[]).map((mode) => {
              const active = state.mode === mode;
              return (
                <Pressable
                  key={mode}
                  style={[styles.modeChip, active && styles.modeChipOn]}
                  disabled={state.loading || state.saving}
                  onPress={() => void persistMode(mode)}
                >
                  <Text style={[styles.modeChipText, active && styles.modeChipTextOn]}>{mode.toUpperCase()}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.row}>
            <Text style={styles.value}>{state.coachingEnabled ? 'On' : 'Off'}</Text>
            <Switch
              value={state.coachingEnabled}
              disabled={state.loading || state.saving}
              onValueChange={(next) => void persist(next)}
              trackColor={{ false: '#2A2A2A', true: '#00D9FF' }}
              thumbColor={state.coachingEnabled ? '#EAF8FD' : '#8A8A8A'}
            />
          </View>
          <Text style={styles.helper}>User controlled</Text>
          <Text style={styles.description}>{subtitle}</Text>
        </GlassCard>

        <GlassCard>
          <Text style={styles.sectionTitle}>What this controls</Text>
          <Text style={styles.bullet}>• Real-time coaching prompts during sessions</Text>
          <Text style={styles.bullet}>• Strict/Balanced/Flexible coaching policy behavior</Text>
          <Text style={styles.bullet}>• Coaching-related guidance visibility in session UI</Text>
        </GlassCard>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  content: { padding: 16, paddingBottom: 32 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  backBtn: { minHeight: 44, minWidth: 52, justifyContent: 'center' },
  backText: { color: '#8FDBFF', fontWeight: '800' },
  title: { color: '#FFFFFF', fontWeight: '900', fontSize: 20 },
  card: { marginBottom: 12 },
  label: { color: '#D5D5D5', fontWeight: '800', marginBottom: 8 },
  modeRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  modeChip: {
    flex: 1,
    minHeight: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    backgroundColor: '#101010',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeChipOn: {
    borderColor: 'rgba(0,217,255,0.45)',
    backgroundColor: 'rgba(0,217,255,0.14)',
  },
  modeChipText: { color: '#B0C0C8', fontWeight: '800', fontSize: 12 },
  modeChipTextOn: { color: '#DDF7FF' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  value: { color: '#FFFFFF', fontWeight: '900', fontSize: 17 },
  helper: { color: '#9DB8C1', fontWeight: '800', marginBottom: 8, fontSize: 12 },
  description: { color: '#C8D6DB', fontWeight: '700', lineHeight: 20 },
  sectionTitle: { color: '#FFFFFF', fontWeight: '900', marginBottom: 8 },
  bullet: { color: '#A7B7BD', fontWeight: '700', marginBottom: 6 },
});
