import { APP_CONFIG } from './appConfig';
import { getClubDetail, getClubMembership } from './clubsService';
import { getRelationshipStatusForViewer, getSocialSettingsForUser, isBlockedBetweenUsers } from './friendsService';
import { isMessagingRestricted } from './moderationService';
import { isSupabaseConfigured, socialApi, supabase } from './supabaseClient';

const MESSAGE_SCHEMA_VERSION = 2;

export type ThreadType = 'dm' | 'group' | 'club_announcement' | 'club_general';
export type MessageType =
  | 'text'
  | 'system'
  | 'challenge_invite'
  | 'challenge_update'
  | 'event_share'
  | 'club_invite'
  | 'moderation_notice';
export type DeliveryState = 'sent' | 'delivered' | 'read';
export type ClubChannelType = 'club_announcement' | 'club_general';

export type MessageThread = {
  threadId: string;
  threadType: ThreadType;
  participants: string[];
  clubId?: string | null;
  title?: string | null;
  createdAtUtc: string;
  updatedAtUtc: string;
  lastMessageAtUtc: string;
  lastMessageId?: string | null;
  settings: {
    mutedByUserIds: string[];
    pinnedByUserIds: string[];
  };
  schemaVersion: number;
};

export type MessageRecord = {
  messageId: string;
  threadId: string;
  senderUserId: string;
  messageType: MessageType;
  createdAtUtc: string;
  updatedAtUtc: string;
  deliveryStateByUser: Record<string, DeliveryState>;
  contentPayload: {
    text?: string | null;
    inviteRef?: { type: string; id: string } | null;
    sharedEventId?: string | null;
    challengeId?: string | null;
    clubInviteId?: string | null;
    systemMeta?: Record<string, string | number | boolean> | null;
  };
  editPolicy: {
    editable: boolean;
    editedAtUtc?: string | null;
  };
  clientRef?: string;
  schemaVersion: number;
};

const MESSAGE_LIMIT_PER_MIN = 18;
const INVITE_LIMIT_PER_DAY = 20;
const REPEAT_INVITE_COOLDOWN_HOURS = 24;
const OUTBOUND_DM_THRESHOLD_24H = 40;
const MIN_RECIPROCITY_24H = 3;

