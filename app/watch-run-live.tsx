import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../components/ui/GlassCard';
import { getActiveRunSnapshot, type RunSnapshot } from '../utils/runControlSync';
import { getNativeRoutePreviewDraft, subscribeNativeRoutePreviewDrafts } from '../utils/runNativeBridge';

type MapsModule = typeof import('react-native-maps');
let cachedMapsModule: MapsModule | null = null;
let attemptedMapsModuleLoad = false;

function getMapsModule(): MapsModule | null {
  if (attemptedMapsModuleLoad) return cachedMapsModule;
  attemptedMapsModuleLoad = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedMapsModule = require('react-native-maps');
  } catch (error) {
    if (__DEV__) {
      console.log('react-native-maps unavailable:', error);
    }
    cachedMapsModule = null;
  }
  return cachedMapsModule;
}

type Draft = {
  sessionId?: string;
  finalizeId?: string;
  pointCount?: number;
  hasGap?: boolean;
  pointsE6?: number[][];
  minLatE6?: number;
  minLonE6?: number;
  maxLatE6?: number;
  maxLonE6?: number;
};

function asNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pointsFromDraft(draft: Draft | null) {
  const raw = Array.isArray(draft?.pointsE6) ? (draft?.pointsE6 as any[]) : [];
  return raw
    .flatMap((pair: any) => {
      const latE6 = asNumber(Array.isArray(pair) ? pair[0] : pair?.latE6);
      const lonE6 = asNumber(Array.isArray(pair) ? pair[1] : pair?.lonE6);
      if (latE6 == null || lonE6 == null) return [];
      const latitude = latE6 / 1e6;
      const longitude = lonE6 / 1e6;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
      if (latitude < -90 || latitude > 90) return [];
      if (longitude < -180 || longitude > 180) return [];
      return [{ latitude, longitude }];
    })
    .filter((p, idx, arr) => (idx === 0 ? true : p.latitude !== arr[idx - 1]?.latitude || p.longitude !== arr[idx - 1]?.longitude));
}

function regionFromDraft(draft: Draft | null) {
  const minLatE6 = asNumber(draft?.minLatE6);
  const minLonE6 = asNumber(draft?.minLonE6);
  const maxLatE6 = asNumber(draft?.maxLatE6);
  const maxLonE6 = asNumber(draft?.maxLonE6);
  if (minLatE6 == null || minLonE6 == null || maxLatE6 == null || maxLonE6 == null) return null;
  const minLat = minLatE6 / 1e6;
  const minLon = minLonE6 / 1e6;
  const maxLat = maxLatE6 / 1e6;
  const maxLon = maxLonE6 / 1e6;
  if (![minLat, minLon, maxLat, maxLon].every((v) => Number.isFinite(v))) return null;
  const latitude = (minLat + maxLat) / 2;
  const longitude = (minLon + maxLon) / 2;
  const latitudeDelta = Math.max(0.01, Math.abs(maxLat - minLat) * 1.6);
  const longitudeDelta = Math.max(0.01, Math.abs(maxLon - minLon) * 1.6);
  return { latitude, longitude, latitudeDelta, longitudeDelta };
}

