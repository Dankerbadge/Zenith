import { router } from 'expo-router'; import React, { useEffect, useMemo, useState } from 'react'; import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Chip from '../../components/ui/Chip';
import GlassCard from '../../components/ui/GlassCard';
import {
  canonicalEngineType,
  clampXpWeight,
  getDefaultWorkoutLoadouts,
  getWorkoutLoadouts,
  saveWorkoutLoadouts,
  type WorkoutLoadout,
} from '../../utils/effortEngine';
import { getCurrencySnapshot } from '../../utils/effortCurrencyService';

const XP_OPTIONS = [0.8, 0.9, 1.0, 1.1, 1.2] as const;

export default function WorkoutLoadoutsScreen() {
  const [rows, setRows] = useState<WorkoutLoadout[]>([]);
  const [saving, setSaving] = useState(false);
  const [slotLimit, setSlotLimit] = useState(6);

  useEffect(() => {
    const load = async () => {
      const [list, currency] = await Promise.all([getWorkoutLoadouts(), getCurrencySnapshot()]);
      setRows(list);
      setSlotLimit(currency.loadoutSlotLimit);
    };
    void load();
  }, []);

  const enabledCount = useMemo(() => rows.filter((row) => row.enabled).length, [rows]);

  const setEnabled = (id: string, enabled: boolean) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, enabled } : row)));
  };

  const setWinningDay = (id: string, countsForWinningDay: boolean) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, countsForWinningDay } : row)));
  };

  const setXpWeight = (id: string, xpWeight: number) => {
    const nextWeight = clampXpWeight(xpWeight);
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, xpWeight: nextWeight } : row)));
  };

  const restoreDefaults = () => {
    setRows(getDefaultWorkoutLoadouts());
  };

  const save = async () => {
    if (enabledCount === 0) {
      Alert.alert('Enable at least one workout', 'Keep one workout enabled so Watch/Home start actions stay available.');
      return;
    }

    setSaving(true);
    try {
      const saved = await saveWorkoutLoadouts(rows);
      setRows(saved);
      Alert.alert('Saved', 'Workout loadouts updated.');
      router.back();
    } catch {
      Alert.alert('Could not save', 'Try again in a moment.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.back}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Workout Loadouts</Text>
          <View style={{ width: 42 }} />
        </View>

        <Text style={styles.subtitle}>Engine-bound starts with guardrails. Names can vary, physiology stays honest.</Text>

        <GlassCard>
          <Text style={styles.sectionLabel}>Enabled start actions</Text>
          <Text style={styles.sectionValue}>{enabledCount} active</Text>
          <Text style={styles.helper}>Slots used: {rows.length} / {slotLimit}</Text>
          <Text style={styles.helper}>You can customize semantic profiles, but engine type and XP weight stay bounded.</Text>
        </GlassCard>

        {rows.map((row) => (
          <GlassCard key={row.id}>
            <View style={styles.rowHeader}>
              <View>
                <Text style={styles.rowTitle}>{row.name}</Text>
                <Text style={styles.rowMeta}>Engine: {canonicalEngineType(row.engine).replace('_', ' ')}</Text>
              </View>
              <Chip label={row.enabled ? 'Enabled' : 'Disabled'} active={row.enabled} onPress={() => setEnabled(row.id, !row.enabled)} />
            </View>

            <Text style={styles.label}>Counts toward Winning Day</Text>
            <View style={styles.inlineRow}>
              <Chip label='Yes' active={row.countsForWinningDay} onPress={() => setWinningDay(row.id, true)} />
              <Chip label='No' active={!row.countsForWinningDay} onPress={() => setWinningDay(row.id, false)} />
            </View>

            <Text style={styles.label}>XP weight (bounded)</Text>
            <View style={styles.inlineRow}>
              {XP_OPTIONS.map((weight) => (
                <Chip
                  key={`${row.id}-${weight}`}
                  label={`${weight.toFixed(1)}x`}
                  active={Math.abs(row.xpWeight - weight) < 0.001}
                  onPress={() => setXpWeight(row.id, weight)}
                />
              ))}
            </View>
          </GlassCard>
        ))}

        <GlassCard>
          <Pressable style={styles.secondaryBtn} onPress={restoreDefaults}>
            <Text style={styles.secondaryBtnText}>Restore defaults</Text>
          </Pressable>
          <Pressable style={[styles.primaryBtn, saving && styles.btnDisabled]} onPress={save} disabled={saving}>
            <Text style={styles.primaryBtnText}>{saving ? 'Saving...' : 'Save loadouts'}</Text>
          </Pressable>
        </GlassCard>
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
  sectionLabel: { color: '#E0E0E0', fontWeight: '700' },
  sectionValue: { color: '#FFFFFF', fontWeight: '900', fontSize: 24, marginTop: 6 },
  helper: { color: '#9BB9C2', marginTop: 8, fontSize: 12, lineHeight: 17 },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowTitle: { color: '#FFF', fontWeight: '800', fontSize: 16 },
  rowMeta: { color: '#A6C7D1', marginTop: 3 },
  label: { color: '#E2E2E2', fontWeight: '700', marginTop: 10, marginBottom: 8 },
  inlineRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  secondaryBtn: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3A3A3A',
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#151515',
  },
  secondaryBtnText: { color: '#D3EDF6', fontWeight: '800', fontSize: 14 },
  primaryBtn: {
    marginTop: 10,
    borderRadius: 12,
    backgroundColor: '#00D9FF',
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#041A22', fontWeight: '900', fontSize: 15 },
  btnDisabled: { opacity: 0.6 },
});
