import { useFocusEffect } from '@react-navigation/native';
import { Redirect, router } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../components/ui/GlassCard';
import SectionHeader from '../../components/ui/SectionHeader';
import { APP_CONFIG } from '../../utils/appConfig';
import { getCommunityView } from '../../utils/friendsService';
import { isSupabaseConfigured, socialApi } from '../../utils/supabaseClient';
import { useAuth } from '../context/authcontext';

type DmRow = any;

export default function MessagesScreen() {
  const socialEnabled = APP_CONFIG.FEATURES.SOCIAL_FEATURES_ENABLED || APP_CONFIG.RUNTIME.OVERRIDES.SOCIAL_FEATURES_ENABLED;
  const { supabaseUserId } = useAuth();
  const viewerUserId = supabaseUserId || null;

  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [friends, setFriends] = useState<Awaited<ReturnType<typeof getCommunityView>>['friends']>([]);
  const [dms, setDms] = useState<DmRow[]>([]);

  const load = useCallback(async () => {
    if (!viewerUserId || !isSupabaseConfigured) return;
    setLoading(true);
    try {
      const [community, myDmGroups] = await Promise.all([getCommunityView(viewerUserId), socialApi.getMyDmGroups(viewerUserId)]);
      setFriends(community.friends);
      setDms(Array.isArray(myDmGroups) ? myDmGroups : []);
      setLoadError(null);
    } catch (err: any) {
      setLoadError(String(err?.message || 'Unable to load DMs.'));
      setFriends([]);
      setDms([]);
    } finally {
      setLoading(false);
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

  const startDm = async (friendUserId: string) => {
    if (!friendUserId) {
      Alert.alert('Unavailable', 'This friend record is missing an ID.');
      return;
    }
    if (!viewerUserId) return;
    await withBusy(async () => {
      const group = await socialApi.ensureDmGroup(viewerUserId, friendUserId);
      router.push(`/messages/${group.id}` as any);
    });
  };

  const openExistingDm = async (groupId: string) => {
    if (!groupId) {
      Alert.alert('Unavailable', 'This DM thread is missing an ID.');
      return;
    }
    router.push(`/messages/${groupId}` as any);
  };

  if (!socialEnabled) return <Redirect href='/(tabs)/profile' />;

  if (!viewerUserId) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.empty}>Sign in to use DMs.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!isSupabaseConfigured) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.empty}>Cloud sync is required to use messages.</Text>
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
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.back}>Back</Text>
          </Pressable>
          <Text style={styles.title}>DMs</Text>
          <View style={{ width: 60 }} />
        </View>

        {loadError ? (
          <GlassCard>
            <Text style={styles.empty}>Failed to load messages.</Text>
            <Text style={styles.errorText}>{loadError}</Text>
            <Pressable style={styles.retryBtn} onPress={() => void load()} disabled={loading}>
              <Text style={styles.retryText}>{loading ? 'Retrying…' : 'Retry'}</Text>
            </Pressable>
          </GlassCard>
        ) : null}

        <SectionHeader title='INBOX' />
        <GlassCard>
          {loading && !dms.length ? <Text style={styles.empty}>Loading…</Text> : null}
          {dms.length ? (
            dms.slice(0, 30).map((row: any, index: number) => {
              const groupId = String(row.group_id || row?.groups?.id || '');
              const rowDisabled = busy;
              return (
                <Pressable
                  key={`${groupId || `dm-${index}`}`}
                  style={[styles.row, rowDisabled && styles.rowDisabled]}
                  onPress={() => {
                    if (groupId) {
                      void openExistingDm(groupId);
                      return;
                    }
                    Alert.alert('Corrupt entry', 'This DM thread is missing required data.', [
                      { text: 'Refresh', onPress: () => void load() },
                      {
                        text: 'Remove',
                        style: 'destructive',
                        onPress: () => setDms((prev) => prev.filter((_, i) => i !== index)),
                      },
                      { text: 'Cancel', style: 'cancel' },
                    ]);
                  }}
                  onLongPress={() => {
                    if (groupId) return;
                    Alert.alert('Remove entry?', 'Remove this invalid DM row from the list?', [
                      {
                        text: 'Remove',
                        style: 'destructive',
                        onPress: () => setDms((prev) => prev.filter((_, i) => i !== index)),
                      },
                      { text: 'Cancel', style: 'cancel' },
                    ]);
                  }}
                  disabled={rowDisabled}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>Direct Message</Text>
                    <Text style={styles.meta}>{String(row?.groups?.join_code || '')}</Text>
                  </View>
                  <Text style={[styles.openText, rowDisabled && styles.openTextDisabled]}>{groupId ? 'Open' : 'Unavailable'}</Text>
                </Pressable>
              );
            })
          ) : !loading ? (
            <Text style={styles.empty}>No DMs yet. Start one below.</Text>
          ) : null}
        </GlassCard>

        <SectionHeader title='START A DM' />
        <GlassCard>
          {loading && !friends.length ? <Text style={styles.empty}>Loading…</Text> : null}
          {friends.length ? (
            friends.slice(0, 30).map((friend) => (
              <View key={friend.profile.userId} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{friend.profile.displayName}</Text>
                  <Text style={styles.meta}>{friend.profile.handle}</Text>
                </View>
                <Pressable style={styles.openBtn} onPress={() => void startDm(friend.profile.userId)} disabled={busy}>
                  <Text style={styles.openBtnText}>{busy ? '…' : 'DM'}</Text>
                </Pressable>
              </View>
            ))
          ) : !loading ? (
            <Text style={styles.empty}>Add friends to start DMs.</Text>
          ) : null}
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
  back: { color: '#7EDCFF', fontWeight: '700' },
  title: { color: '#FFF', fontWeight: '900', fontSize: 22 },
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1B1B1B' },
  rowDisabled: { opacity: 0.6 },
  name: { color: '#FFFFFF', fontWeight: '900' },
  meta: { color: '#8FA6AE', marginTop: 4, fontWeight: '700', fontSize: 12 },
  empty: { color: '#9DA8AD', fontWeight: '700' },
  errorText: { color: '#9DA8AD', marginTop: 6, fontWeight: '700' },
  retryBtn: {
    marginTop: 10,
    minHeight: 40,
    minWidth: 110,
    borderRadius: 10,
    backgroundColor: '#00D9FF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  retryText: { color: '#01212A', fontWeight: '900' },
  openText: { color: '#8FDBFF', fontWeight: '900' },
  openTextDisabled: { color: '#6B7E84' },
  openBtn: { minHeight: 40, borderRadius: 10, backgroundColor: '#00D9FF', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  openBtnText: { color: '#01212A', fontWeight: '900' },
});
