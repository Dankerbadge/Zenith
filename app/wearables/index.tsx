import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../components/ui/GlassCard';
import { APP_CONFIG } from '../../utils/appConfig';
import { getWatchWorkoutCarouselOrder } from '../../utils/watchWorkoutCarouselOrder';
import { WATCH_WORKOUT_PLANS } from '../../utils/watchWorkoutPlanCatalog';

export default function WearablesHubScreen() {
  const garminEnabled = APP_CONFIG.FEATURES.GARMIN_CONNECT_ENABLED;
  const appleHealthEnabled = APP_CONFIG.FEATURES.HEALTH_INTEGRATION_ENABLED;
  const healthLabel = Platform.OS === 'ios' ? 'Apple Health' : 'Health data';
  const healthSubtitle =
    Platform.OS === 'ios'
      ? 'Permissions, daily signal import, duplicate merge safeguards.'
      : 'Use Health Connect permissions and sync controls from the health screen.';

  const [watchCarouselPreview, setWatchCarouselPreview] = useState<string>('Tap to customize.');

  const planLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of WATCH_WORKOUT_PLANS) {
      map.set(p.planId, p.subtitle ? `${p.label} · ${p.subtitle}` : p.label);
    }
    return map;
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let alive = true;
    void (async () => {
      try {
        const order = await getWatchWorkoutCarouselOrder();
        if (!alive) return;
        const labels = order.map((id) => planLabelById.get(id) || id).slice(0, 4);
        const suffix = order.length > 4 ? ` +${order.length - 4} more` : '';
        setWatchCarouselPreview(order.length > 0 ? `Current: ${labels.join(', ')}${suffix}` : 'Tap to customize.');
      } catch {
        if (alive) setWatchCarouselPreview('Tap to customize.');
      }
    })();
    return () => {
      alive = false;
    };
  }, [planLabelById]);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.back}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Wearables</Text>
          <View style={{ width: 40 }} />
        </View>

        <Text style={styles.subtitle}>Connect devices, verify sync health, and control import behavior from one place.</Text>

        <GlassCard>
          <Text style={styles.section}>Available providers</Text>
          <Pressable
            style={styles.row}
            onPress={() => router.push('/health-permissions' as any)}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{healthLabel}</Text>
              <Text style={styles.rowText}>{healthSubtitle}</Text>
            </View>
            <Text style={appleHealthEnabled ? styles.badgeLive : styles.badgeOff}>{appleHealthEnabled ? 'Enabled' : 'Off'}</Text>
          </Pressable>

          <Pressable
            style={styles.row}
            onPress={() => router.push('/wearables/garmin' as any)}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Garmin Connect IQ</Text>
              <Text style={styles.rowText}>Companion link, entitlement checks, and workout sync diagnostics.</Text>
            </View>
            <Text style={garminEnabled ? styles.badgeLive : styles.badgeOff}>{garminEnabled ? 'Enabled' : 'Setup'}</Text>
          </Pressable>
        </GlassCard>

        {Platform.OS === 'ios' ? (
          <GlassCard style={{ marginTop: 14 }}>
            <Text style={styles.section}>Apple Watch</Text>
            <Pressable style={styles.row} onPress={() => router.push('/wearables/watch-carousel' as any)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>Workout carousel order</Text>
                <Text style={styles.rowText} numberOfLines={2}>
                  {watchCarouselPreview}
                </Text>
              </View>
              <Text style={styles.badgeLive}>Edit</Text>
            </Pressable>
          </GlassCard>
        ) : null}
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
  subtitle: { color: '#A2A2A2', marginBottom: 12, lineHeight: 20 },
  section: { color: '#FFF', fontWeight: '800', marginBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  rowDisabled: { opacity: 0.55 },
  rowTitle: { color: '#ECECEC', fontWeight: '800', marginBottom: 4 },
  rowText: { color: '#B0B0B0', fontSize: 12, lineHeight: 16 },
  badgeLive: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(126,220,255,0.45)',
    backgroundColor: 'rgba(126,220,255,0.12)',
    color: '#D8F4FF',
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: 11,
    fontWeight: '800',
  },
  badgeOff: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    color: '#D5D5D5',
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: 11,
    fontWeight: '800',
  },
});
