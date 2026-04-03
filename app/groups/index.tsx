import { useFocusEffect } from '@react-navigation/native'; import { Redirect, router } from 'expo-router'; import React, { useCallback, useMemo, useState } from 'react'; import { Alert, Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../components/ui/GlassCard';
import SectionHeader from '../../components/ui/SectionHeader';
import { APP_CONFIG } from '../../utils/appConfig';
import { isSupabaseConfigured, socialApi } from '../../utils/supabaseClient';
import { useAuth } from '../context/authcontext';

function randomJoinCode(prefix: string) {
  const token = Math.random().toString(36).slice(2, 10);
  return `${prefix}:${token}`;
}

export default function GroupsHubScreen() {
  const socialEnabled = APP_CONFIG.FEATURES.SOCIAL_FEATURES_ENABLED || APP_CONFIG.RUNTIME.OVERRIDES.SOCIAL_FEATURES_ENABLED;
  const { supabaseUserId } = useAuth();
  const viewerUserId = supabaseUserId || null;

  const [busy, setBusy] = useState(false);
  const [myGroups, setMyGroups] = useState<any[]>([]);
  const [publicGroups, setPublicGroups] = useState<any[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');
  const [newGroupVisibility, setNewGroupVisibility] = useState<'public' | 'invite_only'>('public');

  const [joinCode, setJoinCode] = useState('');
  const [bootstrapPanel, setBootstrapPanel] = useState<{
    visible: boolean;
    groupId: string | null;
    groupName: string;
    state: 'posting' | 'failed' | 'fallback' | 'done';
    message: string;
  }>({
    visible: false,
    groupId: null,
    groupName: '',
    state: 'done',
    message: '',
  });

  const myGroupIds = useMemo(() => new Set(myGroups.map((row) => String(row.group_id || row?.groups?.id || '')).filter(Boolean)), [myGroups]);

  const cleanMine = (rows: any[]) =>
    (Array.isArray(rows) ? rows : []).filter((row) => {
      const group = row?.groups || null;
      const code = String(group?.join_code || '');
      const kind = String(group?.kind || '');
      if (code.startsWith('dm:')) return false;
      if (code.startsWith('team:')) return false;
      if (kind && kind !== 'friend_group') return false;
      return true;
    });

  const cleanPublic = (rows: any[]) =>
    (Array.isArray(rows) ? rows : []).filter((row) => {
      const group = row || null;
      const code = String(group?.join_code || '');
      const kind = String(group?.kind || '');
      if (code.startsWith('dm:')) return false;
      if (code.startsWith('team:')) return false;
      if (kind && kind !== 'friend_group') return false;
      return true;
    });

  const load = useCallback(async () => {
    if (!viewerUserId || !isSupabaseConfigured) return;
    try {
      setLoadError(null);
      const [mine, publics] = await Promise.all([socialApi.getMyGroups(viewerUserId), socialApi.getGroups()]);
      setMyGroups(cleanMine(mine as any));
      setPublicGroups(cleanPublic(publics as any));
    } catch (err: any) {
      setLoadError(String(err?.message || 'Unable to load groups.'));
      setMyGroups([]);
      setPublicGroups([]);
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
      Alert.alert('Action failed', String(err?.message || 'Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const openGroup = (groupId: string) => {
    if (!groupId) {
      Alert.alert('Unavailable', 'This group entry is missing an ID.');
      return;
    }
    router.push(`/groups/${groupId}` as any);
  };

  const openCreate = () => {
    setNewGroupName('');
    setNewGroupDesc('');
    setNewGroupVisibility('public');
    setCreateOpen(true);
  };

  const create = async () => {
    if (!viewerUserId) return;
    const name = newGroupName.trim();
    if (!name) return;
    const desc = newGroupDesc.trim() || undefined;
    const isPublic = newGroupVisibility === 'public';
    const code = isPublic ? null : randomJoinCode('group');
    if (busy) return;
    setBusy(true);
    try {
      const created = await socialApi.createGroup(viewerUserId, name, desc, { isPublic, joinCode: code });
      const groupId = String((created as any)?.id || '');
      setCreateOpen(false);
      setBootstrapPanel({
        visible: true,
        groupId: groupId || null,
        groupName: name,
        state: 'posting',
        message: 'Creating initial group message…',
      });

      try {
        await socialApi.bootstrapGroupThread({ creatorUserId: viewerUserId, groupId, groupName: name });
        setBootstrapPanel({
          visible: true,
          groupId,
          groupName: name,
          state: 'done',
          message: 'Group initialized.',
        });
      } catch (err: any) {
        setBootstrapPanel({
          visible: true,
          groupId,
          groupName: name,
          state: 'failed',
          message: String(err?.message || 'Group created, but initial system message failed.'),
        });
      }
      await load();
    } catch (err: any) {
      Alert.alert('Action failed', String(err?.message || 'Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const retryBootstrap = async () => {
    if (!viewerUserId) return;
    if (!bootstrapPanel.groupId) return;
    setBootstrapPanel((prev) => ({ ...prev, state: 'posting', message: 'Retrying initial message…' }));
    try {
      await socialApi.bootstrapGroupThread({
        creatorUserId: viewerUserId,
        groupId: bootstrapPanel.groupId,
        groupName: bootstrapPanel.groupName || 'Group',
      });
      setBootstrapPanel((prev) => ({ ...prev, state: 'done', message: 'Group initialized.' }));
      await load();
    } catch (err: any) {
      setBootstrapPanel((prev) => ({
        ...prev,
        state: 'fallback',
        message: String(err?.message || 'Still unable to post initial message. Group remains usable.'),
      }));
    }
  };

  const joinByCode = async () => {
    if (!viewerUserId) return;
    const code = joinCode.trim();
    if (!code) return;
    await withBusy(async () => {
      const group = await socialApi.getGroupByJoinCode(code);
      if (!group?.id) {
        Alert.alert('Not found', 'That invite code did not match a group.');
        return;
      }
      await socialApi.joinGroup(viewerUserId, String(group.id));
      setJoinCode('');
      openGroup(String(group.id));
    });
  };

  if (!socialEnabled) return <Redirect href='/(tabs)/profile' />;
  if (!viewerUserId) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.empty}>Sign in to use groups.</Text>
        </View>
      </SafeAreaView>
    );
  }
  if (!isSupabaseConfigured) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.empty}>Cloud sync is required to use groups.</Text>
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
          <Text style={styles.title}>Groups</Text>
          <Pressable onPress={openCreate} style={styles.createBtn} disabled={busy}>
            <Text style={styles.createText}>+ Create</Text>
          </Pressable>
        </View>

        {loadError ? (
          <GlassCard>
            <Text style={styles.empty}>Groups backend error.</Text>
            <Text style={styles.errorText}>{loadError}</Text>
            <Pressable style={styles.retryBtn} onPress={() => void load()} disabled={busy}>
              <Text style={styles.retryText}>{busy ? 'Retrying…' : 'Retry'}</Text>
            </Pressable>
          </GlassCard>
        ) : null}

        <SectionHeader title='JOIN WITH CODE' />
        <GlassCard>
          <TextInput
            value={joinCode}
            onChangeText={setJoinCode}
            placeholder='group:abcdef12'
            placeholderTextColor='#7E8E93'
            style={styles.input}
            autoCapitalize='none'
            autoCorrect={false}
          />
          <Pressable style={[styles.primaryWide, (!joinCode.trim() || busy) && styles.primaryWideDisabled]} onPress={() => void joinByCode()} disabled={busy || !joinCode.trim()}>
            <Text style={styles.primaryWideText}>Join group</Text>
          </Pressable>
        </GlassCard>

        <SectionHeader title='YOUR GROUPS' />
        <GlassCard>
          {myGroups.length ? (
            myGroups.map((row: any, index: number) => {
              const group = row?.groups || null;
              const groupId = String(row.group_id || group?.id || '');
              const rowDisabled = busy;
              return (
                <Pressable
                  key={`${groupId || `mine-${index}`}`}
                  style={[styles.row, rowDisabled && styles.rowDisabled]}
                  onPress={() => {
                    if (groupId) {
                      openGroup(groupId);
                      return;
                    }
                    Alert.alert('Corrupt entry', 'This group row is missing required data.', [
                      { text: 'Refresh', onPress: () => void load() },
                      {
                        text: 'Remove',
                        style: 'destructive',
                        onPress: () => setMyGroups((prev) => prev.filter((_, i) => i !== index)),
                      },
                      { text: 'Cancel', style: 'cancel' },
                    ]);
                  }}
                  onLongPress={() => {
                    if (groupId) return;
                    Alert.alert('Remove entry?', 'Remove this invalid group row from the list?', [
                      {
                        text: 'Remove',
                        style: 'destructive',
                        onPress: () => setMyGroups((prev) => prev.filter((_, i) => i !== index)),
                      },
                      { text: 'Cancel', style: 'cancel' },
                    ]);
                  }}
                  disabled={rowDisabled}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{String(group?.name || 'Group')}</Text>
                    <Text style={styles.rowSub}>{String(group?.description || '')}</Text>
                  </View>
                  <Text style={[styles.openText, rowDisabled && styles.openTextDisabled]}>{groupId ? 'Open' : 'Unavailable'}</Text>
                </Pressable>
              );
            })
          ) : (
            <Text style={styles.empty}>No groups yet.</Text>
          )}
        </GlassCard>

        <SectionHeader title='DISCOVER' />
        <GlassCard>
          {publicGroups.length ? (
            publicGroups.slice(0, 30).map((group: any, index: number) => {
              const groupId = String(group?.id || '');
              const already = myGroupIds.has(groupId);
              const joinDisabled = busy;
              return (
                <View key={`${groupId || `public-${index}`}`} style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{String(group?.name || 'Group')}</Text>
                    <Text style={styles.rowSub}>{String(group?.description || '')}</Text>
                  </View>
                  {already ? (
                    <Text style={styles.metaPill}>Joined</Text>
                  ) : (
                    <Pressable
                      style={[styles.joinBtn, joinDisabled && styles.joinBtnDisabled]}
                      disabled={joinDisabled}
                      onPress={() =>
                        void withBusy(async () => {
                          if (!groupId) {
                            Alert.alert('Corrupt entry', 'This public group row is missing required data.', [
                              { text: 'Refresh', onPress: () => void load() },
                              { text: 'OK', style: 'cancel' },
                            ]);
                            return;
                          }
                          await socialApi.joinGroup(viewerUserId, groupId);
                        })
                      }
                    >
                      <Text style={[styles.joinText, joinDisabled && styles.joinTextDisabled]}>{groupId ? 'Join' : 'Repair'}</Text>
                    </Pressable>
                  )}
                </View>
              );
            })
          ) : (
            <Text style={styles.empty}>No public groups yet.</Text>
          )}
        </GlassCard>
      </ScrollView>

      <Modal visible={createOpen} animationType='slide' transparent onRequestClose={() => setCreateOpen(false)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={Keyboard.dismiss} accessible={false} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Create group</Text>
            <TextInput
              value={newGroupName}
              onChangeText={setNewGroupName}
              placeholder='Group name'
              placeholderTextColor='#7E8E93'
              style={styles.input}
            />
            <TextInput
              value={newGroupDesc}
              onChangeText={setNewGroupDesc}
              placeholder='Description (optional)'
              placeholderTextColor='#7E8E93'
              style={[styles.input, { marginTop: 10 }]}
            />
            <View style={styles.visibilityRow}>
              {(['public', 'invite_only'] as const).map((mode) => {
                const active = newGroupVisibility === mode;
                return (
                  <Pressable key={mode} style={[styles.visibilityChip, active && styles.visibilityChipOn]} onPress={() => setNewGroupVisibility(mode)} disabled={busy}>
                    <Text style={[styles.visibilityText, active && styles.visibilityTextOn]}>{mode === 'public' ? 'Public' : 'Invite-only'}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.modalActions}>
              <Pressable style={styles.ghostBtn} onPress={() => setCreateOpen(false)} disabled={busy}>
                <Text style={styles.ghostText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.primaryBtn, !newGroupName.trim() && styles.primaryBtnDisabled]} onPress={() => void create()} disabled={busy || !newGroupName.trim()}>
                <Text style={styles.primaryText}>{busy ? '…' : 'Create'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={bootstrapPanel.visible}
        animationType='fade'
        transparent
        onRequestClose={() => {
          setBootstrapPanel((prev) => ({ ...prev, visible: false }));
        }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Group Initialization</Text>
            <Text style={styles.modalBody}>{bootstrapPanel.message}</Text>
            {bootstrapPanel.state === 'posting' ? (
              <Text style={styles.modalHint}>Please wait…</Text>
            ) : null}
            {(bootstrapPanel.state === 'failed' || bootstrapPanel.state === 'fallback') ? (
              <Text style={styles.modalHint}>You can continue to the group now and retry bootstrap later.</Text>
            ) : null}
            <View style={styles.modalActions}>
              {(bootstrapPanel.state === 'failed' || bootstrapPanel.state === 'fallback') && (
                <Pressable style={styles.ghostBtn} onPress={() => void retryBootstrap()} disabled={busy}>
                  <Text style={styles.ghostText}>Retry</Text>
                </Pressable>
              )}
              <Pressable
                style={styles.primaryBtn}
                onPress={() => {
                  const groupId = bootstrapPanel.groupId;
                  setBootstrapPanel((prev) => ({ ...prev, visible: false }));
                  if (groupId) openGroup(groupId);
                }}
                disabled={!bootstrapPanel.groupId}
              >
                <Text style={styles.primaryText}>
                  {bootstrapPanel.state === 'failed' || bootstrapPanel.state === 'fallback'
                    ? 'Continue without system message'
                    : 'Continue'}
                </Text>
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
  backBtn: { minHeight: 44, minWidth: 60, justifyContent: 'center' },
  backText: { color: '#8FDBFF', fontWeight: '800' },
  title: { color: '#FFFFFF', fontWeight: '900', fontSize: 22 },
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
  createBtn: {
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(0,217,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(0,217,255,0.30)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  createText: { color: '#BFF3FF', fontWeight: '900' },

  input: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1B1B1B',
    backgroundColor: '#0F0F0F',
    paddingHorizontal: 12,
    color: '#FFFFFF',
    fontWeight: '800',
  },
  primaryWide: { minHeight: 44, borderRadius: 12, backgroundColor: '#00D9FF', alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  primaryWideDisabled: { opacity: 0.4 },
  primaryWideText: { color: '#01212A', fontWeight: '900' },

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

  joinBtn: { minHeight: 36, paddingHorizontal: 12, borderRadius: 999, backgroundColor: 'rgba(0,217,255,0.18)', borderWidth: 1, borderColor: 'rgba(0,217,255,0.30)', alignItems: 'center', justifyContent: 'center' },
  joinBtnDisabled: { backgroundColor: '#1D2B2F', borderColor: '#2B3A3F' },
  joinText: { color: '#BFF3FF', fontWeight: '900' },
  joinTextDisabled: { color: '#88A0A8' },
  metaPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: '#111111', borderWidth: 1, borderColor: '#2A2A2A', color: '#D5D5D5', fontWeight: '900' },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', padding: 16 },
  modalCard: { borderRadius: 16, backgroundColor: '#0E0E0E', borderWidth: 1, borderColor: '#1B1B1B', padding: 16 },
  modalTitle: { color: '#FFFFFF', fontWeight: '900', fontSize: 18, marginBottom: 10 },
  modalBody: { color: '#D2E2E8', fontWeight: '700' },
  modalHint: { color: '#9FB4BC', fontWeight: '700', marginTop: 8, fontSize: 12 },
  modalActions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end', marginTop: 12 },
  ghostBtn: { minHeight: 44, paddingHorizontal: 14, borderRadius: 12, backgroundColor: '#111111', borderWidth: 1, borderColor: '#2A2A2A', alignItems: 'center', justifyContent: 'center' },
  ghostText: { color: '#D5D5D5', fontWeight: '900' },
  primaryBtn: { minHeight: 44, paddingHorizontal: 14, borderRadius: 12, backgroundColor: '#00D9FF', alignItems: 'center', justifyContent: 'center' },
  primaryBtnDisabled: { opacity: 0.4 },
  primaryText: { color: '#01212A', fontWeight: '900' },

  visibilityRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  visibilityChip: { flex: 1, minHeight: 40, borderRadius: 999, backgroundColor: '#111111', borderWidth: 1, borderColor: '#2A2A2A', alignItems: 'center', justifyContent: 'center' },
  visibilityChipOn: { backgroundColor: 'rgba(0,217,255,0.18)', borderColor: 'rgba(0,217,255,0.30)' },
  visibilityText: { color: '#D5D5D5', fontWeight: '900' },
  visibilityTextOn: { color: '#BFF3FF' },
});
