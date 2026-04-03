import { useFocusEffect } from '@react-navigation/native'; import { Redirect, router } from 'expo-router'; import React, { useCallback, useMemo, useState } from 'react'; import { Alert, Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../components/ui/GlassCard';
import SectionHeader from '../../components/ui/SectionHeader';
import { APP_CONFIG } from '../../utils/appConfig';
import { isSupabaseConfigured, socialApi } from '../../utils/supabaseClient';
import { devErrorDetail, userFacingErrorMessage } from '../../utils/userFacingErrors';
import { useAuth } from '../context/authcontext';

export default function TeamsHubScreen() {
  const socialEnabled = APP_CONFIG.FEATURES.SOCIAL_FEATURES_ENABLED || APP_CONFIG.RUNTIME.OVERRIDES.SOCIAL_FEATURES_ENABLED;
  const { supabaseUserId } = useAuth();
  const viewerUserId = supabaseUserId || null;

  const [busy, setBusy] = useState(false);
  const [myTeams, setMyTeams] = useState<any[]>([]);
  const [publicTeams, setPublicTeams] = useState<any[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamDesc, setNewTeamDesc] = useState('');

  const [joinOpen, setJoinOpen] = useState(false);
  const [joinCode, setJoinCode] = useState('');

  const myTeamIds = useMemo(() => new Set(myTeams.map((row) => String(row.team_id || row?.teams?.id || '')).filter(Boolean)), [myTeams]);

  const load = useCallback(async () => {
    if (!viewerUserId || !isSupabaseConfigured) return;
    try {
      setLoadError(null);
      const [mine, publics] = await Promise.all([
        socialApi.getMyTeams(viewerUserId),
        socialApi.getTeams(),
      ]);
      setMyTeams(Array.isArray(mine) ? mine : []);
      setPublicTeams(Array.isArray(publics) ? publics : []);
    } catch (err: any) {
      const message = userFacingErrorMessage(err, 'Unable to load teams.');
      const detail = __DEV__ ? devErrorDetail(err) : '';
      setLoadError(detail ? `${message}\n${detail}` : message);
      setMyTeams([]);
      setPublicTeams([]);
    }
  }, [viewerUserId]);

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
      const message = userFacingErrorMessage(err, 'Please try again.');
      const detail = __DEV__ ? devErrorDetail(err) : '';
      Alert.alert('Action failed', detail ? `${message}\n\n${detail}` : message);
    } finally {
      setBusy(false);
    }
  };

  const openTeam = (teamId: string) => {
    if (!teamId) {
      Alert.alert('Unavailable', 'This team entry is missing an ID.');
      return;
    }
    router.push(`/teams/${teamId}` as any);
  };

  const openCreate = () => {
    setNewTeamName('');
    setNewTeamDesc('');
    setCreateOpen(true);
  };

  const openJoin = () => {
    setJoinCode('');
    setJoinOpen(true);
  };

  const create = async () => {
    if (!viewerUserId) return;
    const name = newTeamName.trim();
    if (!name) return;
    await withBusy(async () => {
      const created = await socialApi.createTeam(viewerUserId, name, 'coaching_team', newTeamDesc.trim() || undefined);
      setCreateOpen(false);
      openTeam(String((created as any).id));
    });
  };

  const join = async () => {
    if (!viewerUserId) return;
    await withBusy(async () => {
      const res = await socialApi.joinTeamByInviteCode(viewerUserId, joinCode);
      const teamId = String((res as any)?.teamId || '').trim();
      if (!teamId) throw new Error('Join succeeded but team id was missing.');
      setJoinOpen(false);
      openTeam(teamId);
    });
  };

  if (!socialEnabled) return <Redirect href='/(tabs)/profile' />;
  if (!viewerUserId) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}><Text style={styles.empty}>Sign in to use teams.</Text></View>
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

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScrollBeginDrag={Keyboard.dismiss}
      >
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Teams</Text>
          <View style={styles.headerRight}>
            <Pressable onPress={openJoin} style={[styles.headerBtn, busy && styles.createBtnDisabled]} disabled={busy}>
              <Text style={styles.createText}>Join</Text>
            </Pressable>
            <Pressable onPress={openCreate} style={[styles.createBtn, busy && styles.createBtnDisabled]} disabled={busy}>
              <Text style={styles.createText}>+ Create</Text>
            </Pressable>
          </View>
        </View>

        {loadError ? (
          <GlassCard>
            <Text style={styles.empty}>Teams backend error.</Text>
            <Text style={styles.errorText}>{loadError}</Text>
            <Pressable style={styles.retryBtn} onPress={() => void load()} disabled={busy}>
              <Text style={styles.retryText}>{busy ? 'Retrying…' : 'Retry'}</Text>
            </Pressable>
          </GlassCard>
        ) : null}

        <SectionHeader title='MY TEAMS' />
        <GlassCard>
          {myTeams.length ? (
            myTeams.map((row: any, index: number) => {
              const team = row?.teams || null;
              const teamId = String(row.team_id || team?.id || '');
              const rowDisabled = busy;
              return (
                <Pressable
                  key={`${teamId || `mine-${index}`}`}
                  style={[styles.row, rowDisabled && styles.rowDisabled]}
                  onPress={() => {
                    if (teamId) {
                      openTeam(teamId);
                      return;
                    }
                    Alert.alert('Corrupt entry', 'This team row is missing required data.', [
                      { text: 'Refresh', onPress: () => void load() },
                      {
                        text: 'Remove',
                        style: 'destructive',
                        onPress: () => setMyTeams((prev) => prev.filter((_, i) => i !== index)),
                      },
                      { text: 'Cancel', style: 'cancel' },
                    ]);
                  }}
                  onLongPress={() => {
                    if (teamId) return;
                    Alert.alert('Remove entry?', 'Remove this invalid team row from the list?', [
                      {
                        text: 'Remove',
                        style: 'destructive',
                        onPress: () => setMyTeams((prev) => prev.filter((_, i) => i !== index)),
                      },
                      { text: 'Cancel', style: 'cancel' },
                    ]);
                  }}
                  disabled={rowDisabled}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{String(team?.name || 'Team')}</Text>
                    <Text style={styles.rowSub}>{String(row.role || 'member')}</Text>
                  </View>
                  <Text style={[styles.openText, rowDisabled && styles.openTextDisabled]}>{teamId ? 'Open' : 'Unavailable'}</Text>
                </Pressable>
              );
            })
          ) : (
            <Text style={styles.empty}>No teams yet.</Text>
          )}
        </GlassCard>

        <SectionHeader title='DISCOVER' />
        <GlassCard>
          {publicTeams.length ? (
            publicTeams.slice(0, 30).map((team: any, index: number) => {
              const teamId = String(team?.id || '');
              const already = myTeamIds.has(teamId);
              const joinDisabled = busy;
              return (
                <View key={`${teamId || `public-${index}`}`} style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{String(team?.name || 'Team')}</Text>
                    <Text style={styles.rowSub}>{String(team?.description || '')}</Text>
                  </View>
                  {already ? (
                    <Text style={styles.metaPill}>Joined</Text>
                  ) : (
                    <Pressable
                      style={[styles.joinBtn, joinDisabled && styles.joinBtnDisabled]}
                      disabled={joinDisabled}
                      onPress={() =>
                        void withBusy(async () => {
                          if (!teamId) {
                            Alert.alert('Corrupt entry', 'This public team row is missing required data.', [
                              { text: 'Refresh', onPress: () => void load() },
                              { text: 'OK', style: 'cancel' },
                            ]);
                            return;
                          }
                          await socialApi.joinTeam(viewerUserId, teamId);
                        })
                      }
                    >
                      <Text style={[styles.joinText, joinDisabled && styles.joinTextDisabled]}>{teamId ? 'Join' : 'Repair'}</Text>
                    </Pressable>
                  )}
                </View>
              );
            })
          ) : (
            <Text style={styles.empty}>No public teams yet.</Text>
          )}
        </GlassCard>
      </ScrollView>

      <Modal visible={createOpen} animationType='slide' transparent onRequestClose={() => setCreateOpen(false)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={Keyboard.dismiss} accessible={false} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Create team</Text>
            <TextInput
              value={newTeamName}
              onChangeText={setNewTeamName}
              placeholder='Team name'
              placeholderTextColor='#7E8E93'
              style={styles.input}
            />
            <TextInput
              value={newTeamDesc}
              onChangeText={setNewTeamDesc}
              placeholder='Description (optional)'
              placeholderTextColor='#7E8E93'
              style={[styles.input, { marginTop: 10 }]}
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.ghostBtn} onPress={() => setCreateOpen(false)} disabled={busy}>
                <Text style={styles.ghostText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.primaryBtn, !newTeamName.trim() && styles.primaryBtnDisabled]} onPress={() => void create()} disabled={busy || !newTeamName.trim()}>
                <Text style={styles.primaryText}>{busy ? '…' : 'Create'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={joinOpen} animationType='slide' transparent onRequestClose={() => setJoinOpen(false)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={Keyboard.dismiss} accessible={false} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Join team</Text>
            <Text style={styles.modalHint}>Enter the 6-digit invite code.</Text>
            <TextInput
              value={joinCode}
              onChangeText={setJoinCode}
              placeholder='Invite code'
              placeholderTextColor='#7E8E93'
              style={styles.input}
              keyboardType="number-pad"
              maxLength={12}
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.ghostBtn} onPress={() => setJoinOpen(false)} disabled={busy}>
                <Text style={styles.ghostText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.primaryBtn, joinCode.replace(/[^0-9]/g, '').length !== 6 && styles.primaryBtnDisabled]}
                onPress={() => void join()}
                disabled={busy || joinCode.replace(/[^0-9]/g, '').length !== 6}
              >
                <Text style={styles.primaryText}>{busy ? '…' : 'Join'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  content: { padding: 16, paddingBottom: 32 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  backBtn: { minHeight: 44, minWidth: 60, justifyContent: 'center' },
  backText: { color: '#8FDBFF', fontWeight: '800' },
  title: { color: '#FFFFFF', fontWeight: '900', fontSize: 22 },
  headerBtn: {
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  createBtn: { minHeight: 40, paddingHorizontal: 12, borderRadius: 12, backgroundColor: 'rgba(0,217,255,0.18)', borderWidth: 1, borderColor: 'rgba(0,217,255,0.30)', alignItems: 'center', justifyContent: 'center' },
  createBtnDisabled: { opacity: 0.5 },
  createText: { color: '#BFF3FF', fontWeight: '900' },

  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1B1B1B' },
  rowDisabled: { opacity: 0.6 },
  rowTitle: { color: '#FFFFFF', fontWeight: '900' },
  rowSub: { color: '#8FA6AE', marginTop: 4, fontWeight: '700', fontSize: 12 },
  openText: { color: '#8FDBFF', fontWeight: '900' },
  openTextDisabled: { color: '#6B7E84' },
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

  joinBtn: { minHeight: 40, borderRadius: 10, backgroundColor: '#00D9FF', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  joinBtnDisabled: { backgroundColor: '#1D2B2F' },
  joinText: { color: '#01212A', fontWeight: '900' },
  joinTextDisabled: { color: '#88A0A8' },
  metaPill: { color: '#BFF3FF', fontWeight: '900', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(0,217,255,0.14)', borderWidth: 1, borderColor: 'rgba(0,217,255,0.24)' },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#0F0F0F', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' },
  modalTitle: { color: '#FFFFFF', fontWeight: '900', fontSize: 18, marginBottom: 12 },
  modalHint: { color: '#9DA8AD', fontWeight: '700', marginBottom: 10 },
  input: { minHeight: 44, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', backgroundColor: 'rgba(255,255,255,0.04)', color: '#FFFFFF', paddingHorizontal: 12, fontWeight: '700' },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  ghostBtn: { flex: 1, minHeight: 46, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.04)' },
  ghostText: { color: '#DADADA', fontWeight: '900' },
  primaryBtn: { flex: 1, minHeight: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#00D9FF' },
  primaryBtnDisabled: { backgroundColor: '#1D2B2F' },
  primaryText: { color: '#01212A', fontWeight: '900' },
});
