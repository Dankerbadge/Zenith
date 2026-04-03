import { useFocusEffect } from '@react-navigation/native';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { openMoreActionsMenu } from '../../../components/social/MoreActionsMenu';
import GlassCard from '../../../components/ui/GlassCard';
import { emitSocialEvent, onSocialEvent } from '../../../utils/socialEvents';
import { canModerateContent } from '../../../utils/socialModeration';
import { isSupabaseConfigured, socialApi } from '../../../utils/supabaseClient';
import { useAuth } from '../../context/authcontext';

function relativeTime(iso?: string | null) {
  const ts = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ts)) return '';
  const deltaSec = Math.max(0, (Date.now() - ts) / 1000);
  if (deltaSec < 60) return 'just now';
  const min = Math.floor(deltaSec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

export default function ProfilePostsScreen() {
  const params = useLocalSearchParams<{ userId?: string }>();
  const profileUserId = String(params.userId || '').trim();
  const { supabaseUserId, profile: cloudProfile } = useAuth();
  const viewerUserId = supabaseUserId || '';
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const canDelete = useMemo(
    () => (userId: string) => canModerateContent({ id: viewerUserId, role: (cloudProfile as any)?.role }, userId),
    [cloudProfile, viewerUserId]
  );

  const load = useCallback(async () => {
    if (!profileUserId || !isSupabaseConfigured) return;
    setLoading(true);
    try {
      const posts = await socialApi.getUserPosts(profileUserId);
      setRows(Array.isArray(posts) ? posts : []);
    } finally {
      setLoading(false);
    }
  }, [profileUserId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  useEffect(() => {
    return onSocialEvent('postDeleted', ({ postId }) => {
      setRows((prev) => prev.filter((p) => String(p?.id || '') !== postId));
    });
  }, []);

  const onDelete = (post: any) => {
    const postId = String(post?.id || '');
    if (!postId || !canDelete(String(post?.user_id || ''))) return;
    Alert.alert('Delete this post?', "This can't be undone.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const snapshot = rows;
          setRows((prev) => prev.filter((p) => String(p?.id || '') !== postId));
          try {
            await socialApi.deletePost(postId);
            emitSocialEvent('postDeleted', { postId });
          } catch (err: any) {
            setRows(snapshot);
            Alert.alert('Could not delete post.', String(err?.message || 'Please try again.'));
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor="#8FDBFF" />}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Posts</Text>
          <View style={{ width: 60 }} />
        </View>
        <GlassCard>
          {!rows.length && !loading ? <Text style={styles.empty}>No posts yet.</Text> : null}
          {rows.map((post: any) => (
            <View key={String(post?.id || Math.random())} style={styles.row}>
              <View style={styles.rowHeader}>
                <Text style={styles.rowType}>{String(post?.post_type || 'post')}</Text>
                <View style={styles.rowHeaderRight}>
                  <Text style={styles.rowTime}>{relativeTime(String(post?.created_at || ''))}</Text>
                  {canDelete(String(post?.user_id || '')) ? (
                    <Pressable
                      onPress={() =>
                        openMoreActionsMenu(
                          [
                            {
                              label: 'Delete Post',
                              destructive: true,
                              onPress: () => onDelete(post),
                            },
                          ],
                          'Post actions'
                        )
                      }
                      style={styles.moreBtn}
                    >
                      <Text style={styles.moreText}>•••</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
              <Text style={styles.rowContent}>{String(post?.content || '')}</Text>
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
  empty: { color: '#9DA8AD', fontWeight: '700' },
  row: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1B1B1B' },
  rowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowType: { color: '#8EDFFF', fontWeight: '900', fontSize: 12, textTransform: 'uppercase' },
  rowTime: { color: '#8FA6AE', fontWeight: '700', fontSize: 12 },
  rowContent: { marginTop: 8, color: '#EAF8FD', fontWeight: '700' },
  moreBtn: { minHeight: 24, minWidth: 24, borderRadius: 8, borderWidth: 1, borderColor: '#2A2A2A', backgroundColor: '#111111', alignItems: 'center', justifyContent: 'center' },
  moreText: { color: '#B7C8CE', fontWeight: '900', fontSize: 10, lineHeight: 10 },
});
