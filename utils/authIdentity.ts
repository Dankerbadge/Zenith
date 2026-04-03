import { isSupabaseConfigured, supabase } from './supabaseClient';

type CacheEntry = {
  userId: string | null;
  atMs: number;
};

let cache: CacheEntry | null = null;
const CACHE_TTL_MS = 30_000;

function nowMs() {
  return Date.now();
}

export async function getAuthenticatedUserId(forceRefresh = false): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  if (!forceRefresh && cache && nowMs() - cache.atMs <= CACHE_TTL_MS) {
    return cache.userId;
  }
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      cache = { userId: null, atMs: nowMs() };
      return null;
    }
    const userId = String(data.session?.user?.id || '').trim() || null;
    cache = { userId, atMs: nowMs() };
    return userId;
  } catch {
    cache = { userId: null, atMs: nowMs() };
    return null;
  }
}
