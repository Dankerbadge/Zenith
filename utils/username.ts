// Username utilities for Zenith social features.
// Canonical storage: lower-case, without leading "@", 3-20 chars, [a-z0-9._]

export const USERNAME_MIN_LEN = 3;
export const USERNAME_MAX_LEN = 20;

export function normalizeUsername(input: string): string {
  let v = String(input || '').trim().toLowerCase();
  if (v.startsWith('@')) v = v.replace(/^@+/, '');
  // Common user intent: spaces become underscores.
  v = v.replace(/\s+/g, '_');
  // Strip invalid characters.
  v = v.replace(/[^a-z0-9._]/g, '');
  // Collapse consecutive underscores.
  v = v.replace(/_+/g, '_');
  // Trim punctuation at edges.
  v = v.replace(/^[._]+/, '').replace(/[._]+$/, '');
  return v;
}

export function isUsernameValid(username: string): boolean {
  const v = normalizeUsername(username);
  if (v.length < USERNAME_MIN_LEN || v.length > USERNAME_MAX_LEN) return false;
  return /^[a-z0-9._]+$/.test(v);
}

export function formatHandle(username: string | null | undefined): string {
  const v = String(username || '').trim();
  if (!v) return '@unknown';
  return v.startsWith('@') ? v : `@${v}`;
}

export function buildFallbackUsername(suffix: number | string): string {
  const s = String(suffix).replace(/[^0-9]/g, '');
  const padded = s.length >= 4 ? s.slice(-4) : s.padStart(4, '0');
  return `zenith-athlete-${padded}`;
}

