import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import Constants from 'expo-constants';

import GlassCard from '../../../components/ui/GlassCard';
import Screen from '../../../components/ui/Screen';
import { NEON_THEME } from '../../../constants/neonTheme';
import BodyMap3DNativeView, {
  type BodyMapInteractionStateEvent,
  type BodyMapRendererStateEvent,
  type BodyMapRegionPressEvent,
} from '../../../components/bodymap/BodyMap3DNativeView';
import {
  BODY_MAP_LENSES,
  BODY_MAP_TIMEFRAMES,
  computeBodyMapSnapshot,
  type BodyMapComputedSnapshot,
  type BodyMapLens,
  type BodyMapRegionSnapshot,
  type BodyMapTimeframe,
} from '../../../utils/bodyMapProgress';

const CAMERA_PRESETS = ['FRONT', 'BACK', 'ORBIT'] as const;
type CameraPreset = (typeof CAMERA_PRESETS)[number];
type RendererMode = 'asset' | 'primitive' | 'missing_asset' | 'unknown';

function scoreForLens(region: BodyMapRegionSnapshot, lens: BodyMapLens): number {
  if (lens === 'SORENESS') return region.scores.soreness;
  if (lens === 'PAIN') return region.scores.pain;
  if (lens === 'FATIGUE') return region.scores.fatigue;
  if (lens === 'COMPOSITE') return region.scores.composite;
  return region.scores.stimulus;
}

