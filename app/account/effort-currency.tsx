import { router } from 'expo-router'; import React, { useCallback, useEffect, useState } from 'react'; import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../components/ui/GlassCard';
import { captureException } from '../../utils/crashReporter';
import {
  CURRENCY_UNLOCK_CATALOG,
  getCurrencySnapshot,
  spendEffortCurrency,
  type CurrencyUnlockCatalogItem,
} from '../../utils/effortCurrencyService';

export default function EffortCurrencyScreen() {
  return <EffortCurrencyScreenInner />;
}

function EffortCurrencyScreenInner() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<{
    balance: number;
    lifetimeEarned: number;
    lifetimeSpent: number;
    unlocks: { advancedAnalytics: boolean; noExcusesMode: boolean; extraLoadoutSlots: number };
    loadoutSlotLimit: number;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getCurrencySnapshot();
      setSnapshot(next);
      setLoadError(null);
    } catch (err: any) {
      setSnapshot(null);
      setLoadError(String(err?.message || 'Unable to load currency balance.'));
      void captureException(err, { feature: 'effort_currency', op: 'load_snapshot' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const isUnlocked = useCallback(
    (item: CurrencyUnlockCatalogItem) => {
      if (!snapshot) return false;
      if (item.key === 'advanced_analytics') return snapshot.unlocks.advancedAnalytics;
      if (item.key === 'no_excuses_mode') return snapshot.unlocks.noExcusesMode;
      return false;
    },
    [snapshot]
  );

  const onPurchase = async (item: CurrencyUnlockCatalogItem) => {
    try {
      const qty = item.key === 'extra_loadout_slot' ? 1 : undefined;
      const result = await spendEffortCurrency({ key: item.key, quantity: qty });
      if (!result.ok) {
        if (result.reason === 'insufficient_balance') {
          Alert.alert('Not enough currency', `You need ${item.cost.toFixed(2)} currency for ${item.title}.`);
        } else if (result.reason === 'already_unlocked') {
          Alert.alert('Already unlocked', `${item.title} is already active.`);
        } else {
          Alert.alert('Unavailable', 'Could not complete this unlock right now.');
        }
        return;
      }
      Alert.alert('Unlocked', `${item.title} unlocked.`);
      await load();
    } catch (err: any) {
      Alert.alert('Purchase failed', String(err?.message || 'Try again.'));
      void captureException(err, { feature: 'effort_currency', op: 'purchase' });
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.back}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Effort Currency</Text>
          <View style={{ width: 42 }} />
        </View>

        <Text style={styles.subtitle}>Earned through strict winning days and discipline. Never purchasable for rank.</Text>
        {loadError ? (
          <GlassCard>
            <Text style={styles.errorTitle}>Couldn’t load effort currency</Text>
            <Text style={styles.errorText}>{loadError}</Text>
            <Pressable style={styles.unlockBtn} onPress={() => void load()}>
              <Text style={styles.unlockBtnText}>Retry</Text>
            </Pressable>
          </GlassCard>
        ) : null}

        <GlassCard>
          <Text style={styles.sectionTitle}>Balance</Text>
          <Text style={styles.balance}>{loading || !snapshot ? '—' : snapshot.balance.toFixed(2)}</Text>
          <Text style={styles.rowText}>Lifetime earned: {snapshot ? snapshot.lifetimeEarned.toFixed(2) : '—'}</Text>
          <Text style={styles.rowText}>Lifetime spent: {snapshot ? snapshot.lifetimeSpent.toFixed(2) : '—'}</Text>
          <Text style={styles.rowText}>Loadout slot limit: {snapshot ? snapshot.loadoutSlotLimit : '—'}</Text>
        </GlassCard>

        {CURRENCY_UNLOCK_CATALOG.map((item) => {
          const unlocked = isUnlocked(item);
          return (
            <GlassCard key={item.key}>
              <Text style={styles.unlockTitle}>{item.title}</Text>
              <Text style={styles.unlockDesc}>{item.description}</Text>
              <Text style={styles.unlockCost}>Cost: {item.cost.toFixed(2)} EC</Text>
              {item.key === 'extra_loadout_slot' && snapshot ? (
                <Text style={styles.rowText}>Purchased: {snapshot.unlocks.extraLoadoutSlots}</Text>
              ) : null}
              <Pressable
                style={[styles.unlockBtn, unlocked && !item.repeatable && styles.unlockBtnDisabled]}
                onPress={() => void onPurchase(item)}
                disabled={unlocked && !item.repeatable}
              >
                <Text style={styles.unlockBtnText}>
                  {unlocked && !item.repeatable ? 'Unlocked' : 'Unlock'}
                </Text>
              </Pressable>
            </GlassCard>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  content: { padding: 16, paddingBottom: 44 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  back: { color: '#7EDCFF', fontWeight: '700' },
  title: { color: '#FFF', fontWeight: '800', fontSize: 20 },
  subtitle: { color: '#A4A4A4', marginTop: 12, marginBottom: 12 },
  errorTitle: { color: '#FFD7D7', fontWeight: '900' },
  errorText: { color: '#FFB7B7', marginTop: 6, fontWeight: '700' },
  sectionTitle: { color: '#FFF', fontWeight: '800' },
  balance: { color: '#E9FBFF', fontSize: 28, fontWeight: '900', marginTop: 6 },
  rowText: { color: '#C8DDE5', marginTop: 4, fontWeight: '600' },
  unlockTitle: { color: '#FFF', fontWeight: '800', fontSize: 15 },
  unlockDesc: { color: '#C8DDE5', marginTop: 6, fontWeight: '600' },
  unlockCost: { color: '#9BE5FF', marginTop: 8, fontWeight: '800' },
  unlockBtn: {
    marginTop: 10,
    minHeight: 42,
    borderRadius: 10,
    backgroundColor: '#00D9FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unlockBtnDisabled: { opacity: 0.55 },
  unlockBtnText: { color: '#041A22', fontWeight: '900' },
});
