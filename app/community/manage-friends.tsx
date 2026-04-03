import { useFocusEffect } from '@react-navigation/native';
import { Redirect, router } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../components/ui/GlassCard';
import SectionHeader from '../../components/ui/SectionHeader';
import { APP_CONFIG } from '../../utils/appConfig';
import { useAuth } from '../context/authcontext';
import {
  acceptFriendRequest,
  addFriend,
  blockUser,
  cancelOutgoingRequest,
  declineFriendRequest,
  getCommunityView,
  removeFriend,
  setMuteUser,
  unblockUser,
  type CommunityView,
} from '../../utils/friendsService';

export default function ManageFriendsScreen() {
  const socialEnabled = APP_CONFIG.FEATURES.SOCIAL_FEATURES_ENABLED || APP_CONFIG.RUNTIME.OVERRIDES.SOCIAL_FEATURES_ENABLED;
  const { supabaseUserId } = useAuth();
  const viewerUserId = supabaseUserId || null;
  const [view, setView] = useState<CommunityView | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!viewerUserId) return;
    setLoading(true);
    try {
      const next = await getCommunityView(viewerUserId);
      setView(next);
      setLoadError(null);
    } catch (err: any) {
      setLoadError(String(err?.message || 'Unable to load friends right now.'));
      setView(null);
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

  if (!socialEnabled) {
    return <Redirect href='/(tabs)/profile' />;
  }

  if (!viewerUserId) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.empty}>Sign in to use friends.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!view) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.empty}>{loading ? 'Loading…' : 'Unable to load friends.'}</Text>
          {loadError ? <Text style={styles.errorText}>{loadError}</Text> : null}
          <Pressable style={styles.retryBtn} onPress={() => void load()} disabled={loading}>
            <Text style={styles.retryText}>{loading ? 'Retrying…' : 'Retry'}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.back}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Manage Friends</Text>
          <View style={{ width: 40 }} />
        </View>

        {loadError ? (
          <GlassCard>
            <Text style={styles.empty}>Could not refresh the latest friend data.</Text>
            <Text style={styles.errorText}>{loadError}</Text>
            <Pressable style={styles.retryBtn} onPress={() => void load()} disabled={loading}>
              <Text style={styles.retryText}>{loading ? 'Retrying…' : 'Retry'}</Text>
            </Pressable>
          </GlassCard>
        ) : null}

        <SectionHeader title='INCOMING REQUESTS' />
        <GlassCard>
          {view.incoming.length ? (
            view.incoming.map((row) => (
              <View key={row.relationship.relationshipId} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{row.profile.displayName}</Text>
                  <Text style={styles.handle}>{row.profile.handle}</Text>
                </View>
                <Pressable
                  style={[styles.acceptBtn, busy && styles.actionDisabled]}
                  disabled={busy}
                  onPress={() =>
                    void withBusy(async () => {
                      await acceptFriendRequest(viewerUserId, row.relationship.relationshipId);
                    })
                  }
                >
                  <Text style={[styles.acceptText, busy && styles.actionTextDisabled]}>Accept</Text>
                </Pressable>
                <Pressable
                  style={[styles.ghostBtn, busy && styles.actionDisabled]}
                  disabled={busy}
                  onPress={() =>
                    void withBusy(async () => {
                      await declineFriendRequest(viewerUserId, row.relationship.relationshipId);
                    })
                  }
                >
                  <Text style={[styles.ghostText, busy && styles.actionTextDisabled]}>Decline</Text>
                </Pressable>
              </View>
            ))
          ) : (
            <Text style={styles.empty}>No pending requests.</Text>
          )}
        </GlassCard>

        <SectionHeader title='OUTGOING REQUESTS' />
        <GlassCard>
          {view.outgoing.length ? (
            view.outgoing.map((row) => (
              <View key={row.relationship.relationshipId} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{row.profile.displayName}</Text>
                  <Text style={styles.handle}>{row.profile.handle}</Text>
                </View>
                <Pressable
                  style={[styles.ghostBtn, busy && styles.actionDisabled]}
                  disabled={busy}
                  onPress={() =>
                    void withBusy(async () => {
                      await cancelOutgoingRequest(viewerUserId, row.relationship.relationshipId);
                    })
                  }
                >
                  <Text style={[styles.ghostText, busy && styles.actionTextDisabled]}>Cancel</Text>
                </Pressable>
              </View>
            ))
          ) : (
            <Text style={styles.empty}>No outgoing requests.</Text>
          )}
        </GlassCard>

        <SectionHeader title='FRIENDS' />
        <GlassCard>
          {view.friends.length ? (
            view.friends.map((friend) => (
              <View key={friend.profile.userId} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{friend.profile.displayName}</Text>
                  <Text style={styles.handle}>{friend.profile.handle}</Text>
                  {friend.muted ? <Text style={styles.meta}>Muted</Text> : null}
                </View>
                <Pressable
                  style={[styles.ghostBtn, busy && styles.actionDisabled]}
                  disabled={busy}
                  onPress={() =>
                    void withBusy(async () => {
                      await setMuteUser(viewerUserId, friend.profile.userId, !friend.muted);
                    })
                  }
                >
                  <Text style={[styles.ghostText, busy && styles.actionTextDisabled]}>{friend.muted ? 'Unmute' : 'Mute'}</Text>
                </Pressable>
                <Pressable
                  style={[styles.removeBtn, busy && styles.actionDisabled]}
                  disabled={busy}
                  onPress={() =>
                    void withBusy(async () => {
                      await removeFriend(viewerUserId, friend.profile.userId);
                    })
                  }
                >
                  <Text style={[styles.removeText, busy && styles.actionTextDisabled]}>Remove</Text>
                </Pressable>
                <Pressable
                  style={[styles.removeBtn, busy && styles.actionDisabled]}
                  disabled={busy}
                  onPress={() =>
                    void withBusy(async () => {
                      await blockUser(viewerUserId, friend.profile.userId);
                    })
                  }
                >
                  <Text style={[styles.removeText, busy && styles.actionTextDisabled]}>Block</Text>
                </Pressable>
              </View>
            ))
          ) : (
            <Text style={styles.empty}>No friends yet.</Text>
          )}
        </GlassCard>

        <SectionHeader title='SUGGESTED ATHLETES' />
        <GlassCard>
          {view.suggestions.length ? (
            view.suggestions.map((suggestion) => (
              <View key={suggestion.profile.userId} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{suggestion.profile.displayName}</Text>
                  <Text style={styles.handle}>{suggestion.profile.handle}</Text>
                  <Text style={styles.meta}>{suggestion.reason}</Text>
                </View>
                <Pressable
                  style={[styles.acceptBtn, (!suggestion.canAdd || busy) && styles.disabledBtn, busy && styles.actionDisabled]}
                  disabled={!suggestion.canAdd || busy}
                  onPress={() =>
                    void withBusy(async () => {
                      const result = await addFriend(viewerUserId, suggestion.profile.userId);
                      if (!result.ok) Alert.alert('Cannot add friend', result.reason);
                    })
                  }
                >
                  <Text style={[styles.acceptText, (!suggestion.canAdd || busy) && styles.disabledText, busy && styles.actionTextDisabled]}>Add</Text>
                </Pressable>
              </View>
            ))
          ) : (
            <Text style={styles.empty}>No suggestions yet.</Text>
          )}
        </GlassCard>

        <SectionHeader title='BLOCKED' />
        <GlassCard>
          {view.blocked.length ? (
            view.blocked.map((row) => (
              <View key={row.relationship.relationshipId} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{row.profile.displayName}</Text>
                  <Text style={styles.handle}>{row.profile.handle}</Text>
                </View>
                <Pressable
                  style={[styles.ghostBtn, busy && styles.actionDisabled]}
                  disabled={busy}
                  onPress={() =>
                    void withBusy(async () => {
                      await unblockUser(viewerUserId, row.relationship.relationshipId);
                    })
                  }
                >
                  <Text style={[styles.ghostText, busy && styles.actionTextDisabled]}>Unblock</Text>
                </Pressable>
              </View>
            ))
          ) : (
            <Text style={styles.empty}>No blocked users.</Text>
          )}
        </GlassCard>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  content: { padding: 16, paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { color: '#7EDCFF', fontWeight: '700' },
  title: { color: '#FFF', fontWeight: '900', fontSize: 22 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  name: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
  handle: { color: '#8FDBFF', fontWeight: '600', marginTop: 2 },
  meta: { color: '#9DA8AD', fontSize: 12, marginTop: 2 },
  empty: { color: '#9DA8AD', fontWeight: '600' },
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
  acceptBtn: {
    minHeight: 40,
    minWidth: 72,
    borderRadius: 10,
    backgroundColor: '#00D9FF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  acceptText: { color: '#01212A', fontWeight: '900' },
  ghostBtn: {
    minHeight: 40,
    minWidth: 72,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#3A3A3A',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  ghostText: { color: '#D5D5D5', fontWeight: '700' },
  removeBtn: {
    minHeight: 40,
    minWidth: 72,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#4A2F2F',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  removeText: { color: '#FFB1B1', fontWeight: '700' },
  actionDisabled: { opacity: 0.6 },
  actionTextDisabled: { color: '#9AAAB1' },
  disabledBtn: { backgroundColor: '#202A2E' },
  disabledText: { color: '#88A0A8' },
});