function shortDate(dateKey: string): string {
  const [yearRaw, monthRaw, dayRaw] = String(dateKey).split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return dateKey;
  return `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
}

function resolveBuildStamp(): string {
  const constantsAny = Constants as unknown as {
    expoConfig?: {
      version?: string | null;
      ios?: { buildNumber?: string | number | null } | null;
    } | null;
    nativeApplicationVersion?: string | null;
    nativeBuildVersion?: string | number | null;
    manifest?: { ios?: { buildNumber?: string | number | null } | null } | null;
    manifest2?: {
      extra?: {
        expoClient?: { ios?: { buildNumber?: string | number | null } | null } | null;
      } | null;
    } | null;
  };

  const version =
    (typeof constantsAny.expoConfig?.version === 'string' && constantsAny.expoConfig.version) ||
    (typeof constantsAny.nativeApplicationVersion === 'string' && constantsAny.nativeApplicationVersion) ||
    null;
  const buildRaw =
    constantsAny.expoConfig?.ios?.buildNumber ??
    constantsAny.nativeBuildVersion ??
    constantsAny.manifest?.ios?.buildNumber ??
    constantsAny.manifest2?.extra?.expoClient?.ios?.buildNumber ??
    null;
  const build = buildRaw == null ? null : String(buildRaw);

  if (version && build) return `v${version} (${build})`;
  if (version) return `v${version}`;
  return 'build unknown';
}

export default function BodyMap3DProgressScreen() {
  const [timeframe, setTimeframe] = useState<BodyMapTimeframe>('SESSION');
  const [overlayMode, setOverlayMode] = useState<BodyMapLens>('STIMULUS');
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('FRONT');
  const [historyVisible, setHistoryVisible] = useState(false);
  const [selectedRegionId, setSelectedRegionId] = useState<number>(0);
  const [mapInteracting, setMapInteracting] = useState<boolean>(false);
  const [rendererMode, setRendererMode] = useState<RendererMode>('unknown');
  const [snapshot, setSnapshot] = useState<BodyMapComputedSnapshot | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await computeBodyMapSnapshot(timeframe);
      setSnapshot(next);
      setSelectedRegionId((prev) => (next.regions.some((region) => region.id === prev) ? prev : 0));
    } catch (err: any) {
      setSnapshot(null);
      setError(String(err?.message || err || 'Failed to compute body-map snapshot.'));
    } finally {
      setLoading(false);
    }
  }, [timeframe]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const snapshotJson = useMemo(
    () =>
      JSON.stringify({
        timeframe,
        overlayMode,
        regions: (snapshot?.regions || []).map((row) => ({ id: row.id, key: row.key, scores: row.scores })),
      }),
    [overlayMode, snapshot, timeframe]
  );

  const stimulusLensJson = useMemo(() => JSON.stringify(snapshot?.lensSummaries || {}), [snapshot]);

  const regionPanelsJson = useMemo(
    () =>
      JSON.stringify(
        (snapshot?.regions || []).map((region) => ({
          id: region.id,
          key: region.key,
          label: region.label,
          scores: region.scores,
        }))
      ),
    [snapshot]
  );

  const selectedRegion = useMemo(
    () => snapshot?.regions.find((row) => row.id === selectedRegionId) || null,
    [selectedRegionId, snapshot]
  );

  const selectedHistory = useMemo(() => {
    if (!selectedRegion || !snapshot) return [];
    return snapshot.historyByRegionId[selectedRegion.id] || [];
  }, [selectedRegion, snapshot]);

  const topRegions = useMemo(() => {
    const summary = snapshot?.lensSummaries?.[overlayMode];
    return summary?.topRegions || [];
  }, [overlayMode, snapshot]);
  const buildStamp = useMemo(() => resolveBuildStamp(), []);

  return (
    <Screen edges={['top']} aura>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} scrollEnabled={!mapInteracting}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.back}>Back</Text>
          </Pressable>
          <View style={styles.titleStack}>
            <Text style={styles.title}>3D Body Map</Text>
            <Text style={styles.buildStamp}>{buildStamp}</Text>
          </View>
          <Pressable onPress={() => setHistoryVisible((prev) => !prev)}>
            <Text style={styles.historyToggle}>{historyVisible ? 'Hide History' : 'History'}</Text>
          </Pressable>
        </View>

        <GlassCard>
          <Text style={styles.cardTitle}>Timeframe</Text>
          <View style={styles.pillRow}>
            {BODY_MAP_TIMEFRAMES.map((value) => (
              <Pressable
                key={value}
                style={[styles.pill, timeframe === value && styles.pillActive]}
                onPress={() => setTimeframe(value)}
              >
                <Text style={[styles.pillText, timeframe === value && styles.pillTextActive]}>{value}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.meta}>Controls the log window used to compute all body-map scores.</Text>
        </GlassCard>

        <GlassCard>
          <Text style={styles.cardTitle}>Lens + View</Text>
          <View style={styles.pillRow}>
            {BODY_MAP_LENSES.map((lens) => (
              <Pressable
                key={lens}
                style={[styles.pill, overlayMode === lens && styles.pillActive]}
                onPress={() => setOverlayMode(lens)}
              >
                <Text style={[styles.pillText, overlayMode === lens && styles.pillTextActive]}>{lens}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.pillRow}>
            {CAMERA_PRESETS.map((preset) => (
              <Pressable
                key={preset}
                style={[styles.pill, cameraPreset === preset && styles.pillActive]}
                onPress={() => setCameraPreset(preset)}
              >
                <Text style={[styles.pillText, cameraPreset === preset && styles.pillTextActive]}>{preset}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.meta}>
            Tap a region to inspect details. In ORBIT mode, drag across the map to rotate.
          </Text>
        </GlassCard>

        <GlassCard style={styles.mapCard}>
          {loading ? (
            <View style={[styles.map, styles.mapFallback]}>
              <ActivityIndicator color={NEON_THEME.color.neonCyan} />
              <Text style={styles.meta}>Computing snapshot…</Text>
            </View>
          ) : error ? (
            <View style={[styles.map, styles.mapFallback]}>
              <Text style={styles.fallbackTitle}>Couldn’t compute body map</Text>
              <Text style={styles.fallbackBody}>{error}</Text>
              <Pressable style={[styles.pill, styles.retryPill]} onPress={() => void refresh()}>
                <Text style={[styles.pillText, styles.pillTextActive]}>Retry</Text>
              </Pressable>
            </View>
          ) : Platform.OS === 'ios' ? (
            <BodyMap3DNativeView
              style={styles.map}
              overlayMode={overlayMode}
              activeLens={overlayMode}
              cameraPreset={cameraPreset}
              allowPrimitiveFallback={false}
              snapshotJson={snapshotJson}
              stimulusLensJson={stimulusLensJson}
              regionPanelsJson={regionPanelsJson}
              selectedRegionId={selectedRegionId}
              onRegionPress={(event) => {
                const payload = event?.nativeEvent as BodyMapRegionPressEvent | undefined;
                setSelectedRegionId(Number(payload?.regionId || 0));
              }}
              onInteractionStateChange={(event) => {
                const payload = event?.nativeEvent as BodyMapInteractionStateEvent | undefined;
                setMapInteracting(Boolean(payload?.interacting));
              }}
              onRendererStateChange={(event) => {
                const payload = event?.nativeEvent as BodyMapRendererStateEvent | undefined;
                const next = String(payload?.mode || 'unknown');
                if (next === 'asset' || next === 'primitive' || next === 'missing_asset') {
                  setRendererMode(next);
                } else {
                  setRendererMode('unknown');
                }
              }}
            />
          ) : (
            <View style={[styles.map, styles.mapFallback]}>
              <Text style={styles.fallbackTitle}>iOS Native Preview</Text>
              <Text style={styles.fallbackBody}>3D Body Map is currently wired for iOS native renderer.</Text>
            </View>
          )}
        </GlassCard>

        {Platform.OS === 'ios' && rendererMode !== 'asset' ? (
          <GlassCard>
            <Text style={styles.cardTitle}>Renderer Status</Text>
            <Text style={styles.meta}>
              {rendererMode === 'primitive'
                ? 'Primitive fallback renderer is active. Add BodyMapModel.scn/usdz to ship the final surface map.'
                : 'Mesh asset not found. Add BodyMapModel.scn or BodyMapModel.usdz to iOS app resources.'}
            </Text>
          </GlassCard>
        ) : null}

        <GlassCard>
          <Text style={styles.cardTitle}>Selection</Text>
          {selectedRegion ? (
            <>
              <Text style={styles.regionName}>{selectedRegion.label}</Text>
              <Text style={styles.meta}>{selectedRegion.key}</Text>
              <Text style={styles.meta}>Region ID {selectedRegion.id}</Text>
              <View style={styles.scoreGrid}>
                <Text style={[styles.scoreLine, overlayMode === 'STIMULUS' && styles.scoreLineActive]}>Stimulus {selectedRegion.scores.stimulus}</Text>
                <Text style={[styles.scoreLine, overlayMode === 'SORENESS' && styles.scoreLineActive]}>Soreness {selectedRegion.scores.soreness}</Text>
                <Text style={[styles.scoreLine, overlayMode === 'PAIN' && styles.scoreLineActive]}>Pain {selectedRegion.scores.pain}</Text>
                <Text style={[styles.scoreLine, overlayMode === 'FATIGUE' && styles.scoreLineActive]}>Fatigue {selectedRegion.scores.fatigue}</Text>
                <Text style={[styles.scoreLine, overlayMode === 'COMPOSITE' && styles.scoreLineActive]}>Composite {selectedRegion.scores.composite}</Text>
              </View>
            </>
          ) : (
            <Text style={styles.meta}>No region selected yet.</Text>
          )}
        </GlassCard>

        <GlassCard>
          <Text style={styles.cardTitle}>{overlayMode} Hotspots</Text>
          {topRegions.length ? (
            topRegions.map((region) => (
              <View key={region.id} style={styles.row}>
                <Text style={styles.rowLabel}>{region.label}</Text>
                <Text style={styles.rowValue}>{region.score}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.meta}>No regional load data yet.</Text>
          )}
        </GlassCard>

        {historyVisible ? (
          <GlassCard>
            <Text style={styles.cardTitle}>History</Text>
            {selectedRegion ? (
              selectedHistory.length ? (
                selectedHistory.map((point) => (
                  <View key={`${selectedRegion.id}:${point.date}`} style={styles.row}>
                    <Text style={styles.rowLabel}>{shortDate(point.date)}</Text>
                    <Text style={styles.rowValue}>{scoreForLens({ ...selectedRegion, scores: point.scores }, overlayMode)}</Text>
                  </View>
                ))
              ) : (
                <Text style={styles.meta}>No history rows for this region yet.</Text>
              )
            ) : (
              <Text style={styles.meta}>Select a region to view history.</Text>
            )}
          </GlassCard>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  back: { color: NEON_THEME.color.neonCyan, fontWeight: '900' },
  titleStack: { alignItems: 'center', gap: 2 },
  title: { color: NEON_THEME.color.textPrimary, fontWeight: '900', fontSize: 20 },
  buildStamp: { color: NEON_THEME.color.textSecondary, fontWeight: '700', fontSize: 11 },
  historyToggle: { color: NEON_THEME.color.textSecondary, fontWeight: '800' },
  cardTitle: { color: NEON_THEME.color.textPrimary, fontWeight: '900', fontSize: 14 },
  meta: { color: NEON_THEME.color.textSecondary, fontWeight: '700', marginTop: 10, lineHeight: 18 },
  mapCard: { padding: 8 },
  map: { width: '100%', height: 420, borderRadius: 14, overflow: 'hidden' },
  mapFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#101723' },
  fallbackTitle: { color: '#DCEBFF', fontWeight: '900', fontSize: 16, textAlign: 'center' },
  fallbackBody: { color: '#A9C4CF', marginTop: 6, fontWeight: '700', textAlign: 'center' },
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
  retryPill: { marginTop: 12 },
  pillText: { color: NEON_THEME.color.textSecondary, fontWeight: '800', fontSize: 12 },
  pillTextActive: { color: '#DFF8FF' },
  regionName: { color: NEON_THEME.color.textPrimary, fontWeight: '900', fontSize: 16, marginTop: 10 },
  scoreGrid: { marginTop: 8, gap: 6 },
  scoreLine: { color: '#DFF8FF', fontWeight: '700', fontSize: 13 },
  scoreLineActive: { color: NEON_THEME.color.neonCyan, fontWeight: '900' },
  row: { marginTop: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  rowLabel: { color: '#DFF4FF', fontWeight: '700', flex: 1 },
  rowValue: { color: '#98ECFF', fontWeight: '900' },
});
