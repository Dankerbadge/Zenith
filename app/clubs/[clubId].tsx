import { useFocusEffect } from '@react-navigation/native'; import { Redirect, useLocalSearchParams, router } from 'expo-router'; import React, { useCallback, useMemo, useState } from 'react'; import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../components/ui/GlassCard';
import SectionHeader from '../../components/ui/SectionHeader';
import { getActivityFeed, type ActivityFeedEvent } from '../../utils/activityFeedService';
import {
  createClubChallenge,
  listClubChallengeViews,
  setClubChallengeAcceptance,
  syncClubChallengeCompletionEvents,
  type ClubChallengeView,
} from '../../utils/clubChallengesService';
import { ensureClubChannelThreads } from '../../utils/messageService';
import {
  createClubEvent,
  listClubEventViews,
  setClubEventRsvp,
  type ClubEventRsvpStatus,
  type ClubEventView,
} from '../../utils/clubEventsService';
import { refreshChallengeProgressForUser } from '../../utils/challengeService';
import { getClubAggregateMetrics, type ClubAggregateMetrics, type ClubAnalyticsWindow } from '../../utils/clubAnalyticsService';
import {
  acceptClubInvite,
  approveJoinRequest,
  type ClubRecord,
  declineJoinRequest,
  getClubDetail,
  getClubMembership,
  inviteToClub,
  removeClubMember,
  rotateInviteLinkToken,
  setClubChatMute,
  setClubMemberRole,
  transferClubOwnership,
  type ClubMembership,
  type ClubRole,
} from '../../utils/clubsService';
import { createReport } from '../../utils/moderationService';
import { APP_CONFIG } from '../../utils/appConfig';
import { useAuth } from '../context/authcontext';

const CLUB_FEED_PAGE_SIZE = 10;