type GroupRow = {
  id: string;
  kind?: string | null;
  name?: string | null;
  description?: string | null;
  is_public?: boolean | null;
  join_code?: string | null;
  owner_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type GroupMemberRow = {
  id?: string;
  group_id: string;
  user_id: string;
  role?: string | null;
  joined_at?: string | null;
  created_at?: string | null;
};

type PostRow = {
  id: string;
  group_id: string | null;
  user_id: string;
  post_type: string;
  content: string;
  data?: Record<string, any> | null;
  created_at: string;
  updated_at?: string | null;
};

function nowUtcIso() {
  return new Date().toISOString();
}

function socialEnabled() {
  return APP_CONFIG.FEATURES.SOCIAL_FEATURES_ENABLED || APP_CONFIG.RUNTIME.OVERRIDES.SOCIAL_FEATURES_ENABLED;
}

function hasBlockedLink(text: string): boolean {
  return /(https?:\/\/|www\.)/i.test(text);
}

function isUniqueViolation(error: any): boolean {
  const code = String(error?.code || '').trim();
  const message = String(error?.message || '').toLowerCase();
  return code === '23505' || message.includes('unique') || message.includes('duplicate key');
}

function threadTitleForDm(selfUserId: string, participants: string[]) {
  const other = participants.find((id) => id !== selfUserId);
  return other ? `DM: ${other}` : 'Direct Message';
}

function channelTitle(type: ClubChannelType) {
  return type === 'club_announcement' ? 'Announcements' : 'General';
}

function threadTypeFromGroup(group: GroupRow): ThreadType {
  const joinCode = String(group.join_code || '');
  if (joinCode.startsWith('dm:')) return 'dm';
  if (joinCode.startsWith('club:') && joinCode.endsWith(':announcement')) return 'club_announcement';
  if (joinCode.startsWith('club:') && joinCode.endsWith(':general')) return 'club_general';
  return 'group';
}

function clubIdFromJoinCode(joinCode: string | null | undefined): string | null {
  const code = String(joinCode || '');
  if (!code.startsWith('club:')) return null;
  const parts = code.split(':');
  return parts.length >= 3 ? String(parts[1] || '').trim() || null : null;
}

function deliveryStateByUser(participants: string[], senderUserId: string): Record<string, DeliveryState> {
  const out: Record<string, DeliveryState> = {};
  participants.forEach((userId) => {
    out[userId] = userId === senderUserId ? 'sent' : 'delivered';
  });
  return out;
}

function toMessageType(postType: string): MessageType {
  const normalized = String(postType || '').trim();
  if (normalized === 'dm') return 'text';
  if (normalized === 'system') return 'system';
  if (normalized === 'challenge_invite') return 'challenge_invite';
  if (normalized === 'challenge_update') return 'challenge_update';
  if (normalized === 'event_share' || normalized === 'event_chat') return 'event_share';
  if (normalized === 'club_invite') return 'club_invite';
  if (normalized === 'moderation_notice') return 'moderation_notice';
  return 'text';
}

function toPostType(messageType: MessageType, threadType: ThreadType): string {
  if (messageType === 'text') return threadType === 'dm' ? 'dm' : 'group_message';
  return messageType;
}

function toMessageRecord(post: PostRow, thread: MessageThread): MessageRecord {
  const payload = post.data && typeof post.data === 'object' ? post.data : {};
  return {
    messageId: String(post.id || ''),
    threadId: thread.threadId,
    senderUserId: String(post.user_id || ''),
    messageType: toMessageType(post.post_type),
    createdAtUtc: String(post.created_at || nowUtcIso()),
    updatedAtUtc: String(post.updated_at || post.created_at || nowUtcIso()),
    deliveryStateByUser: deliveryStateByUser(thread.participants, String(post.user_id || '')),
    contentPayload: {
      text: typeof post.content === 'string' ? post.content : null,
      inviteRef: payload?.inviteRef || null,
      sharedEventId: payload?.sharedEventId || null,
      challengeId: payload?.challengeId || null,
      clubInviteId: payload?.clubInviteId || null,
      systemMeta: payload?.systemMeta || null,
    },
    editPolicy: {
      editable: toMessageType(post.post_type) === 'text',
      editedAtUtc: null,
    },
    clientRef: typeof payload?.clientRef === 'string' ? payload.clientRef : undefined,
    schemaVersion: MESSAGE_SCHEMA_VERSION,
  };
}

function toThread(input: {
  group: GroupRow;
  members: GroupMemberRow[];
  lastPost?: PostRow | null;
  viewerUserId?: string;
}): MessageThread {
  const { group, members, lastPost, viewerUserId } = input;
  const participants = Array.from(new Set((members || []).map((row) => String(row.user_id || '')).filter(Boolean)));
  const threadType = threadTypeFromGroup(group);
  const createdAt = String(group.created_at || nowUtcIso());
  const updatedAt = String(lastPost?.created_at || group.updated_at || createdAt);
  const lastMessageAtUtc = String(lastPost?.created_at || group.updated_at || createdAt);
  const baseTitle = String(group.name || '').trim();
  const title =
    threadType === 'dm'
      ? threadTitleForDm(String(viewerUserId || participants[0] || ''), participants)
      : baseTitle || (threadType === 'club_announcement' ? 'Announcements' : threadType === 'club_general' ? 'General' : 'Group');

  return {
    threadId: String(group.id || ''),
    threadType,
    participants,
    clubId: threadType === 'club_announcement' || threadType === 'club_general' ? clubIdFromJoinCode(group.join_code) : null,
    title,
    createdAtUtc: createdAt,
    updatedAtUtc: updatedAt,
    lastMessageAtUtc,
    lastMessageId: lastPost?.id || null,
    settings: {
      mutedByUserIds: [],
      pinnedByUserIds: [],
    },
    schemaVersion: MESSAGE_SCHEMA_VERSION,
  };
}

async function getSessionUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

async function canUseSupabaseMessages(expectedUserId?: string): Promise<{ ok: boolean; sessionUserId: string | null; reason?: string }> {
  if (!socialEnabled()) {
    return { ok: false, sessionUserId: null, reason: 'Social is disabled in this build.' };
  }
  if (!isSupabaseConfigured) {
    return { ok: false, sessionUserId: null, reason: 'Cloud sync is required for messaging.' };
  }
  const sessionUserId = await getSessionUserId();
  if (!sessionUserId) {
    return { ok: false, sessionUserId: null, reason: 'Sign in required.' };
  }
  if (expectedUserId && sessionUserId !== expectedUserId) {
    return { ok: false, sessionUserId, reason: 'Active session does not match this account.' };
  }
  return { ok: true, sessionUserId };
}

async function getGroupMembersMap(groupIds: string[]): Promise<Map<string, GroupMemberRow[]>> {
  const map = new Map<string, GroupMemberRow[]>();
  const unique = Array.from(new Set((groupIds || []).filter(Boolean)));
  if (!unique.length) return map;

  const { data, error } = await supabase.from('group_members').select('*').in('group_id', unique);
  if (error) throw error;

  (data || []).forEach((row: any) => {
    const groupId = String(row.group_id || '');
    if (!groupId) return;
    const bucket = map.get(groupId) || [];
    bucket.push(row as GroupMemberRow);
    map.set(groupId, bucket);
  });
  return map;
}

async function getLatestPostsMap(groupIds: string[]): Promise<Map<string, PostRow>> {
  const map = new Map<string, PostRow>();
  const unique = Array.from(new Set((groupIds || []).filter(Boolean)));
  if (!unique.length) return map;

  const limit = Math.max(20, unique.length * 25);
  const { data, error } = await supabase
    .from('posts')
    .select('*')
    .eq('audience', 'group')
    .in('group_id', unique)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  (data || []).forEach((row: any) => {
    const groupId = String(row.group_id || '');
    if (!groupId) return;
    if (!map.has(groupId)) {
      map.set(groupId, row as PostRow);
    }
  });

  return map;
}

async function getThreadFromGroupId(groupId: string, viewerUserId?: string): Promise<MessageThread | null> {
  const [groupRes, memberRes, lastPostsMap] = await Promise.all([
    supabase.from('groups').select('*').eq('id', groupId).maybeSingle(),
    supabase.from('group_members').select('*').eq('group_id', groupId),
    getLatestPostsMap([groupId]),
  ]);
  if (groupRes.error) throw groupRes.error;
  if (memberRes.error) throw memberRes.error;
  if (!groupRes.data) return null;

  return toThread({
    group: groupRes.data as GroupRow,
    members: (memberRes.data || []) as GroupMemberRow[],
    lastPost: lastPostsMap.get(groupId) || null,
    viewerUserId,
  });
}

async function canOpenDmThread(senderId: string, recipientId: string): Promise<{ ok: boolean; reason: string }> {
  if (senderId === recipientId) return { ok: false, reason: 'Cannot message yourself.' };
  const blocked = await isBlockedBetweenUsers(senderId, recipientId);
  if (blocked) return { ok: false, reason: 'Blocked relationship.' };

  const relation = await getRelationshipStatusForViewer(senderId, recipientId);
  if (relation === 'friends') return { ok: true, reason: 'Friends.' };

  const recipientSettings = await getSocialSettingsForUser(recipientId);
  if (recipientSettings.allowDMsFromNonFriends) return { ok: true, reason: 'Recipient allows non-friend DMs.' };

  return { ok: false, reason: 'Recipient only allows DMs from friends.' };
}

async function evaluateRateLimitBackend(input: {
  thread: MessageThread;
  senderUserId: string;
  messageType: MessageType;
}): Promise<{ ok: boolean; reason: string }> {
  const { thread, senderUserId, messageType } = input;
  const now = Date.now();

  if (messageType !== 'system') {
    const oneMinuteAgo = new Date(now - 60_000).toISOString();
    const { count, error } = await supabase
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', senderUserId)
      .gte('created_at', oneMinuteAgo);
    if (error) throw error;
    if (Number(count || 0) >= MESSAGE_LIMIT_PER_MIN) {
      return { ok: false, reason: 'Rate limit: too many messages per minute.' };
    }
  }

  if (thread.threadType === 'dm' && messageType !== 'system') {
    const since24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const dmGroups = await socialApi.getMyDmGroups(senderUserId);
    const dmGroupIds = Array.from(
      new Set(
        (Array.isArray(dmGroups) ? dmGroups : [])
          .map((row: any) => String(row?.group_id || row?.groups?.id || ''))
          .filter(Boolean)
      )
    );

    if (dmGroupIds.length) {
      const { data: posts, error } = await supabase
        .from('posts')
        .select('group_id, user_id, created_at')
        .eq('audience', 'group')
        .in('group_id', dmGroupIds)
        .gte('created_at', since24h)
        .limit(5000);
      if (error) throw error;

      const recent = Array.isArray(posts) ? posts : [];
      const outboundDm24h = recent.filter((row: any) => String(row.user_id || '') === senderUserId).length;
      const inboundDm24h = recent.filter((row: any) => String(row.user_id || '') !== senderUserId).length;

      if (outboundDm24h >= OUTBOUND_DM_THRESHOLD_24H && inboundDm24h <= MIN_RECIPROCITY_24H) {
        return { ok: false, reason: 'DM sending temporarily restricted due to low reciprocity.' };
      }
    }
  }

  if (messageType === 'challenge_invite') {
    const since24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const { count: invitesToday, error: inviteError } = await supabase
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', senderUserId)
      .eq('post_type', 'challenge_invite')
      .gte('created_at', since24h);
    if (inviteError) throw inviteError;

    if (Number(invitesToday || 0) >= INVITE_LIMIT_PER_DAY) {
      return { ok: false, reason: 'Invite limit reached for today.' };
    }

    if (thread.threadType === 'dm') {
      const sinceRepeat = new Date(now - REPEAT_INVITE_COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();
      const { count: pairInvites, error: pairError } = await supabase
        .from('posts')
        .select('id', { count: 'exact', head: true })
        .eq('group_id', thread.threadId)
        .eq('user_id', senderUserId)
        .eq('post_type', 'challenge_invite')
        .gte('created_at', sinceRepeat);
      if (pairError) throw pairError;

      if (Number(pairInvites || 0) > 0) {
        return { ok: false, reason: `Invite already sent recently. Try again in ${REPEAT_INVITE_COOLDOWN_HOURS}h.` };
      }
    }
  }

  return { ok: true, reason: 'Allowed.' };
}

export async function listThreadsForUser(userId: string): Promise<Array<MessageThread & { unreadCount: number }>> {
  const guard = await canUseSupabaseMessages(userId);
  if (!guard.ok) return [];

  const membershipRes = await supabase
    .from('group_members')
    .select(
      `
      group_id,
      role,
      joined_at,
      groups:group_id (
        id, kind, name, description, is_public, join_code, owner_id, created_at, updated_at
      )
    `
    )
    .eq('user_id', userId)
    .order('joined_at', { ascending: false });

  if (membershipRes.error) throw membershipRes.error;
  const rows = Array.isArray(membershipRes.data) ? membershipRes.data : [];

  const groups: GroupRow[] = rows
    .map((row: any) => (Array.isArray(row?.groups) ? row.groups[0] : row?.groups))
    .filter(Boolean) as GroupRow[];

  const groupIds = groups.map((g) => String(g.id || '')).filter(Boolean);
  const [membersMap, latestPosts] = await Promise.all([getGroupMembersMap(groupIds), getLatestPostsMap(groupIds)]);

  const scoped: Array<MessageThread & { unreadCount: number }> = [];

  for (const group of groups) {
    const groupId = String(group.id || '').trim();
    if (!groupId) continue;

    const thread = toThread({
      group,
      members: membersMap.get(groupId) || [],
      lastPost: latestPosts.get(groupId) || null,
      viewerUserId: userId,
    });

    if (thread.threadType === 'dm') {
      const recipient = thread.participants.find((id) => id !== userId);
      if (!recipient) continue;
      const blocked = await isBlockedBetweenUsers(userId, recipient);
      if (blocked) continue;
    }

    if (thread.threadType === 'club_announcement' || thread.threadType === 'club_general') {
      if (!thread.clubId) continue;
      const membership = await getClubMembership(thread.clubId, userId);
      if (membership?.status !== 'active') continue;
    }

    const unreadCount = 0;
    scoped.push({ ...thread, unreadCount });
  }

  return scoped.sort((a, b) => b.lastMessageAtUtc.localeCompare(a.lastMessageAtUtc));
}

export async function getThreadById(threadId: string): Promise<MessageThread | null> {
  const guard = await canUseSupabaseMessages();
  if (!guard.ok) return null;
  return getThreadFromGroupId(threadId);
}

export async function ensureClubChannelThreads(input: {
  clubId: string;
  userId: string;
}): Promise<{ ok: boolean; reason: string; threads: MessageThread[] }> {
  const guard = await canUseSupabaseMessages(input.userId);
  if (!guard.ok) return { ok: false, reason: guard.reason || 'Cloud sync is required for messaging.', threads: [] };

  const membership = await getClubMembership(input.clubId, input.userId);
  if (!membership || membership.status !== 'active') {
    return { ok: false, reason: 'Must be an active member to open club chat.', threads: [] };
  }

  const detail = await getClubDetail(input.clubId);
  if (!detail) {
    return { ok: false, reason: 'Club not found.', threads: [] };
  }

  const required: ClubChannelType[] = ['club_announcement', 'club_general'];
  const createdOrUpdated: MessageThread[] = [];

  for (const type of required) {
    const channelKey = type === 'club_announcement' ? 'announcement' : 'general';
    const joinCode = `club:${input.clubId}:${channelKey}`;

    const existingRes = await supabase.from('groups').select('*').eq('join_code', joinCode).limit(1);
    if (existingRes.error) throw existingRes.error;

    let group = Array.isArray(existingRes.data) && existingRes.data.length ? (existingRes.data[0] as GroupRow) : null;
    if (!group) {
      group = (await socialApi.createGroup(
        input.userId,
        `${detail.club.name} • ${channelTitle(type)}`,
        `${detail.club.name} ${channelTitle(type)} channel`,
        { isPublic: false, joinCode, kind: 'club_channel' }
      )) as GroupRow;
    }

    const membershipInsert = await supabase
      .from('group_members')
      .insert({ group_id: group.id, user_id: input.userId, role: membership.role === 'owner' ? 'owner' : 'member' });
    if (membershipInsert.error && !isUniqueViolation(membershipInsert.error)) {
      throw membershipInsert.error;
    }

    const thread = await getThreadFromGroupId(String(group.id || ''), input.userId);
    if (thread) {
      createdOrUpdated.push(thread);
    }
  }

  return { ok: true, reason: 'Club channels ready.', threads: createdOrUpdated };
}

export async function ensureDmThread(input: {
  requesterUserId: string;
  recipientUserId: string;
}): Promise<{ ok: boolean; reason: string; thread?: MessageThread }> {
  const guard = await canUseSupabaseMessages(input.requesterUserId);
  if (!guard.ok) return { ok: false, reason: guard.reason || 'Cloud sync is required for messaging.' };

  const rule = await canOpenDmThread(input.requesterUserId, input.recipientUserId);
  if (!rule.ok) return { ok: false, reason: rule.reason };

  const group = await socialApi.ensureDmGroup(input.requesterUserId, input.recipientUserId);
  const thread = await getThreadFromGroupId(String((group as any)?.id || ''), input.requesterUserId);
  if (!thread) return { ok: false, reason: 'Unable to load DM thread.' };

  return { ok: true, reason: 'Thread ready.', thread };
}

export async function createGroupThread(input: {
  creatorUserId: string;
  participantUserIds: string[];
  title: string;
}): Promise<{ ok: boolean; reason: string; thread?: MessageThread; bootstrapPending?: boolean }> {
  const guard = await canUseSupabaseMessages(input.creatorUserId);
  if (!guard.ok) return { ok: false, reason: guard.reason || 'Cloud sync is required for messaging.' };

  const title = String(input.title || '').trim();
  if (!title) return { ok: false, reason: 'Group title required.' };

  const participants = Array.from(
    new Set([input.creatorUserId, ...(Array.isArray(input.participantUserIds) ? input.participantUserIds : [])].filter(Boolean))
  );
  if (participants.length < 2) return { ok: false, reason: 'Select at least 1 other member.' };

  const group = (await socialApi.createGroup(input.creatorUserId, title, undefined, {
    isPublic: false,
    kind: 'friend_group',
  })) as GroupRow;

  for (const participantId of participants) {
    if (participantId === input.creatorUserId) continue;
    const insert = await supabase
      .from('group_members')
      .insert({ group_id: group.id, user_id: participantId, role: 'member' });
    if (insert.error && !isUniqueViolation(insert.error)) {
      throw insert.error;
    }
  }

  const thread = await getThreadFromGroupId(String(group.id || ''), input.creatorUserId);
  if (!thread) return { ok: false, reason: 'Unable to load created group.' };

  let bootstrapPending = false;
  let reason = 'Group created.';
  try {
    const bootstrap = await sendMessage({
      threadId: thread.threadId,
      senderUserId: 'system',
      messageType: 'system',
      text: `Group created: ${title}`,
    });
    if (!bootstrap.ok) {
      bootstrapPending = true;
      reason = `Group created. Bootstrap message pending (${bootstrap.reason}).`;
    }
  } catch (error: any) {
    bootstrapPending = true;
    reason = `Group created. Bootstrap message pending (${String(error?.message || 'unknown error')}).`;
  }

  return { ok: true, reason, thread, bootstrapPending };
}

export async function listMessagesForThread(input: {
  threadId: string;
  viewerUserId: string;
  limit?: number;
}): Promise<MessageRecord[]> {
  const guard = await canUseSupabaseMessages(input.viewerUserId);
  if (!guard.ok) return [];

  const thread = await getThreadFromGroupId(input.threadId, input.viewerUserId);
  if (!thread) return [];

  if (thread.threadType === 'dm') {
    const recipient = thread.participants.find((id) => id !== input.viewerUserId);
    if (!recipient) return [];
    const blocked = await isBlockedBetweenUsers(input.viewerUserId, recipient);
    if (blocked) return [];
  }

  if (thread.threadType === 'club_announcement' || thread.threadType === 'club_general') {
    if (!thread.clubId) return [];
    const membership = await getClubMembership(thread.clubId, input.viewerUserId);
    if (membership?.status !== 'active') return [];
  } else if (!thread.participants.includes(input.viewerUserId)) {
    return [];
  }

  const limit = Math.max(1, Number(input.limit) || 100);
  const { data, error } = await supabase
    .from('posts')
    .select('*')
    .eq('audience', 'group')
    .eq('group_id', input.threadId)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;

  return (data || []).map((row: any) => toMessageRecord(row as PostRow, thread));
}

export async function sendMessage(input: {
  threadId: string;
  senderUserId: string;
  messageType: MessageType;
  text?: string;
  clientRef?: string;
  contentPayload?: MessageRecord['contentPayload'];
}): Promise<{ ok: boolean; reason: string; message?: MessageRecord }> {
  const guard = await canUseSupabaseMessages(input.senderUserId === 'system' ? undefined : input.senderUserId);
  if (!guard.ok) return { ok: false, reason: guard.reason || 'Cloud sync is required for messaging.' };

  const thread = await getThreadFromGroupId(input.threadId, guard.sessionUserId || undefined);
  if (!thread) return { ok: false, reason: 'Thread not found.' };

  const isSystemSender = input.senderUserId === 'system' && input.messageType === 'system';
  if (isSystemSender) {
    return { ok: false, reason: 'System sender is not supported in canonical backend path.' };
  }

  if (!thread.participants.includes(input.senderUserId)) {
    return { ok: false, reason: 'Not in thread.' };
  }

  if (await isMessagingRestricted(input.senderUserId)) {
    return { ok: false, reason: 'Messaging is temporarily restricted for this account.' };
  }

  if (thread.threadType === 'dm') {
    const recipient = thread.participants.find((id) => id !== input.senderUserId);
    if (!recipient) return { ok: false, reason: 'Recipient missing.' };
    const blocked = await isBlockedBetweenUsers(input.senderUserId, recipient);
    if (blocked) return { ok: false, reason: 'Blocked relationship.' };
  }

  if (thread.threadType === 'club_announcement' || thread.threadType === 'club_general') {
    if (!thread.clubId) return { ok: false, reason: 'Club thread misconfigured.' };
    const membership = await getClubMembership(thread.clubId, input.senderUserId);
    if (!membership || membership.status !== 'active') {
      return { ok: false, reason: 'Must be an active member to post.' };
    }
    if (membership.mutedInClubChat) {
      return { ok: false, reason: 'Muted in this club chat.' };
    }
    if (thread.threadType === 'club_announcement' && membership.role !== 'owner' && membership.role !== 'admin') {
      return { ok: false, reason: 'Only owner/admin can post announcements.' };
    }
  }

  const rateCheck = await evaluateRateLimitBackend({
    thread,
    senderUserId: input.senderUserId,
    messageType: input.messageType,
  });
  if (!rateCheck.ok) return { ok: false, reason: rateCheck.reason };

  if (input.clientRef) {
    const duplicate = await supabase
      .from('posts')
      .select('*')
      .eq('group_id', input.threadId)
      .eq('user_id', input.senderUserId)
      .contains('data', { clientRef: input.clientRef })
      .limit(1);
    if (duplicate.error) throw duplicate.error;
    const existing = Array.isArray(duplicate.data) && duplicate.data.length ? (duplicate.data[0] as PostRow) : null;
    if (existing) {
      return { ok: true, reason: 'Duplicate send prevented.', message: toMessageRecord(existing, thread) };
    }
  }

  const textBody = String(input.contentPayload?.text || input.text || '');
  if (input.messageType === 'text' && hasBlockedLink(textBody)) {
    return { ok: false, reason: 'Links are disabled in MVP messaging.' };
  }

  const contentPayload = input.contentPayload || { text: input.text || '' };
  const metadataPayload = {
    ...contentPayload,
    clientRef: input.clientRef || null,
    messageType: input.messageType,
  };

  const post = (await socialApi.createPost(
    input.senderUserId,
    textBody,
    toPostType(input.messageType, thread.threadType),
    metadataPayload,
    { audience: 'group', groupId: input.threadId, isPublic: false }
  )) as PostRow;

  const message = toMessageRecord(post, thread);
  return { ok: true, reason: 'Sent.', message };
}

export async function emitSystemMessage(input: {
  threadId: string;
  text: string;
  systemMeta?: Record<string, string | number | boolean>;
}): Promise<{ ok: boolean; reason: string; message?: MessageRecord }> {
  return sendMessage({
    threadId: input.threadId,
    senderUserId: 'system',
    messageType: 'system',
    contentPayload: { text: input.text, systemMeta: input.systemMeta || null },
    clientRef: `system_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
  });
}

export async function markThreadRead(input: { threadId: string; userId: string }): Promise<void> {
  const guard = await canUseSupabaseMessages(input.userId);
  if (!guard.ok) return;

  const thread = await getThreadFromGroupId(input.threadId, input.userId);
  if (!thread) return;

  if (thread.threadType === 'club_announcement' || thread.threadType === 'club_general') {
    if (!thread.clubId) return;
    const membership = await getClubMembership(thread.clubId, input.userId);
    if (membership?.status !== 'active') return;
    return;
  }

  if (!thread.participants.includes(input.userId)) return;
}
