import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../components/ui/GlassCard';
import SectionHeader from '../../components/ui/SectionHeader';
import { APP_CONFIG } from '../../utils/appConfig';
import { useAuth } from '../context/authcontext';
import { listWorkoutChallengesForUser, respondToWorkoutChallenge, type ScoreType } from '../../utils/workoutChallengesApi';

function scoreLabel(scoreType: ScoreType) {
  switch (scoreType) {
    case 'FASTEST_TIME_FOR_DISTANCE':
      return 'Fastest time';
    case 'LONGEST_DISTANCE':
      return 'Longest distance';
    case 'MOST_DISTANCE_CUMULATIVE':
      return 'Most cumulative distance';
    case 'MOST_TIME_CUMULATIVE':
      return 'Most cumulative time';
    case 'BEST_AVG_PACE_FOR_DISTANCE':
      return 'Best pace';
    case 'COMPLETION_ONLY':
      return 'Completion';
    case 'SPLITS_COMPLIANCE':
      return 'Splits compliance';
    default:
      return 'Challenge';
  }
}

export default function SocialChallengesScreen() {
  const socialEnabled = APP_CONFIG.FEATURES.SOCIAL_FEATURES_ENABLED || APP_CONFIG.RUNTIME.OVERRIDES.SOCIAL_FEATURES_ENABLED;
  const { supabaseUserId } = useAuth();
  const viewerUserId = supabaseUserId || '';

  const [scope, setScope] = useState<'active' | 'past' | 'invites'>('active');
  const [rows, setRows] = useState<Array<any>>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!viewerUserId) return;
    setLoading(true);
    setError(null);
    try {
      const next = await listWorkoutChallengesForUser({ userId: viewerUserId, scope });
      setRows(next);
    } catch (err: any) {
      setRows([]);
      setError(String(err?.message || 'Unable to load challenges.'));
    } finally {
      setLoading(false);
    }
  }, [scope, viewerUserId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const scopeTitle = useMemo(() => (scope === 'active' ? 'Active' : scope === 'invites' ? 'Invites' : 'Past'), [scope]);

  if (!socialEnabled) return null;

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Social Challenges</Text>
          <Pressable onPress={() => router.push('/challenges/create' as any)} style={styles.createBtn}>
            <Text style={styles.createBtnText}>Create</Text>
          </Pressable>
        </View>

        <View style={styles.scopeRow}>
          {(['active', 'invites', 'past'] as const).map((key) => (
            <Pressable key={key} style={[styles.scopeChip, scope === key && styles.scopeChipOn]} onPress={() => setScope(key)}>
              <Text style={[styles.scopeText, scope === key && styles.scopeTextOn]}>{key === 'active' ? 'Active' : key === 'invites' ? 'Invites' : 'Past'}</Text>
            </Pressable>
          ))}
        </View>

        <SectionHeader title={scopeTitle.toUpperCase()} />

        {loading ? (
          <GlassCard>
            <View style={styles.loadingRow}>
              <ActivityIndicator />
              <Text style={styles.loadingText}>Loading challenges…</Text>
            </View>
          </GlassCard>
        ) : null}

        {error ? (
          <GlassCard>
            <Text style={styles.errorTitle}>Couldn’t load</Text>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable style={styles.retryBtn} onPress={() => void load()}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </GlassCard>
        ) : null}

        {!loading && !error && rows.length === 0 ? (
          <GlassCard>
            <Text style={styles.empty}>No {scope} challenges.</Text>
          </GlassCard>
        ) : null}

        {rows.map((row) => {
          const challenge = row.challenge;
          const me = row.me;
          const isInvite = String(me?.status || '') === 'INVITED';
          const busy = busyId === String(challenge?.id || '');
          return (
            <Pressable key={String(challenge?.id || Math.random())} onPress={() => router.push(`/challenges/social/${challenge.id}` as any)} style={styles.cardPress}>
              <GlassCard>
                <View style={styles.rowTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{String(challenge?.title || 'Challenge')}</Text>
                    <Text style={styles.cardSub}>
                      {String(challenge?.activity_type || '')} · {scoreLabel(challenge?.score_type)}
                    </Text>
                  </View>
                  <Text style={styles.rankText}>{row.myRank ? `#${row.myRank}` : '—'}</Text>
                </View>
                <Text style={styles.cardMeta}>
                  {new Date(challenge?.start_ts).toLocaleDateString()} - {new Date(challenge?.end_ts).toLocaleDateString()}
                </Text>
                <Text style={styles.cardMeta}>Status: {String(me?.status || 'UNKNOWN')}</Text>
                {isInvite ? (
                  <View style={styles.actionRow}>
                    <Pressable
                      style={[styles.acceptBtn, busy && styles.disabled]}
                      disabled={busy}
                      onPress={async () => {
                        setBusyId(String(challenge.id));
                        try {
                          await respondToWorkoutChallenge({ challengeId: challenge.id, userId: viewerUserId, response: 'ACCEPT' });
                          await load();
                        } finally {
                          setBusyId(null);
                        }
                      }}
                    >
                      <Text style={styles.acceptText}>{busy ? '…' : 'Accept'}</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.declineBtn, busy && styles.disabled]}
                      disabled={busy}
                      onPress={async () => {
                        setBusyId(String(challenge.id));
                        try {
                          await respondToWorkoutChallenge({ challengeId: challenge.id, userId: viewerUserId, response: 'DECLINE' });
                          await load();
                        } finally {
                          setBusyId(null);
                        }
                      }}
                    >
                      <Text style={styles.declineText}>{busy ? '…' : 'Decline'}</Text>
                    </Pressable>
                  </View>
                ) : null}
              </GlassCard>
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  content: { padding: 16, paddingBottom: 32 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  backBtn: { minHeight: 40, minWidth: 56, justifyContent: 'center' },
  backText: { color: '#8FDBFF', fontWeight: '800' },
  title: { color: '#FFF', fontWeight: '900', fontSize: 20 },
  createBtn: {
    minHeight: 38,
    borderRadius: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,217,255,0.35)',
    backgroundColor: 'rgba(0,217,255,0.16)',
  },
  createBtnText: { color: '#BFF3FF', fontWeight: '900' },
  scopeRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  scopeChip: {
    flex: 1,
    minHeight: 36,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111111',
  },
  scopeChipOn: { borderColor: 'rgba(0,217,255,0.34)', backgroundColor: 'rgba(0,217,255,0.14)' },
  scopeText: { color: '#D5D5D5', fontWeight: '800', fontSize: 12 },
  scopeTextOn: { color: '#BFF3FF' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  loadingText: { color: '#9CB4BB', fontWeight: '700' },
  errorTitle: { color: '#FFD7D7', fontWeight: '900' },
  errorText: { color: '#FFB7B7', marginTop: 6, fontWeight: '700' },
  retryBtn: {
    marginTop: 10,
    minHeight: 40,
    borderRadius: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#00D9FF',
    alignSelf: 'flex-start',
  },
  retryText: { color: '#01212A', fontWeight: '900' },
  empty: { color: '#9DA8AD', fontWeight: '700' },
  cardPress: { marginTop: 10 },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  cardTitle: { color: '#FFF', fontWeight: '900' },
  cardSub: { color: '#A6C0C8', fontWeight: '700', marginTop: 6, fontSize: 12 },
  rankText: { color: '#8FDBFF', fontWeight: '900', fontSize: 16 },
  cardMeta: { color: '#8FA6AE', fontWeight: '700', marginTop: 6, fontSize: 12 },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  acceptBtn: {
    flex: 1,
    minHeight: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,217,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(0,217,255,0.35)',
  },
  acceptText: { color: '#BFF3FF', fontWeight: '900' },
  declineBtn: {
    flex: 1,
    minHeight: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,77,109,0.10)',
    borderWidth: 1,
    borderColor: '#4A2A2A',
  },
  declineText: { color: '#FFB7C5', fontWeight: '900' },
  disabled: { opacity: 0.6 },
});
