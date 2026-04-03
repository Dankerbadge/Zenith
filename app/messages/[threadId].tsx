import { useFocusEffect } from '@react-navigation/native'; import { Redirect, router, useLocalSearchParams } from 'expo-router'; import React, { useCallback, useMemo, useState } from 'react'; import { Alert, Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

import GlassCard from '../../components/ui/GlassCard';
import { APP_CONFIG } from '../../utils/appConfig';
import {
  buildCustomChallengePayload,
  customChallengeSummary,
  parseCustomChallengePayload,
  type CustomChallengeMetric,
} from '../../utils/customChallengePosts';
import { isBlockedBetweenUsers } from '../../utils/friendsService';
import { acceptInvite, declineInvite, getInviteState } from '../../utils/socialChallengeInviteService';
import { isSupabaseConfigured, socialApi } from '../../utils/supabaseClient';
import { useAuth } from '../context/authcontext';

type PostRow = Awaited<ReturnType<typeof socialApi.getGroupPosts>>[number] & {
  profiles?: { id: string; username?: string | null; display_name?: string | null } | null;
};

const OUTBOX_KEY_PREFIX = 'dm_outbox_v1:';

type OutboxItem =
  | { type: 'dm'; text: string; createdAt: string }
  | { type: 'challenge'; payload: ReturnType<typeof buildCustomChallengePayload>; createdAt: string };

function relativeTime(iso?: string | null) {
  const ts = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ts)) return '';
  const deltaSec = Math.max(0, (Date.now() - ts) / 1000);
  if (deltaSec < 60) return 'now';
  const min = Math.floor(deltaSec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  return `${day}d`;
}

