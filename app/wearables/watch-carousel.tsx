import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../components/ui/GlassCard';
import { pushWatchWorkoutCarouselOrderToWatch } from '../../utils/runNativeBridge';
import { getWatchWorkoutCarouselOrder, setWatchWorkoutCarouselOrder } from '../../utils/watchWorkoutCarouselOrder';
import { WATCH_WORKOUT_PLANS, type WatchWorkoutPlanId } from '../../utils/watchWorkoutPlanCatalog';

const MAX_CAROUSEL_ITEMS = 12;

function planLabel(planId: WatchWorkoutPlanId): string {
  const row = WATCH_WORKOUT_PLANS.find((p) => p.planId === planId);
  if (!row) return planId;
  return row.subtitle ? `${row.label} · ${row.subtitle}` : row.label;
}

function fnv1a64(input: string) {
  let hash = BigInt('1469598103934665603');
  const prime = BigInt('1099511628211');
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & BigInt('0xFFFFFFFFFFFFFFFF');
  }
  return hash;
}

function hslToHex(h: number, s: number, l: number) {
  const hh = ((h % 360) + 360) % 360;
  const ss = Math.max(0, Math.min(1, s));
  const ll = Math.max(0, Math.min(1, l));

  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;

  let r = 0, g = 0, b = 0;
  if (hh < 60) [r, g, b] = [c, x, 0];
  else if (hh < 120) [r, g, b] = [x, c, 0];
  else if (hh < 180) [r, g, b] = [0, c, x];
  else if (hh < 240) [r, g, b] = [0, x, c];
  else if (hh < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  const toHex = (v: number) => {
    const n = Math.round((v + m) * 255);
    return n.toString(16).padStart(2, '0');
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function planAccent(planId: WatchWorkoutPlanId): readonly [string, string] {
  // Keep a few hero accents aligned with the watch app.
  if (planId === 'runOutdoor') return ['#22C6FF', '#5266FF'] as const;
  if (planId === 'runTreadmill') return ['#00BE75', '#0085DB'] as const;
  if (planId === 'lift') return ['#A855F7', '#4E5BFF'] as const;
  if (planId === 'hiit') return ['#FFAA00', '#FF4F6A'] as const;
  if (planId === 'yoga') return ['#7EDCFF', '#6CE8B5'] as const;

  const h = fnv1a64(planId);
  const hue = Number(h % BigInt(360));
  const hue2 = (hue + 30) % 360;
  const c1 = hslToHex(hue, 0.9, 0.62);
  const c2 = hslToHex(hue2, 0.85, 0.36);
  return [c1, c2] as const;
}

export default function WatchCarouselOrderScreen() {
  const [order, setOrder] = useState<WatchWorkoutPlanId[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const current = await getWatchWorkoutCarouselOrder();
        if (!alive) return;
        setOrder(current.slice(0, MAX_CAROUSEL_ITEMS));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const availableToAdd = useMemo(() => {
    const set = new Set(order);
    const cmp = (a: any, b: any) => {
      const aa = `${a.label}${a.subtitle ? ` ${a.subtitle}` : ''}`.toLowerCase();
      const bb = `${b.label}${b.subtitle ? ` ${b.subtitle}` : ''}`.toLowerCase();
      return aa.localeCompare(bb);
    };
    return WATCH_WORKOUT_PLANS.filter((p) => !set.has(p.planId)).sort(cmp).slice(0, 40);
  }, [order]);

  const move = useCallback((idx: number, dir: -1 | 1) => {
    setOrder((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (idx < 0 || idx >= next.length) return prev;
      if (j < 0 || j >= next.length) return prev;
      const tmp = next[idx];
      next[idx] = next[j];
      next[j] = tmp;
      return next;
    });
  }, []);

  const remove = useCallback((planId: WatchWorkoutPlanId) => {
    setOrder((prev) => prev.filter((p) => p !== planId));
  }, []);

  const add = useCallback((planId: WatchWorkoutPlanId) => {
    setOrder((prev) => {
      if (prev.includes(planId)) return prev;
      if (prev.length >= MAX_CAROUSEL_ITEMS) return prev;
      return [...prev, planId];
    });
  }, []);

  const save = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const next = order.slice(0, MAX_CAROUSEL_ITEMS);
      await setWatchWorkoutCarouselOrder(next);
      if (Platform.OS === 'ios') {
        await pushWatchWorkoutCarouselOrderToWatch(next);
      }
      router.back();
    } finally {
      setSaving(false);
    }
  }, [order, saving]);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.back}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Watch Carousel</Text>
          <Pressable onPress={save} disabled={saving || loading}>
            <Text style={[styles.save, (saving || loading) && { opacity: 0.6 }]}>{saving ? 'Saving…' : 'Save'}</Text>
          </Pressable>
        </View>

        <Text style={styles.subtitle}>
          The Apple Watch carousel should stay fast. Pick up to {MAX_CAROUSEL_ITEMS} workouts and order them how you want.
        </Text>

        <GlassCard>
          <Text style={styles.section}>Carousel order</Text>
          {loading ? <Text style={styles.muted}>Loading…</Text> : null}
          {!loading && order.length === 0 ? <Text style={styles.muted}>No workouts selected.</Text> : null}
          {order.map((planId, idx) => (
            <View key={planId} style={[styles.row, idx === order.length - 1 && { borderBottomWidth: 0 }]}>
              <View style={styles.rowAccent} />
              <View style={[styles.rowAccentFill, { backgroundColor: planAccent(planId)[0] + 'CC' }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{planLabel(planId)}</Text>
                <Text style={styles.rowText}>{idx + 1} of {order.length}</Text>
              </View>

              <View style={styles.rowActions}>
                <Pressable onPress={() => move(idx, -1)} style={({ pressed }) => [styles.smallBtn, pressed && styles.pressed]} disabled={idx === 0}>
                  <Text style={[styles.smallBtnText, idx === 0 && styles.smallBtnTextDisabled]}>Up</Text>
                </Pressable>
                <Pressable onPress={() => move(idx, 1)} style={({ pressed }) => [styles.smallBtn, pressed && styles.pressed]} disabled={idx === order.length - 1}>
                  <Text style={[styles.smallBtnText, idx === order.length - 1 && styles.smallBtnTextDisabled]}>Down</Text>
                </Pressable>
                <Pressable onPress={() => remove(planId)} style={({ pressed }) => [styles.smallBtnDanger, pressed && styles.pressed]}>
                  <Text style={styles.smallBtnText}>Remove</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </GlassCard>

        <GlassCard style={{ marginTop: 14 }}>
          <Text style={styles.section}>Add workouts</Text>
          <Text style={styles.muted}>
            Showing a short list (first 40). Add more later if you want; the carousel is capped at {MAX_CAROUSEL_ITEMS}.
          </Text>
          {availableToAdd.map((p, idx) => (
            <View key={p.planId} style={[styles.row, idx === availableToAdd.length - 1 && { borderBottomWidth: 0 }]}>
              <View style={styles.rowAccent} />
              <View style={[styles.rowAccentFill, { backgroundColor: planAccent(p.planId)[0] + 'CC' }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{p.subtitle ? `${p.label} · ${p.subtitle}` : p.label}</Text>
                <Text style={styles.rowText}>{p.group}</Text>
              </View>
              <Pressable onPress={() => add(p.planId)} style={({ pressed }) => [styles.addBtn, pressed && styles.pressed]} disabled={order.length >= MAX_CAROUSEL_ITEMS}>
                <Text style={[styles.addBtnText, order.length >= MAX_CAROUSEL_ITEMS && { opacity: 0.6 }]}>Add</Text>
              </Pressable>
            </View>
          ))}
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
  save: { color: '#7EDCFF', fontWeight: '900' },
  subtitle: { color: '#A2A2A2', marginBottom: 12, lineHeight: 20 },

  section: { color: '#FFF', fontWeight: '800', marginBottom: 8 },
  muted: { color: '#A2A2A2', fontSize: 12, lineHeight: 16, marginBottom: 8 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  rowAccent: {
    width: 3,
    alignSelf: 'stretch',
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  rowAccentFill: {
    position: 'absolute',
    left: 0,
    top: 10,
    bottom: 10,
    width: 3,
    borderRadius: 3,
  },
  rowTitle: { color: '#ECECEC', fontWeight: '800', marginBottom: 4 },
  rowText: { color: '#B0B0B0', fontSize: 12, lineHeight: 16 },

  rowActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  smallBtn: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  smallBtnDanger: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,80,80,0.32)',
    backgroundColor: 'rgba(255,80,80,0.10)',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  smallBtnText: { color: '#EDEDED', fontWeight: '900', fontSize: 12 },
  smallBtnTextDisabled: { opacity: 0.45 },

  addBtn: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(126,220,255,0.45)',
    backgroundColor: 'rgba(126,220,255,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  addBtnText: { color: '#D8F4FF', fontWeight: '900', fontSize: 12 },

  pressed: { opacity: 0.8 },
});
