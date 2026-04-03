import { useFocusEffect } from '@react-navigation/native';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../../components/ui/GlassCard';
import { isSupabaseConfigured, socialApi } from '../../../utils/supabaseClient';
import { useAuth } from '../../context/authcontext';

export default function UserProfileScreen() {
  const params = useLocalSearchParams<{ userId?: string }>();
  const profileUserId = String(params.userId || '').trim();
  const { supabaseUserId } = useAuth();
  const viewerUserId = supabaseUserId || '';
  const [profile, setProfile] = useState<any | null>(null);
  const [counts, setCounts] = useState({ followers: 0, following: 0, posts: 0 });
  const [isFollowing, setIsFollowing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!profileUserId || !isSupabaseConfigured) return;
    const [profileRow, followers, following, posts] = await Promise.all([
      socialApi.getProfile(profileUserId),
      socialApi.getFollowers(profileUserId),
      socialApi.getFollowing(profileUserId),
      socialApi.getUserPosts(profileUserId),
    ]);
    setProfile(profileRow);
    setCounts({
      followers: Array.isArray(followers) ? followers.length : 0,
      following: Array.isArray(following) ? following.length : 0,
      posts: Array.isArray(posts) ? posts.length : 0,
    });
    if (viewerUserId && viewerUserId !== profileUserId) {
      setIsFollowing(await socialApi.isFollowing(viewerUserId, profileUserId));
    }
  }, [profileUserId, viewerUserId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const onToggleFollow = async () => {
    if (!viewerUserId || viewerUserId === profileUserId || busy) return;
    const next = !isFollowing;
    setBusy(true);
    setIsFollowing(next);
    setCounts((prev) => ({ ...prev, followers: Math.max(0, prev.followers + (next ? 1 : -1)) }));
    try {
      if (next) await socialApi.followUser(viewerUserId, profileUserId);
      else await socialApi.unfollowUser(viewerUserId, profileUserId);
    } catch (err: any) {
      setIsFollowing(!next);
      setCounts((prev) => ({ ...prev, followers: Math.max(0, prev.followers + (next ? -1 : 1)) }));
      Alert.alert('Action failed', String(err?.message || 'Unable to update follow state.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Profile</Text>
          <View style={{ width: 60 }} />
        </View>

        <GlassCard>
          <Text style={styles.name}>{String(profile?.display_name || profile?.username || 'Athlete')}</Text>
          <Text style={styles.handle}>@{String(profile?.username || 'unknown')}</Text>
          {viewerUserId && viewerUserId !== profileUserId ? (
            <Pressable style={[styles.followBtn, isFollowing && styles.followingBtn]} onPress={() => void onToggleFollow()} disabled={busy}>
              <Text style={[styles.followText, isFollowing && styles.followingText]}>{isFollowing ? 'Following' : 'Follow'}</Text>
            </Pressable>
          ) : null}
          <View style={styles.countRow}>
            <Pressable style={styles.countBtn} onPress={() => router.push(`/profile/${profileUserId}/followers` as any)}>
              <Text style={styles.countValue}>{counts.followers}</Text>
              <Text style={styles.countLabel}>Followers</Text>
            </Pressable>
            <Pressable style={styles.countBtn} onPress={() => router.push(`/profile/${profileUserId}/following` as any)}>
              <Text style={styles.countValue}>{counts.following}</Text>
              <Text style={styles.countLabel}>Following</Text>
            </Pressable>
            <Pressable style={styles.countBtn} onPress={() => router.push(`/profile/${profileUserId}/posts` as any)}>
              <Text style={styles.countValue}>{counts.posts}</Text>
              <Text style={styles.countLabel}>Posts</Text>
            </Pressable>
          </View>
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
  name: { color: '#FFFFFF', fontWeight: '900', fontSize: 22 },
  handle: { marginTop: 6, color: '#8FA6AE', fontWeight: '700' },
  followBtn: {
    marginTop: 12,
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0,217,255,0.35)',
    backgroundColor: 'rgba(0,217,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  followingBtn: { borderColor: '#2A2A2A', backgroundColor: '#111111' },
  followText: { color: '#BFF3FF', fontWeight: '900' },
  followingText: { color: '#D5D5D5' },
  countRow: { marginTop: 16, flexDirection: 'row', gap: 10 },
  countBtn: { flex: 1, minHeight: 64, borderRadius: 12, borderWidth: 1, borderColor: '#242424', backgroundColor: '#121212', alignItems: 'center', justifyContent: 'center' },
  countValue: { color: '#EAF8FD', fontWeight: '900', fontSize: 18 },
  countLabel: { marginTop: 4, color: '#8FA6AE', fontWeight: '700', fontSize: 12 },
});
