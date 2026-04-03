import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../components/ui/GlassCard';
import SectionHeader from '../../components/ui/SectionHeader';
import { APP_CONFIG } from '../../utils/appConfig';
import { isSupabaseConfigured, socialApi } from '../../utils/supabaseClient';
import { useAuth } from '../context/authcontext';

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

function eventText(activityType: string, data: any) {
  const type = String(activityType || '').toUpperCase();
  if (type === 'POST_CREATED') return 'created a post';
  if (type === 'COMMENT_CREATED') return 'commented on your post';
  if (type === 'WORKOUT_COMPLETED') return `completed ${String(data?.activityType || 'a workout').toLowerCase()}`;
  if (type === 'CHALLENGE_CREATED') return 'created a challenge';
  if (type === 'CHALLENGE_COMPLETED') return 'completed a challenge';
  if (type === 'FOLLOWED_USER') return 'followed an athlete';
  return type.replace(/_/g, ' ').toLowerCase();
}

export default function ActivityFeedScreen() {
  const socialEnabled = APP_CONFIG.FEATURES.SOCIAL_FEATURES_ENABLED || APP_CONFIG.RUNTIME.OVERRIDES.SOCIAL_FEATURES_ENABLED;
  const { supabaseUserId } = useAuth();
  const viewerUserId = supabaseUserId || '';

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!viewerUserId || !isSupabaseConfigured || !socialEnabled) return;
    setLoading(true);
    try {
      setError(null);
      const feed = await socialApi.getActivityFeed(viewerUserId, 80);
      setRows(Array.isArray(feed) ? feed : []);
    } catch (err: any) {
      setRows([]);
      setError(String(err?.message || 'Unable to load activity feed.'));
    } finally {
      setLoading(false);
    }
  }, [socialEnabled, viewerUserId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor="#8FDBFF" />}
      >
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Activity Feed</Text>
          <View style={{ width: 60 }} />
        </View>

        {error ? (
          <GlassCard>
            <Text style={styles.errorText}>{error}</Text>
          </GlassCard>
        ) : null}

        <SectionHeader title="RECENT ACTIVITY" />
        <GlassCard>
          {!rows.length && !loading ? <Text style={styles.empty}>No activity yet.</Text> : null}
          {rows.map((row) => {
            const id = String(row?.id || '');
            const data = row?.data || {};
            const activityType = String(row?.activity_type || '');
            const actorId = String(data?.actorUserId || '');
            const postId = String(data?.postId || '');
            const workoutId = String(data?.workoutId || '');
            const challengeId = String(data?.challengeId || '');
            const targetUserId = String(data?.targetUserId || '');
            return (
              <Pressable
                key={id || Math.random().toString(36)}
                style={styles.row}
                onPress={() => {
                  if (postId) {
                    router.push(`/groups/${String(data?.groupId || '')}` as any);
                    return;
                  }
                  if (workoutId) {
                    router.push('/run-summary' as any);
                    return;
                  }
                  if (challengeId) {
                    router.push(`/challenges/social/${challengeId}` as any);
                    return;
                  }
                  if (targetUserId || actorId) {
                    router.push(`/profile/${targetUserId || actorId}` as any);
                  }
                }}
              >
                <Text style={styles.rowTitle}>{eventText(activityType, data)}</Text>
                <Text style={styles.rowMeta}>{relativeTime(String(row?.created_at || ''))}</Text>
              </Pressable>
            );
          })}
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
  row: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1B1B1B' },
  rowTitle: { color: '#EAF8FD', fontWeight: '800' },
  rowMeta: { color: '#8FA6AE', marginTop: 4, fontWeight: '700', fontSize: 12 },
  errorText: { color: '#FFB4C6', fontWeight: '700' },
  empty: { color: '#9DA8AD', fontWeight: '700' },
});
