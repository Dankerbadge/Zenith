import { useFocusEffect } from '@react-navigation/native';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../../components/ui/GlassCard';
import { isSupabaseConfigured, socialApi } from '../../../utils/supabaseClient';
import { useAuth } from '../../context/authcontext';

export default function FollowingListScreen() {
  const params = useLocalSearchParams<{ userId?: string }>();
  const profileUserId = String(params.userId || '').trim();
  const { supabaseUserId } = useAuth();
  const viewerUserId = supabaseUserId || '';
  const [rows, setRows] = useState<any[]>([]);
  const [followingMap, setFollowingMap] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    if (!profileUserId || !isSupabaseConfigured) return;
    const following = await socialApi.getFollowing(profileUserId);
    const normalized = (Array.isArray(following) ? following : []).map((row: any) => ({
      id: String(row?.profiles?.id || row?.following_id || ''),
      username: String(row?.profiles?.username || ''),
      displayName: String(row?.profiles?.display_name || row?.profiles?.username || 'Athlete'),
    }));
    setRows(normalized);
    const states = await Promise.all(
      normalized.map(async (row: any) => {
        if (!viewerUserId || !row.id || row.id === viewerUserId) return [row.id, false] as const;
        const isFollowing = await socialApi.isFollowing(viewerUserId, row.id);
        return [row.id, isFollowing] as const;
      })
    );
    const next: Record<string, boolean> = {};
    states.forEach(([id, value]) => {
      if (id) next[id] = value;
    });
    setFollowingMap(next);
  }, [profileUserId, viewerUserId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const onToggle = async (targetUserId: string) => {
    if (!viewerUserId || !targetUserId || targetUserId === viewerUserId) return;
    const next = !Boolean(followingMap[targetUserId]);
    setFollowingMap((prev) => ({ ...prev, [targetUserId]: next }));
    try {
      if (next) await socialApi.followUser(viewerUserId, targetUserId);
      else await socialApi.unfollowUser(viewerUserId, targetUserId);
    } catch (err: any) {
      setFollowingMap((prev) => ({ ...prev, [targetUserId]: !next }));
      Alert.alert('Action failed', String(err?.message || 'Unable to update follow state.'));
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Following</Text>
          <View style={{ width: 60 }} />
        </View>
        <GlassCard>
          {!rows.length ? <Text style={styles.empty}>Not following anyone yet.</Text> : null}
          {rows.map((row) => (
            <View key={row.id} style={styles.row}>
              <Pressable style={{ flex: 1 }} onPress={() => row.id && router.push(`/profile/${row.id}` as any)}>
                <Text style={styles.name}>{row.displayName}</Text>
                <Text style={styles.handle}>@{row.username || 'unknown'}</Text>
              </Pressable>
              {row.id !== viewerUserId ? (
                <Pressable style={[styles.followBtn, followingMap[row.id] && styles.followingBtn]} onPress={() => void onToggle(row.id)}>
                  <Text style={[styles.followText, followingMap[row.id] && styles.followingText]}>{followingMap[row.id] ? 'Following' : 'Follow'}</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
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
  row: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1B1B1B', flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { color: '#FFFFFF', fontWeight: '800' },
  handle: { color: '#8FA6AE', marginTop: 2, fontSize: 12, fontWeight: '700' },
  followBtn: { minHeight: 34, minWidth: 90, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(0,217,255,0.35)', backgroundColor: 'rgba(0,217,255,0.16)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  followingBtn: { borderColor: '#2A2A2A', backgroundColor: '#111111' },
  followText: { color: '#BFF3FF', fontWeight: '900', fontSize: 12 },
  followingText: { color: '#D5D5D5' },
  empty: { color: '#9DA8AD', fontWeight: '700' },
});
