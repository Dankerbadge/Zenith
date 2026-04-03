export type EventSource = 'team' | 'group' | 'personal';

export function isTeamGroup(group: any | null): boolean {
  if (!group) return false;
  const kind = String(group?.kind || '').trim().toLowerCase();
  const joinCode = String(group?.join_code || '').trim().toLowerCase();
  if (kind === 'coaching_team') return true;
  return joinCode.startsWith('team:');
}

export function getEventSource(ev: any): EventSource {
  if (!ev?.group_id) return 'personal';
  const group = ev?.groups || null;
  return isTeamGroup(group) ? 'team' : 'group';
}

export function eventTypeLabel(raw: any): string {
  const v = String(raw || '').trim().toLowerCase();
  if (!v) return 'Event';
  if (v === 'training') return 'Training';
  if (v === 'social') return 'Social';
  if (v === 'race') return 'Race';
  if (v === 'meeting') return 'Meeting';
  if (v === 'travel') return 'Travel';
  if (v === 'other') return 'Other';
  return v;
}

export function toLocalDateKey(iso?: string | null): string {
  const d = iso ? new Date(String(iso)) : null;
  if (!d || !Number.isFinite(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function formatTimeWindow(startIso?: string | null, endIso?: string | null): string {
  const start = startIso ? new Date(String(startIso)) : null;
  if (!start || !Number.isFinite(start.getTime())) return '—';
  const s = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const end = endIso ? new Date(String(endIso)) : null;
  if (end && Number.isFinite(end.getTime())) {
    const e = end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return `${s}–${e}`;
  }
  return s;
}

export function formatEventDateHeader(localDateKey: string): string {
  if (!localDateKey) return '—';
  const [y, m, d] = localDateKey.split('-').map((t) => Number(t));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return localDateKey;
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return dt.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

export function isUpcoming(startIso?: string | null, now = new Date()): boolean {
  const start = startIso ? Date.parse(String(startIso)) : NaN;
  if (!Number.isFinite(start)) return false;
  return start >= now.getTime();
}

export function splitUpcomingPast<T extends { start_at?: string | null }>(events: T[], now = new Date()): { upcoming: T[]; past: T[] } {
  const upcoming: T[] = [];
  const past: T[] = [];
  for (const ev of Array.isArray(events) ? events : []) {
    const start = ev?.start_at ? Date.parse(String(ev.start_at)) : NaN;
    if (!Number.isFinite(start)) continue;
    if (start >= now.getTime()) upcoming.push(ev);
    else past.push(ev);
  }
  upcoming.sort((a, b) => Date.parse(String(a.start_at || '0')) - Date.parse(String(b.start_at || '0')));
  past.sort((a, b) => Date.parse(String(b.start_at || '0')) - Date.parse(String(a.start_at || '0')));
  return { upcoming, past };
}