function fmtDurationSec(totalSec: number) {
  const sec = Math.max(0, Math.round(Number(totalSec) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function WatchRunLiveScreen() {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      if (Platform.OS !== 'ios') {
        setLoadError('Live Apple Watch route preview is only available on iOS.');
        setSnapshot(null);
        setDraft(null);
        return;
      }
      const snap = await getActiveRunSnapshot();
      if (!snap || snap.sourceDevice !== 'watch') {
        setLoadError('No active Apple Watch run is currently connected.');
        setSnapshot(null);
        setDraft(null);
        return;
      }
      setSnapshot(snap);
      const nextDraft = await getNativeRoutePreviewDraft(snap.sessionId);
      setDraft(nextDraft);
    } catch {
      setLoadError('Could not load live route preview.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (Platform.OS !== 'ios') return () => {};
    const unsub = subscribeNativeRoutePreviewDrafts((evt) => {
      if (!evt || typeof evt !== 'object') return;
      if (snapshot?.sessionId && evt.sessionId && String(evt.sessionId) !== snapshot.sessionId) return;
      setDraft(evt as Draft);
    });
    return unsub;
  }, [snapshot?.sessionId]);

  const points = useMemo(() => pointsFromDraft(draft), [draft]);
  const region = useMemo(() => regionFromDraft(draft), [draft]);
  const mapsModule = points.length >= 2 ? getMapsModule() : null;
  const MapView = mapsModule?.default;
  const Polyline = mapsModule?.Polyline;

  const headerStatus = snapshot?.state ? snapshot.state.toUpperCase() : 'LIVE';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
      <LinearGradient colors={['#050B10', '#041A22', '#050B10']} style={styles.bg} />

      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn}>
          <Text style={styles.headerBtnText}>Back</Text>
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.title}>Watch Run</Text>
          <Text style={styles.subtitle}>{headerStatus}</Text>
        </View>
        <Pressable onPress={() => void load()} style={styles.headerBtn}>
          <Text style={styles.headerBtnText}>Refresh</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {loading ? (
          <GlassCard>
            <Text style={styles.cardTitle}>Loading…</Text>
            <Text style={styles.cardBody}>Fetching the latest route preview draft.</Text>
          </GlassCard>
        ) : loadError ? (
          <GlassCard>
            <Text style={styles.cardTitle}>Live preview unavailable</Text>
            <Text style={styles.cardBody}>{loadError}</Text>
          </GlassCard>
        ) : (
          <>
            <GlassCard style={styles.metricsCard}>
              <Text style={styles.metricLine}>
                Time: {fmtDurationSec(Number(snapshot?.elapsedTimeSec) || 0)} · Distance:{' '}
                {(Number(snapshot?.totalDistanceMiles) || 0).toFixed(2)} mi
              </Text>
              <Text style={styles.metricLineMuted}>
                Points: {points.length || 0}
                {draft?.hasGap ? ' · Gaps detected (finalize will correct)' : ''}
              </Text>
            </GlassCard>

            <GlassCard style={styles.mapCard}>
              {MapView && Polyline && points.length >= 2 ? (
                <View style={styles.mapWrap}>
                  <MapView
                    style={styles.map}
                    region={
                      region || {
                        latitude: points[0].latitude,
                        longitude: points[0].longitude,
                        latitudeDelta: 0.01,
                        longitudeDelta: 0.01,
                      }
                    }
                    showsUserLocation={false}
                    showsMyLocationButton={false}
                    pitchEnabled={false}
                    rotateEnabled={false}
                    scrollEnabled
                    zoomEnabled
                  >
                    <Polyline coordinates={points} strokeWidth={4} strokeColor="#00D9FF" />
                  </MapView>
                </View>
              ) : (
                <View style={styles.mapEmpty}>
                  <Text style={styles.cardTitle}>Waiting for route preview…</Text>
                  <Text style={styles.cardBody}>
                    This preview updates best-effort while the workout is running. If the phone is unreachable, the full
                    preview will still arrive at finalize-time.
                  </Text>
                </View>
              )}
            </GlassCard>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#050B10' },
  bg: { ...StyleSheet.absoluteFillObject },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 10,
  },
  headerBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(10,20,24,0.7)',
    minWidth: 86,
    alignItems: 'center',
  },
  headerBtnText: { color: '#EAF8FD', fontWeight: '800', fontSize: 12 },
  headerCenter: { alignItems: 'center', flex: 1 },
  title: { color: '#FFF', fontWeight: '900', fontSize: 16 },
  subtitle: { color: '#9BD7EA', fontWeight: '800', fontSize: 11, marginTop: 2 },
  scroll: { paddingHorizontal: 14, paddingBottom: 28 },
  metricsCard: { marginBottom: 10 },
  metricLine: { color: '#EAF8FD', fontWeight: '800' },
  metricLineMuted: { color: '#9AB0BA', marginTop: 6, fontWeight: '700', fontSize: 12 },
  mapCard: { padding: 0, overflow: 'hidden' },
  mapWrap: { height: 320, width: '100%' },
  map: { height: 320, width: '100%' },
  mapEmpty: { padding: 14, minHeight: 220, justifyContent: 'center' },
  cardTitle: { color: '#FFF', fontWeight: '900', fontSize: 15 },
  cardBody: { color: '#B9C8CF', marginTop: 6, fontWeight: '600', lineHeight: 18 },
});