export default function ClubDetailScreen() {
  const { supabaseUserId } = useAuth();
  const viewerUserId = String(supabaseUserId || '').trim();
  const socialEnabled = APP_CONFIG.FEATURES.SOCIAL_FEATURES_ENABLED || APP_CONFIG.RUNTIME.OVERRIDES.SOCIAL_FEATURES_ENABLED;
  const { clubId } = useLocalSearchParams<{ clubId: string }>();
  const [club, setClub] = useState<ClubRecord | null>(null);
  const [members, setMembers] = useState<ClubMembership[]>([]);
  const [myMembership, setMyMembership] = useState<ClubMembership | null>(null);
  const [feed, setFeed] = useState<ActivityFeedEvent[]>([]);
  const [feedPage, setFeedPage] = useState(1);
  const [hasMoreFeed, setHasMoreFeed] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [clubChallenges, setClubChallenges] = useState<ClubChallengeView[]>([]);
  const [clubEvents, setClubEvents] = useState<ClubEventView[]>([]);
  const [analyticsWindow, setAnalyticsWindow] = useState<ClubAnalyticsWindow>('weekly');
  const [analytics, setAnalytics] = useState<ClubAggregateMetrics | null>(null);

  const load = useCallback(async (page = 1, mode: 'replace' | 'append' = 'replace') => {
    if (!clubId || !viewerUserId) {
      setClub(null);
      setMembers([]);
      setMyMembership(null);
      setFeed([]);
      setClubChallenges([]);
      setClubEvents([]);
      setAnalytics(null);
      return;
    }
    if (mode === 'replace') {
      await refreshChallengeProgressForUser(viewerUserId);
      await syncClubChallengeCompletionEvents({ clubId });
    }
    const [detail, mine, feedRows] = await Promise.all([
      getClubDetail(clubId),
      getClubMembership(clubId, viewerUserId),
      getActivityFeed({ userId: viewerUserId, scope: 'club', clubId, page, pageSize: CLUB_FEED_PAGE_SIZE }),
    ]);
    if (!detail) {
      router.back();
      return;
    }
    setClub(detail.club);
    setMembers(detail.memberships);
    setMyMembership(mine);
    setFeedPage(page);
    setHasMoreFeed(feedRows.length === CLUB_FEED_PAGE_SIZE);
    setFeed((prev) =>
      mode === 'append' ? [...prev, ...feedRows.filter((row) => !prev.some((existing) => existing.id === row.id))] : feedRows
    );
    const challengeRows = await listClubChallengeViews({ clubId, userId: viewerUserId });
    setClubChallenges(challengeRows);
    const eventRows = await listClubEventViews({ clubId, userId: viewerUserId });
    setClubEvents(eventRows);
    const metrics = await getClubAggregateMetrics({
      clubId,
      userId: viewerUserId,
      windowType: analyticsWindow,
    });
    setAnalytics(metrics);
  }, [clubId, viewerUserId, analyticsWindow]);

  useFocusEffect(
    useCallback(() => {
      void load(1, 'replace');
      const interval = setInterval(() => {
        void load(1, 'replace');
      }, 75_000);
      return () => clearInterval(interval);
    }, [load])
  );

  const activeMembers = useMemo(() => members.filter((m) => m.status === 'active'), [members]);
  const invitedMembers = useMemo(() => members.filter((m) => m.status === 'invited'), [members]);
  const pendingRequests = useMemo(() => members.filter((m) => m.status === 'pending_request'), [members]);

  const canManage = myMembership?.role === 'owner' || myMembership?.role === 'admin';
  const canTransfer = myMembership?.role === 'owner';
  const canModerate = myMembership?.role === 'owner' || myMembership?.role === 'admin' || myMembership?.role === 'moderator';

  const inviteDemoMember = async () => {
    if (!clubId || !canManage) return;
    const candidates = ['user_aria', 'user_miles', 'user_nova', 'user_zen'].filter((id) => id !== viewerUserId);
    const target = candidates.find((id) => !members.some((m) => m.userId === id && (m.status === 'active' || m.status === 'invited')));
    if (!target) {
      Alert.alert('Invite', 'No demo users left to invite.');
      return;
    }
    const result = await inviteToClub({ actorUserId: viewerUserId, clubId, targetUserId: target });
    if (!result.ok) {
      Alert.alert('Invite failed', result.reason);
      return;
    }
    await load();
  };

  const changeRole = async (targetUserId: string, nextRole: ClubRole) => {
    if (!clubId) return;
    const result = await setClubMemberRole({
      actorUserId: viewerUserId,
      clubId,
      targetUserId,
      nextRole,
    });
    if (!result.ok) {
      Alert.alert('Role update failed', result.reason);
      return;
    }
    await load();
  };

  const transfer = async (targetUserId: string) => {
    if (!clubId) return;
    const result = await transferClubOwnership({
      actorUserId: viewerUserId,
      clubId,
      newOwnerUserId: targetUserId,
    });
    if (!result.ok) {
      Alert.alert('Transfer failed', result.reason);
      return;
    }
    await load();
  };

  const remove = async (targetUserId: string) => {
    if (!clubId) return;
    const result = await removeClubMember({
      actorUserId: viewerUserId,
      clubId,
      targetUserId,
    });
    if (!result.ok) {
      Alert.alert('Remove failed', result.reason);
      return;
    }
    await load();
  };

  const ban = async (targetUserId: string) => {
    if (!clubId) return;
    const result = await removeClubMember({
      actorUserId: viewerUserId,
      clubId,
      targetUserId,
      ban: true,
    });
    if (!result.ok) {
      Alert.alert('Ban failed', result.reason);
      return;
    }
    await load();
  };

  const toggleMute = async (targetUserId: string, muted: boolean) => {
    if (!clubId) return;
    const result = await setClubChatMute({
      actorUserId: viewerUserId,
      clubId,
      targetUserId,
      muted,
    });
    if (!result.ok) {
      Alert.alert('Mute failed', result.reason);
      return;
    }
    await load();
  };

  const reportMember = async (targetUserId: string) => {
    if (!clubId) return;
    await createReport({
      reporterUserId: viewerUserId,
      targetType: 'user',
      targetId: targetUserId,
      reasonCategory: 'club_misconduct',
      contextClubId: clubId,
      description: 'Reported from club member management.',
    });
    Alert.alert('Report submitted', 'Club moderation report created.');
  };

  const acceptInvite = async () => {
    if (!clubId) return;
    const result = await acceptClubInvite({ clubId, userId: viewerUserId });
    if (!result.ok) {
      Alert.alert('Join failed', result.reason);
      return;
    }
    await load();
  };

  const approveRequest = async (targetUserId: string) => {
    if (!clubId) return;
    const result = await approveJoinRequest({
      actorUserId: viewerUserId,
      clubId,
      targetUserId,
    });
    if (!result.ok) {
      Alert.alert('Approval failed', result.reason);
      return;
    }
    await load();
  };

  const declineRequest = async (targetUserId: string) => {
    if (!clubId) return;
    const result = await declineJoinRequest({
      actorUserId: viewerUserId,
      clubId,
      targetUserId,
    });
    if (!result.ok) {
      Alert.alert('Decline failed', result.reason);
      return;
    }
    await load();
  };

  const rotateToken = async () => {
    if (!clubId) return;
    const result = await rotateInviteLinkToken({
      actorUserId: viewerUserId,
      clubId,
    });
    if (!result.ok) {
      Alert.alert('Rotate failed', result.reason);
      return;
    }
    Alert.alert('Invite token rotated', `New token: ${result.token}`);
    await load();
  };

  const createChallenge = async () => {
    if (!clubId) return;
    const result = await createClubChallenge({
      clubId,
      createdByUserId: viewerUserId,
      title: 'Club Challenge: One Qualifying Run',
      participationMode: 'invite_members',
      leaderboardMode: 'completion_only',
    });
    if (!result) return;
    await load();
  };

  const openClubChat = async () => {
    if (!clubId) return;
    const result = await ensureClubChannelThreads({ clubId, userId: viewerUserId });
    if (!result.ok) {
      Alert.alert('Chat unavailable', result.reason);
      return;
    }
    router.push('/messages' as any);
  };

  const respondChallenge = async (clubChallengeId: string, decision: 'accepted' | 'declined') => {
    const result = await setClubChallengeAcceptance({
      clubChallengeId,
      userId: viewerUserId,
      acceptanceStatus: decision,
    });
    if (!result.ok) {
      Alert.alert('Challenge', result.reason);
      return;
    }
    await load();
  };

  const createEvent = async (spawnChallenge: boolean) => {
    if (!clubId || !club) return;
    const start = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const result = await createClubEvent({
      clubId,
      actorUserId: viewerUserId,
      title: 'Group Run Session',
      description: 'Meet up and log together.',
      startTimeUtc: start,
      durationSec: 45 * 60,
      locationText: club.settings.locationHint || 'Location not set',
      spawnChallenge,
    });
    if (!result.ok) {
      Alert.alert('Event', result.reason);
      return;
    }
    await load();
  };

  const setRsvp = async (clubEventId: string, status: ClubEventRsvpStatus) => {
    const result = await setClubEventRsvp({
      clubEventId,
      userId: viewerUserId,
      status,
    });
    if (!result.ok) {
      Alert.alert('RSVP', result.reason);
      return;
    }
    await load();
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await load(1, 'replace');
    } finally {
      setRefreshing(false);
    }
  };

  const loadMoreFeed = async () => {
    if (!hasMoreFeed || refreshing) return;
    await load(feedPage + 1, 'append');
  };

  if (!socialEnabled) {
    return <Redirect href='/(tabs)/profile' />;
  }

  if (!viewerUserId) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}><Text style={styles.empty}>Sign in to view clubs.</Text></View>
      </SafeAreaView>
    );
  }

  if (!club) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}><Text style={styles.empty}>Loading club...</Text></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor='#8FDBFF' />}
      >
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.back}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Club</Text>
          <View style={{ width: 40 }} />
        </View>

        <GlassCard>
          <Text style={styles.clubName}>{club.name}</Text>
          <Text style={styles.clubMeta}>{club.visibilityMode.replace(/_/g, ' ')}</Text>
          {!!club.description && <Text style={styles.desc}>{club.description}</Text>}
          <Text style={styles.clubMeta}>My role: {myMembership?.role || 'none'} ({myMembership?.status || 'not joined'})</Text>
          <Text style={styles.clubMeta}>Invite token: {club.settings.inviteLinkToken || 'disabled'}</Text>
          {myMembership?.status === 'active' ? (
            <Pressable style={styles.actionBtn} onPress={() => void openClubChat()}>
              <Text style={styles.actionText}>Open Club Chat</Text>
            </Pressable>
          ) : null}
          {myMembership?.status === 'invited' ? (
            <Pressable style={styles.actionBtn} onPress={() => void acceptInvite()}>
              <Text style={styles.actionText}>Accept Invite</Text>
            </Pressable>
          ) : null}
          {canManage ? (
            <Pressable style={styles.actionBtn} onPress={() => void rotateToken()}>
              <Text style={styles.actionText}>Rotate Invite Token</Text>
            </Pressable>
          ) : null}
        </GlassCard>

        <SectionHeader title='MEMBERS' />
        <GlassCard>
          {activeMembers.length ? (
            activeMembers.map((member) => (
              <View key={member.membershipId} style={styles.memberRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.memberName}>{member.userId}</Text>
                  <Text style={styles.memberMeta}>{member.role}{member.mutedInClubChat ? ' • muted in chat' : ''}</Text>
                </View>
                {canManage && member.userId !== viewerUserId ? (
                  <View style={styles.inlineActions}>
                    <Pressable style={styles.smallBtn} onPress={() => void changeRole(member.userId, member.role === 'member' ? 'moderator' : 'member')}>
                      <Text style={styles.smallText}>{member.role === 'member' ? 'Promote' : 'Demote'}</Text>
                    </Pressable>
                    <Pressable style={styles.smallBtn} onPress={() => void remove(member.userId)}>
                      <Text style={styles.smallText}>Remove</Text>
                    </Pressable>
                    <Pressable style={styles.smallBtn} onPress={() => void ban(member.userId)}>
                      <Text style={styles.smallText}>Ban</Text>
                    </Pressable>
                    <Pressable style={styles.smallBtn} onPress={() => void toggleMute(member.userId, !member.mutedInClubChat)}>
                      <Text style={styles.smallText}>{member.mutedInClubChat ? 'Unmute' : 'Mute'}</Text>
                    </Pressable>
                    <Pressable style={styles.smallBtn} onPress={() => void reportMember(member.userId)}>
                      <Text style={styles.smallText}>Report</Text>
                    </Pressable>
                    {canTransfer ? (
                      <Pressable
                        style={styles.smallBtn}
                        onPress={() =>
                          Alert.alert('Transfer ownership?', `Transfer ownership to ${member.userId}?`, [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Transfer', onPress: () => void transfer(member.userId) },
                          ])
                        }
                      >
                        <Text style={styles.smallText}>Owner</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : canModerate && member.userId !== viewerUserId ? (
                  <View style={styles.inlineActions}>
                    <Pressable style={styles.smallBtn} onPress={() => void toggleMute(member.userId, !member.mutedInClubChat)}>
                      <Text style={styles.smallText}>{member.mutedInClubChat ? 'Unmute' : 'Mute'}</Text>
                    </Pressable>
                    <Pressable style={styles.smallBtn} onPress={() => void reportMember(member.userId)}>
                      <Text style={styles.smallText}>Report</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ))
          ) : (
            <Text style={styles.empty}>No active members.</Text>
          )}
        </GlassCard>

        <SectionHeader title='JOIN REQUESTS' />
        <GlassCard>
          {pendingRequests.length ? (
            pendingRequests.map((member) => (
              <View key={member.membershipId} style={styles.memberRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.memberName}>{member.userId}</Text>
                  <Text style={styles.memberMeta}>requested</Text>
                </View>
                {canManage ? (
                  <View style={styles.inlineActions}>
                    <Pressable style={styles.smallBtn} onPress={() => void approveRequest(member.userId)}>
                      <Text style={styles.smallText}>Approve</Text>
                    </Pressable>
                    <Pressable style={styles.smallBtn} onPress={() => void declineRequest(member.userId)}>
                      <Text style={styles.smallText}>Decline</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ))
          ) : (
            <Text style={styles.empty}>No pending requests.</Text>
          )}
        </GlassCard>

        <SectionHeader title='INVITED' />
        <GlassCard>
          {invitedMembers.length ? (
            invitedMembers.map((member) => (
              <View key={member.membershipId} style={styles.memberRow}>
                <Text style={styles.memberName}>{member.userId}</Text>
                <Text style={styles.memberMeta}>invited</Text>
              </View>
            ))
          ) : (
            <Text style={styles.empty}>No pending invites.</Text>
          )}
          {__DEV__ && canManage ? (
            <Pressable style={styles.actionBtn} onPress={() => void inviteDemoMember()}>
              <Text style={styles.actionText}>Invite Demo Member</Text>
            </Pressable>
          ) : null}
        </GlassCard>

        <SectionHeader title='CLUB FEED' />
        <GlassCard>
          {feed.length ? (
            feed.map((item) => (
              <View key={item.id} style={styles.feedRow}>
                <Text style={styles.feedIcon}>{iconForEvent(item.type)}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.memberName}>{item.title}</Text>
                  <Text style={styles.memberMeta}>{item.subtitle}</Text>
                </View>
                <Text style={styles.memberMeta}>{relativeTime(item.timestampUtc)}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.empty}>No club events yet.</Text>
          )}
          {hasMoreFeed && feed.length > 0 ? (
            <Pressable style={styles.smallLoadMore} onPress={() => void loadMoreFeed()}>
              <Text style={styles.smallLoadMoreText}>Load more feed</Text>
            </Pressable>
          ) : null}
        </GlassCard>

        <SectionHeader title='CLUB CHALLENGES' />
        <GlassCard>
          {clubChallenges.length ? (
            clubChallenges.map((row) => (
              <View key={row.record.clubChallengeId} style={styles.challengeRow}>
                <Text style={styles.memberName}>{row.title}</Text>
                <Text style={styles.memberMeta}>Ends {row.endTimeUtc || 'n/a'}</Text>
                <Text style={styles.memberMeta}>
                  Accepted {row.participantsAccepted} • Completed {row.participantsCompleted}
                </Text>
                <Text style={styles.memberMeta}>My status: {row.myAcceptanceStatus} / {row.myOutcomeStatus}</Text>
                <Text style={styles.memberMeta}>Reward +{row.rewardXp} XP · Penalty -{row.penaltyXp} XP</Text>
                {row.myAcceptanceStatus === 'pending' || row.myAcceptanceStatus === 'not_invited' ? (
                  <View style={styles.inlineActions}>
                    <Pressable style={styles.smallBtn} onPress={() => void respondChallenge(row.record.clubChallengeId, 'accepted')}>
                      <Text style={styles.smallText}>Accept</Text>
                    </Pressable>
                    <Pressable style={styles.smallBtn} onPress={() => void respondChallenge(row.record.clubChallengeId, 'declined')}>
                      <Text style={styles.smallText}>Decline</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ))
          ) : (
            <Text style={styles.empty}>No club challenges yet.</Text>
          )}
          {canManage ? (
            <Pressable style={styles.actionBtn} onPress={() => void createChallenge()}>
              <Text style={styles.actionText}>Create Club Challenge</Text>
            </Pressable>
          ) : null}
        </GlassCard>

        <SectionHeader title='CLUB EVENTS' />
        <GlassCard>
          {clubEvents.length ? (
            clubEvents.map((row) => (
              <View key={row.event.clubEventId} style={styles.challengeRow}>
                <Text style={styles.memberName}>{row.event.title}</Text>
                <Text style={styles.memberMeta}>Starts {row.event.startTimeUtc}</Text>
                {!!row.event.locationText && <Text style={styles.memberMeta}>Location: {row.event.locationText}</Text>}
                <Text style={styles.memberMeta}>
                  Going {row.counts.going} • Maybe {row.counts.maybe} • No {row.counts.not_going}
                </Text>
                <Text style={styles.memberMeta}>My RSVP: {row.myRsvp || 'none'}</Text>
                <View style={styles.inlineActions}>
                  <Pressable style={styles.smallBtn} onPress={() => void setRsvp(row.event.clubEventId, 'going')}>
                    <Text style={styles.smallText}>Going</Text>
                  </Pressable>
                  <Pressable style={styles.smallBtn} onPress={() => void setRsvp(row.event.clubEventId, 'maybe')}>
                    <Text style={styles.smallText}>Maybe</Text>
                  </Pressable>
                  <Pressable style={styles.smallBtn} onPress={() => void setRsvp(row.event.clubEventId, 'not_going')}>
                    <Text style={styles.smallText}>No</Text>
                  </Pressable>
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.empty}>No club events yet.</Text>
          )}
          {canManage ? (
            <View style={styles.inlineActions}>
              <Pressable style={styles.actionBtn} onPress={() => void createEvent(false)}>
                <Text style={styles.actionText}>Create Event</Text>
              </Pressable>
              <Pressable style={styles.actionBtn} onPress={() => void createEvent(true)}>
                <Text style={styles.actionText}>Create Event + Challenge</Text>
              </Pressable>
            </View>
          ) : null}
        </GlassCard>

        <SectionHeader title='CLUB ANALYTICS' />
        <GlassCard>
          <View style={styles.inlineActions}>
            {(['daily', 'weekly', 'monthly'] as const).map((w) => (
              <Pressable
                key={w}
                style={[styles.smallBtn, analyticsWindow === w && styles.smallBtnActive]}
                onPress={() => setAnalyticsWindow(w)}
              >
                <Text style={[styles.smallText, analyticsWindow === w && styles.smallTextActive]}>{w}</Text>
              </Pressable>
            ))}
          </View>
          {analytics ? (
            <View style={{ marginTop: 10, gap: 4 }}>
              <Text style={styles.memberMeta}>Window: {analytics.windowStartDateKey} → {analytics.windowEndDateKey}</Text>
              <Text style={styles.memberMeta}>Runs: {analytics.totals.totalRuns}</Text>
              <Text style={styles.memberMeta}>Distance: {(analytics.totals.totalDistanceMeters / 1609.344).toFixed(2)} mi</Text>
              <Text style={styles.memberMeta}>Time: {Math.round(analytics.totals.totalElapsedTimeSec / 60)} min</Text>
              <Text style={styles.memberMeta}>Winning day proxy: {analytics.totals.totalWinningDays}</Text>
              <Text style={styles.memberMeta}>Unique participants: {analytics.totals.uniqueParticipantsCount}</Text>
              <Text style={styles.memberMeta}>
                Challenges completed: {analytics.totals.challengesCompletedCount} / accepted {analytics.totals.challengesParticipationCount}
              </Text>
              <Text style={styles.memberMeta}>Participation rate: {analytics.derived.participationRatePercent}%</Text>
              <Text style={styles.memberMeta}>Avg runs per participant: {analytics.derived.avgRunsPerParticipant}</Text>
            </View>
          ) : (
            <Text style={styles.empty}>No analytics yet.</Text>
          )}
        </GlassCard>
      </ScrollView>
    </SafeAreaView>
  );
}

function iconForEvent(type: ActivityFeedEvent['type']) {
  if (type === 'run_completed') return '🏃';
  if (type === 'route_pr' || type === 'segment_pr') return '⚡';
  if (type === 'challenge_completed' || type === 'club_challenge_completed') return '🎯';
  if (type === 'club_joined') return '👥';
  if (type === 'club_left') return '↩️';
  if (type === 'rank_up') return '🏆';
  if (type === 'streak_milestone' || type === 'winning_day_milestone') return '🔥';
  return '•';
}

function relativeTime(iso: string) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diffSec < 60) return 'now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  return `${Math.floor(diffSec / 86400)}d`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  content: { padding: 16, paddingBottom: 30 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { color: '#7EDCFF', fontWeight: '700' },
  title: { color: '#FFF', fontWeight: '900', fontSize: 22 },
  clubName: { color: '#FFF', fontWeight: '900', fontSize: 20 },
  clubMeta: { color: '#95AFB8', fontWeight: '700', marginTop: 4 },
  desc: { color: '#C9D6DA', marginTop: 8, fontWeight: '600' },
  memberRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1F1F1F' },
  memberName: { color: '#FFF', fontWeight: '800' },
  memberMeta: { color: '#95AFB8', marginTop: 2, fontSize: 12 },
  empty: { color: '#95AFB8', fontWeight: '600' },
  actionBtn: {
    marginTop: 12,
    minHeight: 42,
    borderRadius: 10,
    backgroundColor: '#00D9FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: { color: '#01222B', fontWeight: '900' },
  inlineActions: { flexDirection: 'row', gap: 8, marginTop: 6, flexWrap: 'wrap' },
  feedRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  feedIcon: { fontSize: 16, width: 20, textAlign: 'center' },
  challengeRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1F1F1F' },
  smallBtn: {
    minHeight: 30,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#3A3A3A',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  smallBtnActive: {
    borderColor: '#00D9FF',
    backgroundColor: 'rgba(0,217,255,0.14)',
  },
  smallText: { color: '#D4D4D4', fontWeight: '700', fontSize: 12 },
  smallTextActive: { color: '#EAFBFF' },
  smallLoadMore: {
    marginTop: 8,
    minHeight: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#3A3A3A',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  smallLoadMoreText: { color: '#CFEAF3', fontSize: 12, fontWeight: '700' },
});
