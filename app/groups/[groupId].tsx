import { useFocusEffect } from '@react-navigation/native'; import { Redirect, router, useLocalSearchParams } from 'expo-router'; import React, { useCallback, useEffect, useMemo, useState } from 'react'; import { Alert, Keyboard, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { openMoreActionsMenu } from '../../components/social/MoreActionsMenu';
import GlassCard from '../../components/ui/GlassCard';
import Chip from '../../components/ui/Chip';
import EventCard from '../../components/ui/EventCard';
import SectionHeader from '../../components/ui/SectionHeader';
import { APP_CONFIG } from '../../utils/appConfig';
import {
  buildCustomChallengePayload,
  customChallengeSummary,
  parseCustomChallengePayload,
  type CustomChallengeMetric,
} from '../../utils/customChallengePosts';
import { formatEventDateHeader, splitUpcomingPast, toLocalDateKey } from '../../utils/eventsUi';
import { acceptInvite, declineInvite, getInviteState } from '../../utils/socialChallengeInviteService';
import { emitSocialEvent } from '../../utils/socialEvents';
import { canModerateContent } from '../../utils/socialModeration';
import { isSupabaseConfigured, socialApi } from '../../utils/supabaseClient';
import { useAuth } from '../context/authcontext';

type GroupRow = Awaited<ReturnType<typeof socialApi.getTeamGroup>>;
type PostRow = Awaited<ReturnType<typeof socialApi.getGroupPosts>>[number] & {
  profiles?: { id: string; username?: string | null; display_name?: string | null } | null;
};
type CommentRow = Awaited<ReturnType<typeof socialApi.getComments>>[number] & {
  profiles?: { id: string; username?: string | null; display_name?: string | null } | null;
};

function relativeTime(iso?: string | null) {
  const ts = iso ? Date.parse(iso) : NaN;
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

export default function GroupDetailScreen() {
  const params = useLocalSearchParams<{ groupId?: string; composeChallenge?: string }>();
  const groupId = String(params.groupId || '').trim();

  const socialEnabled = APP_CONFIG.FEATURES.SOCIAL_FEATURES_ENABLED || APP_CONFIG.RUNTIME.OVERRIDES.SOCIAL_FEATURES_ENABLED;
  const { supabaseUserId } = useAuth();
  const viewerUserId = supabaseUserId || null;

  const [group, setGroup] = useState<GroupRow | null>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'posts' | 'events' | 'members'>('posts');

  const [events, setEvents] = useState<any[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [coachTeamEventAdmin, setCoachTeamEventAdmin] = useState(false);
  const [eventTypeFilter, setEventTypeFilter] = useState<'all' | 'training' | 'social' | 'race' | 'meeting' | 'travel' | 'other'>('all');

  const [composeOpen, setComposeOpen] = useState(false);
  const [composeText, setComposeText] = useState('');
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [challengeTitle, setChallengeTitle] = useState('Team push');
  const [challengeMetric, setChallengeMetric] = useState<CustomChallengeMetric>('workouts');
  const [challengeTarget, setChallengeTarget] = useState('4');
  const [challengeDays, setChallengeDays] = useState('7');
  const [challengeRewardXp, setChallengeRewardXp] = useState('40');
  const [challengeNote, setChallengeNote] = useState('');
  const [inviteStateByPost, setInviteStateByPost] = useState<Record<string, { status: 'accepted' | 'declined'; localChallengeId?: string }>>({});

  const [postOpen, setPostOpen] = useState<PostRow | null>(null);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');

  const load = useCallback(async () => {
    if (!viewerUserId || !groupId || !isSupabaseConfigured) return;
    try {
      setLoadError(null);
      const [groupRow, memberRows, postRows] = await Promise.all([
        socialApi.getGroup(groupId),
        socialApi.getGroupMembers(groupId),
        socialApi.getGroupPosts(groupId, 40),
      ]);
      setGroup(groupRow as any);
      setMembers(Array.isArray(memberRows) ? memberRows : []);
      setPosts((Array.isArray(postRows) ? postRows : []) as any);
      const list = Array.isArray(postRows) ? postRows : [];
      const statePairs = await Promise.all(
        list.map(async (row: any) => {
          const id = String(row?.id || '').trim();
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

      // Load structured events for this group. This should not block posts/members.
      setEventsLoading(true);
      setEventsError(null);
      try {
        const evRows = await socialApi.getEventsForUser(viewerUserId, { groupId, limit: 120, includeRsvpCounts: true });
        setEvents(Array.isArray(evRows) ? evRows : []);
      } catch (err: any) {
        setEvents([]);
        setEventsError(String(err?.message || 'Unable to load events.'));
      } finally {
        setEventsLoading(false);
      }
    } catch (err: any) {
      setLoadError(String(err?.message || 'Unable to load group.'));
      setGroup(null);
      setMembers([]);
      setPosts([]);
      setEvents([]);
      setEventsError(null);
      setEventsLoading(false);
    }
  }, [viewerUserId, groupId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  useEffect(() => {
    if (String(params.composeChallenge || '') === '1') {
      setChallengeOpen(true);
    }
  }, [params.composeChallenge]);

  useEffect(() => {
    let cancelled = false;
    const computeCoachAdmin = async () => {
      if (!viewerUserId || !group || !isSupabaseConfigured) {
        if (!cancelled) setCoachTeamEventAdmin(false);
        return;
      }
      const kind = String((group as any)?.kind || '').trim().toLowerCase();
      const joinCode = String((group as any)?.join_code || '').trim();
      if (kind !== 'coaching_team' || !joinCode.startsWith('team:')) {
        if (!cancelled) setCoachTeamEventAdmin(false);
        return;
      }
      const teamId = joinCode.split(':')[1] || '';
      if (!teamId) {
        if (!cancelled) setCoachTeamEventAdmin(false);
        return;
      }
      try {
        const mine = await socialApi.getMyTeams(viewerUserId);
        const rows = Array.isArray(mine) ? mine : [];
        const match = rows.find((row: any) => String(row?.team_id || row?.teams?.id || '') === teamId);
        const role = String(match?.role || '').trim().toLowerCase();
        const isCoachLike = role === 'owner' || role === 'admin' || role === 'coach' || role === 'trainer';
        if (!cancelled) setCoachTeamEventAdmin(isCoachLike);
      } catch {
        if (!cancelled) setCoachTeamEventAdmin(false);
      }
    };
    void computeCoachAdmin();
    return () => {
      cancelled = true;
    };
  }, [viewerUserId, group, group?.id]);

  const viewerGroupRole = useMemo(() => {
    if (!viewerUserId) return '';
    const row = members.find((m: any) => String(m?.user_id || '') === viewerUserId) || null;
    return String(row?.role || '').trim().toLowerCase();
  }, [members, viewerUserId]);
  const viewerCanModerateByRole = viewerGroupRole === 'owner' || viewerGroupRole === 'admin' || viewerGroupRole === 'mod';

  const canCreateEvent = useMemo(() => {
    return viewerGroupRole === 'owner' || viewerGroupRole === 'admin' || viewerGroupRole === 'mod' || coachTeamEventAdmin;
  }, [viewerGroupRole, coachTeamEventAdmin]);
  const isTeamGroup = useMemo(() => {
    const kind = String((group as any)?.kind || '').trim().toLowerCase();
    const joinCode = String((group as any)?.join_code || '').trim();
    return kind === 'coaching_team' || joinCode.startsWith('team:');
  }, [group]);

  const visibleEvents = useMemo(() => {
    const list = Array.isArray(events) ? events : [];
    if (eventTypeFilter === 'all') return list;
    return list.filter((ev: any) => String(ev?.event_type || '').trim().toLowerCase() === eventTypeFilter);
  }, [events, eventTypeFilter]);

  const { upcoming: upcomingEvents, past: pastEvents } = useMemo(() => splitUpcomingPast(visibleEvents), [visibleEvents]);

  const groupedUpcoming = useMemo(() => {
    const map = new Map<string, any[]>();
    upcomingEvents.forEach((ev: any) => {
      const key = toLocalDateKey(String(ev?.start_at || ''));
      if (!key) return;
      const bucket = map.get(key) || [];
      bucket.push(ev);
      map.set(key, bucket);
    });
    const keys = Array.from(map.keys()).sort();
    return keys.map((key) => ({ key, label: formatEventDateHeader(key), rows: (map.get(key) || []).slice() }));
  }, [upcomingEvents]);

  const groupedPast = useMemo(() => {
    const map = new Map<string, any[]>();
    pastEvents.forEach((ev: any) => {
      const key = toLocalDateKey(String(ev?.start_at || ''));
      if (!key) return;
      const bucket = map.get(key) || [];
      bucket.push(ev);
      map.set(key, bucket);
    });
    const keys = Array.from(map.keys()).sort().reverse();
    return keys.map((key) => ({ key, label: formatEventDateHeader(key), rows: (map.get(key) || []).slice() }));
  }, [pastEvents]);

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

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const leaveGroupAndExit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await socialApi.leaveGroup(viewerUserId!, groupId);
      router.replace('/groups' as any);
    } catch (err: any) {
      Alert.alert('Action failed', String(err?.message || 'Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const loadPostComments = useCallback(async (postId: string) => {
    if (!postId) return;
    setCommentsLoading(true);
    setCommentsError(null);
    try {
      const rows = await socialApi.getComments(postId);
      setComments((Array.isArray(rows) ? rows : []) as any);
    } catch (err: any) {
      setComments([]);
      setCommentsError(String(err?.message || 'Could not load comments.'));
      Alert.alert('Comments unavailable', String(err?.message || 'Could not load comments.'));
    } finally {
      setCommentsLoading(false);
    }
  }, []);

  const openPost = async (post: PostRow) => {
    if (!post?.id) {
      Alert.alert('Unavailable', 'This post is missing an ID.');
      return;
    }
    setPostOpen(post);
    setCommentText('');
    setComments([]);
    setCommentsError(null);
    await loadPostComments(post.id);
  };

  const submitPost = async () => {
    if (!viewerUserId) return;
    if (!groupId) {
      Alert.alert('Unavailable', 'This group link is missing an ID.');
      return;
    }
    const text = composeText.trim();
    if (!text) {
      Alert.alert('Missing post', 'Write something first.');
      return;
    }
    setComposeOpen(false);
    setComposeText('');
    await withBusy(async () => {
      await socialApi.createPost(viewerUserId, text, 'group_post', {}, { audience: 'group', groupId, isPublic: false });
    });
  };

  const submitCustomChallenge = async () => {
    if (!viewerUserId || !groupId) return;
    const title = challengeTitle.trim();
    if (!title) {
      Alert.alert('Missing title', 'Add a challenge title.');
      return;
    }
    const payload = buildCustomChallengePayload({
      title,
      metric: challengeMetric,
      targetValue: Number(challengeTarget || 0),
      windowDays: Number(challengeDays || 0),
      rewardXp: Number(challengeRewardXp || 0),
      note: challengeNote,
      scope: 'team',
      createdByUserId: viewerUserId,
    });
    setChallengeOpen(false);
    await withBusy(async () => {
      const summary = customChallengeSummary(payload);
      await socialApi.createPost(
        viewerUserId,
        `${payload.title} · ${summary}`,
        'team_challenge',
        { customChallenge: payload },
        { audience: 'group', groupId, isPublic: false }
      );
    });
  };

  const acceptChallenge = async (postId: string, payload: ReturnType<typeof parseCustomChallengePayload>) => {
    if (!payload) return;
    try {
      const res = await acceptInvite({ postId, payload });
      setInviteStateByPost((prev) => ({ ...prev, [postId]: { status: 'accepted', localChallengeId: res.localChallengeId } }));
      Alert.alert('Challenge accepted', `Reward armed: +${Math.round(payload.rewardXp)} XP on completion.`);
    } catch (err: any) {
      Alert.alert('Unable to accept', String(err?.message || 'Try again.'));
    }
  };

  const rejectChallenge = async (postId: string) => {
    await declineInvite({ postId });
    setInviteStateByPost((prev) => ({ ...prev, [postId]: { status: 'declined' } }));
  };

  const submitComment = async () => {
    if (!viewerUserId || !postOpen?.id) return;
    const text = commentText.trim();
    if (!text) return;
    setCommentText('');
    await withBusy(async () => {
      await socialApi.createComment(viewerUserId, postOpen.id, text);
    });
    await loadPostComments(postOpen.id);
  };

  const deletePost = async (post: PostRow) => {
    const postId = String(post?.id || '').trim();
    if (!postId || !viewerUserId) return;
    const ownerId = String(post?.user_id || '');
    if (!canModerateContent({ id: viewerUserId, role: viewerCanModerateByRole ? 'moderator' : '' }, ownerId)) return;
    Alert.alert('Delete this post?', "This can't be undone.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const snapshot = posts;
          setPosts((prev) => prev.filter((p) => String(p?.id || '') !== postId));
          try {
            await socialApi.deletePost(postId);
            emitSocialEvent('postDeleted', { postId });
            if (String(postOpen?.id || '') === postId) setPostOpen(null);
          } catch (err: any) {
            setPosts(snapshot);
            Alert.alert('Could not delete post.', String(err?.message || 'Please try again.'));
          }
        },
      },
    ]);
  };

  const deleteComment = async (comment: CommentRow) => {
    const commentId = String(comment?.id || '').trim();
    if (!commentId || !viewerUserId || !postOpen?.id) return;
    const ownerId = String(comment?.user_id || '');
    if (!canModerateContent({ id: viewerUserId, role: viewerCanModerateByRole ? 'moderator' : '' }, ownerId)) return;
    Alert.alert('Delete this comment?', "This can't be undone.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const snapshot = comments;
          setComments((prev) => prev.filter((c) => String(c?.id || '') !== commentId));
          setPosts((prev) =>
            prev.map((p) =>
              String(p?.id || '') === String(postOpen?.id || '')
                ? { ...p, comments_count: Math.max(0, Number((p as any)?.comments_count || 0) - 1) }
                : p
            )
          );
          try {
            await socialApi.deleteComment(commentId);
            emitSocialEvent('commentDeleted', { commentId, postId: postOpen.id });
          } catch (err: any) {
            setComments(snapshot);
            setPosts((prev) =>
              prev.map((p) =>
                String(p?.id || '') === String(postOpen?.id || '')
                  ? { ...p, comments_count: Number((p as any)?.comments_count || 0) + 1 }
                  : p
              )
            );
            Alert.alert('Could not delete comment.', String(err?.message || 'Please try again.'));
          }
        },
      },
    ]);
  };

  if (!socialEnabled) return <Redirect href='/(tabs)/profile' />;
  if (!viewerUserId) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.empty}>Sign in to view groups.</Text>
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
  if (!groupId) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.empty}>This group link is invalid.</Text>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>Back</Text>
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor='#8FDBFF' />}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScrollBeginDrag={Keyboard.dismiss}
      >
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>Back</Text>
          </Pressable>
        <Text style={styles.title}>{group?.name || 'Group'}</Text>
        <View style={{ width: 60 }} />
      </View>

      <Text style={styles.subtitle}>{group?.description || 'Group space'}</Text>
      {loadError ? (
        <GlassCard>
          <Text style={styles.empty}>Group backend error.</Text>
          <Text style={styles.errorText}>{loadError}</Text>
          <Pressable style={styles.retryBtn} onPress={() => void load()} disabled={refreshing || busy}>
            <Text style={styles.retryText}>{refreshing || busy ? 'Retrying…' : 'Retry'}</Text>
          </Pressable>
        </GlassCard>
      ) : null}

        <View style={styles.tabRow}>
          {(['posts', 'events', 'members'] as const).map((key) => {
            const active = tab === key;
            return (
              <Pressable
                key={key}
                style={[styles.tabChip, active && styles.tabChipOn]}
                onPress={() => setTab(key)}
                disabled={busy}
              >
                <Text style={[styles.tabChipText, active && styles.tabChipTextOn]}>
                  {key === 'posts' ? 'Posts' : key === 'events' ? 'Events' : 'Members'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {tab === 'posts' ? (
          <>
            <SectionHeader title='POSTS' />
            <GlassCard>
              <Pressable style={styles.primaryWide} onPress={() => setComposeOpen(true)} disabled={busy}>
                <Text style={styles.primaryWideText}>Post to group</Text>
              </Pressable>
              {isTeamGroup ? (
                <Pressable style={styles.ghostWide} onPress={() => setChallengeOpen(true)} disabled={busy}>
                  <Text style={styles.ghostWideText}>Send team challenge</Text>
                </Pressable>
              ) : null}
            </GlassCard>

            <GlassCard>
              {posts.length ? (
                posts.map((post, index: number) => {
                  const postId = String(post?.id || '');
                  const postDisabled = busy || !postId;
                  const customChallenge = parseCustomChallengePayload((post as any)?.data);
                  const inviteState = inviteStateByPost[postId] || null;
                  const showInviteActions = Boolean(customChallenge && String(post?.user_id || '') !== String(viewerUserId || '') && !inviteState);
                  return (
                    <Pressable
                      key={`${postId || `post-${index}`}`}
                      onPress={() => void openPost(post)}
                      style={[styles.postRow, postDisabled && styles.postRowDisabled]}
                      disabled={postDisabled}
                    >
                      <View style={styles.postHeader}>
                        <Text style={styles.postAuthor}>{post.profiles?.display_name || post.profiles?.username || 'Athlete'}</Text>
                        <View style={styles.postHeaderRight}>
                          <Text style={styles.postTime}>{relativeTime(post.created_at)}</Text>
                          {(String(post?.user_id || '') === String(viewerUserId || '') || viewerCanModerateByRole) ? (
                            <Pressable
                              onPress={() =>
                                openMoreActionsMenu(
                                  [
                                    {
                                      label: 'Delete Post',
                                      destructive: true,
                                      onPress: () => void deletePost(post),
                                    },
                                  ],
                                  'Post actions'
                                )
                              }
                              style={({ pressed }) => [styles.moreBtn, pressed && styles.postRowDisabled]}
                            >
                              <Text style={styles.moreText}>•••</Text>
                            </Pressable>
                          ) : null}
                        </View>
                      </View>
                      <Text style={styles.postContent}>{String(post.content || '')}</Text>
                      {customChallenge ? (
                        <View style={styles.challengeCard}>
                          <Text style={styles.challengeTitle}>{customChallenge.title}</Text>
                          <Text style={styles.challengeMeta}>{customChallengeSummary(customChallenge)}</Text>
                          {customChallenge.note ? <Text style={styles.challengeNote}>{customChallenge.note}</Text> : null}
                          {inviteState ? (
                            <Text style={styles.challengeStateText}>
                              {inviteState.status === 'accepted' ? `Accepted · Reward +${Math.round(customChallenge.rewardXp)} XP` : 'Declined'}
                            </Text>
                          ) : null}
                          {showInviteActions ? (
                            <View style={styles.challengeActionRow}>
                              <Pressable style={styles.challengeAcceptBtn} onPress={() => void acceptChallenge(postId, customChallenge)}>
                                <Text style={styles.challengeAcceptText}>Accept</Text>
                              </Pressable>
                              <Pressable style={styles.challengeDeclineBtn} onPress={() => void rejectChallenge(postId)}>
                                <Text style={styles.challengeDeclineText}>Decline</Text>
                              </Pressable>
                            </View>
                          ) : null}
                        </View>
                      ) : null}
                      <Text style={styles.postMeta}>
                        {Number(post.likes_count || 0)} likes · {Number(post.comments_count || 0)} comments
                      </Text>
                    </Pressable>
                  );
                })
              ) : (
                <Text style={styles.empty}>No posts yet.</Text>
              )}
            </GlassCard>
          </>
        ) : null}

        {tab === 'events' ? (
          <>
            <SectionHeader title='EVENTS' />
            <GlassCard>
              <View style={{ gap: 10 }}>
                {canCreateEvent ? (
                  <Pressable
                    style={styles.primaryWide}
                    onPress={() => router.push(`/events/create?groupId=${encodeURIComponent(groupId)}` as any)}
                    disabled={busy}
                  >
                    <Text style={styles.primaryWideText}>+ Create event</Text>
                  </Pressable>
                ) : (
                  <Text style={styles.empty}>Only admins/mods can create events.</Text>
                )}

                <View style={styles.filterRow}>
                  {([
                    { key: 'all', label: 'All' },
                    { key: 'training', label: 'Training' },
                    { key: 'social', label: 'Social' },
                    { key: 'race', label: 'Race' },
                    { key: 'meeting', label: 'Meeting' },
                    { key: 'travel', label: 'Travel' },
                    { key: 'other', label: 'Other' },
                  ] as const).map((opt) => (
                    <Chip
                      key={opt.key}
                      label={opt.label}
                      active={eventTypeFilter === opt.key}
                      onPress={() => setEventTypeFilter(opt.key)}
                      disabled={busy}
                    />
                  ))}
                </View>
              </View>
            </GlassCard>

            {eventsLoading ? (
              <GlassCard style={{ marginTop: 12 }}>
                <Text style={styles.empty}>Loading events…</Text>
              </GlassCard>
            ) : null}

            {eventsError ? (
              <GlassCard style={{ marginTop: 12 }}>
                <Text style={styles.empty}>Events backend error.</Text>
                <Text style={styles.errorText}>{eventsError}</Text>
                <Pressable style={styles.retryBtn} onPress={() => void load()} disabled={busy || refreshing}>
                  <Text style={styles.retryText}>{busy || refreshing ? 'Retrying…' : 'Retry'}</Text>
                </Pressable>
              </GlassCard>
            ) : null}

            {!eventsLoading && !eventsError ? (
              <>
                <SectionHeader title="UPCOMING" />
                <GlassCard>
                  {!groupedUpcoming.length ? <Text style={styles.empty}>No upcoming events.</Text> : null}
                  {groupedUpcoming.map((section) => (
                    <View key={`up-${section.key}`} style={styles.eventSection}>
                      <Text style={styles.dateHeader}>{section.label}</Text>
                      <View style={styles.eventList}>
                        {section.rows.map((ev: any) => (
                          <EventCard
                            key={String(ev?.id || Math.random())}
                            event={ev}
                            onPress={() => {
                              const id = String(ev?.id || '').trim();
                              if (!id) return;
                              router.push(`/events/${id}` as any);
                            }}
                            onRsvpPress={() => {
                              const id = String(ev?.id || '').trim();
                              if (!id) return;
                              router.push(`/events/${id}?rsvp=1` as any);
                            }}
                            disabled={busy || !ev?.id}
                          />
                        ))}
                      </View>
                    </View>
                  ))}
                </GlassCard>

                <SectionHeader title="PAST" />
                <GlassCard>
                  {!groupedPast.length ? <Text style={styles.empty}>No past events.</Text> : null}
                  {groupedPast.map((section) => (
                    <View key={`past-${section.key}`} style={styles.eventSection}>
                      <Text style={styles.dateHeader}>{section.label}</Text>
                      <View style={styles.eventList}>
                        {section.rows.map((ev: any) => (
                          <EventCard
                            key={String(ev?.id || Math.random())}
                            event={ev}
                            onPress={() => {
                              const id = String(ev?.id || '').trim();
                              if (!id) return;
                              router.push(`/events/${id}` as any);
                            }}
                            disabled={busy || !ev?.id}
                          />
                        ))}
                      </View>
                    </View>
                  ))}
                </GlassCard>
              </>
            ) : null}
          </>
        ) : null}

        {tab === 'members' ? (
          <>
            <SectionHeader title='MEMBERS' />
            <GlassCard>
              {members.length ? (
                members.slice(0, 200).map((row: any) => (
                  <View key={row.id || row.user_id} style={styles.rowLine}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>{row?.profiles?.display_name || row?.profiles?.username || 'Athlete'}</Text>
                      <Text style={styles.rowSub}>{String(row.role || 'member')}</Text>
                    </View>
                  </View>
                ))
              ) : (
                <Text style={styles.empty}>No members found.</Text>
              )}
              <Pressable
                style={[styles.ghostWide, { marginTop: 12 }]}
                disabled={busy}
                onPress={() =>
                  Alert.alert('Leave group?', 'You can re-join later.', [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Leave',
                      style: 'destructive',
                      onPress: () => void leaveGroupAndExit(),
                    },
                  ])
                }
              >
                <Text style={styles.ghostWideText}>Leave group</Text>
              </Pressable>
            </GlassCard>
          </>
        ) : null}
      </ScrollView>

      <Modal visible={composeOpen} transparent animationType='fade' onRequestClose={() => setComposeOpen(false)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={Keyboard.dismiss} accessible={false} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New group post</Text>
            <TextInput
              value={composeText}
              onChangeText={setComposeText}
              placeholder='Share an update…'
              placeholderTextColor='#7E8E93'
              style={styles.modalInput}
              multiline
              maxLength={320}
              autoFocus
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.modalGhost} onPress={() => setComposeOpen(false)} disabled={busy}>
                <Text style={styles.modalGhostText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.modalPrimary} onPress={() => void submitPost()} disabled={busy}>
                <Text style={styles.modalPrimaryText}>{busy ? 'Posting…' : 'Post'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={challengeOpen} transparent animationType='fade' onRequestClose={() => setChallengeOpen(false)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={Keyboard.dismiss} accessible={false} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Team challenge</Text>
            <TextInput
              value={challengeTitle}
              onChangeText={setChallengeTitle}
              placeholder='Challenge title'
              placeholderTextColor='#7E8E93'
              style={styles.challengeInput}
              maxLength={60}
            />
            <Text style={styles.challengeLabel}>Metric</Text>
            <View style={styles.challengeMetricRow}>
              {([
                ['distance_mi', 'Distance'],
                ['workouts', 'Workouts'],
                ['xp', 'XP'],
              ] as Array<[CustomChallengeMetric, string]>).map(([key, label]) => (
                <Pressable key={key} style={[styles.challengeMetricChip, challengeMetric === key && styles.challengeMetricChipOn]} onPress={() => setChallengeMetric(key)}>
                  <Text style={[styles.challengeMetricChipText, challengeMetric === key && styles.challengeMetricChipTextOn]}>{label}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.challengeInlineRow}>
              <TextInput
                value={challengeTarget}
                onChangeText={setChallengeTarget}
                placeholder='Target'
                placeholderTextColor='#7E8E93'
                style={[styles.challengeInput, styles.challengeInlineInput]}
                keyboardType='decimal-pad'
              />
              <TextInput
                value={challengeDays}
                onChangeText={setChallengeDays}
                placeholder='Days'
                placeholderTextColor='#7E8E93'
                style={[styles.challengeInput, styles.challengeInlineInput]}
                keyboardType='number-pad'
              />
              <TextInput
                value={challengeRewardXp}
                onChangeText={setChallengeRewardXp}
                placeholder='XP'
                placeholderTextColor='#7E8E93'
                style={[styles.challengeInput, styles.challengeInlineInput]}
                keyboardType='number-pad'
              />
            </View>
            <TextInput
              value={challengeNote}
              onChangeText={setChallengeNote}
              placeholder='Optional note'
              placeholderTextColor='#7E8E93'
              style={[styles.challengeInput, styles.challengeNoteInput]}
              multiline
              maxLength={180}
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.modalGhost} onPress={() => setChallengeOpen(false)} disabled={busy}>
                <Text style={styles.modalGhostText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.modalPrimary} onPress={() => void submitCustomChallenge()} disabled={busy}>
                <Text style={styles.modalPrimaryText}>{busy ? 'Sending…' : 'Send challenge'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={Boolean(postOpen)} transparent animationType='fade' onRequestClose={() => setPostOpen(null)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={Keyboard.dismiss} accessible={false} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Post</Text>
            <Text style={styles.postContent}>{String(postOpen?.content || '')}</Text>
            <SectionHeader title='COMMENTS' />
            <View style={{ maxHeight: 260 }}>
              <ScrollView
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                onScrollBeginDrag={Keyboard.dismiss}
              >
                {(comments || []).map((c) => (
                  <View key={c.id} style={styles.commentRow}>
                    <View style={styles.commentHeader}>
                      <Text style={styles.commentAuthor}>{c.profiles?.display_name || c.profiles?.username || 'Athlete'}</Text>
                      {(String(c?.user_id || '') === String(viewerUserId || '') || viewerCanModerateByRole) ? (
                        <Pressable
                          onPress={() =>
                            openMoreActionsMenu(
                              [
                                {
                                  label: 'Delete Comment',
                                  destructive: true,
                                  onPress: () => void deleteComment(c),
                                },
                              ],
                              'Comment actions'
                            )
                          }
                          style={({ pressed }) => [styles.moreBtnSmall, pressed && styles.postRowDisabled]}
                        >
                          <Text style={styles.moreText}>•••</Text>
                        </Pressable>
                      ) : null}
                    </View>
                    <Text style={styles.commentContent}>{String(c.content || '')}</Text>
                  </View>
                ))}
                {commentsLoading ? <Text style={styles.empty}>Loading comments…</Text> : null}
                {commentsError ? (
                  <View style={{ marginTop: 8 }}>
                    <Text style={styles.errorText}>{commentsError}</Text>
                    <Pressable
                      style={styles.retryBtn}
                      onPress={() => {
                        if (!postOpen?.id) return;
                        void loadPostComments(postOpen.id);
                      }}
                      disabled={busy || commentsLoading}
                    >
                      <Text style={styles.retryText}>{commentsLoading ? 'Retrying…' : 'Retry comments'}</Text>
                    </Pressable>
                  </View>
                ) : null}
                {!commentsLoading && !commentsError && comments.length === 0 ? <Text style={styles.empty}>No comments yet.</Text> : null}
              </ScrollView>
            </View>
            <View style={styles.commentComposer}>
              <TextInput
                value={commentText}
                onChangeText={setCommentText}
                placeholder='Add a comment'
                placeholderTextColor='#7E8E93'
                style={styles.commentInput}
              />
              <Pressable style={styles.smallBtn} onPress={() => void submitComment()} disabled={busy || !commentText.trim()}>
                <Text style={styles.smallBtnText}>Send</Text>
              </Pressable>
            </View>
            <Pressable style={styles.modalGhostWide} onPress={() => setPostOpen(null)} disabled={busy}>
              <Text style={styles.modalGhostText}>Close</Text>
            </Pressable>
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
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { minHeight: 44, minWidth: 60, justifyContent: 'center' },
  backText: { color: '#8FDBFF', fontWeight: '800' },
  title: { color: '#FFFFFF', fontWeight: '900', fontSize: 20 },
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
  subtitle: { color: '#9DA8AD', marginTop: 10, fontWeight: '700', marginBottom: 10 },

  tabRow: { flexDirection: 'row', gap: 8, marginTop: 10, marginBottom: 10 },
  tabChip: {
    flex: 1,
    minHeight: 40,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(20,20,20,0.86)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  tabChipOn: { borderColor: '#00D9FF', backgroundColor: 'rgba(0,217,255,0.14)' },
  tabChipText: { color: '#C7C7C7', fontWeight: '900', textAlign: 'center', fontSize: 12 },
  tabChipTextOn: { color: '#EAFBFF' },

  primaryWide: {
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: '#00D9FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  primaryWideText: { color: '#01212A', fontWeight: '900' },
  ghostWide: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostWideText: { color: '#D5D5D5', fontWeight: '900' },

  rowLine: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1B1B1B' },
  rowTitle: { color: '#FFFFFF', fontWeight: '900' },
  rowSub: { color: '#8FA6AE', marginTop: 4, fontWeight: '700', fontSize: 12 },

  postRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1B1B1B' },
  postRowDisabled: { opacity: 0.6 },
  postHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  postHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  postAuthor: { color: '#FFFFFF', fontWeight: '900' },
  postTime: { color: '#8FA6AE', fontWeight: '700', fontSize: 12 },
  moreBtn: {
    minHeight: 26,
    minWidth: 26,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    backgroundColor: '#121212',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  moreBtnSmall: {
    minHeight: 22,
    minWidth: 22,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    backgroundColor: '#121212',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  moreText: { color: '#B7C8CE', fontWeight: '900', fontSize: 10, lineHeight: 10 },
  postContent: { color: '#EAF8FD', marginTop: 8, fontWeight: '700' },
  postMeta: { color: '#8FA6AE', marginTop: 8, fontWeight: '700', fontSize: 12 },
  challengeCard: {
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0,217,255,0.28)',
    backgroundColor: 'rgba(0,217,255,0.08)',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  challengeTitle: { color: '#EAF8FD', fontWeight: '900' },
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

  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  eventSection: { marginTop: 12 },
  dateHeader: { color: '#B4CBD1', fontWeight: '900', fontSize: 12, letterSpacing: 0.8, marginBottom: 10 },
  eventList: { gap: 10 },

  eventRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#1B1B1B' },
  eventBadge: { color: '#8EDFFF', fontWeight: '900', fontSize: 12, marginLeft: 10 },

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

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 16 },
  modalCard: { backgroundColor: '#0F0F0F', borderRadius: 16, borderWidth: 1, borderColor: '#242424', padding: 14 },
  modalTitle: { color: '#FFFFFF', fontWeight: '900', fontSize: 18, marginBottom: 10 },
  modalInput: {
    minHeight: 110,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    backgroundColor: '#111111',
    color: '#EAF8FD',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontWeight: '700',
    textAlignVertical: 'top',
  },
  challengeInput: {
    marginTop: 10,
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    backgroundColor: '#111111',
    color: '#EAF8FD',
    paddingHorizontal: 12,
    fontWeight: '700',
  },
  challengeLabel: { color: '#9DA8AD', marginTop: 10, fontWeight: '800' },
  challengeMetricRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  challengeMetricChip: {
    flex: 1,
    minHeight: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  challengeMetricChipOn: { borderColor: 'rgba(0,217,255,0.34)', backgroundColor: 'rgba(0,217,255,0.14)' },
  challengeMetricChipText: { color: '#D5D5D5', fontWeight: '800', fontSize: 12 },
  challengeMetricChipTextOn: { color: '#BFF3FF' },
  challengeInlineRow: { flexDirection: 'row', gap: 8, marginTop: 2 },
  challengeInlineInput: { flex: 1 },
  challengeNoteInput: { minHeight: 74, textAlignVertical: 'top', paddingVertical: 10 },
  modalActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  modalGhost: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalGhostWide: {
    marginTop: 10,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalGhostText: { color: '#D5D5D5', fontWeight: '900' },
  modalPrimary: { flex: 1, minHeight: 44, borderRadius: 12, backgroundColor: '#00D9FF', alignItems: 'center', justifyContent: 'center' },
  modalPrimaryText: { color: '#01212A', fontWeight: '900' },

  commentRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1B1B1B' },
  commentHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  commentAuthor: { color: '#FFFFFF', fontWeight: '900' },
  commentContent: { color: '#EAF8FD', marginTop: 4, fontWeight: '700' },
  commentComposer: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 12 },
  commentInput: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    backgroundColor: '#111111',
    color: '#EAF8FD',
    paddingHorizontal: 12,
    fontWeight: '700',
  },
  smallBtn: { minHeight: 44, borderRadius: 12, backgroundColor: '#00D9FF', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  smallBtnText: { color: '#01212A', fontWeight: '900' },
});
