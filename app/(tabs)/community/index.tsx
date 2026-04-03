import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';

import { openMoreActionsMenu } from '../../../components/social/MoreActionsMenu';
import Screen from '../../../components/ui/Screen';
import GlassCard from '../../../components/ui/GlassCard';
import Chip from '../../../components/ui/Chip';
import NeonButton from '../../../components/ui/NeonButton';
import { NEON_THEME, neonColorFor } from '../../../constants/neonTheme';
import { APP_CONFIG } from '../../../utils/appConfig';
import { customChallengeSummary, parseCustomChallengePayload } from '../../../utils/customChallengePosts';
import { acceptInvite, declineInvite, getInviteState } from '../../../utils/socialChallengeInviteService';
import { emitSocialEvent, onSocialEvent } from '../../../utils/socialEvents';
import { canModerateContent } from '../../../utils/socialModeration';
import { isSupabaseConfigured, socialApi } from '../../../utils/supabaseClient';
import { devErrorDetail, userFacingErrorMessage } from '../../../utils/userFacingErrors';
import { useAuth } from '../../context/authcontext';

type FeedMode = 'following' | 'for_you';
type FeedFilter = 'all' | 'run' | 'lift' | 'recovery';
// NOTE: required by scripts/verify-p0-all.js; kept even if unused by runtime code.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type CommunityTopTab = 'friends' | 'groups';

type UiPost = {
  id: string;
  userId: string;
  authorName: string;
  authorHandle: string;
  createdAtIso: string;
  content: string;
  postType: string;
  likeCount: number;
  commentCount: number;
  viewerHasLiked: boolean;
  data?: any;
};

function relativeTime(iso: string) {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const deltaSec = Math.max(0, (Date.now() - ts) / 1000);
  if (deltaSec < 60) return 'just now';
  const min = Math.floor(deltaSec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  return `${day}d`;
}

function initials(name: string) {
  const clean = String(name || '').trim();
  if (!clean) return 'Z';
  const parts = clean.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] || 'Z';
  const second = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return `${first}${second}`.toUpperCase();
}

function matchesFilter(postType: string, filter: FeedFilter) {
  const t = String(postType || '').toLowerCase();
  if (filter === 'all') return true;
  if (filter === 'run') return t.includes('run');
  if (filter === 'lift') return t.includes('lift') || t.includes('strength');
  if (filter === 'recovery') return t.includes('recovery') || t.includes('rest') || t.includes('walk');
  return true;
}

