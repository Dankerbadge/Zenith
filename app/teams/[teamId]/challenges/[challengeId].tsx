import { useFocusEffect } from '@react-navigation/native';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../../../components/ui/GlassCard';
import SectionHeader from '../../../../components/ui/SectionHeader';
import { isSupabaseConfigured, socialApi } from '../../../../utils/supabaseClient';
import { useAuth } from '../../../context/authcontext';

export default function TeamChallengeDetailScreen() {
  const params = useLocalSearchParams<{ teamId?: string; challengeId?: string }>();
  const teamId = String(params.teamId || '').trim();
  const challengeId = String(params.challengeId || '').trim();
  const { supabaseUserId } = useAuth();
  const viewerUserId = supabaseUserId || '';
  const [challenge, setChallenge] = useState<any | null>(null);
  const [participants, setParticipants] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const mine = useMemo(
    () => participants.find((row) => String(row?.user_id || '') === viewerUserId) || null,
    [participants, viewerUserId]
  );
  const joined = String(mine?.status || '').toUpperCase() === 'JOINED';

  const load = useCallback(async () => {
    if (!challengeId || !isSupabaseConfigured) return;
    setLoading(true);
    try {
      const [challengeRow, rows] = await Promise.all([
        socialApi.getTeamChallenge(challengeId),
        socialApi.getTeamChallengeParticipants(challengeId),
      ]);
      setChallenge(challengeRow);
      const sorted = (Array.isArray(rows) ? rows : []).slice().sort((a: any, b: any) => Number(b?.best_score || 0) - Number(a?.best_score || 0));
      setParticipants(sorted);
    } finally {
      setLoading(false);
    }
  }, [challengeId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const onJoinLeave = async () => {
    if (!viewerUserId || !challengeId || busy) return;
    setBusy(true);
    try {
      if (joined) await socialApi.leaveTeamChallenge(challengeId, viewerUserId);
      else await socialApi.joinTeamChallenge(challengeId, viewerUserId);
      await load();
    } catch (err: any) {
      Alert.alert('Action failed', String(err?.message || 'Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor="#8FDBFF" />}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Challenge</Text>
          <View style={{ width: 60 }} />
        </View>

        <GlassCard>
          <Text style={styles.challengeTitle}>{String(challenge?.title || 'Challenge')}</Text>
          <Text style={styles.challengeMeta}>
            {String(challenge?.challenge_type || 'workouts')} · Target {Number(challenge?.target_value || 0)} · {String(challenge?.start_date || '')} - {String(challenge?.end_date || '')}
          </Text>
          <Pressable style={[styles.primary, busy && styles.disabled]} onPress={() => void onJoinLeave()} disabled={busy}>
            <Text style={styles.primaryText}>{joined ? 'Leave challenge' : 'Join challenge'}</Text>
          </Pressable>
        </GlassCard>

        <SectionHeader title="LEADERBOARD" />
        <GlassCard>
          {!participants.length ? <Text style={styles.empty}>No participants yet.</Text> : null}
          {participants.map((row, index) => {
            const userId = String(row?.user_id || '');
            const score = Number(row?.best_score || 0);
            return (
              <Pressable key={String(row?.id || `${userId}_${index}`)} style={[styles.row, userId === viewerUserId && styles.rowMine]} onPress={() => userId && router.push(`/profile/${userId}` as any)}>
                <Text style={styles.rank}>{index + 1}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{String(row?.profiles?.display_name || row?.profiles?.username || 'Athlete')}</Text>
                  <Text style={styles.meta}>{String(row?.status || 'JOINED')}</Text>
                </View>
                <Text style={styles.value}>{Math.round(score).toLocaleString()}</Text>
              </Pressable>
            );
          })}
        </GlassCard>

        <GlassCard style={{ marginTop: 12 }}>
          <Pressable style={styles.secondary} onPress={() => router.push(`/leaderboards/weekly_xp?teamId=${teamId}&timeframe=WEEK` as any)}>
            <Text style={styles.secondaryText}>Open team leaderboard</Text>
          </Pressable>
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
  challengeTitle: { color: '#EAF8FD', fontWeight: '900', fontSize: 18 },
  challengeMeta: { marginTop: 6, color: '#8FA6AE', fontWeight: '700' },
  primary: { marginTop: 12, minHeight: 44, borderRadius: 12, backgroundColor: '#00D9FF', alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#01212A', fontWeight: '900' },
  secondary: { minHeight: 40, borderRadius: 10, borderWidth: 1, borderColor: '#2A2A2A', backgroundColor: '#111111', alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: '#D5D5D5', fontWeight: '800' },
  disabled: { opacity: 0.6 },
  empty: { color: '#9DA8AD', fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1B1B1B' },
  rowMine: { backgroundColor: 'rgba(0,217,255,0.08)' },
  rank: { width: 24, color: '#8EDFFF', fontWeight: '900', textAlign: 'center' },
  name: { color: '#FFFFFF', fontWeight: '800' },
  meta: { marginTop: 2, color: '#8FA6AE', fontWeight: '700', fontSize: 12 },
  value: { color: '#EAF8FD', fontWeight: '900' },
});
