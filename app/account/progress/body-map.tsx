import React, { useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import GlassCard from '../../../components/ui/GlassCard';
import BodyMap3DNativeView, { type BodyMapRegionPressEvent } from '../../../components/bodymap/BodyMap3DNativeView';

type BodyMapRegion = {
  id: number;
  key: string;
  scores: {
    stimulus: number;
    soreness: number;
    pain: number;
    fatigue: number;
    composite: number;
  };
};

const REGION_DEMO_DATA: BodyMapRegion[] = [
  { id: 1, key: 'CHEST_L', scores: { stimulus: 62, soreness: 28, pain: 8, fatigue: 41, composite: 44 } },
  { id: 2, key: 'CHEST_R', scores: { stimulus: 66, soreness: 31, pain: 9, fatigue: 43, composite: 47 } },
  { id: 3, key: 'DELTS_FRONT_L', scores: { stimulus: 73, soreness: 35, pain: 12, fatigue: 57, composite: 56 } },
  { id: 4, key: 'DELTS_FRONT_R', scores: { stimulus: 70, soreness: 33, pain: 10, fatigue: 54, composite: 54 } },
  { id: 9, key: 'BICEPS_L', scores: { stimulus: 58, soreness: 27, pain: 9, fatigue: 37, composite: 41 } },
  { id: 10, key: 'BICEPS_R', scores: { stimulus: 60, soreness: 26, pain: 8, fatigue: 39, composite: 41 } },
  { id: 15, key: 'UPPER_BACK_L', scores: { stimulus: 64, soreness: 32, pain: 10, fatigue: 46, composite: 47 } },
  { id: 16, key: 'UPPER_BACK_R', scores: { stimulus: 67, soreness: 34, pain: 10, fatigue: 48, composite: 49 } },
  { id: 21, key: 'ABS', scores: { stimulus: 51, soreness: 20, pain: 6, fatigue: 30, composite: 34 } },
  { id: 24, key: 'LOWER_BACK', scores: { stimulus: 43, soreness: 36, pain: 14, fatigue: 33, composite: 38 } },
  { id: 31, key: 'QUADS_L', scores: { stimulus: 69, soreness: 39, pain: 13, fatigue: 55, composite: 55 } },
  { id: 32, key: 'QUADS_R', scores: { stimulus: 68, soreness: 37, pain: 12, fatigue: 54, composite: 54 } },
  { id: 35, key: 'CALVES_L', scores: { stimulus: 52, soreness: 22, pain: 7, fatigue: 31, composite: 35 } },
  { id: 36, key: 'CALVES_R', scores: { stimulus: 53, soreness: 23, pain: 7, fatigue: 32, composite: 36 } },
];

const LENSES = ['STIMULUS', 'SORENESS', 'PAIN', 'FATIGUE', 'COMPOSITE'] as const;
type OverlayLens = (typeof LENSES)[number];

export default function BodyMap3DProgressScreen() {
  const [overlayMode, setOverlayMode] = useState<OverlayLens>('STIMULUS');
  const [selectedRegionId, setSelectedRegionId] = useState<number>(0);

  const snapshotJson = useMemo(
    () =>
      JSON.stringify({
        overlayMode,
        regions: REGION_DEMO_DATA.map((row) => ({ id: row.id, key: row.key, scores: row.scores })),
      }),
    [overlayMode]
  );

  const selectedRegion = useMemo(() => REGION_DEMO_DATA.find((row) => row.id === selectedRegionId), [selectedRegionId]);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.back}>Back</Text>
          </Pressable>
          <Text style={styles.title}>3D Body Map</Text>
          <View style={{ width: 40 }} />
        </View>

        <GlassCard>
          <Text style={styles.cardTitle}>Overlay Lens</Text>
          <View style={styles.pillRow}>
            {LENSES.map((lens) => (
              <Pressable
                key={lens}
                style={[styles.pill, overlayMode === lens && styles.pillActive]}
                onPress={() => setOverlayMode(lens)}
              >
                <Text style={[styles.pillText, overlayMode === lens && styles.pillTextActive]}>{lens}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.meta}>Tap a region to inspect its score details for the selected lens.</Text>
        </GlassCard>

        <GlassCard style={styles.mapCard}>
          {Platform.OS === 'ios' ? (
            <BodyMap3DNativeView
              style={styles.map}
              overlayMode={overlayMode}
              snapshotJson={snapshotJson}
              selectedRegionId={selectedRegionId}
              onRegionPress={(event) => {
                const payload = event?.nativeEvent as BodyMapRegionPressEvent | undefined;
                setSelectedRegionId(Number(payload?.regionId || 0));
              }}
            />
          ) : (
            <View style={[styles.map, styles.mapFallback]}>
              <Text style={styles.fallbackTitle}>iOS Native Preview</Text>
              <Text style={styles.fallbackBody}>3D Body Map is currently wired for iOS native renderer.</Text>
            </View>
          )}
        </GlassCard>

        <GlassCard>
          <Text style={styles.cardTitle}>Selection</Text>
          {selectedRegion ? (
            <>
              <Text style={styles.regionName}>{selectedRegion.key}</Text>
              <Text style={styles.meta}>Region ID {selectedRegion.id}</Text>
              <Text style={styles.scoreLine}>
                {overlayMode}: {selectedRegion.scores[overlayMode.toLowerCase() as keyof BodyMapRegion['scores']]}
              </Text>
            </>
          ) : (
            <Text style={styles.meta}>No region selected yet.</Text>
          )}
        </GlassCard>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  back: { color: '#7EDCFF', fontWeight: '900' },
  title: { color: '#FFF', fontWeight: '900', fontSize: 20 },
  cardTitle: { color: '#EAF8FD', fontWeight: '900', fontSize: 14 },
  meta: { color: '#A9C4CF', fontWeight: '700', marginTop: 10, lineHeight: 18 },
  mapCard: { padding: 8 },
  map: { width: '100%', height: 420, borderRadius: 14, overflow: 'hidden' },
  mapFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#101723' },
  fallbackTitle: { color: '#DCEBFF', fontWeight: '900', fontSize: 16 },
  fallbackBody: { color: '#A9C4CF', marginTop: 6, fontWeight: '700' },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  pillActive: { backgroundColor: 'rgba(0,217,255,0.2)', borderColor: 'rgba(0,217,255,0.8)' },
  pillText: { color: '#A9C4CF', fontWeight: '800', fontSize: 12 },
  pillTextActive: { color: '#DFF8FF' },
  regionName: { color: '#FFF', fontWeight: '900', fontSize: 16, marginTop: 10 },
  scoreLine: { color: '#DFF8FF', fontWeight: '800', marginTop: 6, fontSize: 13 },
});