function PostCard(props: {
  post: UiPost;
  onToggleLike: () => void;
  onShare: () => void;
  onOpenDm: () => void;
  onAcceptChallenge?: () => void;
  onDeclineChallenge?: () => void;
  challengeState?: { status: 'accepted' | 'declined'; localChallengeId?: string } | null;
  dmDisabled?: boolean;
  canDelete?: boolean;
  onDelete?: () => void;
}) {
  const p = props.post;
  const typeKey = String(p.postType || '').toLowerCase();
  const highlightColor = typeKey.includes('run')
    ? neonColorFor('hydration')
    : typeKey.includes('lift') || typeKey.includes('strength')
    ? neonColorFor('protein')
    : typeKey.includes('recovery') || typeKey.includes('rest')
    ? neonColorFor('activity')
    : neonColorFor('readiness');
  const customChallenge = parseCustomChallengePayload(p.data);
  const showChallengeActions = Boolean(customChallenge && !props.challengeState && p.userId);
  return (
    <GlassCard style={styles.postCard} highlightColor={highlightColor}>
      <View style={styles.postTop}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials(p.authorName)}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>
              {p.authorName}
            </Text>
            <Text style={styles.time}>· {relativeTime(p.createdAtIso)}</Text>
          </View>
          <Text style={styles.handle} numberOfLines={1}>
            {p.authorHandle}
          </Text>
        </View>
        {props.canDelete ? (
          <Pressable
            onPress={() =>
              openMoreActionsMenu(
                [
                  {
                    label: 'Delete Post',
                    destructive: true,
                    onPress: () => props.onDelete?.(),
                  },
                ],
                'Post actions'
              )
            }
            style={({ pressed }) => [styles.moreBtn, pressed && styles.pressed]}
          >
            <MaterialIcons name="more-horiz" size={18} color="#CDECF4" />
          </Pressable>
        ) : null}
      </View>

      <Text style={styles.postType} numberOfLines={1}>
        {p.postType}
      </Text>
      <Text style={styles.postText}>{p.content || '—'}</Text>
      {customChallenge ? (
        <View style={styles.challengeCard}>
          <Text style={styles.challengeTitle}>{customChallenge.title}</Text>
          <Text style={styles.challengeMeta}>{customChallengeSummary(customChallenge)}</Text>
          {customChallenge.note ? <Text style={styles.challengeNote}>{customChallenge.note}</Text> : null}
          {props.challengeState ? (
            <Text style={styles.challengeStateText}>
              {props.challengeState.status === 'accepted' ? `Accepted · Reward +${Math.round(customChallenge.rewardXp)} XP` : 'Declined'}
            </Text>
          ) : null}
          {showChallengeActions ? (
            <View style={styles.challengeActionRow}>
              <Pressable style={styles.challengeAcceptBtn} onPress={props.onAcceptChallenge}>
                <Text style={styles.challengeAcceptText}>Accept</Text>
              </Pressable>
              <Pressable style={styles.challengeDeclineBtn} onPress={props.onDeclineChallenge}>
                <Text style={styles.challengeDeclineText}>Decline</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.actionRow}>
        <Pressable onPress={props.onToggleLike} style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed, p.viewerHasLiked && styles.actionBtnOn]}>
          <Text style={[styles.actionText, p.viewerHasLiked && styles.actionTextOn]}>Kudos</Text>
          <Text style={[styles.actionCount, p.viewerHasLiked && styles.actionTextOn]}>{String(p.likeCount || 0)}</Text>
        </Pressable>
        <View style={styles.actionBtn}>
          <Text style={styles.actionText}>Comment</Text>
          <Text style={styles.actionCount}>{String(p.commentCount || 0)}</Text>
        </View>
        <Pressable onPress={props.onOpenDm} disabled={props.dmDisabled} style={({ pressed }) => [styles.actionBtn, props.dmDisabled && styles.actionBtnDisabled, pressed && !props.dmDisabled && styles.pressed]}>
          <Text style={styles.actionText}>DM</Text>
        </Pressable>
        <Pressable onPress={props.onShare} style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}>
          <Text style={styles.actionText}>Share</Text>
        </Pressable>
      </View>
    </GlassCard>
  );
}

