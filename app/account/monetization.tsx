import { router } from 'expo-router'; import React, { useCallback, useEffect, useState } from 'react'; import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../components/ui/GlassCard';
import { fetchBillingEntitlement, type BillingEntitlement } from '../../utils/billingService';
import { restorePurchases } from '../../utils/monetizationService';

export default function MonetizationScreen() {
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState(false);
  const [entitlement, setEntitlement] = useState<BillingEntitlement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const ent = await fetchBillingEntitlement();
      setEntitlement(ent);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openPlatformSubscriptionManager = async () => {
    const urls =
      Platform.OS === 'ios'
        ? ['https://apps.apple.com/account/subscriptions', 'https://play.google.com/store/account/subscriptions']
        : ['https://play.google.com/store/account/subscriptions', 'https://apps.apple.com/account/subscriptions'];
    for (const url of urls) {
      try {
        const supported = await Linking.canOpenURL(url);
        if (supported) {
          await Linking.openURL(url);
          return;
        }
      } catch {
        // try next URL
      }
    }
    router.push('/store' as any);
  };

  const restore = async () => {
    if (restoring) return;
    setRestoring(true);
    try {
      await restorePurchases();
      await load();
    } finally {
      setRestoring(false);
    }
  };

  const isPro = Boolean(entitlement?.isPro);
  const status = String(entitlement?.status || 'inactive');

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}><Text style={styles.back}>Back</Text></Pressable>
          <Text style={styles.title}>Subscription</Text>
          <View style={{ width: 40 }} />
        </View>

        <GlassCard>
          <Text style={styles.section}>Current status</Text>
          {loading ? (
            <View style={styles.row}>
              <ActivityIndicator color="#00D9FF" />
              <Text style={styles.item}>Checking entitlement…</Text>
            </View>
          ) : (
            <>
              <Text style={styles.item}>- Tier: {isPro ? 'Zenith Pro' : 'Free'}</Text>
              <Text style={styles.item}>- Status: {status}</Text>
              <Text style={styles.item}>- Plan: {entitlement?.plan || '—'}</Text>
              <Text style={styles.item}>- Renewal: {entitlement?.currentPeriodEnd || '—'}</Text>
            </>
          )}
        </GlassCard>

        <View style={{ height: 10 }} />
        <GlassCard>
          <Text style={styles.section}>Actions</Text>
          <Pressable style={styles.linkButton} onPress={() => router.push('/store' as any)}>
            <Text style={styles.linkButtonText}>{isPro ? 'Open Subscription Store' : 'View Plans'}</Text>
          </Pressable>
          <Pressable style={styles.linkButton} onPress={() => void restore()} disabled={restoring}>
            <Text style={styles.linkButtonText}>{restoring ? 'Restoring…' : 'Restore Purchases'}</Text>
          </Pressable>
          <Pressable style={styles.linkButton} onPress={() => void openPlatformSubscriptionManager()}>
            <Text style={styles.linkButtonText}>Manage on App Store / Play</Text>
          </Pressable>
          <Pressable style={styles.linkButton} onPress={() => void load()} disabled={loading}>
            <Text style={styles.linkButtonText}>{loading ? 'Refreshing…' : 'Refresh Status'}</Text>
          </Pressable>
        </GlassCard>

        <View style={{ height: 10 }} />
        <GlassCard>
          <Text style={styles.section}>Free tier guarantee</Text>
          <Text style={styles.item}>- Core logging remains free.</Text>
          <Text style={styles.item}>- Stats, streaks, and social stay accessible.</Text>
          <Text style={styles.item}>- Pro unlocks advanced analytics and premium bundles.</Text>
        </GlassCard>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  content: { padding: 16, paddingBottom: 40 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  back: { color: '#7EDCFF', fontWeight: '700' },
  title: { color: '#FFF', fontWeight: '800', fontSize: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  section: { color: '#FFF', fontWeight: '800', marginBottom: 8 },
  item: { color: '#D0D0D0', fontWeight: '600', marginBottom: 6, lineHeight: 18 },
  linkButton: {
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2F2F2F',
    backgroundColor: '#161616',
    paddingVertical: 10,
    alignItems: 'center',
  },
  linkButtonText: { color: '#D3EDF6', fontWeight: '800' },
});
