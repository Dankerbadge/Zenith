import { emitClubJoinedEvent, emitClubLeftEvent } from './activityEventService';
import { APP_CONFIG } from './appConfig';
import { createModerationAction } from './moderationService';
import { isSupabaseConfigured, supabase } from './supabaseClient';

const CLUB_SCHEMA_VERSION = 2;
const JOIN_REQUEST_COOLDOWN_HOURS = 6;
const JOIN_REQUESTS_PER_DAY_LIMIT = 20;
const CLUB_INVITES_PER_DAY_LIMIT = 40;
const REPEAT_INVITE_COOLDOWN_HOURS = 24;
const INVITE_TOKEN_FAILED_ATTEMPTS_PER_HOUR_LIMIT = 8;
const TOKEN_ROTATIONS_PER_DAY_LIMIT = 20;

export type ClubVisibilityMode = 'private_invite_only' | 'request_to_join' | 'public_discoverable';
export type ClubRole = 'owner' | 'admin' | 'moderator' | 'member';
export type ClubMembershipStatus = 'active' | 'pending_request' | 'invited' | 'removed' | 'banned';

export type ClubRecord = {
  clubId: string;
  name: string;
  description: string;
  visibilityMode: ClubVisibilityMode;
  createdByUserId: string;
  createdAtUtc: string;
  updatedAtUtc: string;
  schemaVersion: number;
  settings: {
    inviteLinkEnabled: boolean;
    inviteLinkToken: string | null;
    allowMemberInvites: boolean;
    requireApproval: boolean;
    defaultMemberVisibility: 'private' | 'club';
    announcementsPostingRoles: ('owner' | 'admin')[];
    generalChatEnabled: boolean;
    contentRules: string;
    tags: string[];
    locationHint: string | null;
  };
};

export type ClubMembership = {
  membershipId: string;
  clubId: string;
  userId: string;
  role: ClubRole;
  status: ClubMembershipStatus;
  joinedAtUtc: string | null;
  invitedAtUtc: string | null;
  requestedAtUtc: string | null;
  removedAtUtc: string | null;
  removedByUserId: string | null;
  mutedInClubChat: boolean;
  lastChangedByUserId: string | null;
  createdAtUtc: string;
  updatedAtUtc: string;
  schemaVersion: number;
};

type ClubActionType =
  | 'invite_sent'
  | 'invite_accepted'
  | 'join_request_sent'
  | 'join_request_approved'
  | 'join_request_declined'
  | 'invite_token_failed'
  | 'invite_token_joined'
  | 'invite_token_rotated';

type ClubActionAudit = {
  atUtc: string;
  actorUserId: string;
  action: ClubActionType;
  clubId?: string;
  targetUserId?: string;
  success: boolean;
  reason?: string;
};

type SupabaseClubRow = {
  id: string;
  name: string;
  description: string | null;
  visibility_mode: ClubVisibilityMode;
  created_by_user_id: string;
  invite_link_enabled: boolean | null;
  invite_link_token: string | null;
  allow_member_invites: boolean | null;
  require_approval: boolean | null;
  default_member_visibility: 'private' | 'club' | null;
  announcements_posting_roles: Array<'owner' | 'admin'> | null;
  general_chat_enabled: boolean | null;
  content_rules: string | null;
  tags: string[] | null;
  location_hint: string | null;
  created_at: string;
  updated_at: string;
};