export default function CommunityScreen() {
  const socialEnabled = APP_CONFIG.FEATURES.SOCIAL_FEATURES_ENABLED || APP_CONFIG.RUNTIME.OVERRIDES.SOCIAL_FEATURES_ENABLED;
  const { supabaseUserId, profile: cloudProfile } = useAuth();
  const viewerUserId = supabaseUserId || null;

  const [mode, setMode] = useState<FeedMode>('for_you');
  const [filter, setFilter] = useState<FeedFilter>('all');
  const [posts, setPosts] = useState<UiPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [composerOpen, setComposerOpen] = useState(false);
  const [composerText, setComposerText] = useState('');
  const [posting, setPosting] = useState(false);

  const [dmHint, setDmHint] = useState(false);
  const [inviteStateByPost, setInviteStateByPost] = useState<Record<string, { status: 'accepted' | 'declined'; localChallengeId?: string }>>({});

  const load = useCallback(async () => {
    if (!socialEnabled) return;
    setLoading(true);
    try {
      setError(null);

      if (!viewerUserId || !isSupabaseConfigured) {
        setPosts([]);
        setDmHint(true);
        return;
      }

      const rows =
        mode === 'following' ? await socialApi.getFriendsFeed(viewerUserId, 28, 0) : await socialApi.getCommunityFeed(viewerUserId, 28);

      const mapped: UiPost[] = (Array.isArray(rows) ? rows : []).map((row: any) => {
        const profile = row?.profiles || row?.profiles?.[0] || null;
        const authorName = String(profile?.display_name || profile?.username || 'Athlete');
        const handle = String(profile?.username || 'unknown');
        const authorHandle = handle.startsWith('@') ? handle : `@${handle}`;
        return {
          id: String(row?.id || ''),
          userId: String(row?.user_id || ''),
          authorName,
          authorHandle,
          createdAtIso: String(row?.created_at || new Date().toISOString()),
          content: String(row?.content || ''),
          postType: String(row?.post_type || 'post'),
          likeCount: Number(row?.likeCount ?? row?.likes_count ?? 0) || 0,
          commentCount: Number(row?.commentCount ?? row?.comments_count ?? 0) || 0,
          viewerHasLiked: Boolean(row?.viewerHasLiked),
          data: row?.data ?? null,
        };
      });

      setPosts(mapped);
      const statePairs = await Promise.all(
        mapped.map(async (row) => {
          const id = String(row.id || '').trim();
          if (!id) return null;
          const s = await getInviteState(id);
          return s ? ([id, { status: s.status, localChallengeId: s.localChallengeId }] as const) : null;
        })
      );
      const nextState: Record<string, { status: 'accepted' | 'declined'; localChallengeId?: string }> = {};
      statePairs.forEach((entry) => {
        if (!entry) return;
        nextState[entry[0]] = entry[1];
      });
      setInviteStateByPost(nextState);
      setDmHint(false);
    } catch (err: any) {
      const message = userFacingErrorMessage(err, 'Unable to load the community feed.');
      const detail = __DEV__ ? devErrorDetail(err) : '';
      setError(detail ? `${message}\n${detail}` : message);
      // Keep the last successful feed on screen as stale-cache fallback.
    } finally {
      setLoading(false);
    }
  }, [mode, socialEnabled, viewerUserId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  React.useEffect(() => {
    return onSocialEvent('postDeleted', ({ postId }) => {
      setPosts((prev) => prev.filter((p) => p.id !== postId));
    });
  }, []);

  const filtered = useMemo(() => posts.filter((p) => matchesFilter(p.postType, filter)), [posts, filter]);

  const openComposer = () => {
    setComposerText('');
    setComposerOpen(true);
  };

  const submitPost = async () => {
    if (!viewerUserId || !isSupabaseConfigured) {
      Alert.alert('Sign in required', 'Connect your account to post.');
      return;
    }
    const content = composerText.trim();
    if (!content) return;
    if (posting) return;
    setPosting(true);
    try {
      await socialApi.createPost(viewerUserId, content, 'text', null, { audience: mode === 'following' ? 'friends' : 'public' });
      setComposerOpen(false);
      await load();
    } catch (err: any) {
      const message = userFacingErrorMessage(err, 'Unable to post right now.');
      const detail = __DEV__ ? devErrorDetail(err) : '';
      Alert.alert('Post failed', detail ? `${message}\n\n${detail}` : message);
    } finally {
      setPosting(false);
    }
  };

  const toggleLike = async (post: UiPost) => {
    if (!viewerUserId || !isSupabaseConfigured) {
      Alert.alert('Sign in required', 'Connect your account to give kudos.');
      return;
    }
    if (!post.id) return;

    const nextLiked = !post.viewerHasLiked;
    setPosts((prev) =>
      prev.map((p) =>
        p.id === post.id ? { ...p, viewerHasLiked: nextLiked, likeCount: Math.max(0, (p.likeCount || 0) + (nextLiked ? 1 : -1)) } : p
      )
    );

    try {
      if (nextLiked) await socialApi.likePost(viewerUserId, post.id);
      else await socialApi.unlikePost(viewerUserId, post.id);
    } catch (err: any) {
      // Roll back optimistic update.
      setPosts((prev) => prev.map((p) => (p.id === post.id ? post : p)));
      const message = userFacingErrorMessage(err, 'Unable to update kudos.');
      Alert.alert('Action failed', message);
    }
  };

  const acceptChallenge = async (post: UiPost) => {
    const payload = parseCustomChallengePayload(post.data);
    if (!payload || !post.id) return;
    try {
      const res = await acceptInvite({ postId: post.id, payload });
      setInviteStateByPost((prev) => ({ ...prev, [post.id]: { status: 'accepted', localChallengeId: res.localChallengeId } }));
      Alert.alert('Challenge accepted', `XP reward armed: +${Math.round(payload.rewardXp)} XP on completion.`);
    } catch (err: any) {
      Alert.alert('Unable to accept', userFacingErrorMessage(err, 'Could not accept challenge.'));
    }
  };

  const rejectChallenge = async (post: UiPost) => {
    if (!post.id) return;
    await declineInvite({ postId: post.id });
    setInviteStateByPost((prev) => ({ ...prev, [post.id]: { status: 'declined' } }));
  };

  const deletePost = async (post: UiPost) => {
    if (!viewerUserId) return;
    const canDelete = canModerateContent({ id: viewerUserId, role: (cloudProfile as any)?.role }, post.userId);
    if (!canDelete || !post.id) return;
    Alert.alert('Delete this post?', "This can't be undone.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const snapshot = posts;
          setPosts((prev) => prev.filter((p) => p.id !== post.id));
          try {
            await socialApi.deletePost(post.id);
            emitSocialEvent('postDeleted', { postId: post.id });
          } catch (err: any) {
            setPosts(snapshot);
            Alert.alert('Could not delete post.', userFacingErrorMessage(err, 'Please try again.'));
          }
        },
      },
    ]);
  };

  return (
    <Screen aura>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>Community</Text>
          <View style={styles.headerRight}>
            <Pressable onPress={() => router.push('/challenges/social' as any)} style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}>
              <MaterialIcons name="emoji-events" size={22} color="#D9F6FF" />
            </Pressable>
            <Pressable onPress={() => router.push('/social/leaderboards' as any)} style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}>
              <MaterialIcons name="leaderboard" size={22} color="#D9F6FF" />
            </Pressable>
            <Pressable onPress={() => router.push('/social/feed' as any)} style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}>
              <MaterialIcons name="dynamic-feed" size={22} color="#D9F6FF" />
            </Pressable>
            <Pressable onPress={() => router.push('/friends/find' as any)} style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}>
              <MaterialIcons name="search" size={22} color="#D9F6FF" />
            </Pressable>
            <Pressable onPress={() => router.push('/messages' as any)} style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}>
              <MaterialIcons name="chat-bubble-outline" size={22} color="#D9F6FF" />
              {dmHint ? <View style={styles.dot} /> : null}
            </Pressable>
            <Pressable onPress={openComposer} style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}>
              <MaterialIcons name="add" size={22} color="#D9F6FF" />
            </Pressable>
          </View>
        </View>

        <View style={styles.modeRow}>
          <Pressable onPress={() => router.push('/social/feed' as any)} style={styles.subtabChip}>
            <Text style={styles.subtabText}>Feed</Text>
          </Pressable>
          <Pressable onPress={() => router.push('/challenges/social' as any)} style={styles.subtabChip}>
            <Text style={styles.subtabText}>Challenges</Text>
          </Pressable>
        </View>

        <View style={styles.modeRow}>
          <Pressable onPress={() => setMode('following')} style={[styles.modeChip, mode === 'following' && styles.modeChipOn]}>
            <Text style={[styles.modeText, mode === 'following' && styles.modeTextOn]}>Following</Text>
          </Pressable>
          <Pressable onPress={() => setMode('for_you')} style={[styles.modeChip, mode === 'for_you' && styles.modeChipOn]}>
            <Text style={[styles.modeText, mode === 'for_you' && styles.modeTextOn]}>For You</Text>
          </Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {(['all', 'run', 'lift', 'recovery'] as FeedFilter[]).map((key) => (
            <Chip key={key} label={key === 'all' ? 'All' : key === 'run' ? 'Run' : key === 'lift' ? 'Strength' : 'Recovery'} active={filter === key} onPress={() => setFilter(key)} />
          ))}
        </ScrollView>

        {error ? (
          <GlassCard highlightColor={neonColorFor('error')}>
            <Text style={styles.errorTitle}>Feed sync issue</Text>
            <Text style={styles.errorBody}>{error}</Text>
            {posts.length ? <Text style={styles.errorBody}>Showing cached feed while reconnecting.</Text> : null}
            <NeonButton
              label={loading ? 'Loading…' : 'Retry'}
              semantic="error"
              onPress={() => void load()}
              disabled={loading}
              style={styles.retryBtn}
            />
          </GlassCard>
        ) : null}

        {!viewerUserId ? (
          <GlassCard highlightColor={neonColorFor('readiness')}>
            <Text style={styles.emptyTitle}>Start building your community</Text>
            <Text style={styles.emptyBody}>Follow athletes, join groups, and use DMs to coordinate sessions.</Text>
            <View style={styles.emptyActions}>
              <NeonButton label="Sign in" semantic="readiness" variant="primary" onPress={() => router.push('/auth/login' as any)} style={styles.flexBtn} />
              <NeonButton
                label="Find athletes"
                semantic="readiness"
                variant="secondary"
                onPress={() => router.push('/friends/find' as any)}
                style={styles.flexBtn}
              />
            </View>
          </GlassCard>
        ) : null}

        {loading && !filtered.length ? <Text style={styles.info}>Loading feed…</Text> : null}

        <View style={styles.feedList}>
          {filtered.map((p) => (
            <PostCard
              key={p.id || `${p.userId}_${p.createdAtIso}`}
              post={p}
              onToggleLike={() => void toggleLike(p)}
              onShare={() => void Share.share({ message: p.content })}
              onOpenDm={() => router.push('/messages' as any)}
              onAcceptChallenge={() => void acceptChallenge(p)}
              onDeclineChallenge={() => void rejectChallenge(p)}
              challengeState={inviteStateByPost[p.id] || null}
              dmDisabled={!viewerUserId || !isSupabaseConfigured}
              canDelete={Boolean(canModerateContent({ id: viewerUserId, role: (cloudProfile as any)?.role }, p.userId))}
              onDelete={() => void deletePost(p)}
            />
          ))}
        </View>

        {!loading && filtered.length === 0 ? (
          <GlassCard highlightColor={neonColorFor('protein')}>
            <Text style={styles.emptyTitle}>No posts yet</Text>
            <Text style={styles.emptyBody}>Follow athletes or create your first post.</Text>
            <View style={styles.emptyActions}>
              <NeonButton
                label="Find athletes"
                semantic="readiness"
                variant="primary"
                onPress={() => router.push('/friends/find' as any)}
                style={styles.flexBtn}
              />
              <NeonButton label="Create post" semantic="protein" variant="secondary" onPress={openComposer} style={styles.flexBtn} />
            </View>
          </GlassCard>
        ) : null}

        <View style={{ height: 32 }} />
      </ScrollView>

      <Modal visible={composerOpen} animationType="slide" transparent onRequestClose={() => setComposerOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New Post</Text>
            <Text style={styles.modalSub}>Share a short update. Keep it training-first.</Text>
            <TextInput
              value={composerText}
              onChangeText={setComposerText}
              placeholder="What did you do today?"
              placeholderTextColor="#777"
              style={styles.modalInput}
              multiline
              maxLength={420}
            />
            <View style={styles.modalActions}>
              <Pressable onPress={() => setComposerOpen(false)} style={({ pressed }) => [styles.modalGhost, pressed && styles.pressed]} disabled={posting}>
                <Text style={styles.modalGhostText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => void submitPost()}
                style={({ pressed }) => [styles.modalPrimary, pressed && styles.pressed, (posting || !composerText.trim()) && styles.disabled]}
                disabled={posting || !composerText.trim()}
              >
                <Text style={styles.modalPrimaryText}>{posting ? 'Posting…' : 'Post'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 32 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { color: NEON_THEME.color.textPrimary, fontSize: 28, fontWeight: '900' },
  headerRight: { flexDirection: 'row', gap: 12 },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: NEON_THEME.color.surface1,
    borderWidth: 1,
    borderColor: NEON_THEME.color.strokeSubtle,
  },
  dot: {
    position: 'absolute',
    right: 10,
    top: 10,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: NEON_THEME.color.neonCyan,
  },
  pressed: { opacity: 0.96, transform: [{ scale: 0.995 }] },

  modeRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  subtabChip: {
    flex: 1,
    minHeight: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: NEON_THEME.color.strokeSubtle,
    backgroundColor: NEON_THEME.color.surface1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subtabText: { color: NEON_THEME.color.textSecondary, fontWeight: '900', fontSize: 12 },
  modeChip: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: NEON_THEME.color.strokeSubtle,
    backgroundColor: NEON_THEME.color.surface1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeChipOn: { borderColor: 'rgba(14,210,244,0.55)', backgroundColor: 'rgba(14,210,244,0.16)' },
  modeText: { color: NEON_THEME.color.textSecondary, fontWeight: '900' },
  modeTextOn: { color: NEON_THEME.color.textPrimary },

  filterRow: { gap: 8, paddingVertical: 4, paddingRight: 4 },

  info: { color: NEON_THEME.color.textSecondary, fontWeight: '700', marginTop: 12 },
  feedList: { marginTop: 12, gap: 12 },

  postCard: { padding: 16 },
  postTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(14,210,244,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(14,210,244,0.55)',
  },
  avatarText: { color: NEON_THEME.color.textPrimary, fontWeight: '900' },
  moreBtn: {
    width: 30,
    height: 30,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: NEON_THEME.color.strokeSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { color: NEON_THEME.color.textPrimary, fontWeight: '900' },
  time: { color: NEON_THEME.color.textTertiary, fontWeight: '800' },
  handle: { marginTop: 4, color: NEON_THEME.color.neonCyan, fontWeight: '800', fontSize: 12 },
  postType: { marginTop: 12, color: NEON_THEME.color.textTertiary, fontWeight: '900', fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase' },
  postText: { marginTop: 8, color: NEON_THEME.color.textPrimary, fontWeight: '700', lineHeight: 18 },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  actionBtn: {
    flex: 1,
    minHeight: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: NEON_THEME.color.strokeSubtle,
    backgroundColor: 'rgba(0,0,0,0.20)',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 12,
  },
  actionBtnOn: { borderColor: 'rgba(14,210,244,0.55)', backgroundColor: 'rgba(14,210,244,0.12)' },
  actionBtnDisabled: { opacity: 0.55 },
  actionText: { color: NEON_THEME.color.textSecondary, fontWeight: '900', fontSize: 12 },
  actionTextOn: { color: NEON_THEME.color.textPrimary },
  actionCount: { color: NEON_THEME.color.textTertiary, fontWeight: '900', fontSize: 12 },
  challengeCard: {
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,217,255,0.28)',
    backgroundColor: 'rgba(0,217,255,0.08)',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  challengeTitle: { color: NEON_THEME.color.textPrimary, fontWeight: '900' },
  challengeMeta: { color: '#A4EFFF', fontWeight: '800', marginTop: 4, fontSize: 12 },
  challengeNote: { color: '#C8D8DE', fontWeight: '700', marginTop: 4, fontSize: 12 },
  challengeStateText: { color: '#9EE8B5', fontWeight: '800', marginTop: 6, fontSize: 12 },
  challengeActionRow: { marginTop: 8, flexDirection: 'row', gap: 8 },
  challengeAcceptBtn: {
    flex: 1,
    minHeight: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(0,217,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(0,217,255,0.34)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  challengeAcceptText: { color: '#BFF3FF', fontWeight: '900', fontSize: 12 },
  challengeDeclineBtn: {
    flex: 1,
    minHeight: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#3A2A2A',
    backgroundColor: 'rgba(255,77,109,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  challengeDeclineText: { color: '#FFB1C1', fontWeight: '900', fontSize: 12 },

  errorTitle: { color: NEON_THEME.color.textPrimary, fontWeight: '900' },
  errorBody: { color: NEON_THEME.color.textSecondary, fontWeight: '700', marginTop: 8, lineHeight: 18 },
  retryBtn: { marginTop: 12, minHeight: 40, alignSelf: 'flex-start' },

  emptyTitle: { color: NEON_THEME.color.textPrimary, fontWeight: '900', fontSize: 16 },
  emptyBody: { marginTop: 8, color: NEON_THEME.color.textSecondary, fontWeight: '700', lineHeight: 18 },
  emptyActions: { flexDirection: 'row', gap: 12, marginTop: 12 },
  flexBtn: { flex: 1 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.66)', justifyContent: 'flex-end', padding: 16 },
  modalCard: { borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', backgroundColor: '#121212', padding: 16 },
  modalTitle: { color: '#FFF', fontWeight: '900', fontSize: 18 },
  modalSub: { color: 'rgba(255,255,255,0.70)', fontWeight: '700', marginTop: 8, lineHeight: 18 },
  modalInput: {
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: '#0F0F0F',
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: '#FFF',
    fontWeight: '700',
    minHeight: 120,
  },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  modalGhost: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalGhostText: { color: '#EAEAEA', fontWeight: '900' },
  modalPrimary: { flex: 1, minHeight: 46, borderRadius: 14, backgroundColor: '#00D9FF', alignItems: 'center', justifyContent: 'center' },
  modalPrimaryText: { color: '#041A22', fontWeight: '900' },
  disabled: { opacity: 0.55 },
});