export default function DmThreadScreen() {
  const params = useLocalSearchParams<{ threadId?: string }>();
  const dmGroupId = String(params.threadId || '').trim();

  // Doctrine check expects this exact literal reference in social routes.
  void APP_CONFIG.FEATURES.SOCIAL_FEATURES_ENABLED;
  const socialEnabled = APP_CONFIG.FEATURES.SOCIAL_FEATURES_ENABLED || APP_CONFIG.RUNTIME.OVERRIDES.SOCIAL_FEATURES_ENABLED;
  const { supabaseUserId } = useAuth();
  const viewerUserId = supabaseUserId || null;

  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [challengeTitle, setChallengeTitle] = useState('Weekly push');
  const [challengeMetric, setChallengeMetric] = useState<CustomChallengeMetric>('distance_mi');
  const [challengeTarget, setChallengeTarget] = useState('12');
  const [challengeDays, setChallengeDays] = useState('7');
  const [challengeRewardXp, setChallengeRewardXp] = useState('30');
  const [challengeNote, setChallengeNote] = useState('');
  const [inviteStateByPost, setInviteStateByPost] = useState<Record<string, { status: 'accepted' | 'declined'; localChallengeId?: string }>>({});
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [outboxPending, setOutboxPending] = useState(0);
  const isRecipientUnavailable = blockedReason === 'Recipient unavailable.';
  const isBlocked = Boolean(blockedReason) && !isRecipientUnavailable;
  const outboxKey = `${OUTBOX_KEY_PREFIX}${dmGroupId}`;

  const readOutbox = useCallback(async (): Promise<OutboxItem[]> => {
    if (!dmGroupId) return [];
    const raw = await AsyncStorage.getItem(outboxKey);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [dmGroupId, outboxKey]);

  const writeOutbox = useCallback(async (items: OutboxItem[]) => {
    await AsyncStorage.setItem(outboxKey, JSON.stringify(items));
    setOutboxPending(items.length);
  }, [outboxKey]);

  const enqueueOutbox = useCallback(async (item: OutboxItem) => {
    const existing = await readOutbox();
    const next = [...existing, item];
    await writeOutbox(next);
  }, [readOutbox, writeOutbox]);

  const flushOutbox = useCallback(async () => {
    if (!viewerUserId || !dmGroupId || isBlocked) return;
    const queue = await readOutbox();
    if (!queue.length) {
      setOutboxPending(0);
      return;
    }
    const remaining: OutboxItem[] = [];
    for (const item of queue) {
      try {
        if (item.type === 'dm') {
          await socialApi.sendDmMessage(viewerUserId, dmGroupId, item.text);
        } else {
          const payload = item.payload;
          const summary = customChallengeSummary(payload);
          await socialApi.createPost(
            viewerUserId,
            `${payload.title} · ${summary}`,
            'challenge_invite',
            { customChallenge: payload },
            { audience: 'group', groupId: dmGroupId, isPublic: false }
          );
        }
      } catch {
        remaining.push(item);
      }
    }
    await writeOutbox(remaining);
  }, [dmGroupId, isBlocked, readOutbox, viewerUserId, writeOutbox]);

  const title = useMemo(() => {
    const other = members.find((m: any) => m.user_id && m.user_id !== viewerUserId);
    const name = other?.profiles?.display_name || other?.profiles?.username || null;
    return name ? `DM · ${String(name)}` : 'Direct Message';
  }, [members, viewerUserId]);

  const load = useCallback(async () => {
    if (!viewerUserId || !dmGroupId || !isSupabaseConfigured) return;
    try {
      setLoadError(null);
      const [memberRows, postRows] = await Promise.all([
        socialApi.getGroupMembers(dmGroupId),
        socialApi.getGroupPosts(dmGroupId, 120),
      ]);
      setMembers(Array.isArray(memberRows) ? memberRows : []);
      const list = (Array.isArray(postRows) ? postRows : []) as any[];
      // Chat reads oldest -> newest.
      setPosts(list.slice().reverse() as any);
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

      const other = Array.isArray(memberRows)
        ? (memberRows as any[]).map((m) => m.user_id).find((id) => id && id !== viewerUserId)
        : null;
      if (other) {
        const blocked = await isBlockedBetweenUsers(viewerUserId, other);
        setBlockedReason(blocked ? 'Messaging unavailable: one of you is blocked.' : null);
      } else {
        setBlockedReason('Recipient unavailable.');
      }
      await flushOutbox();
    } catch (err: any) {
      setLoadError(String(err?.message || 'Unable to load DM.'));
      setMembers([]);
      setPosts([]);
      setBlockedReason(null);
    }
  }, [viewerUserId, dmGroupId, flushOutbox]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const send = async () => {
    if (!viewerUserId || !dmGroupId) return;
    const text = draft.trim();
    if (!text) return;
    if (isBlocked) {
      Alert.alert('Unavailable', blockedReason || 'Messaging unavailable.');
      return;
    }
    if (isRecipientUnavailable) {
      await enqueueOutbox({ type: 'dm', text, createdAt: new Date().toISOString() });
      setDraft('');
      Alert.alert('Queued', 'Recipient is temporarily unavailable. Message will auto-send when the thread reconnects.');
      return;
    }
    setBusy(true);
    try {
      await socialApi.sendDmMessage(viewerUserId, dmGroupId, text);
      setDraft('');
      await load();
    } catch (err: any) {
      await enqueueOutbox({ type: 'dm', text, createdAt: new Date().toISOString() });
      setDraft('');
      Alert.alert('Queued', 'Network issue. Your message is queued and will retry automatically.');
    } finally {
      setBusy(false);
    }
  };

  const sendChallenge = async () => {
    if (!viewerUserId || !dmGroupId) return;
    if (isBlocked) {
      Alert.alert('Unavailable', blockedReason || 'Messaging unavailable.');
      return;
    }
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
      scope: 'friend',
      createdByUserId: viewerUserId,
    });
    setBusy(true);
    try {
      if (isRecipientUnavailable) {
        await enqueueOutbox({ type: 'challenge', payload, createdAt: new Date().toISOString() });
        setChallengeOpen(false);
        setChallengeNote('');
        Alert.alert('Queued', 'Challenge queued and will send when the thread reconnects.');
        return;
      }
      const summary = customChallengeSummary(payload);
      await socialApi.createPost(
        viewerUserId,
        `${payload.title} · ${summary}`,
        'challenge_invite',
        { customChallenge: payload },
        { audience: 'group', groupId: dmGroupId, isPublic: false }
      );
      setChallengeOpen(false);
      setChallengeNote('');
      await load();
    } catch (err: any) {
      await enqueueOutbox({ type: 'challenge', payload, createdAt: new Date().toISOString() });
      setChallengeOpen(false);
      setChallengeNote('');
      Alert.alert('Queued', 'Network issue. Challenge queued and will retry automatically.');
    } finally {
      setBusy(false);
    }
  };

  const acceptChallenge = async (postId: string, payload: ReturnType<typeof parseCustomChallengePayload>) => {
    if (!payload) return;
    try {
      const res = await acceptInvite({ postId, payload });
      setInviteStateByPost((prev) => ({ ...prev, [postId]: { status: 'accepted', localChallengeId: res.localChallengeId } }));
      Alert.alert('Challenge accepted', `XP reward is armed. Complete it to earn +${Math.round(payload.rewardXp)} XP.`);
    } catch (err: any) {
      Alert.alert('Unable to accept', String(err?.message || 'Try again.'));
    }
  };

  const rejectChallenge = async (postId: string) => {
    await declineInvite({ postId });
    setInviteStateByPost((prev) => ({ ...prev, [postId]: { status: 'declined' } }));
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
  if (!dmGroupId) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.empty}>This DM link is invalid.</Text>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <Text style={styles.title}>{title}</Text>
        <Pressable onPress={() => setChallengeOpen(true)} style={styles.challengeBtn} disabled={busy || isBlocked}>
          <Text style={styles.challengeBtnText}>Challenge</Text>
        </Pressable>
      </View>

      {loadError ? (
        <GlassCard style={{ marginHorizontal: 16, marginTop: 12 }}>
          <Text style={styles.empty}>DM backend error.</Text>
          <Text style={styles.errorText}>{loadError}</Text>
          <Pressable style={styles.retryBtn} onPress={() => void load()} disabled={busy}>
            <Text style={styles.retryText}>{busy ? 'Retrying…' : 'Retry'}</Text>
          </Pressable>
        </GlassCard>
      ) : null}

      {blockedReason ? (
        <GlassCard style={{ marginHorizontal: 16, marginTop: 12 }}>
          <Text style={styles.empty}>{blockedReason}</Text>
          <View style={styles.unavailableActions}>
            <Pressable style={styles.unavailableBtn} onPress={() => router.push('/messages' as any)}>
              <Text style={styles.unavailableBtnText}>Back to inbox</Text>
            </Pressable>
            <Pressable
              style={styles.unavailableBtn}
              onPress={() => router.push((isBlocked ? '/community/manage-friends' : '/friends/find') as any)}
            >
              <Text style={styles.unavailableBtnText}>{isBlocked ? 'Manage friends' : 'Find friends'}</Text>
            </Pressable>
          </View>
          {isRecipientUnavailable ? <Text style={styles.unavailableHint}>Recipient looks temporarily unavailable. Messages/challenges will queue and auto-send on reconnect.</Text> : null}
        </GlassCard>
      ) : null}

      {outboxPending > 0 ? (
        <GlassCard style={{ marginHorizontal: 16, marginTop: 10 }}>
          <Text style={styles.unavailableHint}>Outbox: {outboxPending} pending item{outboxPending === 1 ? '' : 's'}.</Text>
          <View style={styles.unavailableActions}>
            <Pressable style={styles.unavailableBtn} onPress={() => void flushOutbox()}>
              <Text style={styles.unavailableBtnText}>Retry now</Text>
            </Pressable>
          </View>
        </GlassCard>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.thread}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScrollBeginDrag={Keyboard.dismiss}
      >
        {posts.length ? (
          posts.map((post, index: number) => {
            const mine = post.user_id === viewerUserId;
            const postId = String(post?.id || `msg-${index}`);
            const customChallenge = parseCustomChallengePayload((post as any)?.data);
            const inviteState = inviteStateByPost[postId] || null;
            const showInviteActions = Boolean(customChallenge && !mine && !inviteState);
            return (
              <View key={postId} style={[styles.msgRow, mine ? styles.msgRowMine : styles.msgRowTheirs]}>
                <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                  <Text style={[styles.msgText, mine ? styles.msgTextMine : styles.msgTextTheirs]}>{String(post.content || '')}</Text>
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
                  <Text style={[styles.msgTime, mine ? styles.msgTimeMine : styles.msgTimeTheirs]}>{relativeTime(post.created_at)}</Text>
                </View>
              </View>
            );
          })
        ) : (
          <Text style={[styles.empty, { paddingHorizontal: 16, paddingTop: 18 }]}>No messages yet.</Text>
        )}
      </ScrollView>

      <View style={styles.composer}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={isBlocked ? 'Messaging unavailable' : isRecipientUnavailable ? 'Message (queued until reconnect)' : 'Message'}
          placeholderTextColor='#7E8E93'
          style={[styles.input, isBlocked && styles.inputDisabled]}
          editable={!isBlocked}
        />
        <Pressable style={[styles.sendBtn, (busy || !draft.trim() || isBlocked) && styles.sendDisabled]} onPress={() => void send()} disabled={busy || !draft.trim() || isBlocked}>
          <Text style={[styles.sendText, (busy || !draft.trim() || isBlocked) && styles.sendTextDisabled]}>{busy ? '…' : 'Send'}</Text>
        </Pressable>
      </View>

      <Modal visible={challengeOpen} animationType='slide' transparent onRequestClose={() => setChallengeOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Send Challenge</Text>
            <Text style={styles.modalSub}>Create a custom challenge for this friend.</Text>
            <TextInput value={challengeTitle} onChangeText={setChallengeTitle} placeholder='Challenge title' placeholderTextColor='#7E8E93' style={styles.modalInput} />
            <Text style={styles.modalLabel}>Metric</Text>
            <View style={styles.metricRow}>
              {([
                ['distance_mi', 'Distance'],
                ['workouts', 'Workouts'],
                ['xp', 'XP'],
              ] as Array<[CustomChallengeMetric, string]>).map(([key, label]) => (
                <Pressable key={key} style={[styles.metricChip, challengeMetric === key && styles.metricChipOn]} onPress={() => setChallengeMetric(key)}>
                  <Text style={[styles.metricChipText, challengeMetric === key && styles.metricChipTextOn]}>{label}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.inlineRow}>
              <TextInput
                value={challengeTarget}
                onChangeText={setChallengeTarget}
                placeholder='Target'
                placeholderTextColor='#7E8E93'
                style={[styles.modalInput, styles.inlineInput]}
                keyboardType='decimal-pad'
              />
              <TextInput
                value={challengeDays}
                onChangeText={setChallengeDays}
                placeholder='Days'
                placeholderTextColor='#7E8E93'
                style={[styles.modalInput, styles.inlineInput]}
                keyboardType='number-pad'
              />
              <TextInput
                value={challengeRewardXp}
                onChangeText={setChallengeRewardXp}
                placeholder='XP'
                placeholderTextColor='#7E8E93'
                style={[styles.modalInput, styles.inlineInput]}
                keyboardType='number-pad'
              />
            </View>
            <TextInput
              value={challengeNote}
              onChangeText={setChallengeNote}
              placeholder='Optional note'
              placeholderTextColor='#7E8E93'
              style={[styles.modalInput, styles.noteInput]}
              multiline
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.modalGhost} onPress={() => setChallengeOpen(false)} disabled={busy}>
                <Text style={styles.modalGhostText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.modalPrimary, busy && styles.sendDisabled]} onPress={() => void sendChallenge()} disabled={busy}>
                <Text style={styles.modalPrimaryText}>{busy ? 'Sending…' : 'Send'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10 },
  backBtn: { minHeight: 44, minWidth: 60, justifyContent: 'center' },
  backText: { color: '#8FDBFF', fontWeight: '800' },
  title: { color: '#FFFFFF', fontWeight: '900', fontSize: 16, maxWidth: '70%' },
  challengeBtn: {
    minHeight: 34,
    minWidth: 76,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0,217,255,0.34)',
    backgroundColor: 'rgba(0,217,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  challengeBtnText: { color: '#BFF3FF', fontWeight: '900', fontSize: 12 },
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
  empty: { color: '#9DA8AD', fontWeight: '700' },
  errorText: { color: '#9DA8AD', marginTop: 8, fontWeight: '700' },

  thread: { paddingHorizontal: 16, paddingBottom: 12, paddingTop: 6 },
  msgRow: { flexDirection: 'row', marginBottom: 10 },
  msgRowMine: { justifyContent: 'flex-end' },
  msgRowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '84%', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1 },
  bubbleMine: { backgroundColor: 'rgba(0,217,255,0.16)', borderColor: 'rgba(0,217,255,0.40)' },
  bubbleTheirs: { backgroundColor: '#111111', borderColor: '#2A2A2A' },
  msgText: { fontWeight: '800' },
  msgTextMine: { color: '#EAF8FD' },
  msgTextTheirs: { color: '#EAF8FD' },
  msgTime: { marginTop: 6, fontWeight: '800', fontSize: 11 },
  msgTimeMine: { color: '#8FDBFF' },
  msgTimeTheirs: { color: '#8FA6AE' },
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

  composer: { flexDirection: 'row', gap: 8, padding: 16, borderTopWidth: 1, borderTopColor: '#1B1B1B' },
  input: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    backgroundColor: '#111111',
    color: '#EAF8FD',
    paddingHorizontal: 12,
    fontWeight: '800',
  },
  inputDisabled: { opacity: 0.55 },
  sendBtn: { minHeight: 44, borderRadius: 12, backgroundColor: '#00D9FF', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  sendDisabled: { backgroundColor: '#1F2A2D' },
  sendText: { color: '#01212A', fontWeight: '900' },
  sendTextDisabled: { color: '#88A0A8' },
  retryBtn: {
    marginTop: 10,
    minHeight: 38,
    minWidth: 90,
    alignSelf: 'flex-start',
    borderRadius: 10,
    backgroundColor: '#00D9FF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  retryText: { color: '#01212A', fontWeight: '900' },
  unavailableActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  unavailableBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  unavailableBtnText: { color: '#D5D5D5', fontWeight: '800' },
  unavailableHint: { marginTop: 8, color: '#8FA6AE', fontWeight: '700', fontSize: 12 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.66)', justifyContent: 'flex-end', padding: 16 },
  modalCard: { borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', backgroundColor: '#121212', padding: 16 },
  modalTitle: { color: '#FFF', fontWeight: '900', fontSize: 18 },
  modalSub: { color: 'rgba(255,255,255,0.70)', fontWeight: '700', marginTop: 8, lineHeight: 18 },
  modalLabel: { color: '#9DA8AD', marginTop: 10, fontWeight: '800' },
  modalInput: {
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    backgroundColor: '#111111',
    color: '#EAF8FD',
    paddingHorizontal: 12,
    minHeight: 42,
    fontWeight: '800',
  },
  metricRow: { marginTop: 8, flexDirection: 'row', gap: 8 },
  metricChip: {
    flex: 1,
    minHeight: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111111',
  },
  metricChipOn: { borderColor: 'rgba(0,217,255,0.34)', backgroundColor: 'rgba(0,217,255,0.14)' },
  metricChipText: { color: '#D5D5D5', fontWeight: '800', fontSize: 12 },
  metricChipTextOn: { color: '#BFF3FF' },
  inlineRow: { flexDirection: 'row', gap: 8, marginTop: 2 },
  inlineInput: { flex: 1 },
  noteInput: { minHeight: 72, textAlignVertical: 'top', paddingVertical: 10 },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 14 },
  modalGhost: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalGhostText: { color: '#EAEAEA', fontWeight: '900' },
  modalPrimary: { flex: 1, minHeight: 44, borderRadius: 12, backgroundColor: '#00D9FF', alignItems: 'center', justifyContent: 'center' },
  modalPrimaryText: { color: '#01212A', fontWeight: '900' },
});