type SupabaseMembershipRow = {
  id: string;
  club_id: string;
  user_id: string;
  role: ClubRole;
  status: ClubMembershipStatus;
  joined_at: string | null;
  invited_at: string | null;
  requested_at: string | null;
  removed_at: string | null;
  removed_by_user_id: string | null;
  muted_in_club_chat: boolean | null;
  last_changed_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

function nowUtcIso() {
  return new Date().toISOString();
}

function socialEnabled() {
  return APP_CONFIG.FEATURES.SOCIAL_FEATURES_ENABLED || APP_CONFIG.RUNTIME.OVERRIDES.SOCIAL_FEATURES_ENABLED;
}

function generateInviteToken() {
  return Math.random().toString(36).slice(2, 10);
}

function isUniqueViolation(error: any): boolean {
  const code = String(error?.code || '').trim();
  const message = String(error?.message || '').toLowerCase();
  return code === '23505' || message.includes('unique') || message.includes('duplicate key');
}

function canManageMembers(role: ClubRole) {
  return role === 'owner' || role === 'admin';
}

function canModerate(role: ClubRole) {
  return role === 'owner' || role === 'admin' || role === 'moderator';
}

function canTransferOwnership(role: ClubRole) {
  return role === 'owner';
}

function canRoleEdit(actorRole: ClubRole, targetRole: ClubRole, nextRole: ClubRole) {
  if (actorRole === 'owner') return true;
  if (actorRole === 'admin') {
    const allowed = new Set<ClubRole>(['member', 'moderator']);
    return allowed.has(targetRole) && allowed.has(nextRole);
  }
  return false;
}

function toClubRecord(row: SupabaseClubRow): ClubRecord {
  const announcements = Array.isArray(row.announcements_posting_roles)
    ? row.announcements_posting_roles.filter((role): role is 'owner' | 'admin' => role === 'owner' || role === 'admin')
    : [];

  return {
    clubId: row.id,
    name: String(row.name || '').trim(),
    description: String(row.description || ''),
    visibilityMode: row.visibility_mode,
    createdByUserId: row.created_by_user_id,
    createdAtUtc: row.created_at,
    updatedAtUtc: row.updated_at,
    schemaVersion: CLUB_SCHEMA_VERSION,
    settings: {
      inviteLinkEnabled: Boolean(row.invite_link_enabled ?? true),
      inviteLinkToken: row.invite_link_token || null,
      allowMemberInvites: Boolean(row.allow_member_invites ?? false),
      requireApproval: Boolean(row.require_approval ?? false),
      defaultMemberVisibility: row.default_member_visibility === 'private' ? 'private' : 'club',
      announcementsPostingRoles: announcements.length ? announcements : ['owner', 'admin'],
      generalChatEnabled: Boolean(row.general_chat_enabled ?? true),
      contentRules: String(row.content_rules || 'Be respectful and accountable.'),
      tags: Array.isArray(row.tags) ? row.tags.map((tag) => String(tag)).filter(Boolean) : [],
      locationHint: row.location_hint || null,
    },
  };
}

function toMembership(row: SupabaseMembershipRow): ClubMembership {
  return {
    membershipId: row.id,
    clubId: row.club_id,
    userId: row.user_id,
    role: row.role,
    status: row.status,
    joinedAtUtc: row.joined_at,
    invitedAtUtc: row.invited_at,
    requestedAtUtc: row.requested_at,
    removedAtUtc: row.removed_at,
    removedByUserId: row.removed_by_user_id,
    mutedInClubChat: Boolean(row.muted_in_club_chat ?? false),
    lastChangedByUserId: row.last_changed_by_user_id,
    createdAtUtc: row.created_at,
    updatedAtUtc: row.updated_at,
    schemaVersion: CLUB_SCHEMA_VERSION,
  };
}

async function getSessionUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

async function canUseSupabaseClubs(expectedUserId?: string): Promise<{ ok: boolean; sessionUserId: string | null; reason?: string }> {
  if (!socialEnabled()) {
    return { ok: false, sessionUserId: null, reason: 'Social is disabled in this build.' };
  }
  if (!isSupabaseConfigured) {
    return { ok: false, sessionUserId: null, reason: 'Cloud sync is required for clubs.' };
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

async function requireSupabaseClubs(expectedUserId?: string): Promise<string> {
  const guard = await canUseSupabaseClubs(expectedUserId);
  if (!guard.ok || !guard.sessionUserId) {
    throw new Error(guard.reason || 'Cloud sync is required for clubs.');
  }
  return guard.sessionUserId;
}

async function getClubRow(clubId: string): Promise<SupabaseClubRow | null> {
  const { data, error } = await supabase.from('clubs').select('*').eq('id', clubId).maybeSingle();
  if (error) throw error;
  return (data as SupabaseClubRow | null) || null;
}

async function getMembershipRow(clubId: string, userId: string): Promise<SupabaseMembershipRow | null> {
  const { data, error } = await supabase
    .from('club_memberships')
    .select('*')
    .eq('club_id', clubId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as SupabaseMembershipRow | null) || null;
}

async function getAuditCount(input: {
  actorUserId: string;
  action: ClubActionType;
  windowMs: number;
  clubId?: string;
  targetUserId?: string;
  success?: boolean;
}): Promise<number> {
  const sinceIso = new Date(Date.now() - input.windowMs).toISOString();
  let q = supabase
    .from('club_action_audit')
    .select('id', { count: 'exact', head: true })
    .eq('actor_user_id', input.actorUserId)
    .eq('action', input.action)
    .gte('at_utc', sinceIso);
  if (typeof input.success === 'boolean') q = q.eq('success', input.success);
  if (input.clubId) q = q.eq('club_id', input.clubId);
  if (input.targetUserId) q = q.eq('target_user_id', input.targetUserId);
  const { count, error } = await q;
  if (error) throw error;
  return Number(count || 0);
}

async function hasRecentAudit(input: {
  actorUserId: string;
  action: ClubActionType;
  windowMs: number;
  clubId?: string;
  targetUserId?: string;
  success?: boolean;
}): Promise<boolean> {
  const sinceIso = new Date(Date.now() - input.windowMs).toISOString();
  let q = supabase
    .from('club_action_audit')
    .select('id')
    .eq('actor_user_id', input.actorUserId)
    .eq('action', input.action)
    .gte('at_utc', sinceIso)
    .limit(1);
  if (typeof input.success === 'boolean') q = q.eq('success', input.success);
  if (input.clubId) q = q.eq('club_id', input.clubId);
  if (input.targetUserId) q = q.eq('target_user_id', input.targetUserId);
  const { data, error } = await q;
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

async function pushClubActionAudit(entry: ClubActionAudit) {
  const payload = {
    at_utc: entry.atUtc,
    actor_user_id: entry.actorUserId,
    action: entry.action,
    club_id: entry.clubId || null,
    target_user_id: entry.targetUserId || null,
    success: entry.success,
    reason: entry.reason || null,
  };
  const { error } = await supabase.from('club_action_audit').insert(payload);
  if (error) throw error;
}

async function createClubRow(input: {
  creatorUserId: string;
  name: string;
  description: string;
  visibilityMode: ClubVisibilityMode;
}): Promise<SupabaseClubRow> {
  const now = nowUtcIso();
  let lastError: any = null;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const inviteToken = generateInviteToken();
    const payload = {
      name: input.name,
      description: input.description,
      visibility_mode: input.visibilityMode,
      created_by_user_id: input.creatorUserId,
      invite_link_enabled: true,
      invite_link_token: inviteToken,
      allow_member_invites: false,
      require_approval: input.visibilityMode === 'request_to_join',
      default_member_visibility: 'club',
      announcements_posting_roles: ['owner', 'admin'],
      general_chat_enabled: true,
      content_rules: 'Be respectful and accountable.',
      tags: [] as string[],
      location_hint: null,
      created_at: now,
      updated_at: now,
    };

    const { data, error } = await supabase.from('clubs').insert(payload).select('*').single();
    if (!error && data) {
      return data as SupabaseClubRow;
    }
    if (!isUniqueViolation(error)) {
      throw error;
    }
    lastError = error;
  }

  throw lastError || new Error('Unable to allocate an invite token.');
}

async function updateMembershipById(membershipId: string, patch: Record<string, any>) {
  const { data, error } = await supabase
    .from('club_memberships')
    .update(patch)
    .eq('id', membershipId)
    .select('*')
    .single();
  if (error) throw error;
  return data as SupabaseMembershipRow;
}

async function insertMembership(payload: Record<string, any>) {
  const { data, error } = await supabase.from('club_memberships').insert(payload).select('*').single();
  if (error) throw error;
  return data as SupabaseMembershipRow;
}

export async function createClub(input: {
  creatorUserId: string;
  name: string;
  description?: string;
  visibilityMode?: ClubVisibilityMode;
}): Promise<ClubRecord> {
  const creatorUserId = String(input.creatorUserId || '').trim();
  await requireSupabaseClubs(creatorUserId);

  const clubRow = await createClubRow({
    creatorUserId,
    name: String(input.name || '').trim(),
    description: String(input.description || '').trim(),
    visibilityMode: input.visibilityMode || 'private_invite_only',
  });

  const now = nowUtcIso();
  await insertMembership({
    club_id: clubRow.id,
    user_id: creatorUserId,
    role: 'owner',
    status: 'active',
    joined_at: now,
    invited_at: null,
    requested_at: null,
    removed_at: null,
    removed_by_user_id: null,
    muted_in_club_chat: false,
    last_changed_by_user_id: creatorUserId,
    created_at: now,
    updated_at: now,
  });

  await emitClubJoinedEvent({
    actorUserId: creatorUserId,
    clubId: clubRow.id,
    clubName: clubRow.name,
  });

  return toClubRecord(clubRow);
}

export async function listMyClubs(userId: string): Promise<Array<{ club: ClubRecord; membership: ClubMembership }>> {
  const guard = await canUseSupabaseClubs(userId);
  if (!guard.ok) return [];

  const { data, error } = await supabase
    .from('club_memberships')
    .select('*, clubs:club_id(*)')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('updated_at', { ascending: false });
  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  return rows
    .map((row: any) => {
      const clubRaw = Array.isArray(row?.clubs) ? row.clubs[0] : row?.clubs;
      if (!clubRaw) return null;
      return {
        club: toClubRecord(clubRaw as SupabaseClubRow),
        membership: toMembership(row as SupabaseMembershipRow),
      };
    })
    .filter((row): row is { club: ClubRecord; membership: ClubMembership } => Boolean(row))
    .sort((a, b) => b.club.updatedAtUtc.localeCompare(a.club.updatedAtUtc));
}

export async function getClubDetail(clubId: string): Promise<{ club: ClubRecord; memberships: ClubMembership[] } | null> {
  const guard = await canUseSupabaseClubs();
  if (!guard.ok) return null;

  const [clubRaw, membershipsRes] = await Promise.all([
    getClubRow(clubId),
    supabase.from('club_memberships').select('*').eq('club_id', clubId).order('created_at', { ascending: true }),
  ]);

  if (!clubRaw) return null;
  if (membershipsRes.error) throw membershipsRes.error;

  const memberships = (membershipsRes.data || []).map((row: any) => toMembership(row as SupabaseMembershipRow));
  return { club: toClubRecord(clubRaw), memberships };
}

export async function getClubMembership(clubId: string, userId: string): Promise<ClubMembership | null> {
  const guard = await canUseSupabaseClubs(userId);
  if (!guard.ok) return null;
  const row = await getMembershipRow(clubId, userId);
  return row ? toMembership(row) : null;
}

export async function inviteToClub(input: {
  actorUserId: string;
  clubId: string;
  targetUserId: string;
}): Promise<{ ok: boolean; reason: string }> {
  const actorUserId = String(input.actorUserId || '').trim();
  const targetUserId = String(input.targetUserId || '').trim();
  const clubId = String(input.clubId || '').trim();

  const guard = await canUseSupabaseClubs(actorUserId);
  if (!guard.ok) return { ok: false, reason: guard.reason || 'Cloud sync is required for clubs.' };

  const [clubRaw, actorMembership, existing] = await Promise.all([
    getClubRow(clubId),
    getMembershipRow(clubId, actorUserId),
    getMembershipRow(clubId, targetUserId),
  ]);

  if (!clubRaw) return { ok: false, reason: 'Club not found.' };
  if (!actorMembership || actorMembership.status !== 'active') return { ok: false, reason: 'Not a club member.' };

  const actorRole = actorMembership.role as ClubRole;
  const club = toClubRecord(clubRaw);
  if (!(canManageMembers(actorRole) || club.settings.allowMemberInvites)) {
    return { ok: false, reason: 'No invite permission.' };
  }

  const invitesToday = await getAuditCount({
    actorUserId,
    action: 'invite_sent',
    windowMs: 24 * 60 * 60 * 1000,
    success: true,
  });
  if (invitesToday >= CLUB_INVITES_PER_DAY_LIMIT) {
    return { ok: false, reason: 'Invite limit reached for today.' };
  }

  const repeatedInvite = await hasRecentAudit({
    actorUserId,
    action: 'invite_sent',
    clubId,
    targetUserId,
    success: true,
    windowMs: REPEAT_INVITE_COOLDOWN_HOURS * 60 * 60 * 1000,
  });
  if (repeatedInvite) {
    return { ok: false, reason: 'Invite already sent recently.' };
  }

  if (existing?.status === 'active') return { ok: false, reason: 'Already in club.' };
  if (existing?.status === 'banned') return { ok: false, reason: 'User is banned from this club.' };

  const now = nowUtcIso();
  if (existing) {
    await updateMembershipById(existing.id, {
      status: 'invited',
      role: 'member',
      invited_at: now,
      joined_at: null,
      requested_at: null,
      removed_at: null,
      removed_by_user_id: null,
      muted_in_club_chat: false,
      last_changed_by_user_id: actorUserId,
      updated_at: now,
    });
  } else {
    await insertMembership({
      club_id: clubId,
      user_id: targetUserId,
      role: 'member',
      status: 'invited',
      joined_at: null,
      invited_at: now,
      requested_at: null,
      removed_at: null,
      removed_by_user_id: null,
      muted_in_club_chat: false,
      last_changed_by_user_id: actorUserId,
      created_at: now,
      updated_at: now,
    });
  }

  await pushClubActionAudit({
    atUtc: now,
    actorUserId,
    action: 'invite_sent',
    clubId,
    targetUserId,
    success: true,
  });

  return { ok: true, reason: 'Invite sent.' };
}

export async function acceptClubInvite(input: { userId: string; clubId: string }): Promise<{ ok: boolean; reason: string }> {
  const userId = String(input.userId || '').trim();
  const clubId = String(input.clubId || '').trim();
  const guard = await canUseSupabaseClubs(userId);
  if (!guard.ok) return { ok: false, reason: guard.reason || 'Cloud sync is required for clubs.' };

  const [membership, club] = await Promise.all([getMembershipRow(clubId, userId), getClubRow(clubId)]);
  if (!membership || membership.status !== 'invited') {
    return { ok: false, reason: 'No invite found.' };
  }

  const now = nowUtcIso();
  await updateMembershipById(membership.id, {
    status: 'active',
    joined_at: now,
    updated_at: now,
    last_changed_by_user_id: userId,
    removed_at: null,
    removed_by_user_id: null,
  });

  if (club) {
    await emitClubJoinedEvent({ actorUserId: userId, clubId, clubName: String(club.name || '') });
  }

  await pushClubActionAudit({
    atUtc: now,
    actorUserId: userId,
    action: 'invite_accepted',
    clubId,
    success: true,
  });

  return { ok: true, reason: 'Joined club.' };
}

export async function setClubMemberRole(input: {
  actorUserId: string;
  clubId: string;
  targetUserId: string;
  nextRole: ClubRole;
}): Promise<{ ok: boolean; reason: string }> {
  const actorUserId = String(input.actorUserId || '').trim();
  const guard = await canUseSupabaseClubs(actorUserId);
  if (!guard.ok) return { ok: false, reason: guard.reason || 'Cloud sync is required for clubs.' };

  const [actor, target] = await Promise.all([
    getMembershipRow(input.clubId, actorUserId),
    getMembershipRow(input.clubId, input.targetUserId),
  ]);

  if (!actor || !target || actor.status !== 'active' || target.status !== 'active') {
    return { ok: false, reason: 'Membership not found.' };
  }

  if (!canManageMembers(actor.role)) return { ok: false, reason: 'No role permission.' };
  if (target.role === input.nextRole) return { ok: true, reason: 'No role change.' };
  if (!canRoleEdit(actor.role, target.role, input.nextRole)) {
    return { ok: false, reason: 'Cannot set this role.' };
  }

  await updateMembershipById(target.id, {
    role: input.nextRole,
    last_changed_by_user_id: actorUserId,
    updated_at: nowUtcIso(),
  });

  return { ok: true, reason: 'Role updated.' };
}

export async function transferClubOwnership(input: {
  actorUserId: string;
  clubId: string;
  newOwnerUserId: string;
}): Promise<{ ok: boolean; reason: string }> {
  const actorUserId = String(input.actorUserId || '').trim();
  const newOwnerUserId = String(input.newOwnerUserId || '').trim();
  const clubId = String(input.clubId || '').trim();
  const guard = await canUseSupabaseClubs(actorUserId);
  if (!guard.ok) return { ok: false, reason: guard.reason || 'Cloud sync is required for clubs.' };

  const [owner, target] = await Promise.all([
    getMembershipRow(clubId, actorUserId),
    getMembershipRow(clubId, newOwnerUserId),
  ]);
  if (!owner || !target || owner.status !== 'active' || target.status !== 'active') {
    return { ok: false, reason: 'Membership not found.' };
  }
  if (!canTransferOwnership(owner.role)) {
    return { ok: false, reason: 'Only owner can transfer ownership.' };
  }

  const now = nowUtcIso();
  await updateMembershipById(owner.id, {
    role: 'admin',
    last_changed_by_user_id: actorUserId,
    updated_at: now,
  });
  await updateMembershipById(target.id, {
    role: 'owner',
    last_changed_by_user_id: actorUserId,
    updated_at: now,
  });

  const { error } = await supabase
    .from('clubs')
    .update({ created_by_user_id: newOwnerUserId, updated_at: now })
    .eq('id', clubId);
  if (error) throw error;

  return { ok: true, reason: 'Ownership transferred.' };
}

export async function removeClubMember(input: {
  actorUserId: string;
  clubId: string;
  targetUserId: string;
  ban?: boolean;
}): Promise<{ ok: boolean; reason: string }> {
  const actorUserId = String(input.actorUserId || '').trim();
  const targetUserId = String(input.targetUserId || '').trim();
  const clubId = String(input.clubId || '').trim();
  const guard = await canUseSupabaseClubs(actorUserId);
  if (!guard.ok) return { ok: false, reason: guard.reason || 'Cloud sync is required for clubs.' };

  const [actor, target, club] = await Promise.all([
    getMembershipRow(clubId, actorUserId),
    getMembershipRow(clubId, targetUserId),
    getClubRow(clubId),
  ]);

  if (!actor || !target || actor.status !== 'active' || target.status !== 'active') {
    return { ok: false, reason: 'Membership not found.' };
  }
  if (!canModerate(actor.role)) return { ok: false, reason: 'No moderation permission.' };
  if (target.role === 'owner') return { ok: false, reason: 'Cannot remove owner.' };
  if (actor.role === 'moderator' && target.role !== 'member') {
    return { ok: false, reason: 'Moderators can only remove members.' };
  }
  if (actor.role === 'admin' && target.role === 'admin') {
    return { ok: false, reason: 'Admins cannot remove other admins.' };
  }

  const now = nowUtcIso();
  await updateMembershipById(target.id, {
    status: input.ban ? 'banned' : 'removed',
    removed_at: now,
    removed_by_user_id: actorUserId,
    updated_at: now,
    last_changed_by_user_id: actorUserId,
  });

  await createModerationAction({
    actionType: input.ban ? 'ban_from_club' : 'remove_from_club',
    actorUserId,
    targetType: 'user',
    targetId: targetUserId,
    contextClubId: clubId,
    detailsPayload: { role: target.role, status: input.ban ? 'banned' : 'removed' },
  });

  if (club) {
    await emitClubLeftEvent({
      actorUserId: targetUserId,
      clubId,
      clubName: String(club.name || ''),
    });
  }

  return { ok: true, reason: input.ban ? 'Member banned.' : 'Member removed.' };
}

export async function listDiscoverableClubs(userId: string): Promise<ClubRecord[]> {
  const guard = await canUseSupabaseClubs(userId);
  if (!guard.ok) return [];

  const [clubsRes, membershipsRes] = await Promise.all([
    supabase
      .from('clubs')
      .select('*')
      .in('visibility_mode', ['public_discoverable', 'request_to_join'])
      .order('updated_at', { ascending: false }),
    supabase
      .from('club_memberships')
      .select('club_id, status')
      .eq('user_id', userId)
      .in('status', ['active', 'invited', 'pending_request', 'banned']),
  ]);

  if (clubsRes.error) throw clubsRes.error;
  if (membershipsRes.error) throw membershipsRes.error;

  const hidden = new Set((membershipsRes.data || []).map((row: any) => String(row.club_id || '')).filter(Boolean));
  return (clubsRes.data || [])
    .filter((row: any) => !hidden.has(String(row.id || '')))
    .map((row: any) => toClubRecord(row as SupabaseClubRow));
}

export async function requestToJoinClub(input: {
  userId: string;
  clubId: string;
}): Promise<{ ok: boolean; reason: string; status?: ClubMembershipStatus }> {
  const userId = String(input.userId || '').trim();
  const clubId = String(input.clubId || '').trim();
  const guard = await canUseSupabaseClubs(userId);
  if (!guard.ok) return { ok: false, reason: guard.reason || 'Cloud sync is required for clubs.' };

  const [clubRaw, existing] = await Promise.all([getClubRow(clubId), getMembershipRow(clubId, userId)]);
  if (!clubRaw) return { ok: false, reason: 'Club not found.' };

  const club = toClubRecord(clubRaw);
  if (existing?.status === 'banned') return { ok: false, reason: 'You are banned from this club.' };
  if (existing?.status === 'active') return { ok: false, reason: 'Already a member.', status: 'active' };
  if (existing?.status === 'invited') {
    return { ok: false, reason: 'You have an invite. Accept it from club detail.', status: 'invited' };
  }

  if (club.visibilityMode === 'private_invite_only') {
    return { ok: false, reason: 'Invite only. Use an invite link.' };
  }

  const joinRequestsToday = await getAuditCount({
    actorUserId: userId,
    action: 'join_request_sent',
    windowMs: 24 * 60 * 60 * 1000,
    success: true,
  });
  if (joinRequestsToday >= JOIN_REQUESTS_PER_DAY_LIMIT) {
    return { ok: false, reason: 'Join request limit reached for today.' };
  }

  if (existing?.status === 'pending_request' && existing.requested_at) {
    const requestedMs = Date.parse(existing.requested_at);
    if (Number.isFinite(requestedMs)) {
      const cooldownMs = JOIN_REQUEST_COOLDOWN_HOURS * 60 * 60 * 1000;
      if (Date.now() - requestedMs < cooldownMs) {
        return { ok: false, reason: 'Request already sent. Try again later.' };
      }
    }
  }

  const now = nowUtcIso();
  const autoJoin = club.visibilityMode === 'public_discoverable' && !club.settings.requireApproval;
  const nextStatus: ClubMembershipStatus = autoJoin ? 'active' : 'pending_request';

  if (existing) {
    await updateMembershipById(existing.id, {
      status: nextStatus,
      role: 'member',
      requested_at: autoJoin ? existing.requested_at : now,
      joined_at: autoJoin ? now : null,
      removed_at: null,
      removed_by_user_id: null,
      last_changed_by_user_id: userId,
      updated_at: now,
    });
  } else {
    await insertMembership({
      club_id: clubId,
      user_id: userId,
      role: 'member',
      status: nextStatus,
      joined_at: autoJoin ? now : null,
      invited_at: null,
      requested_at: autoJoin ? null : now,
      removed_at: null,
      removed_by_user_id: null,
      muted_in_club_chat: false,
      last_changed_by_user_id: userId,
      created_at: now,
      updated_at: now,
    });
  }

  if (autoJoin) {
    await emitClubJoinedEvent({
      actorUserId: userId,
      clubId,
      clubName: club.name,
    });
  } else {
    await pushClubActionAudit({
      atUtc: now,
      actorUserId: userId,
      action: 'join_request_sent',
      clubId,
      success: true,
    });
  }

  return { ok: true, reason: autoJoin ? 'Joined club.' : 'Join request sent.', status: nextStatus };
}

export async function approveJoinRequest(input: {
  actorUserId: string;
  clubId: string;
  targetUserId: string;
}): Promise<{ ok: boolean; reason: string }> {
  const actorUserId = String(input.actorUserId || '').trim();
  const targetUserId = String(input.targetUserId || '').trim();
  const clubId = String(input.clubId || '').trim();
  const guard = await canUseSupabaseClubs(actorUserId);
  if (!guard.ok) return { ok: false, reason: guard.reason || 'Cloud sync is required for clubs.' };

  const [actor, target, club] = await Promise.all([
    getMembershipRow(clubId, actorUserId),
    getMembershipRow(clubId, targetUserId),
    getClubRow(clubId),
  ]);

  if (!actor || actor.status !== 'active' || !canManageMembers(actor.role)) {
    return { ok: false, reason: 'No approval permission.' };
  }
  if (!target || target.status !== 'pending_request') {
    return { ok: false, reason: 'No pending request found.' };
  }

  const now = nowUtcIso();
  await updateMembershipById(target.id, {
    status: 'active',
    joined_at: now,
    last_changed_by_user_id: actorUserId,
    updated_at: now,
    removed_at: null,
    removed_by_user_id: null,
  });

  if (club) {
    await emitClubJoinedEvent({
      actorUserId: targetUserId,
      clubId,
      clubName: String(club.name || ''),
    });
  }

  await pushClubActionAudit({
    atUtc: now,
    actorUserId,
    action: 'join_request_approved',
    clubId,
    targetUserId,
    success: true,
  });

  return { ok: true, reason: 'Request approved.' };
}

export async function declineJoinRequest(input: {
  actorUserId: string;
  clubId: string;
  targetUserId: string;
}): Promise<{ ok: boolean; reason: string }> {
  const actorUserId = String(input.actorUserId || '').trim();
  const targetUserId = String(input.targetUserId || '').trim();
  const clubId = String(input.clubId || '').trim();
  const guard = await canUseSupabaseClubs(actorUserId);
  if (!guard.ok) return { ok: false, reason: guard.reason || 'Cloud sync is required for clubs.' };

  const [actor, target] = await Promise.all([
    getMembershipRow(clubId, actorUserId),
    getMembershipRow(clubId, targetUserId),
  ]);

  if (!actor || actor.status !== 'active' || !canManageMembers(actor.role)) {
    return { ok: false, reason: 'No approval permission.' };
  }
  if (!target || target.status !== 'pending_request') {
    return { ok: false, reason: 'No pending request found.' };
  }

  const now = nowUtcIso();
  await updateMembershipById(target.id, {
    status: 'removed',
    removed_at: now,
    removed_by_user_id: actorUserId,
    last_changed_by_user_id: actorUserId,
    updated_at: now,
  });

  await pushClubActionAudit({
    atUtc: now,
    actorUserId,
    action: 'join_request_declined',
    clubId,
    targetUserId,
    success: true,
  });

  return { ok: true, reason: 'Request declined.' };
}

export async function joinClubByInviteToken(input: {
  userId: string;
  inviteToken: string;
}): Promise<{ ok: boolean; reason: string; clubId?: string }> {
  const userId = String(input.userId || '').trim();
  const token = String(input.inviteToken || '').trim();
  const guard = await canUseSupabaseClubs(userId);
  if (!guard.ok) return { ok: false, reason: guard.reason || 'Cloud sync is required for clubs.' };

  if (!token) return { ok: false, reason: 'Enter an invite token.' };

  const failedAttempts = await getAuditCount({
    actorUserId: userId,
    action: 'invite_token_failed',
    windowMs: 60 * 60 * 1000,
  });
  if (failedAttempts >= INVITE_TOKEN_FAILED_ATTEMPTS_PER_HOUR_LIMIT) {
    return { ok: false, reason: 'Too many invalid token attempts. Try again later.' };
  }

  const { data: clubs, error } = await supabase
    .from('clubs')
    .select('*')
    .eq('invite_link_enabled', true)
    .eq('invite_link_token', token)
    .limit(1);
  if (error) throw error;

  const clubRaw = Array.isArray(clubs) && clubs.length ? (clubs[0] as SupabaseClubRow) : null;
  if (!clubRaw) {
    await pushClubActionAudit({
      atUtc: nowUtcIso(),
      actorUserId: userId,
      action: 'invite_token_failed',
      success: false,
      reason: 'invalid_token',
    });
    return { ok: false, reason: 'Invite token is invalid.' };
  }

  const existing = await getMembershipRow(clubRaw.id, userId);
  if (existing?.status === 'banned') return { ok: false, reason: 'You are banned from this club.' };
  if (existing?.status === 'active') return { ok: true, reason: 'Already joined.', clubId: clubRaw.id };

  const now = nowUtcIso();
  if (existing) {
    await updateMembershipById(existing.id, {
      status: 'active',
      role: 'member',
      joined_at: now,
      invited_at: existing.invited_at || now,
      requested_at: null,
      removed_at: null,
      removed_by_user_id: null,
      muted_in_club_chat: false,
      last_changed_by_user_id: userId,
      updated_at: now,
    });
  } else {
    await insertMembership({
      club_id: clubRaw.id,
      user_id: userId,
      role: 'member',
      status: 'active',
      joined_at: now,
      invited_at: now,
      requested_at: null,
      removed_at: null,
      removed_by_user_id: null,
      muted_in_club_chat: false,
      last_changed_by_user_id: userId,
      created_at: now,
      updated_at: now,
    });
  }

  await emitClubJoinedEvent({
    actorUserId: userId,
    clubId: clubRaw.id,
    clubName: clubRaw.name,
  });

  await pushClubActionAudit({
    atUtc: now,
    actorUserId: userId,
    action: 'invite_token_joined',
    clubId: clubRaw.id,
    success: true,
  });

  return { ok: true, reason: 'Joined via invite link.', clubId: clubRaw.id };
}

export async function rotateInviteLinkToken(input: {
  actorUserId: string;
  clubId: string;
}): Promise<{ ok: boolean; reason: string; token?: string }> {
  const actorUserId = String(input.actorUserId || '').trim();
  const clubId = String(input.clubId || '').trim();
  const guard = await canUseSupabaseClubs(actorUserId);
  if (!guard.ok) return { ok: false, reason: guard.reason || 'Cloud sync is required for clubs.' };

  const [actor, club] = await Promise.all([getMembershipRow(clubId, actorUserId), getClubRow(clubId)]);
  if (!club) return { ok: false, reason: 'Club not found.' };
  if (!actor || actor.status !== 'active' || !canManageMembers(actor.role)) {
    return { ok: false, reason: 'No link permission.' };
  }

  const rotationsToday = await getAuditCount({
    actorUserId,
    action: 'invite_token_rotated',
    clubId,
    success: true,
    windowMs: 24 * 60 * 60 * 1000,
  });
  if (rotationsToday >= TOKEN_ROTATIONS_PER_DAY_LIMIT) {
    return { ok: false, reason: 'Token rotation limit reached for today.' };
  }

  const now = nowUtcIso();
  let lastError: any = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const token = generateInviteToken();
    const { error } = await supabase
      .from('clubs')
      .update({ invite_link_token: token, invite_link_enabled: true, updated_at: now })
      .eq('id', clubId);

    if (!error) {
      await pushClubActionAudit({
        atUtc: now,
        actorUserId,
        action: 'invite_token_rotated',
        clubId,
        success: true,
      });
      return { ok: true, reason: 'Invite token rotated.', token };
    }

    if (!isUniqueViolation(error)) {
      throw error;
    }
    lastError = error;
  }

  throw lastError || new Error('Unable to rotate invite token.');
}

export async function listAutoShareClubIdsForUser(userId: string): Promise<string[]> {
  const rows = await listMyClubs(userId);
  return rows
    .filter((row) => row.club.settings.defaultMemberVisibility === 'club')
    .map((row) => row.club.clubId);
}

export async function listClubMemberships(clubId: string): Promise<ClubMembership[]> {
  const guard = await canUseSupabaseClubs();
  if (!guard.ok) return [];
  const { data, error } = await supabase
    .from('club_memberships')
    .select('*')
    .eq('club_id', clubId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map((row: any) => toMembership(row as SupabaseMembershipRow));
}

export async function setClubChatMute(input: {
  actorUserId: string;
  clubId: string;
  targetUserId: string;
  muted: boolean;
}): Promise<{ ok: boolean; reason: string }> {
  const actorUserId = String(input.actorUserId || '').trim();
  const targetUserId = String(input.targetUserId || '').trim();
  const clubId = String(input.clubId || '').trim();
  const guard = await canUseSupabaseClubs(actorUserId);
  if (!guard.ok) return { ok: false, reason: guard.reason || 'Cloud sync is required for clubs.' };

  const [actor, target] = await Promise.all([
    getMembershipRow(clubId, actorUserId),
    getMembershipRow(clubId, targetUserId),
  ]);

  if (!actor || !target || actor.status !== 'active' || target.status !== 'active') {
    return { ok: false, reason: 'Membership not found.' };
  }
  if (!canModerate(actor.role)) return { ok: false, reason: 'No moderation permission.' };
  if (targetUserId === actorUserId) return { ok: false, reason: 'Cannot mute yourself.' };
  if (actor.role === 'moderator' && target.role !== 'member') {
    return { ok: false, reason: 'Moderators can only mute members.' };
  }
  if (actor.role === 'admin' && target.role === 'admin') {
    return { ok: false, reason: 'Admins cannot mute other admins.' };
  }
  if (target.role === 'owner') return { ok: false, reason: 'Cannot mute owner.' };

  await updateMembershipById(target.id, {
    muted_in_club_chat: Boolean(input.muted),
    updated_at: nowUtcIso(),
    last_changed_by_user_id: actorUserId,
  });

  await createModerationAction({
    actionType: 'mute_in_club',
    actorUserId,
    targetType: 'user',
    targetId: targetUserId,
    contextClubId: clubId,
    detailsPayload: { muted: Boolean(input.muted) },
  });

  return { ok: true, reason: input.muted ? 'Member muted in club chat.' : 'Member unmuted in club chat.' };
}
