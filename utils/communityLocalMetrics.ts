import AsyncStorage from '@react-native-async-storage/async-storage';
import { APP_CONFIG } from './appConfig';
import { isSupabaseConfigured, supabase } from './supabaseClient';

export type CommunityLocalMetrics = {
  postsTotal: number;
  likesGivenTotal: number;
  likesReceivedTotal: number;
  commentsTotal: number;
  challengesJoinedTotal: number;
  challengesWonTotal: number;
  leaderboardTop10Total: number;
};

const KEY = 'zenith.communityLocalMetrics.v1';

const EMPTY: CommunityLocalMetrics = {
  postsTotal: 0,
  likesGivenTotal: 0,
  likesReceivedTotal: 0,
  commentsTotal: 0,
  challengesJoinedTotal: 0,
  challengesWonTotal: 0,
  leaderboardTop10Total: 0,
};

function safeParse(raw: string | null): CommunityLocalMetrics {
  if (!raw) return { ...EMPTY };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...EMPTY };
    return {
      postsTotal: Math.max(0, Number((parsed as any).postsTotal) || 0),
      likesGivenTotal: Math.max(0, Number((parsed as any).likesGivenTotal) || 0),
      likesReceivedTotal: Math.max(0, Number((parsed as any).likesReceivedTotal) || 0),
      commentsTotal: Math.max(0, Number((parsed as any).commentsTotal) || 0),
      challengesJoinedTotal: Math.max(0, Number((parsed as any).challengesJoinedTotal) || 0),
      challengesWonTotal: Math.max(0, Number((parsed as any).challengesWonTotal) || 0),
      leaderboardTop10Total: Math.max(0, Number((parsed as any).leaderboardTop10Total) || 0),
    };
  } catch {
    return { ...EMPTY };
  }
}

async function canUseSupabaseCommunity() {
  const socialEnabled = APP_CONFIG.FEATURES.SOCIAL_FEATURES_ENABLED || APP_CONFIG.RUNTIME.OVERRIDES.SOCIAL_FEATURES_ENABLED;
  if (!socialEnabled || !isSupabaseConfigured) return { ok: false as const, userId: null as string | null };
  try {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user?.id ?? null;
    if (!userId) return { ok: false as const, userId: null as string | null };
    return { ok: true as const, userId };
  } catch {
    return { ok: false as const, userId: null as string | null };
  }
}

async function countExact(table: string, filters: Array<[string, any]>): Promise<number> {
  let q: any = supabase.from(table).select('id', { count: 'exact', head: true });
  filters.forEach(([key, value]) => {
    q = q.eq(key, value);
  });
  const { count, error } = await q;
  if (error) throw error;
  return Number(count) || 0;
}

export async function getCommunityLocalMetrics(): Promise<CommunityLocalMetrics> {
  const supa = await canUseSupabaseCommunity();
  if (supa.ok && supa.userId) {
    const userId = supa.userId;
    try {
      const [postsTotal, likesGivenTotal, commentsTotal] = await Promise.all([
        countExact('posts', [['user_id', userId]]),
        countExact('likes', [['user_id', userId]]),
        countExact('comments', [['user_id', userId]]),
      ]);

      // Likes received: count likes on my posts.
      const { data: myPosts, error: postsErr } = await supabase.from('posts').select('id').eq('user_id', userId).limit(500);
      if (postsErr) throw postsErr;
      const postIds = Array.isArray(myPosts) ? myPosts.map((r: any) => r.id).filter(Boolean) : [];
      let likesReceivedTotal = 0;
      if (postIds.length) {
        const { count, error } = await supabase.from('likes').select('id', { count: 'exact', head: true }).in('post_id', postIds);
        if (error) throw error;
        likesReceivedTotal = Number(count) || 0;
      }

      return {
        postsTotal,
        likesGivenTotal,
        likesReceivedTotal,
        commentsTotal,
        challengesJoinedTotal: 0,
        challengesWonTotal: 0,
        leaderboardTop10Total: 0,
      };
    } catch {
      // Fall back to local counters if Supabase errors (offline, RLS, etc).
    }
  }

  const raw = await AsyncStorage.getItem(KEY);
  return safeParse(raw);
}

async function write(next: CommunityLocalMetrics) {
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
}

export async function recordCommunityEvent(
  event:
    | { type: 'post_created' }
    | { type: 'like_given' }
    | { type: 'like_received' }
    | { type: 'comment_created' }
    | { type: 'challenge_joined' }
    | { type: 'challenge_won' }
    | { type: 'leaderboard_top10' }
) {
  // In Supabase-backed social builds, local counters must not be the source of truth.
  const supa = await canUseSupabaseCommunity();
  if (supa.ok) return getCommunityLocalMetrics();

  const current = await getCommunityLocalMetrics();
  const next = { ...current };
  switch (event.type) {
    case 'post_created':
      next.postsTotal += 1;
      break;
    case 'like_given':
      next.likesGivenTotal += 1;
      break;
    case 'like_received':
      next.likesReceivedTotal += 1;
      break;
    case 'comment_created':
      next.commentsTotal += 1;
      break;
    case 'challenge_joined':
      next.challengesJoinedTotal += 1;
      break;
    case 'challenge_won':
      next.challengesWonTotal += 1;
      break;
    case 'leaderboard_top10':
      next.leaderboardTop10Total += 1;
      break;
  }
  await write(next);
  return next;
}
