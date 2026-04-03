import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

import GlassCard from '../../../components/ui/GlassCard';
import PremiumGate from '../../../components/PremiumGate';
import { isSupabaseConfigured, supabase } from '../../../utils/supabaseClient';
import { encodePolyline, bboxForPoints, type LatLng } from '../../../utils/polyline';

type SavedRun = {
  timestamp?: string;
  title?: string;
  distance?: number;
  duration?: number;
  route?: { latitude: number; longitude: number }[];
};

function safeParseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toRad(value: number) {
  return (value * Math.PI) / 180;
}

function haversineMeters(a: LatLng, b: LatLng) {
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

function routeDistanceMeters(points: LatLng[]) {
  if (!Array.isArray(points) || points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += haversineMeters(points[i - 1], points[i]);
  }
  return Number(total.toFixed(2));
}

function formatMiles(distanceMeters: number | null | undefined) {
  const meters = Number(distanceMeters || 0);
  if (!Number.isFinite(meters) || meters <= 0) return '—';
  return `${(meters / 1609.344).toFixed(2)} mi`;
}

export default function RoutesScreen() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [routes, setRoutes] = useState<any[]>([]);
  const [suggested, setSuggested] = useState<SavedRun[]>([]);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setRoutes([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.from('saved_routes').select('*').order('created_at', { ascending: false }).limit(50);
      if (error) throw error;
      setRoutes(Array.isArray(data) ? data : []);
    } catch {
      setRoutes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSuggested = useCallback(async () => {
    const raw = await AsyncStorage.getItem('runsHistory');
    const rows = safeParseJson<SavedRun[]>(raw, []);
    const withRoute = rows.filter((r) => Array.isArray(r.route) && r.route.length >= 2 && typeof r.timestamp === 'string');
    setSuggested(withRoute.slice().reverse().slice(0, 6));
  }, []);

  useEffect(() => {
    void refresh();
    void loadSuggested();
  }, [refresh, loadSuggested]);

  const openRoute = useCallback((routeId: string) => {
    router.push(`/account/progress/routes/${routeId}` as any);
  }, []);

  const saveFromRun = useCallback(async (run: SavedRun) => {
    if (!isSupabaseConfigured) {
      Alert.alert('Routes', 'Supabase is not configured in this build.');
      return;
    }
    if (saving) return;
    const points = (run.route || []).map((p) => ({ latitude: Number(p.latitude), longitude: Number(p.longitude) })).filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
    if (points.length < 2) {
      Alert.alert('Routes', 'No route polyline found.');
      return;
    }

    setSaving(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) {
        Alert.alert('Routes', 'Please sign in to save routes.');
        return;
      }

      const bbox = bboxForPoints(points as LatLng[]);
      const encoded = encodePolyline(points as LatLng[]);
      const storedDistanceMeters =
        Number(run.distance || 0) > 0 ? Number((Number(run.distance) * 1609.344).toFixed(2)) : routeDistanceMeters(points as LatLng[]);
      const estimatedTimeSec =
        Number.isFinite(Number(run.duration || 0)) && Number(run.duration || 0) > 0 ? Math.round(Number(run.duration) * 60) : null;
      const name = run.title?.trim() || `Route from ${String(run.timestamp || '').slice(0, 10)}`;

      const existing = await supabase
        .from('saved_routes')
        .select('id,name')
        .eq('user_id', user.id)
        .eq('encoded_polyline', encoded)
        .limit(1)
        .maybeSingle();
      if (!existing.error && existing.data?.id) {
        Alert.alert('Already saved', 'This route is already in your library.');
        openRoute(String(existing.data.id));
        return;
      }

      const { error } = await supabase.from('saved_routes').insert({
        user_id: user.id,
        name,
        encoded_polyline: encoded,
        bbox,
        distance_m: storedDistanceMeters > 0 ? storedDistanceMeters : null,
        elevation_gain_m: null,
        estimated_time_s: estimatedTimeSec,
        is_public: false,
      });
      if (error) throw error;
      await refresh();
      Alert.alert('Saved', 'Route saved to your library.');
    } catch (e: any) {
      Alert.alert('Save failed', String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }, [openRoute, refresh, saving]);

  const totalRoutes = routes.length;
  const totalDistanceMiles = useMemo(() => {
    return routes.reduce((sum, row) => {
      const meters = Number(row?.distance_m || 0);
      if (!Number.isFinite(meters) || meters <= 0) return sum;
      return sum + meters / 1609.344;
    }, 0);
  }, [routes]);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.back}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Routes</Text>
          <View style={{ width: 40 }} />
        </View>

        <PremiumGate feature="routes">
          <GlassCard>
            <Text style={styles.cardTitle}>Suggested from your history</Text>
            <Text style={styles.meta}>Save past GPS runs into your reusable route library with preserved shape and metrics.</Text>
            {suggested.length ? (
              <View style={{ gap: 10, marginTop: 10 }}>
                {suggested.map((r) => (
                  <Pressable key={String(r.timestamp)} style={styles.suggestRow} onPress={() => void saveFromRun(r)}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.suggestTitle} numberOfLines={1}>{r.title?.trim() || 'Run route'}</Text>
                      <Text style={styles.suggestMeta}>
                        {String(r.timestamp || '').slice(0, 10)} · {Array.isArray(r.route) ? r.route.length : 0} points ·{' '}
                        {Number.isFinite(Number(r.distance || 0)) && Number(r.distance || 0) > 0
                          ? `${Number(r.distance).toFixed(2)} mi`
                          : 'distance from map'}
                      </Text>
                    </View>
                    <Text style={styles.suggestCta}>{saving ? '…' : 'Save'}</Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <Text style={styles.meta}>No GPS routes found in your local run history yet.</Text>
            )}
          </GlassCard>
        </PremiumGate>

        <GlassCard>
          <Text style={styles.cardTitle}>My Routes</Text>
          {!loading ? (
            <Text style={styles.meta}>
              {totalRoutes} route{totalRoutes === 1 ? '' : 's'} · {totalDistanceMiles > 0 ? `${totalDistanceMiles.toFixed(1)} mi total` : 'No distance totals yet'}
            </Text>
          ) : null}
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color="#00D9FF" />
              <Text style={styles.meta}>Loading…</Text>
            </View>
          ) : routes.length ? (
            <View style={{ gap: 10, marginTop: 10 }}>
              {routes.map((r) => (
                <Pressable key={String(r.id)} style={styles.routeRow} onPress={() => openRoute(String(r.id))}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.routeTitle} numberOfLines={1}>{String(r.name || 'Route')}</Text>
                    <Text style={styles.routeMeta} numberOfLines={1}>
                      {String(r.created_at || '').slice(0, 10)} · {formatMiles(Number(r.distance_m || 0))}{' '}
                      {r.is_public ? '· Public' : '· Private'}
                    </Text>
                  </View>
                  <Text style={styles.routeCta}>Open</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <Text style={styles.meta}>No saved routes yet.</Text>
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
  center: { padding: 18, alignItems: 'center', gap: 10 },
  cardTitle: { color: '#EAF8FD', fontWeight: '900', fontSize: 14 },
  meta: { color: '#A9C4CF', fontWeight: '700', marginTop: 10, lineHeight: 18 },
  suggestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    padding: 12,
  },
  suggestTitle: { color: '#FFF', fontWeight: '900' },
  suggestMeta: { color: '#86A8B6', fontWeight: '800', marginTop: 4, fontSize: 12 },
  suggestCta: { color: '#00D9FF', fontWeight: '900' },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    padding: 12,
  },
  routeTitle: { color: '#FFF', fontWeight: '900' },
  routeMeta: { color: '#86A8B6', fontWeight: '800', marginTop: 4, fontSize: 12 },
  routeCta: { color: 'rgba(255,255,255,0.75)', fontWeight: '900' },
});
