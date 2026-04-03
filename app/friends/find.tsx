import { useFocusEffect } from '@react-navigation/native';
import { Redirect, router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../components/ui/GlassCard';
import SectionHeader from '../../components/ui/SectionHeader';
import { APP_CONFIG } from '../../utils/appConfig';
import { useAuth } from '../context/authcontext';
import {
  acceptFriendRequest,
  cancelOutgoingRequest,
  declineFriendRequest,
  getSearchRecents,
  saveSearchRecent,
  searchUsersByHandle,
  sendFriendRequest,
  type FriendSearchResult,
} from '../../utils/friendsService';

export default function FindFriendsScreen() {
  const socialEnabled = APP_CONFIG.FEATURES.SOCIAL_FEATURES_ENABLED || APP_CONFIG.RUNTIME.OVERRIDES.SOCIAL_FEATURES_ENABLED;
  const { supabaseUserId } = useAuth();
  const viewerUserId = supabaseUserId || null;
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<FriendSearchResult[]>([]);
  const [recents, setRecents] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [recentsError, setRecentsError] = useState<string | null>(null);

  const normalizedQuery = useMemo(() => query.trim(), [query]);

  const loadRecents = useCallback(async () => {
    if (!viewerUserId) return;
    try {
      const next = await getSearchRecents(viewerUserId);
      setRecents(next);
      setRecentsError(null);
    } catch (err: any) {
      setRecents([]);
      setRecentsError(String(err?.message || 'Could not load recent searches.'));
    }
  }, [viewerUserId]);

  const runSearch = useCallback(
    async (q: string) => {
      if (!viewerUserId) return;
      setLoading(true);
      try {
        const next = await searchUsersByHandle({ viewerUserId, query: q, limit: 16 });
        setRows(next);
        setSearchError(null);
      } catch (err: any) {
        setRows([]);
        setSearchError(String(err?.message || 'Search failed. Please try again.'));
      } finally {
        setLoading(false);
      }
    },
    [viewerUserId]
  );

  useFocusEffect(
    useCallback(() => {
      void loadRecents();
      void runSearch(normalizedQuery);
    }, [loadRecents, runSearch, normalizedQuery])
  );

  useEffect(() => {
    const handle = setTimeout(() => {
      void runSearch(normalizedQuery);
    }, 220);
    return () => clearTimeout(handle);
  }, [normalizedQuery, runSearch]);

  const doAction = async (row: FriendSearchResult) => {
    if (!viewerUserId) return;
    try {
      if (row.actionLabel === 'Add') {
        const res = await sendFriendRequest(viewerUserId, row.profile.userId);
        if (!res.ok) {
          Alert.alert('Could not send request', res.reason);
          return;
        }
        await saveSearchRecent(viewerUserId, row.profile.handle);
      } else if (row.actionLabel === 'Accept') {
        if (!row.relationshipId) {
          Alert.alert('Unavailable', 'This friend request is missing a relationship reference.');
          return;
        }
        await acceptFriendRequest(viewerUserId, row.relationshipId);
      } else if (row.actionLabel === 'Requested') {
        if (!row.relationshipId) {
          Alert.alert('Unavailable', 'This outgoing request is missing a relationship reference.');
          return;
        }
        await cancelOutgoingRequest(viewerUserId, row.relationshipId);
      }
      await loadRecents();
      await runSearch(normalizedQuery);
    } catch (err: any) {
      Alert.alert('Action failed', String(err?.message || 'Try again.'));
    }
  };

  const doDecline = async (relationshipId?: string) => {
    if (!viewerUserId) return;
    if (!relationshipId) {
      Alert.alert('Unavailable', 'This friend request is missing a relationship reference.');
      return;
    }
    try {
      await declineFriendRequest(viewerUserId, relationshipId);
      await runSearch(normalizedQuery);
    } catch (err: any) {
      Alert.alert('Decline failed', String(err?.message || 'Try again.'));
    }
  };

  const openRecent = async (handle: string) => {
    const nextQuery = handle.replace(/^@/, '');
    setQuery(nextQuery);
    await runSearch(nextQuery);
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

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps='handled'
        keyboardDismissMode='on-drag'
        onScrollBeginDrag={Keyboard.dismiss}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.back}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Find Friends</Text>
          <View style={{ width: 42 }} />
        </View>

        <GlassCard>
          <TextInput
            value={query}
            onChangeText={setQuery}
            autoCapitalize='none'
            autoCorrect={false}
            placeholder='Search by username'
            placeholderTextColor='#7E8E93'
            style={styles.input}
          />
          <Text style={styles.helper}>Search is privacy-safe and respects blocks.</Text>
        </GlassCard>

        <SectionHeader title='RECENT SEARCHES' />
        <GlassCard>
          {recentsError ? (
            <View style={styles.errorRow}>
              <Text style={styles.errorText}>{recentsError}</Text>
              <Pressable style={styles.retryBtn} onPress={() => void loadRecents()}>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : null}
          {recents.length ? (
            <View style={styles.recentWrap}>
              {recents.map((item) => (
                <Pressable key={item} style={styles.recentChip} onPress={() => void openRecent(item)}>
                  <Text style={styles.recentChipText}>{item}</Text>
                </Pressable>
              ))}
            </View>
          ) : !recentsError ? (
            <Text style={styles.empty}>No recent searches yet.</Text>
          ) : null}
        </GlassCard>

        <SectionHeader title={loading ? 'RESULTS (SEARCHING...)' : 'RESULTS'} />
        <GlassCard>
          {searchError ? (
            <View style={styles.errorRow}>
              <Text style={styles.errorText}>{searchError}</Text>
              <Pressable style={styles.retryBtn} onPress={() => void runSearch(normalizedQuery)}>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : null}
          {rows.length ? (
            rows.map((row) => (
              <View key={row.profile.userId} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{row.profile.displayName}</Text>
                  <Text style={styles.handle}>{row.profile.handle}</Text>
                  <Text style={styles.reason}>{row.reason}</Text>
                </View>
                {row.actionLabel === 'Accept' ? (
                  <View style={styles.dualActions}>
                    <Pressable style={[styles.actionBtn, !row.actionEnabled && styles.disabled]} disabled={!row.actionEnabled} onPress={() => void doAction(row)}>
                      <Text style={styles.actionText}>Accept</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.ghostBtn, (!row.actionEnabled || !row.relationshipId) && styles.ghostBtnDisabled]}
                      disabled={!row.actionEnabled || !row.relationshipId}
                      onPress={() => void doDecline(row.relationshipId || undefined)}
                    >
                      <Text style={[styles.ghostText, (!row.actionEnabled || !row.relationshipId) && styles.ghostTextDisabled]}>Decline</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable style={[styles.actionBtn, !row.actionEnabled && styles.disabled]} disabled={!row.actionEnabled} onPress={() => void doAction(row)}>
                    <Text style={[styles.actionText, !row.actionEnabled && styles.disabledText]}>{row.actionLabel}</Text>
                  </Pressable>
                )}
              </View>
            ))
          ) : !searchError ? (
            <Text style={styles.empty}>No users found.</Text>
          ) : null}
        </GlassCard>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  content: { padding: 16, paddingBottom: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { color: '#7EDCFF', fontWeight: '700' },
  title: { color: '#FFFFFF', fontWeight: '900', fontSize: 22 },
  input: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#333',
    backgroundColor: '#131313',
    color: '#E8E8E8',
    paddingHorizontal: 12,
    fontWeight: '600',
  },
  helper: { color: '#8FA6AE', fontSize: 12, marginTop: 8, fontWeight: '600' },
  errorRow: { gap: 8, marginBottom: 10 },
  errorText: { color: '#9DA8AD', fontWeight: '700' },
  retryBtn: {
    minHeight: 36,
    minWidth: 90,
    alignSelf: 'flex-start',
    borderRadius: 10,
    backgroundColor: '#00D9FF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  retryText: { color: '#01212A', fontWeight: '900' },
  recentWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  recentChip: {
    minHeight: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#3A3A3A',
    justifyContent: 'center',
    paddingHorizontal: 12,
    backgroundColor: '#141414',
  },
  recentChipText: { color: '#CFE9F2', fontWeight: '700', fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1E1E1E' },
  name: { color: '#FFF', fontWeight: '800' },
  handle: { color: '#86DFFF', marginTop: 2, fontWeight: '700' },
  reason: { color: '#95AFB8', marginTop: 2, fontSize: 12 },
  actionBtn: {
    minHeight: 40,
    minWidth: 86,
    borderRadius: 10,
    backgroundColor: '#00D9FF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  actionText: { color: '#01212A', fontWeight: '900' },
  ghostBtn: {
    minHeight: 40,
    minWidth: 80,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#3A3A3A',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  ghostText: { color: '#D4D4D4', fontWeight: '700' },
  ghostBtnDisabled: { backgroundColor: '#161D20', borderColor: '#263237' },
  ghostTextDisabled: { color: '#7F939A' },
  dualActions: { gap: 8 },
  disabled: { backgroundColor: '#1F2A2D' },
  disabledText: { color: '#8EA4AB' },
  empty: { color: '#95AFB8', fontWeight: '600' },
});
