import { useFocusEffect } from '@react-navigation/native';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../../../components/ui/GlassCard';
import SectionHeader from '../../../../components/ui/SectionHeader';
import { isSupabaseConfigured, socialApi } from '../../../../utils/supabaseClient';

export default function TeamChallengesScreen() {
  const params = useLocalSearchParams<{ teamId?: string }>();
  const teamId = String(params.teamId || '').trim();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const { active, past } = useMemo(() => {
    const activeRows = rows.filter((row) => String(row?.status || '').toLowerCase() === 'active');
    const pastRows = rows.filter((row) => String(row?.status || '').toLowerCase() !== 'active');
    return { active: activeRows, past: pastRows };
  }, [rows]);

  const load = useCallback(async () => {
    if (!teamId || !isSupabaseConfigured) return;
    setLoading(true);
    try {
      const challenges = await socialApi.getTeamChallenges(teamId);
      setRows(Array.isArray(challenges) ? challenges : []);
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const renderRow = (row: any) => (
    <Pressable key={String(row?.id || Math.random())} style={styles.row} onPress={() => router.push(`/teams/${teamId}/challenges/${row.id}` as any)}>
      <Text style={styles.rowTitle}>{String(row?.title || 'Challenge')}</Text>
      <Text style={styles.rowMeta}>
        {String(row?.challenge_type || 'workouts')} · {String(row?.start_date || '')} - {String(row?.end_date || '')}
      </Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor="#8FDBFF" />}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Team Challenges</Text>
          <View style={{ width: 60 }} />
        </View>

        <GlassCard>
          <Pressable style={styles.createBtn} onPress={() => router.push(`/teams/${teamId}/challenges/create` as any)}>
            <Text style={styles.createText}>Create team challenge</Text>
          </Pressable>
        </GlassCard>

        <SectionHeader title="ACTIVE" />
        <GlassCard>{active.length ? active.map(renderRow) : <Text style={styles.empty}>No active challenges.</Text>}</GlassCard>
        <SectionHeader title="PAST" />
        <GlassCard>{past.length ? past.map(renderRow) : <Text style={styles.empty}>No past challenges.</Text>}</GlassCard>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  content: { padding: 16, paddingBottom: 32 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { minHeight: 44, minWidth: 60, justifyContent: 'center' },
  backText: { color: '#8FDBFF', fontWeight: '800' },
  title: { color: '#FFFFFF', fontWeight: '900', fontSize: 20 },
  createBtn: { minHeight: 44, borderRadius: 12, backgroundColor: '#00D9FF', alignItems: 'center', justifyContent: 'center' },
  createText: { color: '#01212A', fontWeight: '900' },
  row: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1B1B1B' },
  rowTitle: { color: '#EAF8FD', fontWeight: '900' },
  rowMeta: { marginTop: 4, color: '#8FA6AE', fontSize: 12, fontWeight: '700' },
  empty: { color: '#9DA8AD', fontWeight: '700' },
});
