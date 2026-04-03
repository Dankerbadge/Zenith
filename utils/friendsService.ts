import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Visibility } from './canonicalRunningSchema';
import { APP_CONFIG } from './appConfig';
import { isSupabaseConfigured, supabase } from './supabaseClient';

const FRIENDS_STATE_KEY = 'friendsStateV1';
const FRIENDS_SCHEMA_VERSION = 2;
const FRIEND_REQUEST_AUDIT_KEY = 'friendRequestAuditV1';
const FRIEND_SEARCH_RECENTS_KEY = 'friendSearchRecentsV1';
const FRIEND_MUTES_KEY = 'friendMutesV1';

const FRIEND_REQUESTS_PER_DAY_LIMIT = 40;
const FRIEND_REQUEST_REPEAT_COOLDOWN_HOURS = 12;
const FRIEND_REQUEST_DECLINE_COOLDOWN_DAYS = 3;

export type FriendRequestPolicy = 'everyone' | 'friends_of_friends' | 'nobody';
export type RelationshipStatus = 'none' | 'outgoing_request' | 'incoming_request' | 'friends' | 'blocked';

export type SocialSettings = {
  userId: string;
  defaultVisibility: Visibility;
  allowFriendRequestsFrom: FriendRequestPolicy;
  discoverableByUsername: boolean;
  allowDMsFromNonFriends: boolean;
  allowPublicDiscoveryFeed: boolean;
  friendInviteEnabled?: boolean;
  friendInviteToken?: string | null;
  friendInviteExpiresAtUtc?: string | null;
  autoAcceptInviteLinks?: boolean;
  notificationPrefs: {
    friendRequests: boolean;
    challengeInvites: boolean;
    clubInvites: boolean;
    dmMessages: boolean;
    reactions: boolean;
    clubAnnouncements: boolean;
    clubGeneral: boolean;
  };
  createdAtUtc: string;
  updatedAtUtc: string;
  schemaVersion: number;
};

export type FriendPrivacy = {
  profileVisibility: Visibility;
  activityVisibility: Visibility;
  allowFriendRequests: FriendRequestPolicy;
};

export type FriendProfile = {
  userId: string;
  displayName: string;
  handle: string;
  sportTags: string[];
  privacy: FriendPrivacy;
  createdAtUtc: string;
  updatedAtUtc: string;
};

type CanonicalRelationshipState = 'none' | 'outgoing_request' | 'friends' | 'blocked';

export type SocialRelationship = {
  relationshipId: string;
  userAId: string;
  userBId: string;
  status: CanonicalRelationshipState;
  requestedByUserId: string | null;
  requestedAtUtc: string | null;
  respondedAtUtc: string | null;
  friendsSinceUtc: string | null;
  blockedByUserId: string | null;
  blockedAtUtc: string | null;
  mutedByA: boolean;
  mutedByB: boolean;
  createdAtUtc: string;
  updatedAtUtc: string;
  schemaVersion: number;
};

type FriendsState = {
  schemaVersion: number;
  profiles: FriendProfile[];
  socialSettings: SocialSettings[];
  relationships: SocialRelationship[];
};

export type FriendSuggestion = {
  profile: FriendProfile;
  canAdd: boolean;
  reason: string;
};

export type CommunityView = {
  me: FriendProfile;
  settings: SocialSettings;
  incoming: Array<{ relationship: SocialRelationship; profile: FriendProfile }>;
  outgoing: Array<{ relationship: SocialRelationship; profile: FriendProfile }>;
  friends: Array<{ relationship: SocialRelationship; profile: FriendProfile; muted: boolean }>;
  blocked: Array<{ relationship: SocialRelationship; profile: FriendProfile }>;
  suggestions: FriendSuggestion[];
};

type FriendRequestAudit = {
  atUtc: string;
  requesterId: string;
  targetId: string;
  action: 'sent' | 'declined' | 'accepted' | 'blocked';
};

export type FriendSearchResult = {
  profile: FriendProfile;
  relationshipId?: string;
  relationshipStatus: RelationshipStatus;
  actionEnabled: boolean;
  actionLabel: 'Add' | 'Requested' | 'Accept' | 'Friends' | 'Unavailable';
  reason: string;
};

function nowUtcIso() {
  return new Date().toISOString();
}

type SupabaseProfileRow = {
  id: string;
  username?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type SupabaseFriendshipRow = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: 'pending' | 'accepted' | 'blocked';
  created_at: string;
  updated_at: string;
};

function toFriendProfile(row: SupabaseProfileRow): FriendProfile {
  const displayName = String(row.display_name || '').trim() || String(row.username || '').trim() || 'Athlete';
  const handleBase = String(row.username || '').trim();
  const handle = handleBase ? `@${handleBase.replace(/^@/, '')}` : `@${row.id.slice(0, 8)}`;
  const createdAtUtc = row.created_at || nowUtcIso();
  const updatedAtUtc = row.updated_at || nowUtcIso();
  return {
    userId: row.id,
    displayName,
    handle,
    sportTags: [],
    privacy: { profileVisibility: 'public', activityVisibility: 'friends', allowFriendRequests: 'everyone' },
    createdAtUtc,
    updatedAtUtc,
  };
}

async function canUseSupabaseFriends(expectedUserId: string) {
  const socialEnabled = APP_CONFIG.FEATURES.SOCIAL_FEATURES_ENABLED || APP_CONFIG.RUNTIME.OVERRIDES.SOCIAL_FEATURES_ENABLED;
  if (!socialEnabled || !isSupabaseConfigured) return false;
  const { data } = await supabase.auth.getSession();
  const sessionUserId = data.session?.user?.id ?? null;
  if (!sessionUserId) return false;
  if (expectedUserId && sessionUserId !== expectedUserId) return false;
  return true;
}

