import { useFocusEffect } from '@react-navigation/native';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../../components/ui/GlassCard';
import SectionHeader from '../../../components/ui/SectionHeader';
import { useAuth } from '../../context/authcontext';
import { reasonCodeToMessage } from '../../../utils/reasonCodeMapper';
import { getWorkoutChallengeDetail } from '../../../utils/workoutChallengesApi';

export default function SocialChallengeDetailScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const challengeId = String(params.id || '').trim();
  const { supabaseUserId } = useAuth();
  const viewerUserId = supabaseUserId || '';

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);

  const load = useCallback(async () => {
    if (!viewerUserId || !challengeId) return;
    setLoading(true);
    setError(null);
    try {
      const next = await getWorkoutChallengeDetail({ challengeId, userId: viewerUserId });
      setDetail(next);
    } catch (err: any) {
      setDetail(null);
      setError(String(err?.message || 'Unable to load challenge.'));
    } finally {
      setLoading(false);
    }
  }, [challengeId, viewerUserId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const recentRejections = useMemo(() => {
    if (!detail?.events) return [];
    return detail.events
      .filter((e: any) => String(e?.type || '') === 'WORKOUT_REJECTED')
      .slice(0, 5)
      .map((e: any) => {
        const reason = String(e?.data?.reasonCode || '');
        return {
          id: String(e?.id || Math.random()),
          reasonCode: reason,
          message: reasonCodeToMessage(reason),
          createdAt: String(e?.created_at || ''),
        };
      });
  }, [detail?.events]);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Challenge Detail</Text>
          <View style={{ width: 56 }} />
        </View>

        {error ? (
          <GlassCard>
            <Text style={styles.errorTitle}>Load failed</Text>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable style={styles.retryBtn} onPress={() => void load()} disabled={loading}>
              <Text style={styles.retryText}>{loading ? 'Retrying…' : 'Retry'}</Text>
            </Pressable>
          </GlassCard>
        ) : null}

        {detail?.challenge ? (
          <>
            <GlassCard>
              <Text style={styles.challengeTitle}>{String(detail.challenge.title || 'Challenge')}</Text>
              <Text style={styles.challengeSub}>
                {String(detail.challenge.activity_type || '')} · {String(detail.challenge.score_type || '').replace(/_/g, ' ')}
              </Text>
              <Text style={styles.challengeSub}>
                {new Date(detail.challenge.start_ts).toLocaleString()} - {new Date(detail.challenge.end_ts).toLocaleString()}
              </Text>
              <Text style={styles.challengeSub}>Status: {String(detail?.me?.status || '')} · Completion: {String(detail?.me?.completion_state || '')}</Text>
            </GlassCard>

            <SectionHeader title='RULES' />
            <GlassCard>
              <Text style={styles.ruleLine}>Location: {String(detail.challenge.rules?.constraints?.locationRequirement || 'EITHER')}</Text>
              <Text style={styles.ruleLine}>Requires route: {String(Boolean(detail.challenge.rules?.constraints?.requiresRoute))}</Text>
              <Text style={styles.ruleLine}>Allowed sources: {String((detail.challenge.rules?.constraints?.allowedSources || []).join(', ') || 'WATCH')}</Text>
              <Text style={styles.ruleLine}>Attempts: {String(detail.challenge.rules?.attemptPolicy?.attemptsAllowed || 'BEST_ONLY')}</Text>
              <Text style={styles.ruleLine}>Distance tolerance: {String(detail.challenge.rules?.constraints?.distanceTolerancePct ?? 0.02)}</Text>
            </GlassCard>

            <SectionHeader title='LEADERBOARD' />
            <GlassCard>
              {(detail.leaderboard || []).map((row: any) => (
                <View key={String(row?.id || Math.random())} style={styles.row}>
                  <Text style={styles.rank}>#{Number(row?.rank || 0)}</Text>
                  <Text style={styles.user}>{String(row?.user_id || '').slice(0, 8)}</Text>
                  <Text style={styles.score}>{Number.isFinite(Number(row?.best_score)) ? String(Number(row.best_score).toFixed(2)) : '—'}</Text>
                </View>
              ))}
            </GlassCard>

            <SectionHeader title="WHY DIDN'T IT COUNT?" />
            <GlassCard>
              {recentRejections.length ? (
                recentRejections.map((row: { id: string; reasonCode: string; message: string }) => (
                  <View key={row.id} style={styles.reasonRow}>
                    <Text style={styles.reasonCode}>{row.reasonCode}</Text>
                    <Text style={styles.reasonText}>{row.message}</Text>
                  </View>
                ))
              ) : (
                <Text style={styles.empty}>No rejected workouts in the latest events.</Text>
              )}
            </GlassCard>
          </>
        ) : (
          <GlassCard>
            <Text style={styles.empty}>{loading ? 'Loading challenge…' : 'Challenge not found.'}</Text>
          </GlassCard>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  content: { padding: 16, paddingBottom: 28 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  backBtn: { minHeight: 40, minWidth: 56, justifyContent: 'center' },
  backText: { color: '#8FDBFF', fontWeight: '800' },
  title: { color: '#FFF', fontWeight: '900', fontSize: 20 },
  errorTitle: { color: '#FFD7D7', fontWeight: '900' },
  errorText: { color: '#FFB7B7', marginTop: 6, fontWeight: '700' },
  retryBtn: { marginTop: 10, minHeight: 40, borderRadius: 10, backgroundColor: '#00D9FF', alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: 12 },
  retryText: { color: '#01212A', fontWeight: '900' },
  challengeTitle: { color: '#FFF', fontWeight: '900', fontSize: 18 },
  challengeSub: { color: '#9CB4BB', marginTop: 6, fontWeight: '700' },
  ruleLine: { color: '#C5D6DB', fontWeight: '700', marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1B1B1B' },
  rank: { width: 48, color: '#8FDBFF', fontWeight: '900' },
  user: { flex: 1, color: '#FFF', fontWeight: '800', fontSize: 12 },
  score: { color: '#BFF3FF', fontWeight: '900' },
  reasonRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1B1B1B' },
  reasonCode: { color: '#FFB7B7', fontWeight: '900', fontSize: 12 },
  reasonText: { color: '#9DA8AD', fontWeight: '700', marginTop: 4 },
  empty: { color: '#9DA8AD', fontWeight: '700' },
});
