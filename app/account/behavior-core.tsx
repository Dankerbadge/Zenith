import { router } from 'expo-router'; import React, { useCallback, useEffect, useState } from 'react'; import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../components/ui/GlassCard';
import { captureException } from '../../utils/crashReporter';
import {
  estimateSessionsToClearDebt,
  getEffortDebtTier,
  getIdentityLockEligibility,
  getBehaviorMultipliers,
  getBehaviorState,
  settleBehaviorDay,
  type BehavioralState,
} from '../../utils/behavioralCore';
import { getDailyLog, todayKey } from '../../utils/storageUtils';

function formatReason(reason: string | null) {
  if (!reason) return 'None';
  return reason.replace(/_/g, ' ');
}

export default function BehaviorCoreScreen() {
  return <BehaviorCoreScreenInner />;
}

function BehaviorCoreScreenInner() {
  const [state, setState] = useState<BehavioralState | null>(null);
  const [multipliers, setMultipliers] = useState<{ xpEfficiency: number; rankEfficiency: number; active: boolean; reason: string | null } | null>(null);
  const [todayBehavior, setTodayBehavior] = useState<{
    trainingMin?: number;
    recoveryMin?: number;
    previousTraining?: number;
    previousRecovery?: number;
    reason?: string;
  } | null>(null);
  const [lockEligibility, setLockEligibility] = useState<{
    eligible: boolean;
    reason: string;
    strictWinsLast14: number;
    effortDebt: number;
    disciplineScore: number;
  } | null>(null);
  const [settling, setSettling] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const debtPlan = estimateSessionsToClearDebt({ effortDebt: state?.effortDebt || 0 });

  const load = useCallback(async () => {
    try {
      const date = todayKey();
      const [behaviorState, behaviorMultipliers, todayLog, lockState] = await Promise.all([
        getBehaviorState(),
        getBehaviorMultipliers(date),
        getDailyLog(date),
        getIdentityLockEligibility(date),
      ]);
      setState(behaviorState);
      setMultipliers(behaviorMultipliers);
      setLockEligibility(lockState);
      const behavioral = (todayLog as any)?.behavioral || {};
      setTodayBehavior({
        trainingMin: Number(behavioral.adaptiveMinimumTrainingMin) || undefined,
        recoveryMin: Number(behavioral.adaptiveMinimumRecoveryMin) || undefined,
        previousTraining: Number(behavioral.adaptiveMinimumTrainingPrev) || undefined,
        previousRecovery: Number(behavioral.adaptiveMinimumRecoveryPrev) || undefined,
        reason: typeof behavioral.adaptiveMinimumReason === 'string' ? behavioral.adaptiveMinimumReason : undefined,
      });
      setLoadError(null);
    } catch (err: any) {
      setLoadError(String(err?.message || 'Unable to load behavior data.'));
      void captureException(err, { feature: 'behavior_core', op: 'load' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const settle = async () => {
    setSettling(true);
    try {
      await settleBehaviorDay(todayKey());
      await load();
    } catch (err: any) {
      Alert.alert('Settle failed', String(err?.message || 'Unable to recompute today settlement.'));
      void captureException(err, { feature: 'behavior_core', op: 'settle_day' });
    } finally {
      setSettling(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.back}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Behavior Core</Text>
          <View style={{ width: 42 }} />
        </View>

        <Text style={styles.subtitle}>Deterministic discipline state, debt, and effort memory.</Text>
        {loadError ? (
          <GlassCard style={styles.cardBlock}>
            <Text style={styles.errorTitle}>Couldn’t load behavior state</Text>
            <Text style={styles.errorText}>{loadError}</Text>
            <Pressable style={styles.refreshButton} onPress={() => void load()}>
              <Text style={styles.refreshText}>Retry</Text>
            </Pressable>
          </GlassCard>
        ) : null}

        <GlassCard style={styles.cardBlock}>
          <Text style={styles.sectionTitle}>Silent Accountability</Text>
          <Text style={styles.metric}>Active: {multipliers?.active ? 'Yes' : 'No'}</Text>
          <Text style={styles.rowText}>XP efficiency: {(multipliers?.xpEfficiency || 1).toFixed(2)}x</Text>
          <Text style={styles.rowText}>Rank efficiency: {(multipliers?.rankEfficiency || 1).toFixed(2)}x</Text>
          <Text style={styles.rowText}>Reason: {formatReason(multipliers?.reason || null)}</Text>
        </GlassCard>

        <GlassCard style={styles.cardBlock}>
          <Text style={styles.sectionTitle}>Debt & Discipline</Text>
          <Text style={styles.metric}>Effort Debt: {(state?.effortDebt || 0).toFixed(2)}</Text>
          <Text style={styles.rowText}>Debt tier: {getEffortDebtTier(state?.effortDebt || 0)}</Text>
          <Text style={styles.rowText}>Discipline Score: {Math.round(state?.disciplineScore || 0)}</Text>
          <Text style={styles.rowText}>Consecutive misses: {state?.consecutiveMisses || 0}</Text>
          <Text style={styles.rowText}>Low-effort repayment streak: {state?.lowEffortRepaymentStreak || 0}</Text>
          <Text style={styles.rowText}>
            Estimated sessions to clear: {debtPlan.trainingSessions} training / {debtPlan.recoverySessions} recovery
          </Text>
          <Pressable style={styles.refreshButton} onPress={settle} disabled={settling}>
            <Text style={styles.refreshText}>{settling ? 'Settling…' : 'Recompute today settlement'}</Text>
          </Pressable>
        </GlassCard>

        <GlassCard style={styles.cardBlock}>
          <Text style={styles.sectionTitle}>Effort Currency</Text>
          <Text style={styles.metric}>{(state?.currencyBalance || 0).toFixed(2)} EC</Text>
          <Text style={styles.rowText}>Lifetime earned: {(state?.currencyLifetimeEarned || 0).toFixed(2)}</Text>
          <Text style={styles.rowText}>Lifetime spent: {(state?.currencyLifetimeSpent || 0).toFixed(2)}</Text>
          <Pressable style={styles.refreshButton} onPress={() => router.push('/account/effort-currency' as any)}>
            <Text style={styles.refreshText}>Open Effort Currency Store</Text>
          </Pressable>
        </GlassCard>

        <GlassCard style={styles.cardBlock}>
          <Text style={styles.sectionTitle}>Modes</Text>
          <Text style={styles.rowText}>Strict deterministic core: {state?.modes?.strictDeterminismEnabled ? 'On' : 'Off'}</Text>
          <Text style={styles.rowText}>Identity lock: {state?.modes?.identityLockEnabled ? 'On' : 'Off'}</Text>
          <Text style={styles.rowText}>No excuses: {state?.modes?.noExcusesEnabled ? 'On' : 'Off'}</Text>
          <Text style={styles.rowText}>Injury mode: {state?.modes?.injuryModeEnabled ? 'On' : 'Off'}</Text>
          <Text style={styles.rowText}>Illness mode: {state?.modes?.illnessModeEnabled ? 'On' : 'Off'}</Text>
          <Text style={styles.rowText}>Identity lock eligibility: {lockEligibility?.eligible ? 'Eligible' : 'Not yet'}</Text>
          <Text style={styles.rowText}>Lock-in requirement check: {lockEligibility?.reason || '—'}</Text>
          <Text style={styles.rowText}>Strict wins (14d): {lockEligibility?.strictWinsLast14 ?? 0}</Text>
        </GlassCard>

        <GlassCard style={styles.cardBlock}>
          <Text style={styles.sectionTitle}>Adaptive Minimums (Today)</Text>
          <Text style={styles.rowText}>
            Training minimum: {todayBehavior?.trainingMin ? `${todayBehavior.trainingMin} min` : '—'}
          </Text>
          <Text style={styles.rowText}>
            Recovery minimum: {todayBehavior?.recoveryMin ? `${todayBehavior.recoveryMin} min` : '—'}
          </Text>
          <Text style={styles.rowText}>
            Previous training min: {todayBehavior?.previousTraining ? `${todayBehavior.previousTraining} min` : '—'}
          </Text>
          <Text style={styles.rowText}>
            Previous recovery min: {todayBehavior?.previousRecovery ? `${todayBehavior.previousRecovery} min` : '—'}
          </Text>
          <Text style={styles.rowText}>Why this changed: {todayBehavior?.reason || 'No settled day yet.'}</Text>
        </GlassCard>

        <GlassCard style={styles.cardBlock}>
          <Text style={styles.sectionTitle}>Effort Memory</Text>
          {state?.memoryEvents?.length ? (
            state.memoryEvents
              .slice()
              .reverse()
              .slice(0, 12)
              .map((event) => (
                <View key={event.id} style={styles.memoryRow}>
                  <Text style={styles.memoryTitle}>{event.title}</Text>
                  <Text style={styles.memoryDate}>{event.date}</Text>
                  <Text style={styles.memoryDetail}>{event.detail}</Text>
                  <Text style={styles.memoryEvidence}>{event.evidence}</Text>
                </View>
              ))
          ) : (
            <Text style={styles.rowText}>No memory events yet.</Text>
          )}
        </GlassCard>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  content: { padding: 16, paddingBottom: 44, gap: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  back: { color: '#7EDCFF', fontWeight: '700' },
  title: { color: '#FFF', fontWeight: '800', fontSize: 20 },
  subtitle: { color: '#A4A4A4', marginTop: 12, marginBottom: 12 },
  cardBlock: { marginBottom: 2 },
  errorTitle: { color: '#FFD7D7', fontWeight: '900' },
  errorText: { color: '#FFB7B7', marginTop: 6, fontWeight: '700' },
  sectionTitle: { color: '#FFF', fontSize: 15, fontWeight: '800', marginBottom: 8 },
  metric: { color: '#E9FBFF', fontSize: 20, fontWeight: '900', marginBottom: 4 },
  rowText: {
    color: '#C8DDE5',
    marginTop: 8,
    fontWeight: '600',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  refreshButton: {
    marginTop: 12,
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#355866',
    backgroundColor: '#12222B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshText: { color: '#D8F6FF', fontWeight: '800' },
  memoryRow: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    paddingTop: 10,
    marginTop: 10,
  },
  memoryTitle: { color: '#E8F8FF', fontWeight: '800' },
  memoryDate: { color: '#90AAB5', fontSize: 12, marginTop: 2 },
  memoryDetail: { color: '#D2E6ED', marginTop: 6, fontWeight: '600' },
  memoryEvidence: { color: '#8FAFBA', marginTop: 4, fontSize: 12 },
});