async function getSupabaseFriendshipsForUser(userId: string): Promise<SupabaseFriendshipRow[]> {
  const { data, error } = await supabase
    .from('friendships')
    .select('*')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);
  if (error) throw error;
  return (data || []) as SupabaseFriendshipRow[];
}

async function getSupabaseFriendshipBetween(userIdA: string, userIdB: string): Promise<SupabaseFriendshipRow | null> {
  const { data, error } = await supabase
    .from('friendships')
    .select('*')
    .or(
      `and(requester_id.eq.${userIdA},addressee_id.eq.${userIdB}),and(requester_id.eq.${userIdB},addressee_id.eq.${userIdA})`
    )
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length ? (data[0] as SupabaseFriendshipRow) : null;
}

async function getSupabaseProfilesByIds(userIds: string[]): Promise<Record<string, FriendProfile>> {
  const unique = Array.from(new Set((userIds || []).filter(Boolean)));
  if (unique.length === 0) return {};
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url, created_at, updated_at')
    .in('id', unique);
  if (error) throw error;
  const map: Record<string, FriendProfile> = {};
  (data || []).forEach((row: any) => {
    const profile = toFriendProfile(row as any);
    map[profile.userId] = profile;
  });
  return map;
}

function supabaseFriendshipToRelationship(row: SupabaseFriendshipRow): SocialRelationship {
  const respondedAtUtc = row.status === 'pending' ? null : row.updated_at || nowUtcIso();
  const friendsSinceUtc = row.status === 'accepted' ? row.updated_at || nowUtcIso() : null;
  return {
    relationshipId: row.id,
    userAId: row.requester_id,
    userBId: row.addressee_id,
    status: row.status === 'accepted' ? 'friends' : row.status === 'blocked' ? 'blocked' : 'outgoing_request',
    requestedByUserId: row.status === 'pending' ? row.requester_id : null,
    requestedAtUtc: row.status === 'pending' ? row.created_at || nowUtcIso() : null,
    respondedAtUtc,
    friendsSinceUtc,
    blockedByUserId: null,
    blockedAtUtc: null,
    mutedByA: false,
    mutedByB: false,
    createdAtUtc: row.created_at || nowUtcIso(),
    updatedAtUtc: row.updated_at || nowUtcIso(),
    schemaVersion: FRIENDS_SCHEMA_VERSION,
  };
}

async function getMutedMapForUser(userId: string): Promise<Record<string, boolean>> {
  const raw = await AsyncStorage.getItem(FRIEND_MUTES_KEY);
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    const map = parsed && typeof parsed === 'object' ? parsed[userId] : null;
    return map && typeof map === 'object' ? map : {};
  } catch {
    return {};
  }
}

async function setMutedMapForUser(userId: string, next: Record<string, boolean>) {
  const raw = await AsyncStorage.getItem(FRIEND_MUTES_KEY);
  let parsed: any = {};
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    parsed = {};
  }
  parsed[userId] = next;
  await AsyncStorage.setItem(FRIEND_MUTES_KEY, JSON.stringify(parsed));
}

function pair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function isUserA(rel: SocialRelationship, userId: string) {
  return rel.userAId === userId;
}

function defaultSettings(userId: string): SocialSettings {
  const now = nowUtcIso();
  return {
    userId,
    defaultVisibility: 'private',
    allowFriendRequestsFrom: 'everyone',
    discoverableByUsername: true,
    allowDMsFromNonFriends: false,
    allowPublicDiscoveryFeed: false,
    friendInviteEnabled: true,
    friendInviteToken: Math.random().toString(36).slice(2, 12),
    friendInviteExpiresAtUtc: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    autoAcceptInviteLinks: false,
    notificationPrefs: {
      friendRequests: true,
      challengeInvites: true,
      clubInvites: true,
      dmMessages: true,
      reactions: false,
      clubAnnouncements: true,
      clubGeneral: false,
    },
    createdAtUtc: now,
    updatedAtUtc: now,
    schemaVersion: FRIENDS_SCHEMA_VERSION,
  };
}

function seedState(): FriendsState {
  const now = nowUtcIso();
  // No seeded/fake people in production builds. Local fallback starts empty.
  return { schemaVersion: FRIENDS_SCHEMA_VERSION, profiles: [], socialSettings: [], relationships: [] };
}

function safeParseState(raw: string | null): FriendsState {
  if (!raw) return seedState();
  try {
    const parsed = JSON.parse(raw) as FriendsState;
    if (!parsed || !Array.isArray(parsed.profiles) || !Array.isArray(parsed.relationships)) return seedState();
    return {
      schemaVersion: FRIENDS_SCHEMA_VERSION,
      profiles: parsed.profiles,
      socialSettings: Array.isArray(parsed.socialSettings) ? parsed.socialSettings : parsed.profiles.map((p) => defaultSettings(p.userId)),
      relationships: parsed.relationships,
    };
  } catch {
    return seedState();
  }
}

async function getState(): Promise<FriendsState> {
  const raw = await AsyncStorage.getItem(FRIENDS_STATE_KEY);
  const state = safeParseState(raw);
  if (!raw) {
    await AsyncStorage.setItem(FRIENDS_STATE_KEY, JSON.stringify(state));
  }
  return state;
}

function localSelfProfile(userId: string): FriendProfile {
  const now = nowUtcIso();
  const suffix = String(userId || '').slice(0, 8) || 'you';
  return {
    userId,
    displayName: 'You',
    handle: `@${suffix}`,
    sportTags: [],
    privacy: { profileVisibility: 'private', activityVisibility: 'private', allowFriendRequests: 'nobody' },
    createdAtUtc: now,
    updatedAtUtc: now,
  };
}

