import { useFocusEffect } from '@react-navigation/native';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../components/ui/GlassCard';
import { isSupabaseConfigured, socialApi } from '../../utils/supabaseClient';
import { useAuth } from '../context/authcontext';

export default function LeaderboardDetailScreen() {
  const params = useLocalSearchParams<{ key?: string; timeframe?: 'DAY' | 'WEEK' | 'MONTH'; teamId?: string }>();
  const key = String(params.key || 'weekly_xp').trim();
  const timeframe = (String(params.timeframe || 'WEEK').toUpperCase() as 'DAY' | 'WEEK' | 'MONTH');
  const teamId = params.teamId ? String(params.teamId) : null;
  const { supabaseUserId } = useAuth();
  const viewerUserId = supabaseUserId || '';
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!viewerUserId || !isSupabaseConfigured) return;
    setLoading(true);
    try {
      setError(null);
      const data = await socialApi.getLeaderboard({ leaderboardKey: key, timeframe, teamId, limit: 100 });
      setRows(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setRows([]);
      setError(String(err?.message || 'Unable to load leaderboard.'));
    } finally {
      setLoading(false);
    }
  }, [key, teamId, timeframe, viewerUserId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const myRowIndex = useMemo(() => rows.findIndex((row) => String(row?.user_id || row?.id || '') === viewerUserId), [rows, viewerUserId]);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor="#8FDBFF" />}
      >
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Leaderboard</Text>
          <View style={{ width: 60 }} />
        </View>

        <Text style={styles.sub}>{key.replace(/_/g, ' ')} · {timeframe}</Text>
        <GlassCard>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {!rows.length && !loading ? <Text style={styles.empty}>No data yet. Log a workout to get on the board.</Text> : null}
          {rows.map((row, idx) => {
            const userId = String(row?.user_id || row?.id || '');
            const mine = userId === viewerUserId;
            return (
              <Pressable key={`${userId}_${idx}`} style={[styles.row, mine && styles.rowMine]} onPress={() => userId && router.push(`/profile/${userId}` as any)}>
                <Text style={styles.rank}>{Number(row?.rank || idx + 1)}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{String(row?.display_name || row?.username || 'Athlete')}</Text>
                  <Text style={styles.handle}>@{String(row?.username || 'unknown')}</Text>
                </View>
                <Text style={styles.value}>{Math.round(Number(row?.value || row?.total_xp || 0)).toLocaleString()}</Text>
              </Pressable>
            );
          })}
          {myRowIndex >= 0 ? <Text style={styles.mineText}>You are #{myRowIndex + 1}</Text> : null}
        </GlassCard>
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
  sub: { color: '#9DA8AD', marginTop: 8, marginBottom: 10, fontWeight: '700' },
  error: { color: '#FFB4C6', fontWeight: '700', marginBottom: 8 },
  empty: { color: '#9DA8AD', fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1B1B1B' },
  rowMine: { backgroundColor: 'rgba(0,217,255,0.08)' },
  rank: { width: 24, color: '#8EDFFF', fontWeight: '900', textAlign: 'center' },
  name: { color: '#FFFFFF', fontWeight: '800' },
  handle: { color: '#8FA6AE', marginTop: 2, fontWeight: '700', fontSize: 12 },
  value: { color: '#EAF8FD', fontWeight: '900' },
  mineText: { marginTop: 10, color: '#8EDFFF', fontWeight: '800' },
});
