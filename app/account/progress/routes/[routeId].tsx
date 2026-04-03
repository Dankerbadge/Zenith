import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MapView, { Polyline, PROVIDER_DEFAULT } from 'react-native-maps';

import GlassCard from '../../../../components/ui/GlassCard';
import PremiumGate from '../../../../components/PremiumGate';
import { isSupabaseConfigured, supabase } from '../../../../utils/supabaseClient';
import { decodePolyline } from '../../../../utils/polyline';

function snapshotKey(routeId: string) {
  return `route_snapshot_local_v1:${routeId}:square`;
}

function toRad(value: number) {
  return (value * Math.PI) / 180;
}

function haversineMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const R = 6371000;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
}

function routeDistanceMeters(points: { latitude: number; longitude: number }[]) {
  if (!Array.isArray(points) || points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += haversineMeters(points[i - 1], points[i]);
  }
  return Number(total.toFixed(2));
}

export default function RouteDetailScreen() {
  const params = useLocalSearchParams<{ routeId?: string }>();
  const routeId = String(params.routeId || '');

  const mapRef = useRef<MapView | null>(null);
  const [loading, setLoading] = useState(true);
  const [row, setRow] = useState<any | null>(null);
  const [points, setPoints] = useState<{ latitude: number; longitude: number }[]>([]);
  const [snapshotUri, setSnapshotUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [renameVisible, setRenameVisible] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setRow(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.from('saved_routes').select('*').eq('id', routeId).maybeSingle();
      if (error) throw error;
      setRow(data || null);
      setRenameDraft(String(data?.name || ''));
      const pts = data?.encoded_polyline ? decodePolyline(String(data.encoded_polyline)) : [];
      setPoints(pts);
      const local = await AsyncStorage.getItem(snapshotKey(routeId));
      setSnapshotUri(local || null);
    } catch {
      setRow(null);
      setPoints([]);
    } finally {
      setLoading(false);
    }
  }, [routeId]);

  useEffect(() => {
    if (!routeId) return;
    void refresh();
  }, [refresh, routeId]);

  const region = useMemo(() => {
    if (points.length === 0) return null;
    let minLat = Number.POSITIVE_INFINITY;
    let maxLat = Number.NEGATIVE_INFINITY;
    let minLon = Number.POSITIVE_INFINITY;
    let maxLon = Number.NEGATIVE_INFINITY;
    for (const p of points) {
      minLat = Math.min(minLat, p.latitude);
      maxLat = Math.max(maxLat, p.latitude);
      minLon = Math.min(minLon, p.longitude);
      maxLon = Math.max(maxLon, p.longitude);
    }
    const latDelta = Math.max(0.01, (maxLat - minLat) * 1.25);
    const lonDelta = Math.max(0.01, (maxLon - minLon) * 1.25);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLon + maxLon) / 2,
      latitudeDelta: latDelta,
      longitudeDelta: lonDelta,
    };
  }, [points]);

  const derivedDistanceMeters = useMemo(() => {
    const rowDistance = Number(row?.distance_m || 0);
    if (Number.isFinite(rowDistance) && rowDistance > 0) return rowDistance;
    return routeDistanceMeters(points);
  }, [points, row?.distance_m]);

  const estimatedTimeSec = useMemo(() => {
    const v = Number(row?.estimated_time_s || 0);
    return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
  }, [row?.estimated_time_s]);

  const distanceMilesText = useMemo(() => {
    if (!Number.isFinite(derivedDistanceMeters) || derivedDistanceMeters <= 0) return '—';
    return `${(derivedDistanceMeters / 1609.344).toFixed(2)} mi`;
  }, [derivedDistanceMeters]);

  const estimatedTimeText = useMemo(() => {
    if (!estimatedTimeSec) return '—';
    const mins = Math.max(1, Math.round(estimatedTimeSec / 60));
    return `${mins} min`;
  }, [estimatedTimeSec]);

  const updateRoute = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!row?.id) return false;
      const { error } = await supabase.from('saved_routes').update(patch).eq('id', row.id);
      if (error) throw error;
      await refresh();
      return true;
    },
    [refresh, row?.id]
  );

  const generateOfflineSnapshot = useCallback(async () => {
    if (!mapRef.current) return;
    if (busy) return;
    setBusy(true);
    try {
      const uri = await (mapRef.current as any).takeSnapshot({
        width: 1080,
        height: 1080,
        format: 'png',
        quality: 1,
        result: 'file',
      });
      if (typeof uri === 'string' && uri) {
        await AsyncStorage.setItem(snapshotKey(routeId), uri);
        setSnapshotUri(uri);
        if (row?.id && isSupabaseConfigured) {
          await supabase.from('route_snapshots').upsert({
            route_id: row.id,
            variant: 'square',
            image_path: uri,
            generated_at: new Date().toISOString(),
          });
        }
        Alert.alert('Saved', 'Offline snapshot saved on this device.');
      }
    } catch (e: any) {
      Alert.alert('Snapshot failed', String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }, [busy, routeId, row?.id]);

  const clearOfflineSnapshot = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await AsyncStorage.removeItem(snapshotKey(routeId));
      setSnapshotUri(null);
      if (row?.id && isSupabaseConfigured) {
        await supabase.from('route_snapshots').delete().eq('route_id', row.id).eq('variant', 'square');
      }
      Alert.alert('Removed', 'Offline snapshot removed from this device.');
    } catch (e: any) {
      Alert.alert('Remove failed', String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }, [busy, routeId, row?.id]);

  const saveRename = useCallback(async () => {
    const nextName = renameDraft.trim();
    if (!nextName) {
      Alert.alert('Rename route', 'Route name cannot be empty.');
      return;
    }
    if (mutating) return;
    setMutating(true);
    try {
      await updateRoute({ name: nextName });
      setRenameVisible(false);
      Alert.alert('Updated', 'Route name updated.');
    } catch (e: any) {
      Alert.alert('Rename failed', String(e?.message || e));
    } finally {
      setMutating(false);
    }
  }, [mutating, renameDraft, updateRoute]);

  const togglePublic = useCallback(async () => {
    if (!row?.id || mutating) return;
    setMutating(true);
    try {
      await updateRoute({ is_public: !Boolean(row?.is_public) });
      Alert.alert('Updated', Boolean(row?.is_public) ? 'Route is now private.' : 'Route is now public.');
    } catch (e: any) {
      Alert.alert('Update failed', String(e?.message || e));
    } finally {
      setMutating(false);
    }
  }, [mutating, row?.id, row?.is_public, updateRoute]);

  const deleteRoute = useCallback(() => {
    if (!row?.id) return;
    Alert.alert('Delete route?', 'This removes the route and offline snapshot metadata.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (mutating) return;
          setMutating(true);
          try {
            const { error } = await supabase.from('saved_routes').delete().eq('id', row.id);
            if (error) throw error;
            await AsyncStorage.removeItem(snapshotKey(routeId));
            Alert.alert('Deleted', 'Route removed.');
            router.back();
          } catch (e: any) {
            Alert.alert('Delete failed', String(e?.message || e));
          } finally {
            setMutating(false);
          }
        },
      },
    ]);
  }, [mutating, routeId, row?.id]);

  const openInMaps = useCallback(async () => {
    if (!points.length) {
      Alert.alert('Route', 'No route points are available.');
      return;
    }
    const start = points[0];
    const end = points[points.length - 1];
    const apple = `http://maps.apple.com/?saddr=${start.latitude},${start.longitude}&daddr=${end.latitude},${end.longitude}&dirflg=w`;
    const google = `https://www.google.com/maps/dir/?api=1&origin=${start.latitude},${start.longitude}&destination=${end.latitude},${end.longitude}&travelmode=walking`;
    const candidates = [apple, google];
    for (const url of candidates) {
      try {
        const supported = await Linking.canOpenURL(url);
        if (supported) {
          await Linking.openURL(url);
          return;
        }
      } catch {
        // try next
      }
    }
    Alert.alert('Maps unavailable', 'No maps provider is available on this device.');
  }, [points]);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.back}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Route</Text>
          <View style={{ width: 40 }} />
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color="#00D9FF" />
            <Text style={styles.meta}>Loading…</Text>
          </View>
        ) : !row ? (
          <GlassCard>
            <Text style={styles.cardTitle}>Route not found</Text>
            <Text style={styles.meta}>This route may have been deleted.</Text>
          </GlassCard>
        ) : (
          <>
            <GlassCard>
              <Text style={styles.cardTitle}>{String(row.name || 'Route')}</Text>
              <Text style={styles.meta}>
                {distanceMilesText} · {estimatedTimeText} · {Boolean(row?.is_public) ? 'Public' : 'Private'}
              </Text>
              <Text style={styles.metaSmall}>{String(row.created_at || '').slice(0, 10)}</Text>
              <View style={styles.actionRow}>
                <Pressable style={styles.btnSecondary} onPress={() => setRenameVisible(true)} disabled={mutating}>
                  <Text style={styles.btnSecondaryText}>Rename</Text>
                </Pressable>
                <Pressable style={styles.btnSecondary} onPress={() => void togglePublic()} disabled={mutating}>
                  <Text style={styles.btnSecondaryText}>{Boolean(row?.is_public) ? 'Make private' : 'Make public'}</Text>
                </Pressable>
              </View>
              <View style={styles.actionRow}>
                <Pressable style={styles.btnSecondary} onPress={() => void openInMaps()}>
                  <Text style={styles.btnSecondaryText}>Open in maps</Text>
                </Pressable>
                <Pressable style={styles.btnDanger} onPress={() => deleteRoute()} disabled={mutating}>
                  <Text style={styles.btnDangerText}>Delete</Text>
                </Pressable>
              </View>
            </GlassCard>

            {snapshotUri ? (
              <GlassCard>
                <Text style={styles.cardTitle}>Offline snapshot</Text>
                <Text style={styles.meta}>Saved locally for airplane-mode viewing.</Text>
                <Text style={styles.metaSmall}>{snapshotUri}</Text>
              </GlassCard>
            ) : null}

            {region ? (
              <GlassCard style={{ padding: 0, overflow: 'hidden' }}>
                <MapView
                  ref={(r) => {
                    mapRef.current = r;
                  }}
                  provider={PROVIDER_DEFAULT}
                  style={{ width: '100%', height: 320 }}
                  initialRegion={region}
                  showsUserLocation={false}
                  showsMyLocationButton={false}
                  pitchEnabled={false}
                  rotateEnabled={false}
                >
                  <Polyline coordinates={points} strokeColor="#00D9FF" strokeWidth={4} />
                </MapView>
              </GlassCard>
            ) : (
              <GlassCard>
                <Text style={styles.cardTitle}>No route polyline</Text>
                <Text style={styles.meta}>This route is missing encoded polyline data.</Text>
              </GlassCard>
            )}

            <PremiumGate feature="offlineRoutes">
              <Pressable style={[styles.btnPrimary, busy && styles.disabled]} onPress={() => void generateOfflineSnapshot()} disabled={busy}>
                <Text style={styles.btnPrimaryText}>{busy ? 'Working…' : 'Save offline snapshot'}</Text>
              </Pressable>
              {snapshotUri ? (
                <Pressable style={[styles.btnSecondary, { marginTop: 8 }, busy && styles.disabled]} onPress={() => void clearOfflineSnapshot()} disabled={busy}>
                  <Text style={styles.btnSecondaryText}>Remove offline snapshot</Text>
                </Pressable>
              ) : null}
            </PremiumGate>
          </>
        )}
      </ScrollView>

      <Modal visible={renameVisible} transparent animationType="fade" onRequestClose={() => setRenameVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Rename route</Text>
            <TextInput
              value={renameDraft}
              onChangeText={setRenameDraft}
              placeholder="Route name"
              placeholderTextColor="#6F7B80"
              style={styles.modalInput}
              autoCapitalize="words"
              autoCorrect={false}
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.modalBtnGhost} onPress={() => setRenameVisible(false)} disabled={mutating}>
                <Text style={styles.modalBtnGhostText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.modalBtnPrimary, mutating && styles.disabled]} onPress={() => void saveRename()} disabled={mutating}>
                <Text style={styles.modalBtnPrimaryText}>{mutating ? 'Saving…' : 'Save'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  back: { color: '#7EDCFF', fontWeight: '900' },
  title: { color: '#FFF', fontWeight: '900', fontSize: 20 },
  center: { padding: 18, alignItems: 'center', gap: 10 },
  cardTitle: { color: '#EAF8FD', fontWeight: '900', fontSize: 14 },
  meta: { color: '#A9C4CF', fontWeight: '700', marginTop: 10, lineHeight: 18 },
  metaSmall: { color: '#86A8B6', fontWeight: '700', marginTop: 8, fontSize: 11 },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  btnPrimary: {
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: '#00D9FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimaryText: { color: '#00141A', fontWeight: '900' },
  btnSecondary: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSecondaryText: { color: '#D7EEF8', fontWeight: '900' },
  btnDanger: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,95,110,0.36)',
    backgroundColor: 'rgba(255,95,110,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDangerText: { color: '#FFC7CF', fontWeight: '900' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    padding: 18,
    justifyContent: 'center',
  },
  modalCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: '#101416',
    padding: 14,
  },
  modalTitle: { color: '#F2FBFF', fontWeight: '900', fontSize: 15 },
  modalInput: {
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    color: '#EAF8FD',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontWeight: '700',
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 12 },
  modalBtnGhost: {
    minHeight: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  modalBtnGhostText: { color: '#CDE6EF', fontWeight: '900' },
  modalBtnPrimary: {
    minHeight: 38,
    borderRadius: 10,
    backgroundColor: '#00D9FF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  modalBtnPrimaryText: { color: '#001B21', fontWeight: '900' },
  disabled: { opacity: 0.6 },
});