async function setState(state: FriendsState): Promise<void> {
  await AsyncStorage.setItem(FRIENDS_STATE_KEY, JSON.stringify({ ...state, schemaVersion: FRIENDS_SCHEMA_VERSION }));
}

function findProfile(state: FriendsState, userId: string) {
  return state.profiles.find((p) => p.userId === userId) || null;
}

function findSettings(state: FriendsState, userId: string) {
  return state.socialSettings.find((s) => s.userId === userId) || defaultSettings(userId);
}

function relationIndex(state: FriendsState, userAId: string, userBId: string) {
  const [a, b] = pair(userAId, userBId);
  return state.relationships.findIndex((r) => r.userAId === a && r.userBId === b);
}

function findRelation(state: FriendsState, userAId: string, userBId: string): SocialRelationship | null {
  const idx = relationIndex(state, userAId, userBId);
  return idx >= 0 ? state.relationships[idx] : null;
}

function ensureRelation(state: FriendsState, userAId: string, userBId: string) {
  const [a, b] = pair(userAId, userBId);
  const idx = relationIndex(state, a, b);
  if (idx >= 0) return { idx, rel: state.relationships[idx] };
  const now = nowUtcIso();
  const rel: SocialRelationship = {
    relationshipId: `rel_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    userAId: a,
    userBId: b,
    status: 'none',
    requestedByUserId: null,
    requestedAtUtc: null,
    respondedAtUtc: null,
    friendsSinceUtc: null,
    blockedByUserId: null,
    blockedAtUtc: null,
    mutedByA: false,
    mutedByB: false,
    createdAtUtc: now,
    updatedAtUtc: now,
    schemaVersion: FRIENDS_SCHEMA_VERSION,
  };
  state.relationships.push(rel);
  return { idx: state.relationships.length - 1, rel };
}

function perspectiveStatus(rel: SocialRelationship, viewerUserId: string): RelationshipStatus {
  if (rel.status === 'blocked') return 'blocked';
  if (rel.status === 'friends') return 'friends';
  if (rel.status === 'outgoing_request') {
    return rel.requestedByUserId === viewerUserId ? 'outgoing_request' : 'incoming_request';
  }
  return 'none';
}

function isBlockedBetween(rel: SocialRelationship) {
  return rel.status === 'blocked' && Boolean(rel.blockedByUserId);
}

function isFriend(rel: SocialRelationship) {
  return rel.status === 'friends';
}

function otherUserId(rel: SocialRelationship, userId: string) {
  return rel.userAId === userId ? rel.userBId : rel.userAId;
}

function isMuted(rel: SocialRelationship, userId: string) {
  return isUserA(rel, userId) ? rel.mutedByA : rel.mutedByB;
}

function listFriendIds(state: FriendsState, userId: string): string[] {
  return state.relationships
    .filter((rel) => isFriend(rel) && (rel.userAId === userId || rel.userBId === userId))
    .map((rel) => otherUserId(rel, userId));
}

function hasMutualFriend(state: FriendsState, requesterId: string, targetId: string) {
  const requesterFriends = new Set(listFriendIds(state, requesterId));
  const targetFriends = new Set(listFriendIds(state, targetId));
  for (const id of requesterFriends) {
    if (targetFriends.has(id)) return true;
  }
  return false;
}

function canSendRequest(state: FriendsState, requesterId: string, targetId: string): { ok: boolean; reason: string } {
  if (requesterId === targetId) return { ok: false, reason: 'Cannot add yourself.' };
  const target = findProfile(state, targetId);
  if (!target) return { ok: false, reason: 'User unavailable.' };

  const rel = findRelation(state, requesterId, targetId);
  if (rel) {
    if (isBlockedBetween(rel)) return { ok: false, reason: 'Blocked relationship.' };
    if (rel.status === 'friends') return { ok: false, reason: 'Already friends.' };
    if (rel.status === 'outgoing_request' && rel.requestedByUserId === requesterId) return { ok: false, reason: 'Request pending.' };
    if (rel.status === 'outgoing_request' && rel.requestedByUserId === targetId) return { ok: false, reason: 'Incoming request pending.' };
  }

  const targetSettings = findSettings(state, targetId);
  const targetPolicy = targetSettings.allowFriendRequestsFrom || target.privacy.allowFriendRequests || 'everyone';
  if (!targetSettings.discoverableByUsername) return { ok: false, reason: 'User is not discoverable.' };
  if (targetPolicy === 'nobody') return { ok: false, reason: 'Not accepting requests.' };
  if (targetPolicy === 'friends_of_friends' && !hasMutualFriend(state, requesterId, targetId)) {
    return { ok: false, reason: 'Friends of friends only.' };
  }
  return { ok: true, reason: 'Allowed.' };
}

function parseAudit(raw: string | null): FriendRequestAudit[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FriendRequestAudit[]) : [];
  } catch {
    return [];
  }
}

async function getRequestAudit(): Promise<FriendRequestAudit[]> {
  const raw = await AsyncStorage.getItem(FRIEND_REQUEST_AUDIT_KEY);
  return parseAudit(raw);
}

async function pushRequestAudit(entry: FriendRequestAudit): Promise<void> {
  const rows = await getRequestAudit();
  rows.push(entry);
  await AsyncStorage.setItem(FRIEND_REQUEST_AUDIT_KEY, JSON.stringify(rows.slice(-2000)));
}

async function requestRateGuard(requesterId: string, targetId: string): Promise<{ ok: boolean; reason: string }> {
  const rows = await getRequestAudit();
  const now = Date.now();
  const inLastDay = rows.filter((r) => r.requesterId === requesterId && r.action === 'sent' && now - Date.parse(r.atUtc) < 24 * 60 * 60 * 1000);
  if (inLastDay.length >= FRIEND_REQUESTS_PER_DAY_LIMIT) {
    return { ok: false, reason: 'Daily request limit reached.' };
  }

  const recentToTarget = rows.find(
    (r) =>
      r.requesterId === requesterId &&
      r.targetId === targetId &&
      r.action === 'sent' &&
      now - Date.parse(r.atUtc) < FRIEND_REQUEST_REPEAT_COOLDOWN_HOURS * 60 * 60 * 1000
  );
  if (recentToTarget) return { ok: false, reason: 'Request already sent recently.' };

  const recentDeclines = rows.filter(
    (r) =>
      r.requesterId === requesterId &&
      r.targetId === targetId &&
      r.action === 'declined' &&
      now - Date.parse(r.atUtc) < 7 * 24 * 60 * 60 * 1000
  );
  if (recentDeclines.length >= 2) {
    const lastDecline = Math.max(...recentDeclines.map((r) => Date.parse(r.atUtc)));
    if (now - lastDecline < FRIEND_REQUEST_DECLINE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000) {
      return { ok: false, reason: 'Request temporarily throttled after repeated declines.' };
    }
  }
  return { ok: true, reason: 'Allowed.' };
}

export async function getCommunityView(userId: string): Promise<CommunityView> {
  if (await canUseSupabaseFriends(userId)) {
    const [friendships, mutedMap] = await Promise.all([getSupabaseFriendshipsForUser(userId), getMutedMapForUser(userId)]);
    const relationships = friendships.map(supabaseFriendshipToRelationship);
    const otherIds = relationships.map((rel) => otherUserId(rel, userId)).filter(Boolean);
    const profilesMap = await getSupabaseProfilesByIds([userId, ...otherIds]);
    const me = profilesMap[userId] || toFriendProfile({ id: userId });

    const settings: SocialSettings = {
      ...defaultSettings(userId),
      friendInviteEnabled: true,
      friendInviteToken: userId,
      friendInviteExpiresAtUtc: null,
      updatedAtUtc: nowUtcIso(),
    };

    const incoming = relationships
      .filter((rel) => (rel.userAId === userId || rel.userBId === userId) && perspectiveStatus(rel, userId) === 'incoming_request')
      .map((relationship) => ({ relationship, profile: profilesMap[otherUserId(relationship, userId)] }))
      .filter((row): row is { relationship: SocialRelationship; profile: FriendProfile } => Boolean(row.profile));

    const outgoing = relationships
      .filter((rel) => (rel.userAId === userId || rel.userBId === userId) && perspectiveStatus(rel, userId) === 'outgoing_request')
      .map((relationship) => ({ relationship, profile: profilesMap[otherUserId(relationship, userId)] }))
      .filter((row): row is { relationship: SocialRelationship; profile: FriendProfile } => Boolean(row.profile));

    const friends = relationships
      .filter((rel) => (rel.userAId === userId || rel.userBId === userId) && perspectiveStatus(rel, userId) === 'friends')
      .map((relationship) => {
        const profile = profilesMap[otherUserId(relationship, userId)];
        const muted = Boolean(profile && mutedMap[profile.userId]);
        return profile ? { relationship, profile, muted } : null;
      })
      .filter((row): row is { relationship: SocialRelationship; profile: FriendProfile; muted: boolean } => Boolean(row))
      .sort((a, b) => a.profile.displayName.localeCompare(b.profile.displayName));

    const blocked = relationships
      .filter((rel) => (rel.userAId === userId || rel.userBId === userId) && rel.status === 'blocked')
      .map((relationship) => ({ relationship, profile: profilesMap[otherUserId(relationship, userId)] }))
      .filter((row): row is { relationship: SocialRelationship; profile: FriendProfile } => Boolean(row.profile));

    return { me, settings, incoming, outgoing, friends, blocked, suggestions: [] };
  }

  const state = await getState();
  const me = findProfile(state, userId) || localSelfProfile(userId);
  const settings = findSettings(state, userId);

  const incoming = state.relationships
    .filter((rel) => (rel.userAId === userId || rel.userBId === userId) && perspectiveStatus(rel, userId) === 'incoming_request')
    .map((relationship) => ({ relationship, profile: findProfile(state, otherUserId(relationship, userId)) }))
    .filter((row): row is { relationship: SocialRelationship; profile: FriendProfile } => Boolean(row.profile));

  const outgoing = state.relationships
    .filter((rel) => (rel.userAId === userId || rel.userBId === userId) && perspectiveStatus(rel, userId) === 'outgoing_request')
    .map((relationship) => ({ relationship, profile: findProfile(state, otherUserId(relationship, userId)) }))
    .filter((row): row is { relationship: SocialRelationship; profile: FriendProfile } => Boolean(row.profile));

  const friends = state.relationships
    .filter((rel) => (rel.userAId === userId || rel.userBId === userId) && perspectiveStatus(rel, userId) === 'friends')
    .map((relationship) => {
      const profile = findProfile(state, otherUserId(relationship, userId));
      return profile ? { relationship, profile, muted: isMuted(relationship, userId) } : null;
    })
    .filter((row): row is { relationship: SocialRelationship; profile: FriendProfile; muted: boolean } => Boolean(row))
    .sort((a, b) => a.profile.displayName.localeCompare(b.profile.displayName));

  const blocked = state.relationships
    .filter((rel) => (rel.userAId === userId || rel.userBId === userId) && rel.status === 'blocked' && rel.blockedByUserId === userId)
    .map((relationship) => ({ relationship, profile: findProfile(state, otherUserId(relationship, userId)) }))
    .filter((row): row is { relationship: SocialRelationship; profile: FriendProfile } => Boolean(row.profile));

  const suppressedIds = new Set<string>([
    ...incoming.map((r) => r.profile.userId),
    ...outgoing.map((r) => r.profile.userId),
    ...friends.map((r) => r.profile.userId),
    ...blocked.map((r) => r.profile.userId),
  ]);

  const suggestions: FriendSuggestion[] = state.profiles
    .filter((profile) => profile.userId !== userId && !suppressedIds.has(profile.userId))
    .map((profile) => {
      const rule = canSendRequest(state, userId, profile.userId);
      return { profile, canAdd: rule.ok, reason: rule.reason };
    })
    .sort((a, b) => Number(b.canAdd) - Number(a.canAdd));

  return { me, settings, incoming, outgoing, friends, blocked, suggestions };
}

export async function setFriendPrivacy(
  userId: string,
  patch: Partial<FriendPrivacy>
): Promise<FriendProfile | null> {
  const state = await getState();
  const idx = state.profiles.findIndex((p) => p.userId === userId);
  if (idx < 0) return null;
  state.profiles[idx] = {
    ...state.profiles[idx],
    privacy: { ...state.profiles[idx].privacy, ...patch },
    updatedAtUtc: nowUtcIso(),
  };
  if (patch.allowFriendRequests) {
    const settingsIdx = state.socialSettings.findIndex((s) => s.userId === userId);
    const baseline = settingsIdx >= 0 ? state.socialSettings[settingsIdx] : defaultSettings(userId);
    const syncedSettings: SocialSettings = {
      ...baseline,
      allowFriendRequestsFrom: patch.allowFriendRequests,
      updatedAtUtc: nowUtcIso(),
      schemaVersion: FRIENDS_SCHEMA_VERSION,
    };
    if (settingsIdx >= 0) state.socialSettings[settingsIdx] = syncedSettings;
    else state.socialSettings.push(syncedSettings);
  }
  await setState(state);
  return state.profiles[idx];
}

export async function setSocialSettings(
  userId: string,
  patch: Partial<Omit<SocialSettings, 'userId' | 'createdAtUtc' | 'updatedAtUtc' | 'schemaVersion'>>
): Promise<SocialSettings> {
  const state = await getState();
  const idx = state.socialSettings.findIndex((s) => s.userId === userId);
  const baseline = idx >= 0 ? state.socialSettings[idx] : defaultSettings(userId);
  const next: SocialSettings = {
    ...baseline,
    ...patch,
    notificationPrefs: { ...baseline.notificationPrefs, ...(patch.notificationPrefs || {}) },
    updatedAtUtc: nowUtcIso(),
    schemaVersion: FRIENDS_SCHEMA_VERSION,
    defaultVisibility:
      (patch.defaultVisibility || baseline.defaultVisibility) === 'public' && !(patch.allowPublicDiscoveryFeed ?? baseline.allowPublicDiscoveryFeed)
        ? 'friends'
        : (patch.defaultVisibility || baseline.defaultVisibility),
  };

  if (idx >= 0) state.socialSettings[idx] = next;
  else state.socialSettings.push(next);
  await setState(state);
  return next;
}

export async function sendFriendRequest(requesterId: string, targetId: string): Promise<{ ok: boolean; reason: string }> {
  if (await canUseSupabaseFriends(requesterId)) {
    if (requesterId === targetId) return { ok: false, reason: 'Cannot add yourself.' };

    const rate = await requestRateGuard(requesterId, targetId);
    if (!rate.ok) return rate;

    const existing = await getSupabaseFriendshipBetween(requesterId, targetId);
    if (existing) {
      if (existing.status === 'accepted') return { ok: false, reason: 'Already friends.' };
      if (existing.status === 'blocked') return { ok: false, reason: 'Unavailable.' };
      if (existing.status === 'pending') {
        if (existing.requester_id === requesterId) return { ok: false, reason: 'Request already sent.' };
        const { error } = await supabase.from('friendships').update({ status: 'accepted' }).eq('id', existing.id);
        if (error) throw error;
        await pushRequestAudit({ atUtc: nowUtcIso(), requesterId, targetId, action: 'accepted' });
        return { ok: true, reason: 'Accepted.' };
      }
    }

    const { error } = await supabase.from('friendships').insert({ requester_id: requesterId, addressee_id: targetId, status: 'pending' });
    if (error) throw error;
    await pushRequestAudit({ atUtc: nowUtcIso(), requesterId, targetId, action: 'sent' });
    return { ok: true, reason: 'Request sent.' };
  }

  const state = await getState();
  const rule = canSendRequest(state, requesterId, targetId);
  if (!rule.ok) return { ok: false, reason: rule.reason };
  const rate = await requestRateGuard(requesterId, targetId);
  if (!rate.ok) return rate;

  const now = nowUtcIso();
  const { idx, rel } = ensureRelation(state, requesterId, targetId);
  state.relationships[idx] = {
    ...rel,
    status: 'outgoing_request',
    requestedByUserId: requesterId,
    requestedAtUtc: now,
    respondedAtUtc: null,
    friendsSinceUtc: null,
    updatedAtUtc: now,
  };
  await setState(state);
  await pushRequestAudit({
    atUtc: now,
    requesterId,
    targetId,
    action: 'sent',
  });
  return { ok: true, reason: 'Request sent.' };
}

export async function cancelOutgoingRequest(userId: string, relationshipId: string): Promise<boolean> {
  if (await canUseSupabaseFriends(userId)) {
    const { error } = await supabase
      .from('friendships')
      .delete()
      .eq('id', relationshipId)
      .eq('requester_id', userId)
      .eq('status', 'pending');
    if (error) throw error;
    return true;
  }

  const state = await getState();
  const idx = state.relationships.findIndex((r) => r.relationshipId === relationshipId);
  if (idx < 0) return false;
  const rel = state.relationships[idx];
  if (rel.status !== 'outgoing_request' || rel.requestedByUserId !== userId) return false;
  state.relationships[idx] = {
    ...rel,
    status: 'none',
    requestedByUserId: null,
    requestedAtUtc: null,
    respondedAtUtc: nowUtcIso(),
    updatedAtUtc: nowUtcIso(),
  };
  await setState(state);
  return true;
}

export async function acceptFriendRequest(userId: string, relationshipId: string): Promise<boolean> {
  if (await canUseSupabaseFriends(userId)) {
    const { data, error } = await supabase
      .from('friendships')
      .update({ status: 'accepted' })
      .eq('id', relationshipId)
      .eq('addressee_id', userId)
      .eq('status', 'pending')
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!data) return false;
    await pushRequestAudit({
      atUtc: nowUtcIso(),
      requesterId: (data as any).requester_id,
      targetId: (data as any).addressee_id,
      action: 'accepted',
    });
    return true;
  }

  const state = await getState();
  const idx = state.relationships.findIndex((r) => r.relationshipId === relationshipId);
  if (idx < 0) return false;
  const rel = state.relationships[idx];
  if (rel.status !== 'outgoing_request') return false;
  const isRecipient = otherUserId(rel, rel.requestedByUserId || '') === userId;
  if (!isRecipient) return false;

  const now = nowUtcIso();
  state.relationships[idx] = {
    ...rel,
    status: 'friends',
    requestedByUserId: null,
    respondedAtUtc: now,
    friendsSinceUtc: now,
    updatedAtUtc: now,
  };
  await setState(state);
  await pushRequestAudit({
    atUtc: now,
    requesterId: rel.requestedByUserId || userId,
    targetId: userId,
    action: 'accepted',
  });
  return true;
}

export async function declineFriendRequest(userId: string, relationshipId: string): Promise<boolean> {
  if (await canUseSupabaseFriends(userId)) {
    const rel = await supabase.from('friendships').select('*').eq('id', relationshipId).maybeSingle();
    if (rel.error) throw rel.error;
    const row = rel.data as any;
    if (!row) return false;
    const { error } = await supabase
      .from('friendships')
      .delete()
      .eq('id', relationshipId)
      .eq('addressee_id', userId)
      .eq('status', 'pending');
    if (error) throw error;
    await pushRequestAudit({ atUtc: nowUtcIso(), requesterId: row.requester_id, targetId: row.addressee_id, action: 'declined' });
    return true;
  }

  const state = await getState();
  const idx = state.relationships.findIndex((r) => r.relationshipId === relationshipId);
  if (idx < 0) return false;
  const rel = state.relationships[idx];
  if (rel.status !== 'outgoing_request') return false;
  const isRecipient = otherUserId(rel, rel.requestedByUserId || '') === userId;
  if (!isRecipient) return false;

  const now = nowUtcIso();
  state.relationships[idx] = {
    ...rel,
    status: 'none',
    requestedByUserId: null,
    requestedAtUtc: null,
    respondedAtUtc: now,
    updatedAtUtc: now,
  };
  await setState(state);
  const requesterId = rel.requestedByUserId || '';
  const targetId = requesterId === userId ? otherUserId(rel, userId) : userId;
  await pushRequestAudit({
    atUtc: now,
    requesterId,
    targetId,
    action: 'declined',
  });
  return true;
}

export async function removeFriend(userId: string, friendId: string): Promise<boolean> {
  if (await canUseSupabaseFriends(userId)) {
    const existing = await getSupabaseFriendshipBetween(userId, friendId);
    if (!existing || existing.status !== 'accepted') return false;
    const { error } = await supabase.from('friendships').delete().eq('id', existing.id);
    if (error) throw error;
    return true;
  }

  const state = await getState();
  const idx = relationIndex(state, userId, friendId);
  if (idx < 0) return false;
  const rel = state.relationships[idx];
  if (rel.status !== 'friends') return false;
  const now = nowUtcIso();
  state.relationships[idx] = {
    ...rel,
    status: 'none',
    friendsSinceUtc: null,
    respondedAtUtc: now,
    updatedAtUtc: now,
  };
  await setState(state);
  return true;
}

export async function blockUser(userId: string, targetId: string): Promise<boolean> {
  if (await canUseSupabaseFriends(userId)) {
    const existing = await getSupabaseFriendshipBetween(userId, targetId);
    if (existing) {
      const { error } = await supabase.from('friendships').update({ status: 'blocked' }).eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('friendships').insert({ requester_id: userId, addressee_id: targetId, status: 'blocked' });
      if (error) throw error;
    }
    await pushRequestAudit({ atUtc: nowUtcIso(), requesterId: userId, targetId, action: 'blocked' });
    return true;
  }

  const state = await getState();
  const { idx, rel } = ensureRelation(state, userId, targetId);
  const now = nowUtcIso();
  state.relationships[idx] = {
    ...rel,
    status: 'blocked',
    requestedByUserId: null,
    requestedAtUtc: null,
    respondedAtUtc: now,
    friendsSinceUtc: null,
    blockedByUserId: userId,
    blockedAtUtc: now,
    updatedAtUtc: now,
  };
  await setState(state);
  await pushRequestAudit({
    atUtc: now,
    requesterId: userId,
    targetId,
    action: 'blocked',
  });
  return true;
}

export async function unblockUser(userId: string, relationshipId: string): Promise<boolean> {
  if (await canUseSupabaseFriends(userId)) {
    const { error } = await supabase
      .from('friendships')
      .delete()
      .eq('id', relationshipId)
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
      .eq('status', 'blocked');
    if (error) throw error;
    return true;
  }

  const state = await getState();
  const idx = state.relationships.findIndex((r) => r.relationshipId === relationshipId);
  if (idx < 0) return false;
  const rel = state.relationships[idx];
  if (rel.status !== 'blocked' || rel.blockedByUserId !== userId) return false;
  state.relationships[idx] = {
    ...rel,
    status: 'none',
    blockedByUserId: null,
    blockedAtUtc: null,
    respondedAtUtc: nowUtcIso(),
    updatedAtUtc: nowUtcIso(),
  };
  await setState(state);
  return true;
}

export async function setMuteUser(userId: string, targetId: string, muted: boolean): Promise<boolean> {
  if (await canUseSupabaseFriends(userId)) {
    const map = await getMutedMapForUser(userId);
    const next = { ...map, [targetId]: muted };
    Object.keys(next).forEach((k) => {
      if (!next[k]) delete next[k];
    });
    await setMutedMapForUser(userId, next);
    return true;
  }

  const state = await getState();
  const idx = relationIndex(state, userId, targetId);
  if (idx < 0) return false;
  const rel = state.relationships[idx];
  const next = isUserA(rel, userId) ? { ...rel, mutedByA: muted } : { ...rel, mutedByB: muted };
  state.relationships[idx] = { ...next, updatedAtUtc: nowUtcIso() };
  await setState(state);
  return true;
}

// Backward-compatible alias used by current UI.
export async function addFriend(requesterId: string, targetId: string): Promise<{ ok: boolean; reason: string }> {
  return sendFriendRequest(requesterId, targetId);
}

export async function isBlockedBetweenUsers(userIdA: string, userIdB: string): Promise<boolean> {
  if (await canUseSupabaseFriends(userIdA)) {
    const rel = await getSupabaseFriendshipBetween(userIdA, userIdB);
    return Boolean(rel && rel.status === 'blocked');
  }

  const state = await getState();
  const idx = relationIndex(state, userIdA, userIdB);
  if (idx < 0) return false;
  return state.relationships[idx].status === 'blocked';
}

export async function getRelationshipStatusForViewer(
  viewerUserId: string,
  otherUserId: string
): Promise<RelationshipStatus> {
  const state = await getState();
  const idx = relationIndex(state, viewerUserId, otherUserId);
  if (idx < 0) return 'none';
  return perspectiveStatus(state.relationships[idx], viewerUserId);
}

export async function getSocialSettingsForUser(userId: string): Promise<SocialSettings> {
  const state = await getState();
  return findSettings(state, userId);
}

export async function searchUsersByHandle(input: {
  viewerUserId: string;
  query: string;
  limit?: number;
}): Promise<FriendSearchResult[]> {
  if (await canUseSupabaseFriends(input.viewerUserId)) {
    const q = input.query.trim().toLowerCase().replace(/^@/, '');
    const limit = Math.max(1, Number(input.limit) || 12);
    if (!q) return [];

    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url, created_at, updated_at')
      .or(`username.ilike.%${q}%,display_name.ilike.%${q}%`)
      .limit(limit);
    if (error) throw error;

    const friendships = await getSupabaseFriendshipsForUser(input.viewerUserId);
    const relByOther = new Map<string, SupabaseFriendshipRow>();
    friendships.forEach((row) => {
      const other = row.requester_id === input.viewerUserId ? row.addressee_id : row.requester_id;
      relByOther.set(other, row);
    });

    return (data || [])
      .map((row: any) => toFriendProfile(row as any))
      .filter((profile: FriendProfile) => profile.userId !== input.viewerUserId)
      .map((profile: FriendProfile) => {
        const row = relByOther.get(profile.userId) || null;
        const rel = row ? supabaseFriendshipToRelationship(row) : null;
        const status = rel ? perspectiveStatus(rel, input.viewerUserId) : 'none';

        let actionLabel: FriendSearchResult['actionLabel'] = 'Add';
        let actionEnabled = true;
        let reason = 'Can send request.';
        if (status === 'outgoing_request') {
          actionLabel = 'Requested';
          actionEnabled = true;
          reason = 'Request pending. Tap to cancel.';
        } else if (status === 'incoming_request') {
          actionLabel = 'Accept';
          actionEnabled = true;
          reason = 'Incoming request.';
        } else if (status === 'friends') {
          actionLabel = 'Friends';
          actionEnabled = false;
          reason = 'Already friends.';
        } else if (status === 'blocked') {
          actionLabel = 'Unavailable';
          actionEnabled = false;
          reason = 'Unavailable.';
        }

        return {
          profile,
          relationshipId: row?.id,
          relationshipStatus: status,
          actionEnabled,
          actionLabel,
          reason,
        };
      });
  }

  const state = await getState();
  const q = input.query.trim().toLowerCase().replace(/^@/, '');
  const limit = Math.max(1, Number(input.limit) || 12);
  const filtered = state.profiles
    .filter((profile) => profile.userId !== input.viewerUserId)
    .filter((profile) => (q ? profile.handle.toLowerCase().replace(/^@/, '').includes(q) : true))
    .filter((profile) => findSettings(state, profile.userId).discoverableByUsername)
    .filter((profile) => {
      const rel = findRelation(state, input.viewerUserId, profile.userId);
      return !(rel && rel.status === 'blocked');
    })
    .sort((a, b) => a.handle.localeCompare(b.handle))
    .slice(0, limit);

  return filtered
    .map((profile) => {
      const idx = relationIndex(state, input.viewerUserId, profile.userId);
      const status = idx >= 0 ? perspectiveStatus(state.relationships[idx], input.viewerUserId) : 'none';
      let actionLabel: FriendSearchResult['actionLabel'] = 'Add';
      let actionEnabled = true;
      let reason = 'Can send request.';
      if (status === 'outgoing_request') {
        actionLabel = 'Requested';
        actionEnabled = true;
        reason = 'Request pending. Tap to cancel.';
      } else if (status === 'incoming_request') {
        actionLabel = 'Accept';
        actionEnabled = true;
        reason = 'Incoming request.';
      } else if (status === 'friends') {
        actionLabel = 'Friends';
        actionEnabled = false;
        reason = 'Already friends.';
      } else if (status === 'blocked') {
        actionLabel = 'Unavailable';
        actionEnabled = false;
        reason = 'Unavailable.';
      } else {
        const sendRule = canSendRequest(state, input.viewerUserId, profile.userId);
        actionEnabled = sendRule.ok;
        reason = sendRule.reason;
      }
      return {
        profile,
        relationshipId: idx >= 0 ? state.relationships[idx].relationshipId : undefined,
        relationshipStatus: status,
        actionEnabled,
        actionLabel,
        reason,
      };
    });
}

export async function saveSearchRecent(viewerUserId: string, handle: string): Promise<void> {
  const raw = await AsyncStorage.getItem(FRIEND_SEARCH_RECENTS_KEY);
  const parsed = (() => {
    try {
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  })();
  const list: string[] = Array.isArray(parsed[viewerUserId]) ? parsed[viewerUserId] : [];
  const normalized = handle.trim();
  if (!normalized) return;
  const next = [normalized, ...list.filter((h) => h !== normalized)].slice(0, 8);
  parsed[viewerUserId] = next;
  await AsyncStorage.setItem(FRIEND_SEARCH_RECENTS_KEY, JSON.stringify(parsed));
}

export async function getSearchRecents(viewerUserId: string): Promise<string[]> {
  const raw = await AsyncStorage.getItem(FRIEND_SEARCH_RECENTS_KEY);
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    return Array.isArray(parsed[viewerUserId]) ? parsed[viewerUserId] : [];
  } catch {
    return [];
  }
}

export async function rotateFriendInviteLink(userId: string): Promise<{ token: string; expiresAtUtc: string }> {
  if (await canUseSupabaseFriends(userId)) {
    // Internal/TestFlight mode uses a stateless token (the user id).
    return { token: userId, expiresAtUtc: '' };
  }

  const token = Math.random().toString(36).slice(2, 12);
  const expiresAtUtc = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  await setSocialSettings(userId, {
    friendInviteEnabled: true,
    friendInviteToken: token,
    friendInviteExpiresAtUtc: expiresAtUtc,
  });
  return { token, expiresAtUtc };
}

export async function setFriendInviteEnabled(userId: string, enabled: boolean): Promise<void> {
  if (await canUseSupabaseFriends(userId)) {
    // Stateless invites: no server toggle yet.
    return;
  }

  await setSocialSettings(userId, { friendInviteEnabled: enabled });
}

export async function getFriendInviteLinkData(userId: string): Promise<{
  token: string | null;
  enabled: boolean;
  expiresAtUtc: string | null;
}> {
  if (await canUseSupabaseFriends(userId)) {
    return { token: userId, enabled: true, expiresAtUtc: null };
  }

  const settings = await getSocialSettingsForUser(userId);
  return {
    token: settings.friendInviteToken || null,
    enabled: settings.friendInviteEnabled !== false,
    expiresAtUtc: settings.friendInviteExpiresAtUtc || null,
  };
}

export async function resolveFriendInviteToken(input: {
  viewerUserId: string;
  token: string;
}): Promise<{ ok: boolean; reason: string; inviter?: FriendProfile }> {
  if (await canUseSupabaseFriends(input.viewerUserId)) {
    const inviterId = input.token.trim();
    if (!inviterId) return { ok: false, reason: 'Invite link is invalid.' };
    if (inviterId === input.viewerUserId) return { ok: false, reason: 'Invite link points to you.' };
    const blocked = await isBlockedBetweenUsers(input.viewerUserId, inviterId);
    if (blocked) return { ok: false, reason: 'Unavailable.' };
    const profiles = await getSupabaseProfilesByIds([inviterId]);
    const inviter = profiles[inviterId];
    if (!inviter) return { ok: false, reason: 'Inviter not found.' };
    return { ok: true, reason: 'Invite link valid.', inviter };
  }

  const state = await getState();
  const now = Date.now();
  const inviterSettings = state.socialSettings.find(
    (settings) =>
      settings.friendInviteEnabled !== false &&
      settings.friendInviteToken === input.token &&
      (!settings.friendInviteExpiresAtUtc || Date.parse(settings.friendInviteExpiresAtUtc) > now)
  );
  if (!inviterSettings) return { ok: false, reason: 'Invite link is invalid or expired.' };
  const inviter = findProfile(state, inviterSettings.userId);
  if (!inviter) return { ok: false, reason: 'Inviter not found.' };

  const rel = findRelation(state, input.viewerUserId, inviter.userId);
  if (rel && rel.status === 'blocked') {
    return { ok: false, reason: 'Unavailable.' };
  }
  return { ok: true, reason: 'Invite link valid.', inviter };
}

export async function connectViaInviteToken(input: {
  viewerUserId: string;
  token: string;
}): Promise<{ ok: boolean; reason: string }> {
  const resolved = await resolveFriendInviteToken(input);
  if (!resolved.ok || !resolved.inviter) return { ok: false, reason: resolved.reason };
  return sendFriendRequest(input.viewerUserId, resolved.inviter.userId);
}
