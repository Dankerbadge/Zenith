import AsyncStorage from '@react-native-async-storage/async-storage';

const REPORTS_KEY = 'moderationReportsV1';
const MOD_ACTIONS_KEY = 'moderationActionsV1';
const MODERATION_SCHEMA_VERSION = 1;
const REPORTS_PER_DAY_LIMIT = 60;
const DUPLICATE_REPORT_COOLDOWN_MIN = 15;

export type ReportTargetType = 'user' | 'event' | 'message' | 'club';
export type ReportStatus = 'open' | 'reviewed' | 'action_taken' | 'closed_no_action';
export type ModerationActionType =
  | 'report_user'
  | 'report_event'
  | 'report_message'
  | 'mute_in_club'
  | 'remove_from_club'
  | 'ban_from_club'
  | 'global_restrict_messaging'
  | 'global_ban';

export type ReportRecord = {
  reportId: string;
  reporterUserId: string;
  targetType: ReportTargetType;
  targetId: string;
  reasonCategory: string;
  description?: string;
  contextClubId?: string | null;
  createdAtUtc: string;
  status: ReportStatus;
  schemaVersion: number;
};

export type ModerationActionRecord = {
  moderationActionId: string;
  actionType: ModerationActionType;
  actorUserId: string;
  targetType: ReportTargetType | 'thread' | 'unknown';
  targetId: string;
  contextClubId?: string | null;
  createdAtUtc: string;
  expiresAtUtc?: string | null;
  detailsPayload?: Record<string, string | number | boolean> | null;
  schemaVersion: number;
};

function nowUtcIso() {
  return new Date().toISOString();
}

function safeParse<T>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function withinWindow(atUtc: string, windowMs: number): boolean {
  const ts = Date.parse(atUtc);
  return Number.isFinite(ts) && Date.now() - ts <= windowMs;
}

async function getReports(): Promise<ReportRecord[]> {
  const raw = await AsyncStorage.getItem(REPORTS_KEY);
  return safeParse<ReportRecord>(raw);
}

async function setReports(rows: ReportRecord[]) {
  await AsyncStorage.setItem(REPORTS_KEY, JSON.stringify(rows.slice(-3000)));
}

async function getActions(): Promise<ModerationActionRecord[]> {
  const raw = await AsyncStorage.getItem(MOD_ACTIONS_KEY);
  return safeParse<ModerationActionRecord>(raw);
}

async function setActions(rows: ModerationActionRecord[]) {
  await AsyncStorage.setItem(MOD_ACTIONS_KEY, JSON.stringify(rows.slice(-3000)));
}

export async function createReport(input: {
  reporterUserId: string;
  targetType: ReportTargetType;
  targetId: string;
  reasonCategory: string;
  description?: string;
  contextClubId?: string | null;
}): Promise<ReportRecord> {
  const existing = await getReports();
  const now = nowUtcIso();
  const byReporterToday = existing.filter(
    (row) => row.reporterUserId === input.reporterUserId && withinWindow(row.createdAtUtc, 24 * 60 * 60 * 1000)
  );
  if (byReporterToday.length >= REPORTS_PER_DAY_LIMIT) {
    return byReporterToday.sort((a, b) => b.createdAtUtc.localeCompare(a.createdAtUtc))[0];
  }

  const duplicateRecent = existing.find(
    (row) =>
      row.reporterUserId === input.reporterUserId &&
      row.targetType === input.targetType &&
      row.targetId === input.targetId &&
      row.reasonCategory === input.reasonCategory &&
      withinWindow(row.createdAtUtc, DUPLICATE_REPORT_COOLDOWN_MIN * 60 * 1000)
  );
  if (duplicateRecent) {
    return duplicateRecent;
  }

  const report: ReportRecord = {
    reportId: `report_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    reporterUserId: input.reporterUserId,
    targetType: input.targetType,
    targetId: input.targetId,
    reasonCategory: input.reasonCategory,
    description: input.description,
    contextClubId: input.contextClubId || null,
    createdAtUtc: now,
    status: 'open',
    schemaVersion: MODERATION_SCHEMA_VERSION,
  };
  const rows = await getReports();
  await setReports([...rows, report]);
  return report;
}

export async function reportUser(input: {
  reporterUserId: string;
  targetUserId: string;
  reasonCategory: string;
  description?: string;
}) {
  return createReport({
    reporterUserId: input.reporterUserId,
    targetType: 'user',
    targetId: input.targetUserId,
    reasonCategory: input.reasonCategory,
    description: input.description,
  });
}

export async function reportEvent(input: {
  reporterUserId: string;
  eventId: string;
  reasonCategory: string;
  description?: string;
}) {
  return createReport({
    reporterUserId: input.reporterUserId,
    targetType: 'event',
    targetId: input.eventId,
    reasonCategory: input.reasonCategory,
    description: input.description,
  });
}

export async function reportMessage(input: {
  reporterUserId: string;
  messageId: string;
  reasonCategory: string;
  description?: string;
}) {
  return createReport({
    reporterUserId: input.reporterUserId,
    targetType: 'message',
    targetId: input.messageId,
    reasonCategory: input.reasonCategory,
    description: input.description,
  });
}

export async function createModerationAction(input: {
  actionType: ModerationActionType;
  actorUserId: string;
  targetType: ModerationActionRecord['targetType'];
  targetId: string;
  expiresAtUtc?: string | null;
  contextClubId?: string | null;
  detailsPayload?: Record<string, string | number | boolean> | null;
}): Promise<ModerationActionRecord> {
  const action: ModerationActionRecord = {
    moderationActionId: `mod_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    actionType: input.actionType,
    actorUserId: input.actorUserId,
    targetType: input.targetType,
    targetId: input.targetId,
    contextClubId: input.contextClubId || null,
    createdAtUtc: nowUtcIso(),
    expiresAtUtc: input.expiresAtUtc || null,
    detailsPayload: input.detailsPayload || null,
    schemaVersion: MODERATION_SCHEMA_VERSION,
  };
  const rows = await getActions();
  await setActions([...rows, action]);
  return action;
}

export async function restrictMessagingForUser(input: {
  targetUserId: string;
  actorUserId?: string;
  durationHours?: number;
  reason?: string;
}) {
  const expiresAtUtc = new Date(Date.now() + Math.max(1, Number(input.durationHours) || 24) * 60 * 60 * 1000).toISOString();
  return createModerationAction({
    actionType: 'global_restrict_messaging',
    actorUserId: input.actorUserId || 'system',
    targetType: 'user',
    targetId: input.targetUserId,
    expiresAtUtc,
    detailsPayload: input.reason ? { reason: input.reason } : null,
  });
}

export async function isMessagingRestricted(userId: string): Promise<boolean> {
  const rows = await getActions();
  const now = Date.now();
  return rows.some((row) => {
    if (row.targetType !== 'user' || row.targetId !== userId) return false;
    if (row.actionType !== 'global_restrict_messaging' && row.actionType !== 'global_ban') return false;
    if (!row.expiresAtUtc) return true;
    const expires = Date.parse(row.expiresAtUtc);
    return Number.isFinite(expires) && expires > now;
  });
}

export async function listReportsForUser(userId: string): Promise<ReportRecord[]> {
  const rows = await getReports();
  return rows
    .filter((row) => row.reporterUserId === userId)
    .sort((a, b) => b.createdAtUtc.localeCompare(a.createdAtUtc));
}

export async function listModerationActions(): Promise<ModerationActionRecord[]> {
  const rows = await getActions();
  return rows.sort((a, b) => b.createdAtUtc.localeCompare(a.createdAtUtc));
}
