import { useFocusEffect } from '@react-navigation/native'; import { Redirect, router, useLocalSearchParams } from 'expo-router'; import React, { useCallback, useMemo, useState } from 'react'; import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../../components/ui/GlassCard';
import SectionHeader from '../../../components/ui/SectionHeader';
import { APP_CONFIG } from '../../../utils/appConfig';
import { isSupabaseConfigured, socialApi } from '../../../utils/supabaseClient';
import { getCoachAccessModeForTeam, setCoachAccessModeForTeam, type CoachAccessMode } from '../../../utils/coachAccessPolicyService';
import { useAuth } from '../../context/authcontext';

export default function TeamDetailScreen() {
  const params = useLocalSearchParams<{ teamId?: string }>();
  const teamId = String(params.teamId || '').trim();

  const socialEnabled = APP_CONFIG.FEATURES.SOCIAL_FEATURES_ENABLED || APP_CONFIG.RUNTIME.OVERRIDES.SOCIAL_FEATURES_ENABLED;
  const { supabaseUserId } = useAuth();
  const viewerUserId = supabaseUserId || null;

  const [team, setTeam] = useState<any | null>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [teamGroup, setTeamGroup] = useState<any | null>(null);
  const [invite, setInvite] = useState<{ invite_code?: string; invite_code_version?: number; rotated_at?: string } | null>(null);
  const [coachAccessMode, setCoachAccessMode] = useState<CoachAccessMode>('training_only');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedSetupHint, setFeedSetupHint] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  const viewerRole = useMemo(() => {
    const direct = members.find((row: any) => String(row?.user_id || '') === String(viewerUserId || ''));
    const fromMembers = String(direct?.role || '').toLowerCase();
    if (fromMembers) return fromMembers;
    if (team?.owner_id && viewerUserId && String(team.owner_id) === String(viewerUserId)) return 'owner';
    return '';
  }, [members, team, viewerUserId]);

  const canRotateInvites = viewerRole === 'owner' || viewerRole === 'admin';
  const canViewInviteCode = Boolean(viewerRole);

  const load = useCallback(async () => {
    if (!viewerUserId || !teamId || !isSupabaseConfigured) return;
    try {
      setLoadError(null);
      const [teamRow, memberRows, group] = await Promise.all([
        socialApi.getTeam(teamId),
        socialApi.getTeamMembers(teamId),
        socialApi.getTeamGroup(teamId),
      ]);
      setTeam(teamRow);
      setMembers(Array.isArray(memberRows) ? memberRows : []);
      setTeamGroup(group);
      setCoachAccessMode(await getCoachAccessModeForTeam(teamId));
      setFeedSetupHint(null);

      // Best-effort: invite codes are admin-only; failure must not block team viewing.
      try {
        const inviteRow = await socialApi.getTeamInviteCode(teamId);
        setInvite(inviteRow);
      } catch {
        setInvite(null);
      }
    } catch (err: any) {
      setLoadError(String(err?.message || 'Unable to load team.'));
      setTeam(null);
      setMembers([]);
      setTeamGroup(null);
      setInvite(null);
    }
  }, [viewerUserId, teamId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const withBusy = async (task: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await task();
      await load();
    } catch (err: any) {
      Alert.alert('Action failed', String(err?.message || 'Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const leaveTeamAndExit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await socialApi.leaveTeam(viewerUserId!, teamId);
      router.replace('/teams' as any);
    } catch (err: any) {
      Alert.alert('Action failed', String(err?.message || 'Try again.'));
    } finally {
      setBusy(false);
    }
  };

  if (!socialEnabled) return <Redirect href='/(tabs)/profile' />;
  if (!viewerUserId) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}><Text style={styles.empty}>Sign in to view teams.</Text></View>
      </SafeAreaView>
    );
  }
  if (!isSupabaseConfigured) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.empty}>Cloud sync is required to use teams.</Text>
          <Pressable style={styles.centerCta} onPress={() => router.push('/auth/login' as any)}>
            <Text style={styles.centerCtaText}>Sign in</Text>
          </Pressable>
          <Pressable style={styles.centerCta} onPress={() => router.back()}>
            <Text style={styles.centerCtaText}>Go back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }
  if (!teamId) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.empty}>This team link is invalid.</Text>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor='#8FDBFF' />}
      >
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <Text style={styles.title}>{team?.name || 'Team'}</Text>
          <View style={{ width: 60 }} />
        </View>

        <Text style={styles.subtitle}>{team?.description || 'Team space'}</Text>
        {loadError ? (
          <GlassCard>
            <Text style={styles.empty}>Team backend error.</Text>
            <Text style={styles.errorText}>{loadError}</Text>
            <Pressable style={styles.retryBtn} onPress={() => void load()} disabled={refreshing || busy}>
              <Text style={styles.retryText}>{refreshing || busy ? 'Retrying…' : 'Retry'}</Text>
            </Pressable>
          </GlassCard>
        ) : null}

        <SectionHeader title='TEAM FEED' />
        <GlassCard>
          <Pressable
            style={[styles.ghostWide, { marginBottom: 10 }]}
            onPress={() => router.push(`/teams/${teamId}/challenges` as any)}
            disabled={busy}
          >
            <Text style={styles.ghostWideText}>Open team challenges</Text>
          </Pressable>
          {teamGroup ? (
            <>
              <Pressable
                style={[styles.primaryWide, (!teamGroup?.id || busy) && styles.primaryWideDisabled]}
                onPress={() => router.push(`/groups/${teamGroup.id}` as any)}
                disabled={busy || !teamGroup?.id}
              >
                <Text style={[styles.primaryWideText, (!teamGroup?.id || busy) && styles.primaryWideTextDisabled]}>Open team feed</Text>
              </Pressable>
              <Pressable
                style={styles.ghostWide}
                onPress={() => router.push(`/groups/${teamGroup.id}?composeChallenge=1` as any)}
                disabled={busy || !teamGroup?.id}
              >
                <Text style={styles.ghostWideText}>Send team challenge</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.empty}>Team feed is ready to set up.</Text>
              <Pressable
                style={styles.ghostWide}
                disabled={busy}
                onPress={() =>
                  void withBusy(async () => {
                    const created = await socialApi.ensureTeamGroup(viewerUserId, teamId);
                    const createdId = String(created?.id || '');
                    if (!created || !createdId) {
                      const nextHint = `Feed setup is temporarily unavailable. Retry in a moment.`;
                      setFeedSetupHint(nextHint);
                      Alert.alert('Feed setup pending', nextHint);
                      return;
                    }
                    setFeedSetupHint(null);
                    setTeamGroup(created);
                    router.push(`/groups/${createdId}` as any);
                  })
                }
              >
                <Text style={styles.ghostWideText}>Set up feed</Text>
              </Pressable>
              {feedSetupHint ? (
                <View style={styles.feedHintBox}>
                  <Text style={styles.feedHintText}>{feedSetupHint}</Text>
                  <Pressable style={styles.feedHintBtn} onPress={() => void load()} disabled={busy}>
                    <Text style={styles.feedHintBtnText}>{busy ? 'Refreshing…' : 'Refresh feed status'}</Text>
                  </Pressable>
                </View>
              ) : null}
            </>
          )}
        </GlassCard>

        <SectionHeader title='TEAM SETTINGS · INVITE CODE' />
        <GlassCard>
          {canViewInviteCode ? (
            <>
              {invite?.invite_code ? (
                <>
                  <Text style={styles.inviteCode}>{String(invite.invite_code)}</Text>
                  <Text style={styles.empty}>Share this 6-digit code with non-members so they can join this team.</Text>
                </>
              ) : (
                <Text style={styles.empty}>Invite code unavailable.</Text>
              )}
              {canRotateInvites ? (
                <Pressable
                  style={[styles.ghostWide, busy && styles.primaryWideDisabled]}
                  disabled={busy}
                  onPress={() =>
                    Alert.alert('Regenerate invite code?', 'Regenerating will invalidate the previous code immediately.', [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Regenerate',
                        style: 'destructive',
                        onPress: () =>
                          void withBusy(async () => {
                            const next = await socialApi.rotateTeamInviteCode(teamId);
                            if (!next?.invite_code) {
                              throw new Error('Invite rotation unavailable. Only the owner/admin can regenerate codes.');
                            }
                            setInvite(next);
                          }),
                      },
                    ])
                  }
                >
                  <Text style={styles.ghostWideText}>{busy ? 'Working…' : 'Regenerate code'}</Text>
                </Pressable>
              ) : (
                <Text style={styles.errorText}>Only owner/admin can regenerate code.</Text>
              )}
            </>
          ) : (
            <Text style={styles.empty}>Invite code is available to active team members only.</Text>
          )}
        </GlassCard>

        <SectionHeader title='COACH DATA ACCESS' />
        <GlassCard>
          <Text style={styles.empty}>You control what your coach can view.</Text>
          <View style={styles.modeRow}>
            {(['training_only', 'all_data'] as CoachAccessMode[]).map((mode) => {
              const active = coachAccessMode === mode;
              return (
                <Pressable
                  key={mode}
                  style={[styles.modeChip, active && styles.modeChipOn]}
                  disabled={busy}
                  onPress={() =>
                    void withBusy(async () => {
                      await setCoachAccessModeForTeam(teamId, mode);
                      setCoachAccessMode(mode);
                    })
                  }
                >
                  <Text style={[styles.modeText, active && styles.modeTextOn]}>
                    {mode === 'training_only' ? 'Training only' : 'All data'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.errorText}>
            Current: {coachAccessMode === 'training_only' ? 'Training only' : 'All data'}.
          </Text>
        </GlassCard>

        <SectionHeader title='MEMBERS' />
        <GlassCard>
          {members.length ? (
            members.map((row: any) => (
              <View key={row.id || row.user_id} style={styles.rowLine}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{row?.profiles?.display_name || row?.profiles?.username || 'Athlete'}</Text>
                  <Text style={styles.rowSub}>
                    {String(row.role || 'member')} · XP {Number(row.xp_contributed || 0).toLocaleString()}
                  </Text>
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.empty}>No members found.</Text>
          )}
          <Pressable
            style={styles.leaveBtn}
            disabled={busy}
            onPress={() =>
              Alert.alert('Leave team?', 'You can re-join later with the invite code.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Leave', style: 'destructive', onPress: () => void leaveTeamAndExit() },
              ])
            }
          >
            <Text style={styles.leaveText}>Leave team</Text>
          </Pressable>
        </GlassCard>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  content: { padding: 16, paddingBottom: 32 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { minHeight: 44, minWidth: 60, justifyContent: 'center' },
  backText: { color: '#8FDBFF', fontWeight: '800' },
  title: { color: '#FFFFFF', fontWeight: '900', fontSize: 20 },
  centerCta: {
    marginTop: 10,
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0,217,255,0.30)',
    backgroundColor: 'rgba(0,217,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  centerCtaText: { color: '#BFF3FF', fontWeight: '900' },
  subtitle: { color: '#9DA8AD', marginTop: 10, fontWeight: '700', marginBottom: 10 },

  primaryWide: { minHeight: 44, borderRadius: 12, backgroundColor: '#00D9FF', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  primaryWideDisabled: { backgroundColor: '#1D2B2F' },
  primaryWideText: { color: '#01212A', fontWeight: '900' },
  primaryWideTextDisabled: { color: '#88A0A8' },
  ghostWide: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  ghostWideText: { color: '#D5D5D5', fontWeight: '900' },
  feedHintBox: {
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    backgroundColor: '#111111',
    padding: 10,
    gap: 8,
  },
  feedHintText: { color: '#9DA8AD', fontWeight: '700' },
  feedHintBtn: {
    minHeight: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0,217,255,0.30)',
    backgroundColor: 'rgba(0,217,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  feedHintBtnText: { color: '#BFF3FF', fontWeight: '900' },

  rowLine: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1B1B1B' },
  rowTitle: { color: '#FFFFFF', fontWeight: '900' },
  rowSub: { color: '#8FA6AE', marginTop: 4, fontWeight: '700', fontSize: 12 },
  empty: { color: '#9DA8AD', fontWeight: '700' },
  errorText: { color: '#9DA8AD', marginTop: 8, fontWeight: '700' },
  retryBtn: {
    marginTop: 10,
    minHeight: 40,
    minWidth: 96,
    alignSelf: 'flex-start',
    borderRadius: 10,
    backgroundColor: '#00D9FF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  retryText: { color: '#01212A', fontWeight: '900' },
  modeRow: { flexDirection: 'row', gap: 10, marginTop: 10, flexWrap: 'wrap' },
  modeChip: { minHeight: 40, paddingHorizontal: 12, borderRadius: 999, backgroundColor: '#111111', borderWidth: 1, borderColor: '#2A2A2A', alignItems: 'center', justifyContent: 'center' },
  modeChipOn: { backgroundColor: 'rgba(0,217,255,0.18)', borderColor: 'rgba(0,217,255,0.30)' },
  modeText: { color: '#D5D5D5', fontWeight: '900' },
  modeTextOn: { color: '#BFF3FF' },

  inviteCode: { color: '#FFFFFF', fontWeight: '900', fontSize: 26, letterSpacing: 2, textAlign: 'center', paddingVertical: 6 },

  leaveBtn: {
    marginTop: 12,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#4A2F2F',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,68,102,0.10)',
  },
  leaveText: { color: '#FFB1B1', fontWeight: '900' },
});
