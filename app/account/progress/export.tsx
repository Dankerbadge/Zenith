import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';

import GlassCard from '../../../components/ui/GlassCard';
import { getSupabaseProjectRef, isSupabaseConfigured, supabase } from '../../../utils/supabaseClient';

function isoDay(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export default function ExportScreen() {
  const [busy, setBusy] = useState(false);

  const today = useMemo(() => isoDay(new Date()), []);
  const from = useMemo(() => isoDay(new Date(Date.now() - 30 * 86400000)), []);

  const exportLocalNutritionCsv = useCallback(async () => {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith('dailyLog_')).sort();
    const rows = await AsyncStorage.multiGet(keys);
    let csv = 'date,calories_kcal,protein_g,carbs_g,fat_g,fiber_g,water_oz,entries\n';
    for (const [key, raw] of rows) {
      const date = key.replace('dailyLog_', '');
      if (date < from || date > today) continue;
      let parsed: any = {};
      try {
        parsed = raw ? JSON.parse(raw) : {};
      } catch {
        parsed = {};
      }
      const calories = Number(parsed?.calories || 0) || 0;
      const protein = Number(parsed?.macros?.protein || 0) || 0;
      const carbs = Number(parsed?.macros?.carbs || 0) || 0;
      const fat = Number(parsed?.macros?.fat || 0) || 0;
      const fiber = Number(parsed?.macros?.fiber || 0) || 0;
      const water = Number(parsed?.water || 0) || 0;
      const entries = Array.isArray(parsed?.foodEntries) ? parsed.foodEntries.length : 0;
      csv += `${date},${calories},${protein},${carbs},${fat},${fiber},${water},${entries}\n`;
    }

    const path = `${FileSystem.cacheDirectory}zenith_nutrition_local_${from}_to_${today}.csv`;
    await FileSystem.writeAsStringAsync(path, csv);
    const canShare = await Sharing.isAvailableAsync();
    if (!canShare) {
      Alert.alert('Export', `Local nutrition CSV saved to: ${path}`);
      return;
    }
    await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: 'Export Nutrition CSV (Local)' });
  }, [from, today]);

  const exportNutrition = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (!isSupabaseConfigured) {
        await exportLocalNutritionCsv();
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        await exportLocalNutritionCsv();
        return;
      }

      // Call function via REST to receive raw CSV.
      const ref = getSupabaseProjectRef();
      if (!ref) throw new Error('supabase_url_missing');
      const funcUrl = `https://${ref}.supabase.co/functions/v1/export-nutrition?from=${encodeURIComponent(from)}&to=${encodeURIComponent(today)}`;

      const res = await fetch(funcUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        await exportLocalNutritionCsv();
        return;
      }
      const csv = await res.text();

      const path = `${FileSystem.cacheDirectory}zenith_nutrition_${from}_to_${today}.csv`;
      await FileSystem.writeAsStringAsync(path, csv);

      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert('Export', `Saved to: ${path}`);
        return;
      }
      await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: 'Export Nutrition CSV' });
    } catch (e: any) {
      try {
        await exportLocalNutritionCsv();
      } catch {
        Alert.alert('Export failed', String(e?.message || e));
      }
    } finally {
      setBusy(false);
    }
  }, [busy, exportLocalNutritionCsv, from, today]);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.back}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Export</Text>
          <View style={{ width: 40 }} />
        </View>

        <GlassCard>
          <Text style={styles.cardTitle}>Nutrition CSV</Text>
          <Text style={styles.meta}>Exports exactly what is logged in `nutrition_daily` for the date range.</Text>
          <Pressable style={[styles.btnPrimary, busy && styles.disabled]} onPress={() => void exportNutrition()} disabled={busy}>
            {busy ? <ActivityIndicator color="#00141A" /> : <Text style={styles.btnPrimaryText}>Export last 30 days</Text>}
          </Pressable>
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
  btnPrimary: {
    marginTop: 12,
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: '#00D9FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimaryText: { color: '#00141A', fontWeight: '900' },
  disabled: { opacity: 0.6 },
});
