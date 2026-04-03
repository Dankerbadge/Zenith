import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { APP_CONFIG } from './appConfig';
import { captureException, captureMessage } from './crashReporter';

const SECURE_AUTH_PREFIX = 'sb_auth';
const SECURE_CHUNK_SIZE = 1800;

function toSecureKey(rawKey: string) {
  const normalized = String(rawKey || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '_');
  return `${SECURE_AUTH_PREFIX}_${normalized || 'key'}`;
}

function secureMetaKey(rawKey: string) {
  return `${toSecureKey(rawKey)}__meta`;
}

function secureChunkKey(rawKey: string, index: number) {
  return `${toSecureKey(rawKey)}__chunk_${String(index)}`;
}

async function readChunkCount(rawKey: string): Promise<number> {
  try {
    const meta = await SecureStore.getItemAsync(secureMetaKey(rawKey));
    if (!meta) return 0;
    const parsed = JSON.parse(meta) as { chunks?: number } | null;
    const count = Number(parsed?.chunks || 0);
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  } catch (err) {
    void captureException(err, { feature: 'supabase_client', op: 'read_chunk_count' });
    return 0;
  }
}

async function writeSecureChunks(rawKey: string, value: string) {
  const previousCount = await readChunkCount(rawKey);
  for (let i = 0; i < previousCount; i += 1) {
    try {
      await SecureStore.deleteItemAsync(secureChunkKey(rawKey, i));
    } catch (err) {
      void captureException(err, { feature: 'supabase_client', op: 'write_secure_chunks_clear_previous', key: rawKey, index: i });
    }
  }

  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += SECURE_CHUNK_SIZE) {
    chunks.push(value.slice(i, i + SECURE_CHUNK_SIZE));
  }

  for (let i = 0; i < chunks.length; i += 1) {
    try {
      await SecureStore.setItemAsync(secureChunkKey(rawKey, i), chunks[i]);
    } catch (err) {
      void captureException(err, { feature: 'supabase_client', op: 'write_secure_chunks_set_chunk', key: rawKey, index: i });
    }
  }

  try {
    await SecureStore.setItemAsync(secureMetaKey(rawKey), JSON.stringify({ chunks: chunks.length }));
  } catch (err) {
    void captureException(err, { feature: 'supabase_client', op: 'write_secure_chunks_set_meta', key: rawKey });
  }
}

async function readSecureChunks(rawKey: string): Promise<string | null> {
  const count = await readChunkCount(rawKey);
  if (count <= 0) return null;

  const parts: string[] = [];
  for (let i = 0; i < count; i += 1) {
    try {
      const value = await SecureStore.getItemAsync(secureChunkKey(rawKey, i));
      if (typeof value !== 'string') return null;
      parts.push(value);
    } catch (err) {
      void captureException(err, { feature: 'supabase_client', op: 'read_secure_chunk', index: i });
      return null;
    }
  }
  return parts.join('');
}

async function removeSecureChunks(rawKey: string) {
  const count = await readChunkCount(rawKey);
  for (let i = 0; i < count; i += 1) {
    try {
      await SecureStore.deleteItemAsync(secureChunkKey(rawKey, i));
    } catch (err) {
      void captureException(err, { feature: 'supabase_client', op: 'remove_secure_chunks_delete_chunk', key: rawKey, index: i });
    }
  }
  try {
    await SecureStore.deleteItemAsync(secureMetaKey(rawKey));
  } catch (err) {
    void captureException(err, { feature: 'supabase_client', op: 'remove_secure_chunks_delete_meta', key: rawKey });
  }
}

function readExtra(key: string): string {
  const extra =
    (Constants.expoConfig as any)?.extra ||
    (Constants.manifest2 as any)?.extra ||
    (Constants.manifest as any)?.extra ||
    null;
  const value = extra ? (extra as any)[key] : undefined;
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return String(value);
}

function randomInviteCode6(): string {
  // Allow leading zeros. Avoid "000000" because it looks like an error code.
  let n = 0;
  while (n === 0) {
    n = Math.floor(Math.random() * 1_000_000);
  }
  return String(n).padStart(6, '0');
}

function isUniqueViolation(error: any): boolean {
  const code = String((error as any)?.code || '');
  if (code === '23505') return true;
  const msg = String((error as any)?.message || '').toLowerCase();
  if (msg.includes('duplicate key value')) return true;
  if (msg.includes('unique constraint')) return true;
  return false;
}

function isSchemaCacheDrift(error: any): boolean {
  const msg = String((error as any)?.message || '').toLowerCase();
  return msg.includes('schema cache') || (msg.includes('could not find') && msg.includes('schema cache'));
}

function isMissingColumn(error: any, column: string): boolean {
  const col = String(column || '').trim().toLowerCase();
  if (!col) return false;
  const msg = String((error as any)?.message || '').toLowerCase();
  return (msg.includes('column') || msg.includes('could not find')) && msg.includes(col) && (msg.includes('does not exist') || msg.includes('schema cache'));
}

function isMissingFunction(error: any, fn: string): boolean {
  const f = String(fn || '').trim().toLowerCase();
  if (!f) return false;
  const msg = String((error as any)?.message || '').toLowerCase();
  return (msg.includes('function') || msg.includes('rpc')) && msg.includes(f) && (msg.includes('does not exist') || msg.includes('schema cache'));
}

// Prefer Metro/EAS `EXPO_PUBLIC_*` inlining, but fall back to app.json `expo.extra`
// for deterministic Xcode Archive/TestFlight/App Store builds.
const ENV_SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || readExtra('EXPO_PUBLIC_SUPABASE_URL');
const ENV_SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || readExtra('EXPO_PUBLIC_SUPABASE_ANON_KEY');
const FALLBACK_SUPABASE_URL = 'https://placeholder.supabase.co';
const FALLBACK_SUPABASE_ANON_KEY = 'placeholder-anon-key';

type SupabaseConfigStatus = { configured: boolean; reason?: string };

function looksLikeUrl(value: string) {
  const v = value.trim();
  return v.startsWith('https://') && v.length >= 12;
}

function looksPlaceholder(value: string) {
  const v = value.trim();
  if (!v) return true;
  const lower = v.toLowerCase();
  if (v === FALLBACK_SUPABASE_URL || v === FALLBACK_SUPABASE_ANON_KEY) return true;
  if (lower.includes('placeholder')) return true;
  if (lower.includes('changeme')) return true;
  if (lower === 'your_key' || lower === 'yourkey') return true;
  if (lower.startsWith('example')) return true;
  // Supabase anon keys are typically long; treat extremely short tokens as misconfig.
  if (v.length < 20) return true;
  return false;
}

function resolveSupabaseConfigStatus(): { status: SupabaseConfigStatus; url: string; anonKey: string } {
  const url = String(ENV_SUPABASE_URL || '').trim();
  const anonKey = String(ENV_SUPABASE_ANON_KEY || '').trim();

  if (!url || !anonKey) {
    return {
      status: { configured: false, reason: 'missing_env' },
      url: FALLBACK_SUPABASE_URL,
      anonKey: FALLBACK_SUPABASE_ANON_KEY,
    };
  }

  if (!looksLikeUrl(url)) {
    return {
      status: { configured: false, reason: 'invalid_url' },
      url: FALLBACK_SUPABASE_URL,
      anonKey: FALLBACK_SUPABASE_ANON_KEY,
    };
  }

  if (looksPlaceholder(url) || looksPlaceholder(anonKey)) {
    return {
      status: { configured: false, reason: 'placeholder_env' },
      url: FALLBACK_SUPABASE_URL,
      anonKey: FALLBACK_SUPABASE_ANON_KEY,
    };
  }

  return {
    status: { configured: true },
    url,
    anonKey,
  };
}

const resolved = resolveSupabaseConfigStatus();

export const isSupabaseConfigured = resolved.status.configured;

export function getSupabaseConfigStatus(): SupabaseConfigStatus {
  return { ...resolved.status };
}

export function getSupabaseProjectRefFromUrl(url: string): string {
  const match = String(url || '')
    .trim()
    .match(/^https:\/\/([^.]+)\.supabase\.co/i);
  return match?.[1] || '';
}

export function getSupabaseProjectRef(): string {
  if (!isSupabaseConfigured) return '';
  return getSupabaseProjectRefFromUrl(resolved.url);
}

const SUPABASE_REF_GUARD_KEY = 'zenith:supabase:project_ref';

export async function runSupabaseProjectRefGuard(): Promise<void> {
  if (!isSupabaseConfigured) return;
  const ref = getSupabaseProjectRef();
  if (!ref) return;

  try {
    const stored = await SecureStore.getItemAsync(SUPABASE_REF_GUARD_KEY);
    if (!stored) {
      await SecureStore.setItemAsync(SUPABASE_REF_GUARD_KEY, ref);
      return;
    }

    if (stored !== ref) {
      const msg = `[supabase] Project ref changed: ${stored} -> ${ref}. This can make users look "reset" if a release build points at a different Supabase project.`;
      void captureMessage(msg, { feature: 'supabase_env_guard', from: stored, to: ref });
      if (__DEV__) throw new Error(msg);
    }
  } catch (err) {
    void captureException(err, { feature: 'supabase_env_guard', op: 'run' });
  }
}

export function assertSupabaseConfigured(actionName?: string) {
  if (isSupabaseConfigured) return;
  const status = getSupabaseConfigStatus();
  const suffix = actionName ? ` action=${actionName}` : '';
  throw new Error(`[supabase] Not configured.${suffix} reason=${String(status.reason || 'unknown')}`);
}

function createDisabledSupabaseProxy() {
  const status = getSupabaseConfigStatus();
  const reason = String(status.reason || 'unknown');

  const throwDisabled = (attempted: string) => {
    throw new Error(`[supabase] Disabled. reason=${reason} attempted=${attempted}`);
  };

  const makeProxy = (path: string): any =>
    new Proxy(function () {}, {
      get(_target, prop) {
        if (prop === 'then') return undefined; // Prevent await treating proxy as a Promise.
        if (prop === Symbol.toStringTag) return 'SupabaseDisabledProxy';
        return makeProxy(`${path}.${String(prop)}`);
      },
      apply(_target, _thisArg, _args) {
        throwDisabled(path);
      },
    });

  return makeProxy('supabase');
}

export const supabase: any = isSupabaseConfigured
  ? createClient(resolved.url, resolved.anonKey, {
      auth: {
        // Use AsyncStorage as the primary auth store for React Native session persistence.
        // Mirror auth state in chunked SecureStore entries so sessions can recover after storage loss.
        storage: {
          getItem: async (key: string) => {
            try {
              const value = await AsyncStorage.getItem(key);
              if (value != null) return value;
            } catch (err) {
              void captureException(err, { feature: 'supabase_client', op: 'storage_get_async', key });
            }
            try {
              const secure = await readSecureChunks(key);
              if (secure != null) {
                // Self-heal AsyncStorage so future reads are fast and resilient.
                try {
                  await AsyncStorage.setItem(key, secure);
                } catch (err) {
                  void captureException(err, { feature: 'supabase_client', op: 'storage_self_heal_set', key });
                }
              }
              return secure;
            } catch (err) {
              void captureException(err, { feature: 'supabase_client', op: 'storage_get_secure_fallback', key });
              return null;
            }
          },
          setItem: async (key: string, value: string) => {
            try {
              await AsyncStorage.setItem(key, value);
            } catch (err) {
              void captureException(err, { feature: 'supabase_client', op: 'storage_set_async', key });
            }
            try {
              // Mirror auth payloads in SecureStore chunks so sessions survive AsyncStorage loss.
              if (typeof value === 'string' && value.length > 0) {
                await writeSecureChunks(key, value);
              }
            } catch (err) {
              void captureException(err, { feature: 'supabase_client', op: 'storage_set_secure_chunks', key });
            }
          },
          removeItem: async (key: string) => {
            try {
              await AsyncStorage.removeItem(key);
            } catch (err) {
              void captureException(err, { feature: 'supabase_client', op: 'storage_remove_async', key });
            }
            try {
              await removeSecureChunks(key);
            } catch (err) {
              void captureException(err, { feature: 'supabase_client', op: 'storage_remove_secure_chunks', key });
            }
          },
        } as any,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : createDisabledSupabaseProxy();

function createSocialApiDisabledProxy() {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        const socialEnabled = APP_CONFIG.FEATURES.SOCIAL_FEATURES_ENABLED || APP_CONFIG.RUNTIME.OVERRIDES.SOCIAL_FEATURES_ENABLED;
        // Throw a clear, intentional error so accidental calls never fail silently.
        throw new Error(
          `[social] Disabled. SOCIAL_FEATURES_ENABLED=${String(
            socialEnabled
          )} SUPABASE_CONFIGURED=${String(isSupabaseConfigured)} attempted=${String(prop)}`
        );
      },
    }
  ) as any;
}

// Helper functions for social features
const enabledSocialApi = {
  // ============================================
  // PROFILES
  // ============================================
  async getProfile(userId: string) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    
    if (error) throw error;
    return data;
  },

  async updateProfile(userId: string, updates: any) {
    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', userId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async searchUsers(query: string) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url, current_rank, total_xp')
      .or(`username.ilike.%${query}%,display_name.ilike.%${query}%`)
      .limit(20);
    
    if (error) throw error;
    return data;
  },

  // ============================================
  // FOLLOWS
  // ============================================
  async followUser(followerId: string, followingId: string) {
    const { data, error } = await supabase
      .from('follows')
      .insert({ follower_id: followerId, following_id: followingId })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async unfollowUser(followerId: string, followingId: string) {
    const { error } = await supabase
      .from('follows')
      .delete()
      .eq('follower_id', followerId)
      .eq('following_id', followingId);
    
    if (error) throw error;
  },

  async getFollowers(userId: string) {
    const { data, error } = await supabase
      .from('follows')
      .select(`
        follower_id,
        profiles:follower_id (
          id, username, display_name, avatar_url, current_rank
        )
      `)
      .eq('following_id', userId);
    
    if (error) throw error;
    return data;
  },

  async getFollowing(userId: string) {
    const { data, error } = await supabase
      .from('follows')
      .select(`
        following_id,
        profiles:following_id (
          id, username, display_name, avatar_url, current_rank
        )
      `)
      .eq('follower_id', userId);
    
    if (error) throw error;
    return data;
  },

  async isFollowing(followerId: string, followingId: string) {
    const { data, error } = await supabase
      .from('follows')
      .select('id')
      .eq('follower_id', followerId)
      .eq('following_id', followingId)
      .single();
    
    return !!data;
  },

  // ============================================
  // POSTS
  // ============================================
  async createPost(
    userId: string,
    content: string,
    postType: string,
    data?: any,
    options?: { audience?: 'friends' | 'public' | 'group'; groupId?: string | null; isPublic?: boolean; imageUrl?: string | null }
  ) {
    const audience = options?.audience || 'public';
    // "Publicness" should be derived from the audience to prevent accidental leaks.
    // Public: visible to everyone. Friends/Group: constrained by RLS and feed filters.
    const resolvedIsPublic = typeof options?.isPublic === 'boolean' ? options.isPublic : audience === 'public';
    const { data: post, error } = await supabase
      .from('posts')
      .insert({
        user_id: userId,
        content,
        post_type: postType,
        data,
        audience,
        group_id: options?.groupId ?? undefined,
        is_public: resolvedIsPublic,
        image_url: options?.imageUrl ?? undefined,
      })
      .select()
      .single();
    
    if (error) throw error;
    return post;
  },

  async getFeed(userId: string, limit: number = 20, offset: number = 0) {
    // Get posts from followed users + own posts
    const { data, error } = await supabase
      .from('posts')
      .select(`
        *,
        profiles:user_id (
          id, username, display_name, avatar_url, current_rank
        ),
        likes:likes!post_id (count),
        user_liked:likes!post_id (
          user_id
        )
      `)
      .eq('is_public', true)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    
    if (error) throw error;
    return data;
  },

  async getCommunityFeed(viewerUserId: string, limit: number = 20) {
    const [friendsRes, groupsRes] = await Promise.all([
      supabase
        .from('friendships')
        .select('requester_id, addressee_id, status')
        .or(`requester_id.eq.${viewerUserId},addressee_id.eq.${viewerUserId}`)
        .eq('status', 'accepted'),
      supabase.from('group_members').select('group_id').eq('user_id', viewerUserId),
    ]);

    if (friendsRes.error) throw friendsRes.error;
    if (groupsRes.error) throw groupsRes.error;

    const friendIds = Array.from(
      new Set(
        (friendsRes.data || [])
          .flatMap((row: any) => [row.requester_id, row.addressee_id])
          .filter((id: string) => id && id !== viewerUserId)
      )
    );
    const visibleFriendIds = Array.from(new Set([viewerUserId, ...friendIds]));
    const groupIds = Array.from(new Set((groupsRes.data || []).map((row: any) => row.group_id).filter(Boolean)));

    const select = `
      *,
      profiles:user_id (
        id, username, display_name, avatar_url, current_rank
      )
    `;

    const pull = async (q: any) => {
      const { data, error } = await q.select(select).order('created_at', { ascending: false }).limit(Math.max(40, limit * 2));
      if (error) throw error;
      return data || [];
    };

    const [publicPosts, friendPosts, groupPosts] = await Promise.all([
      pull(supabase.from('posts').eq('audience', 'public').eq('is_public', true)),
      pull(supabase.from('posts').eq('audience', 'friends').in('user_id', visibleFriendIds)),
      groupIds.length
        ? pull(supabase.from('posts').eq('audience', 'group').in('group_id', groupIds).neq('post_type', 'event_chat'))
        : Promise.resolve([]),
    ]);

    const merged = [...publicPosts, ...friendPosts, ...groupPosts];
    const byId = new Map<string, any>();
    merged.forEach((row: any) => {
      if (row && row.id) byId.set(row.id, row);
    });
    const rows = Array.from(byId.values()).sort(
      (a: any, b: any) => Date.parse(String(b.created_at || '')) - Date.parse(String(a.created_at || ''))
    );

    const postIds = rows.map((r: any) => r.id).filter(Boolean);
    const likedRes = postIds.length
      ? await supabase.from('likes').select('post_id').eq('user_id', viewerUserId).in('post_id', postIds)
      : { data: [] as any[], error: null as any };
    if (likedRes.error) throw likedRes.error;
    const liked = new Set((likedRes.data || []).map((r: any) => r.post_id));

    return rows.slice(0, limit).map((row: any) => ({
      ...row,
      viewerHasLiked: liked.has(row.id),
    }));
  },

  async getAcceptedFriendIds(viewerUserId: string): Promise<string[]> {
    const { data, error } = await supabase
      .from('friendships')
      .select('requester_id, addressee_id, status')
      .or(`requester_id.eq.${viewerUserId},addressee_id.eq.${viewerUserId}`)
      .eq('status', 'accepted');
    if (error) throw error;
    const ids: string[] = Array.from(
      new Set(
        (data || [])
          .flatMap((row: any) => [String(row.requester_id || ''), String(row.addressee_id || '')])
          .filter((id: string) => id && id !== viewerUserId)
      )
    );
    return ids;
  },

  async getProfilesByIds(userIds: string[]) {
    const unique = Array.from(new Set((userIds || []).filter(Boolean)));
    if (unique.length === 0) return [];
    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url, current_rank, total_xp, winning_days')
      .in('id', unique);
    if (error) throw error;
    return data || [];
  },

  async getFriendsFeed(viewerUserId: string, limit: number = 25, offset: number = 0) {
    const friendIds = await enabledSocialApi.getAcceptedFriendIds(viewerUserId);
    const visibleIds = Array.from(new Set([viewerUserId, ...(friendIds || [])])).filter(Boolean);

    const { data: posts, error: postsError } = await supabase
      .from('posts')
      .select(
        `
        id,
        user_id,
        content,
        post_type,
        data,
        audience,
        is_public,
        created_at,
        profiles:user_id (
          id, username, display_name, avatar_url, current_rank
        )
      `
      )
      .eq('audience', 'friends')
      .in('user_id', visibleIds)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (postsError) throw postsError;

    const rows = Array.isArray(posts) ? posts : [];
    const postIds = rows.map((r: any) => r.id).filter(Boolean);

    const [likesRes, commentsRes] = await Promise.all([
      postIds.length ? supabase.from('likes').select('post_id, user_id').in('post_id', postIds).limit(2000) : Promise.resolve({ data: [], error: null } as any),
      postIds.length ? supabase.from('comments').select('post_id').in('post_id', postIds).limit(2000) : Promise.resolve({ data: [], error: null } as any),
    ]);
    if (likesRes.error) throw likesRes.error;
    if (commentsRes.error) throw commentsRes.error;

    const likeCounts = new Map<string, number>();
    const viewerLiked = new Set<string>();
    (likesRes.data || []).forEach((row: any) => {
      const postId = String(row.post_id || '');
      if (!postId) return;
      likeCounts.set(postId, (likeCounts.get(postId) || 0) + 1);
      if (String(row.user_id || '') === viewerUserId) viewerLiked.add(postId);
    });

    const commentCounts = new Map<string, number>();
    (commentsRes.data || []).forEach((row: any) => {
      const postId = String(row.post_id || '');
      if (!postId) return;
      commentCounts.set(postId, (commentCounts.get(postId) || 0) + 1);
    });

    return rows.map((row: any) => ({
      ...row,
      likeCount: likeCounts.get(String(row.id)) || 0,
      commentCount: commentCounts.get(String(row.id)) || 0,
      viewerHasLiked: viewerLiked.has(String(row.id)),
    }));
  },

  async getUserPosts(userId: string) {
    const { data, error } = await supabase
      .from('posts')
      .select(`
        *,
        profiles:user_id (
          id, username, display_name, avatar_url
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data;
  },

  async deletePost(postId: string) {
    const { error } = await supabase
      .from('posts')
      .delete()
      .eq('id', postId);
    
    if (error) throw error;
  },

  // ============================================
  // LIKES
  // ============================================
  async likePost(userId: string, postId: string) {
    const { data, error } = await supabase
      .from('likes')
      .insert({ user_id: userId, post_id: postId })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async unlikePost(userId: string, postId: string) {
    const { error } = await supabase
      .from('likes')
      .delete()
      .eq('user_id', userId)
      .eq('post_id', postId);
    
    if (error) throw error;
  },

  // ============================================
  // COMMENTS
  // ============================================
  async createComment(userId: string, postId: string, content: string) {
    const { data, error } = await supabase
      .from('comments')
      .insert({ user_id: userId, post_id: postId, content })
      .select(`
        *,
        profiles:user_id (
          id, username, display_name, avatar_url
        )
      `)
      .single();
    
    if (error) throw error;
    return data;
  },

  async getComments(postId: string) {
    const { data, error } = await supabase
      .from('comments')
      .select(`
        *,
        profiles:user_id (
          id, username, display_name, avatar_url
        )
      `)
      .eq('post_id', postId)
      .order('created_at', { ascending: true });
    
    if (error) throw error;
    return data;
  },

  async deleteComment(commentId: string) {
    const { error } = await supabase
      .from('comments')
      .delete()
      .eq('id', commentId);
    
    if (error) throw error;
  },

  // ============================================
  // TEAMS
  // ============================================
  async createTeam(ownerId: string, name: string, teamType: string, description?: string) {
    let lastErr: any = null;
    let data: any = null;

    // Generate a unique 6-digit invite code (enforced by DB unique index).
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const inviteCode = randomInviteCode6();
      const payloadBase: any = {
        owner_id: ownerId,
        name,
        team_type: teamType,
        description,
        // Private by default (explicit, do not rely on DB defaults).
        is_public: false,
      };

      // Backward-compatible insert: prefer `invite_code_plain`, but fall back to legacy `invite_code`.
      let res = await supabase
        .from('teams')
        .insert({ ...payloadBase, invite_code_plain: inviteCode })
        .select('id, owner_id, name, description, avatar_url, team_type, is_public, members_count, total_xp, created_at, updated_at')
        .single();

      if (res.error && (isMissingColumn(res.error, 'invite_code_plain') || isSchemaCacheDrift(res.error))) {
        res = await supabase
          .from('teams')
          .insert({ ...payloadBase, invite_code: inviteCode })
          .select('id, owner_id, name, description, avatar_url, team_type, is_public, members_count, total_xp, created_at, updated_at')
          .single();
      }

      if (!res.error) {
        data = res.data;
        break;
      }
      lastErr = res.error;
      if (isUniqueViolation(res.error)) continue;
      throw res.error;
    }

    if (!data) throw lastErr || new Error('Could not allocate invite code. Please try again.');

    // Add owner as member
    await supabase
      .from('team_members')
      .insert({
        team_id: data.id,
        user_id: ownerId,
        role: 'owner',
      });

    // Create the associated team group (for team feed/chat via posts) using join_code = `team:<teamId>`.
    // This keeps all team interactions on existing Supabase tables (groups/group_members/posts/comments/likes).
    try {
      const joinCode = `team:${data.id}`;
      const { data: group, error: groupError } = await supabase
        .from('groups')
        .insert({
          kind: 'coaching_team',
          owner_id: ownerId,
          name,
          description: description || 'Team space',
          is_public: false,
          join_code: joinCode,
        })
        .select()
        .single();
      if (!groupError && group?.id) {
        await supabase.from('group_members').insert({ group_id: group.id, user_id: ownerId, role: 'owner' });
      }
    } catch (err) {
      void captureException(err, { feature: 'supabase_client', op: 'create_team_bootstrap_group', teamId: data?.id, ownerId });
      // best-effort; team still exists without a group feed.
    }
    
    return data;
  },

  async joinTeamByInviteCode(userId: string, inviteCodeRaw: string) {
    const inviteCode = String(inviteCodeRaw || '').replace(/[^0-9]/g, '').slice(0, 6);
    if (inviteCode.length !== 6) throw new Error('Enter a 6-digit invite code.');

    let teamId = '';

    // Prefer server-side invite resolution (bypasses RLS safely).
    const rpcRes = await supabase.rpc('resolve_team_invite_code', { p_invite_code: inviteCode });
    if (!rpcRes.error) {
      const row = Array.isArray(rpcRes.data) ? rpcRes.data[0] : rpcRes.data;
      teamId = String((row as any)?.team_id || '').trim();
    } else if (isMissingFunction(rpcRes.error, 'resolve_team_invite_code') || isSchemaCacheDrift(rpcRes.error)) {
      // Backward-compatible best-effort fallback for environments missing the RPC:
      // attempt plaintext match on either `invite_code_plain` or legacy `invite_code`.
      // Note: RLS may block access for private teams, in which case we surface "not found".
      const byPlain = await supabase.from('teams').select('id').eq('invite_code_plain', inviteCode).limit(1);
      if (!byPlain.error && Array.isArray(byPlain.data) && byPlain.data[0]?.id) {
        teamId = String(byPlain.data[0].id || '').trim();
      } else {
        const byLegacy = await supabase.from('teams').select('id').eq('invite_code', inviteCode).limit(1);
        if (!byLegacy.error && Array.isArray(byLegacy.data) && byLegacy.data[0]?.id) {
          teamId = String(byLegacy.data[0].id || '').trim();
        }
      }
    } else {
      throw rpcRes.error;
    }

    if (!teamId) throw new Error('Invite code not found.');

    try {
      await enabledSocialApi.joinTeam(userId, teamId);
    } catch (err: any) {
      // If already a member, treat as success.
      if (!isUniqueViolation(err)) throw err;
    }
    return { teamId };
  },

  async getTeams(teamType?: string) {
    let query = supabase
      .from('teams')
      .select(`
        id, name, description, avatar_url, team_type, is_public, members_count, total_xp, owner_id, created_at, updated_at,
        profiles:owner_id (username, display_name, avatar_url),
        team_members (count)
      `)
      .eq('is_public', true);
    
    if (teamType) {
      query = query.eq('team_type', teamType);
    }
    
    const { data, error } = await query.order('created_at', { ascending: false });
    
    if (error) throw error;
    return data;
  },

  async getMyTeams(userId: string) {
    const { data, error } = await supabase
      .from('team_members')
      .select(
        `
        team_id,
        role,
        joined_at,
        teams:team_id (
          id, name, description, avatar_url, team_type, is_public, members_count, total_xp, owner_id, created_at, updated_at
        )
      `
      )
      .eq('user_id', userId)
      .order('joined_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  async joinTeam(userId: string, teamId: string) {
    const { data, error } = await supabase
      .from('team_members')
      .insert({
        team_id: teamId,
        user_id: userId,
        role: 'member',
      })
      .select()
      .single();
    
    if (error) throw error;

    // Best-effort: also join the associated team group if it exists.
    try {
      const joinCode = `team:${teamId}`;
      const { data: groups, error: groupsError } = await supabase.from('groups').select('id').eq('join_code', joinCode).limit(1);
      if (!groupsError && Array.isArray(groups) && groups[0]?.id) {
        await supabase.from('group_members').insert({ group_id: groups[0].id, user_id: userId, role: 'member' });
      }
    } catch (err) {
      void captureException(err, { feature: 'supabase_client', op: 'join_team_group_membership', teamId, userId });
    }
    return data;
  },

  async leaveTeam(userId: string, teamId: string) {
    const { error } = await supabase
      .from('team_members')
      .delete()
      .eq('team_id', teamId)
      .eq('user_id', userId);
    
    if (error) throw error;

    // Best-effort: also leave the associated team group if it exists.
    try {
      const joinCode = `team:${teamId}`;
      const { data: groups, error: groupsError } = await supabase.from('groups').select('id').eq('join_code', joinCode).limit(1);
      if (!groupsError && Array.isArray(groups) && groups[0]?.id) {
        await supabase.from('group_members').delete().eq('group_id', groups[0].id).eq('user_id', userId);
      }
    } catch (err) {
      void captureException(err, { feature: 'supabase_client', op: 'leave_team_group_membership', teamId, userId });
    }
  },

  async getTeamMembers(teamId: string) {
    const { data, error } = await supabase
      .from('team_members')
      .select(`
        *,
        profiles:user_id (
          id, username, display_name, avatar_url, current_rank, total_xp
        )
      `)
      .eq('team_id', teamId)
      .order('xp_contributed', { ascending: false });
    
    if (error) throw error;
    return data;
  },

  async getTeam(teamId: string) {
    const { data, error } = await supabase
      .from('teams')
      .select('id, owner_id, name, description, avatar_url, team_type, is_public, members_count, total_xp, created_at, updated_at')
      .eq('id', teamId)
      .single();
    if (error) throw error;
    return data;
  },

  async getTeamInviteCode(teamId: string) {
    const { data, error } = await supabase.rpc('get_team_invite_code', { p_team_id: teamId });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return row || null;
  },

  async rotateTeamInviteCode(teamId: string) {
    const { data, error } = await supabase.rpc('rotate_team_invite_code', { p_team_id: teamId });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return row || null;
  },

  async getTeamGroup(teamId: string) {
    const joinCode = `team:${teamId}`;
    const { data, error } = await supabase.from('groups').select('*').eq('join_code', joinCode).limit(1);
    if (error) throw error;
    return Array.isArray(data) && data.length ? data[0] : null;
  },

  async ensureTeamGroup(ownerOrMemberUserId: string, teamId: string) {
    const existing = await enabledSocialApi.getTeamGroup(teamId);
    if (existing) return existing;

    try {
      const { data: rpcGroup, error: rpcError } = await supabase.rpc('ensure_team_group_feed', { p_team_id: teamId });
      if (!rpcError && rpcGroup) return rpcGroup;
    } catch {
      // Fall through to legacy client-side creation path.
    }

    const team = await enabledSocialApi.getTeam(teamId);
    if (!team) return null;

    const joinCode = `team:${teamId}`;
    try {
      const ownerId = String(team.owner_id || ownerOrMemberUserId);
      const { data: group, error } = await supabase
        .from('groups')
        .insert({
          kind: 'coaching_team',
          owner_id: ownerId,
          name: team.name,
          description: team.description || 'Team space',
          is_public: false,
          join_code: joinCode,
        })
        .select()
        .single();
      if (error) throw error;
      await supabase.from('group_members').insert({ group_id: (group as any).id, user_id: ownerId, role: 'owner' });
      if (ownerOrMemberUserId && ownerOrMemberUserId !== ownerId) {
        await supabase
          .from('group_members')
          .upsert({ group_id: (group as any).id, user_id: ownerOrMemberUserId, role: 'member' }, { onConflict: 'group_id,user_id' });
      }
      return group;
    } catch {
      // If creation fails due RLS race/permissions, re-read existing group and return null only if still missing.
      const fallback = await enabledSocialApi.getTeamGroup(teamId);
      return fallback || null;
    }
  },

  // ============================================
  // TEAM CHECK-INS
  // ============================================
  async getTeamCheckins(teamId: string, options?: { limit?: number; dateFrom?: string; userId?: string }) {
    let query = supabase
      .from('team_checkins')
      .select(
        `
        id,
        team_id,
        user_id,
        checkin_date,
        sleep_quality,
        fatigue_level,
        soreness_level,
        stress_level,
        mood_level,
        pain_flag,
        note,
        submitted_at,
        created_at,
        updated_at,
        profiles:user_id (
          id, username, display_name, avatar_url
        )
      `
      )
      .eq('team_id', teamId)
      .order('checkin_date', { ascending: false })
      .order('submitted_at', { ascending: false });

    if (options?.dateFrom) {
      query = query.gte('checkin_date', options.dateFrom);
    }
    if (options?.userId) {
      query = query.eq('user_id', options.userId);
    }
    if (Number.isFinite(Number(options?.limit)) && Number(options?.limit) > 0) {
      query = query.limit(Number(options?.limit));
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  async upsertTeamCheckin(input: {
    teamId: string;
    userId: string;
    checkinDate: string;
    sleepQuality: number;
    fatigueLevel: number;
    sorenessLevel: number;
    stressLevel: number;
    moodLevel: number;
    painFlag: number;
    note?: string | null;
  }) {
    const payload = {
      team_id: input.teamId,
      user_id: input.userId,
      checkin_date: input.checkinDate,
      sleep_quality: input.sleepQuality,
      fatigue_level: input.fatigueLevel,
      soreness_level: input.sorenessLevel,
      stress_level: input.stressLevel,
      mood_level: input.moodLevel,
      pain_flag: input.painFlag,
      note: input.note ?? null,
      submitted_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('team_checkins')
      .upsert(payload, { onConflict: 'team_id,user_id,checkin_date' })
      .select(
        `
        id,
        team_id,
        user_id,
        checkin_date,
        sleep_quality,
        fatigue_level,
        soreness_level,
        stress_level,
        mood_level,
        pain_flag,
        note,
        submitted_at,
        created_at,
        updated_at,
        profiles:user_id (
          id, username, display_name, avatar_url
        )
      `
      )
      .single();
    if (error) throw error;
    return data;
  },

  // ============================================
  // GROUPS
  // ============================================
  async createGroup(ownerId: string, name: string, description?: string, options?: { isPublic?: boolean; joinCode?: string | null; kind?: string }) {
    const { data, error } = await supabase
      .from('groups')
      .insert({
        kind: options?.kind || 'friend_group',
        owner_id: ownerId,
        name,
        description,
        is_public: typeof options?.isPublic === 'boolean' ? options.isPublic : true,
        join_code: options?.joinCode ?? undefined,
      })
      .select()
      .single();
    if (error) throw error;

    await supabase.from('group_members').insert({ group_id: (data as any).id, user_id: ownerId, role: 'owner' });
    return data;
  },

  async getGroupByJoinCode(joinCode: string) {
    const code = String(joinCode || '').trim();
    if (!code) throw new Error('Missing join code.');
    const { data, error } = await supabase.from('groups').select('*').eq('join_code', code).limit(1);
    if (error) throw error;
    return Array.isArray(data) && data.length ? data[0] : null;
  },

  async getGroups() {
    const { data, error } = await supabase.from('groups').select('*').eq('is_public', true).order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  async getGroup(groupId: string) {
    const { data, error } = await supabase.from('groups').select('*').eq('id', groupId).single();
    if (error) throw error;
    return data;
  },

  async ensureDmGroup(userId: string, otherUserId: string) {
    if (!userId || !otherUserId) throw new Error('Missing user id.');
    if (userId === otherUserId) throw new Error('Cannot DM yourself.');

    // Only allow DMs between accepted friends.
    const { data: friendshipRows, error: friendshipError } = await supabase
      .from('friendships')
      .select('id, status, requester_id, addressee_id')
      .or(
        `and(requester_id.eq.${userId},addressee_id.eq.${otherUserId}),and(requester_id.eq.${otherUserId},addressee_id.eq.${userId})`
      )
      .limit(1);
    if (friendshipError) throw friendshipError;
    const friendship = Array.isArray(friendshipRows) && friendshipRows.length ? friendshipRows[0] : null;
    if (!friendship || friendship.status !== 'accepted') {
      throw new Error('You can only DM accepted friends.');
    }

    const [a, b] = userId < otherUserId ? [userId, otherUserId] : [otherUserId, userId];
    const joinCode = `dm:${a}:${b}`;

    const existing = await supabase.from('groups').select('*').eq('join_code', joinCode).limit(1);
    if (existing.error) throw existing.error;
    if (Array.isArray(existing.data) && existing.data[0]) {
      const group = existing.data[0];
      // Ensure membership (best-effort; ignore duplicates).
      try {
        await supabase.from('group_members').insert({ group_id: group.id, user_id: userId, role: 'member' });
      } catch (err) {
        void captureException(err, { feature: 'supabase_client', op: 'ensure_dm_group_membership_self', groupId: group?.id, userId });
      }
      try {
        await supabase.from('group_members').insert({ group_id: group.id, user_id: otherUserId, role: 'member' });
      } catch (err) {
        void captureException(err, { feature: 'supabase_client', op: 'ensure_dm_group_membership_other', groupId: group?.id, otherUserId });
      }
      return group;
    }

    // Create DM group (private).
    const { data: created, error: createError } = await supabase
      .from('groups')
      .insert({
        kind: 'friend_group',
        owner_id: userId,
        name: 'Direct Message',
        description: null,
        is_public: false,
        join_code: joinCode,
      })
      .select()
      .single();

    // If there is a uniqueness constraint and we raced, refetch.
    if (createError) {
      const refetch = await supabase.from('groups').select('*').eq('join_code', joinCode).limit(1);
      if (refetch.error) throw createError;
      const group = Array.isArray(refetch.data) && refetch.data[0] ? refetch.data[0] : null;
      if (!group) throw createError;
      return group;
    }

    await supabase.from('group_members').insert([
      { group_id: (created as any).id, user_id: userId, role: 'member' },
      { group_id: (created as any).id, user_id: otherUserId, role: 'member' },
    ]);
    return created;
  },

  async getMyDmGroups(userId: string) {
    const { data, error } = await supabase
      .from('group_members')
      .select(
        `
        group_id,
        role,
        joined_at,
        groups:group_id (
          id, kind, name, description, avatar_url, is_public, join_code, owner_id, created_at, updated_at
        )
      `
      )
      .eq('user_id', userId)
      .like('groups.join_code', 'dm:%')
      .order('joined_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  async getMyGroups(userId: string) {
    const { data, error } = await supabase
      .from('group_members')
      .select(
        `
        group_id,
        role,
        joined_at,
        groups:group_id (
          id, kind, name, description, avatar_url, is_public, join_code, owner_id, created_at, updated_at
        )
      `
      )
      .eq('user_id', userId)
      .order('joined_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  async joinGroup(userId: string, groupId: string) {
    const { data, error } = await supabase
      .from('group_members')
      .insert({ group_id: groupId, user_id: userId, role: 'member' })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async leaveGroup(userId: string, groupId: string) {
    const { error } = await supabase.from('group_members').delete().eq('group_id', groupId).eq('user_id', userId);
    if (error) throw error;
  },

  async getGroupMembers(groupId: string) {
    const { data, error } = await supabase
      .from('group_members')
      .select(
        `
        *,
        profiles:user_id (
          id, username, display_name, avatar_url, current_rank, total_xp
        )
      `
      )
      .eq('group_id', groupId)
      .order('joined_at', { ascending: true });
    if (error) throw error;
    return data;
  },

  async getGroupPosts(groupId: string, limit: number = 30) {
    const { data, error } = await supabase
      .from('posts')
      .select(
        `
        *,
        profiles:user_id (
          id, username, display_name, avatar_url, current_rank
        )
      `
      )
      .eq('audience', 'group')
      .eq('group_id', groupId)
      // Event chat lives inside Event Hub; keep the group feed clean.
      .neq('post_type', 'event_chat')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data;
  },

  // ============================================
  // EVENTS (Group + Team Events / Race Day Hub)
  // ============================================
  async getEventsForUser(
    userId: string,
    options?: { limit?: number; groupId?: string; fromIso?: string; toIso?: string; includeRsvpCounts?: boolean }
  ) {
    let query = supabase
      .from('events')
      .select(
        `
        *,
        groups:group_id (
          id, kind, name, description, avatar_url, is_public, join_code, owner_id, created_at, updated_at
        )
      `
      )
      .order('start_at', { ascending: true });

    if (options?.groupId) {
      query = query.eq('group_id', options.groupId);
    }
    if (options?.fromIso) {
      query = query.gte('start_at', options.fromIso);
    }
    if (options?.toIso) {
      query = query.lte('start_at', options.toIso);
    }
    if (Number.isFinite(Number(options?.limit)) && Number(options?.limit) > 0) {
      query = query.limit(Number(options?.limit));
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    const ids = rows.map((row: any) => String(row?.id || '')).filter(Boolean);
    if (!ids.length) return rows;

    // Attach the caller's RSVP status without materializing all RSVPs.
    const { data: rsvps, error: rsvpError } = await supabase
      .from('event_rsvps')
      .select('event_id, status, updated_at')
      .eq('user_id', userId)
      .in('event_id', ids);
    if (rsvpError) throw rsvpError;
    const byEvent = new Map<string, any>();
    (Array.isArray(rsvps) ? rsvps : []).forEach((row: any) => {
      const id = String(row?.event_id || '');
      if (id) byEvent.set(id, row);
    });

    const withMine = rows.map((ev: any) => ({
      ...ev,
      my_rsvp: byEvent.get(String(ev?.id || '')) || null,
    }));

    if (!options?.includeRsvpCounts) return withMine;

    // Optional rollups for list UIs (Event Center, Group Events).
    try {
      const { data: allRsvps, error: allRsvpsError } = await supabase
        .from('event_rsvps')
        .select('event_id, status')
        .in('event_id', ids)
        .limit(5000);
      if (allRsvpsError) throw allRsvpsError;
      const countsByEvent = new Map<string, { going: number; maybe: number; not_going: number }>();
      (Array.isArray(allRsvps) ? allRsvps : []).forEach((row: any) => {
        const eventId = String(row?.event_id || '');
        if (!eventId) return;
        const status = String(row?.status || '').trim().toLowerCase();
        const current = countsByEvent.get(eventId) || { going: 0, maybe: 0, not_going: 0 };
        if (status === 'going') current.going += 1;
        else if (status === 'maybe') current.maybe += 1;
        else if (status === 'not_going') current.not_going += 1;
        countsByEvent.set(eventId, current);
      });
      return withMine.map((ev: any) => ({
        ...ev,
        rsvp_counts: countsByEvent.get(String(ev?.id || '')) || { going: 0, maybe: 0, not_going: 0 },
      }));
    } catch {
      return withMine;
    }
  },

  async getEvent(eventId: string) {
    const { data, error } = await supabase
      .from('events')
      .select(
        `
        *,
        groups:group_id (
          id, kind, name, description, avatar_url, is_public, join_code, owner_id, created_at, updated_at
        )
      `
      )
      .eq('id', eventId)
      .single();
    if (error) throw error;

    // Best-effort: include RSVP rollup for the Event Hub.
    try {
      const { data: rsvps, error: rsvpError } = await supabase
        .from('event_rsvps')
        .select(
          `
          user_id,
          status,
          updated_at,
          profiles:user_id (
            id, username, display_name, avatar_url
          )
        `
        )
        .eq('event_id', eventId)
        .order('updated_at', { ascending: false })
        .limit(200);
      if (!rsvpError) {
        return { ...(data as any), rsvps: Array.isArray(rsvps) ? rsvps : [] };
      }
    } catch {
      // ignore; event details still usable.
    }

    return data;
  },

  async createGroupEvent(
    creatorUserId: string,
    groupId: string,
    input: {
      title: string;
      description?: string | null;
      eventType?: string;
      startAt: string;
      endAt?: string | null;
      timezone?: string | null;
      locationName?: string | null;
      locationAddress?: string | null;
      locationLat?: number | null;
      locationLng?: number | null;
      meetingNotes?: string | null;
      rsvpEnabled?: boolean;
      capacity?: number | null;
      waitlistEnabled?: boolean;
      questions?: any;
      reminders?: any;
      recurrenceRule?: string | null;
      recurrenceUntil?: string | null;
      seriesId?: string | null;
    }
  ) {
    const payload: any = {
      group_id: groupId,
      owner_id: creatorUserId,
      title: String(input.title || '').trim(),
      description: input.description ?? null,
      event_type: input.eventType || 'training',
      start_at: input.startAt,
      end_at: input.endAt ?? null,
      timezone: input.timezone ?? null,
      location_name: input.locationName ?? null,
      location_address: input.locationAddress ?? null,
      location_lat: input.locationLat ?? null,
      location_lng: input.locationLng ?? null,
      meeting_notes: input.meetingNotes ?? null,
      rsvp_enabled: typeof input.rsvpEnabled === 'boolean' ? input.rsvpEnabled : true,
      capacity: input.capacity ?? null,
      waitlist_enabled: typeof input.waitlistEnabled === 'boolean' ? input.waitlistEnabled : false,
      rsvp_questions: input.questions ?? null,
      reminders: input.reminders ?? null,
      recurrence_rule: input.recurrenceRule ?? null,
      recurrence_until: input.recurrenceUntil ?? null,
      series_id: input.seriesId ?? null,
    };

    const { data, error } = await supabase.from('events').insert(payload).select().single();
    if (error) throw error;
    return data;
  },

  async createPersonalEvent(
    ownerUserId: string,
    input: {
      title: string;
      description?: string | null;
      eventType?: string;
      startAt: string;
      endAt?: string | null;
      timezone?: string | null;
      locationName?: string | null;
      locationAddress?: string | null;
      locationLat?: number | null;
      locationLng?: number | null;
      meetingNotes?: string | null;
      rsvpEnabled?: boolean;
      capacity?: number | null;
      waitlistEnabled?: boolean;
      questions?: any;
      reminders?: any;
      recurrenceRule?: string | null;
      recurrenceUntil?: string | null;
      seriesId?: string | null;
    }
  ) {
    const payload: any = {
      group_id: null,
      owner_id: ownerUserId,
      title: String(input.title || '').trim(),
      description: input.description ?? null,
      event_type: input.eventType || 'training',
      start_at: input.startAt,
      end_at: input.endAt ?? null,
      timezone: input.timezone ?? null,
      location_name: input.locationName ?? null,
      location_address: input.locationAddress ?? null,
      location_lat: input.locationLat ?? null,
      location_lng: input.locationLng ?? null,
      meeting_notes: input.meetingNotes ?? null,
      rsvp_enabled: typeof input.rsvpEnabled === 'boolean' ? input.rsvpEnabled : true,
      capacity: input.capacity ?? null,
      waitlist_enabled: typeof input.waitlistEnabled === 'boolean' ? input.waitlistEnabled : false,
      rsvp_questions: input.questions ?? null,
      reminders: input.reminders ?? null,
      recurrence_rule: input.recurrenceRule ?? null,
      recurrence_until: input.recurrenceUntil ?? null,
      series_id: input.seriesId ?? null,
    };

    const { data, error } = await supabase.from('events').insert(payload).select().single();
    if (error) throw error;
    return data;
  },

  async createEventsBulk(rows: any[]) {
    const payload = Array.isArray(rows) ? rows : [];
    if (!payload.length) throw new Error('No events to create.');
    const { data, error } = await supabase.from('events').insert(payload).select();
    if (error) throw error;
    return data;
  },

  async updateEvent(eventId: string, patch: Record<string, any>) {
    const id = String(eventId || '').trim();
    if (!id) throw new Error('Missing eventId.');
    const clean: Record<string, any> = {};
    Object.keys(patch || {}).forEach((k) => {
      const v = (patch as any)[k];
      if (v === undefined) return;
      clean[k] = v;
    });
    const { data, error } = await supabase.from('events').update(clean).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },

  async deleteEvent(eventId: string) {
    const id = String(eventId || '').trim();
    if (!id) throw new Error('Missing eventId.');
    const { error } = await supabase.from('events').delete().eq('id', id);
    if (error) throw error;
  },

  async updateEventsBySeries(seriesId: string, patch: Record<string, any>, options?: { fromIso?: string }) {
    const id = String(seriesId || '').trim();
    if (!id) throw new Error('Missing seriesId.');
    const clean: Record<string, any> = {};
    Object.keys(patch || {}).forEach((k) => {
      const v = (patch as any)[k];
      if (v === undefined) return;
      clean[k] = v;
    });
    let q = supabase.from('events').update(clean).eq('series_id', id);
    if (options?.fromIso) q = q.gte('start_at', options.fromIso);
    const { error } = await q;
    if (error) throw error;
  },

  async deleteEventsBySeries(seriesId: string, options?: { fromIso?: string }) {
    const id = String(seriesId || '').trim();
    if (!id) throw new Error('Missing seriesId.');
    let q = supabase.from('events').delete().eq('series_id', id);
    if (options?.fromIso) q = q.gte('start_at', options.fromIso);
    const { error } = await q;
    if (error) throw error;
  },

  async getEventChatPosts(groupId: string, eventId: string, limit: number = 40) {
    const gid = String(groupId || '').trim();
    const eid = String(eventId || '').trim();
    if (!gid || !eid) return [];
    const { data, error } = await supabase
      .from('posts')
      .select(
        `
        *,
        profiles:user_id (
          id, username, display_name, avatar_url, current_rank
        )
      `
      )
      .eq('audience', 'group')
      .eq('group_id', gid)
      .eq('post_type', 'event_chat')
      .contains('data', { eventId: eid })
      .order('created_at', { ascending: false })
      .limit(Math.max(1, Math.min(200, Number(limit) || 40)));
    if (error) throw error;
    return data;
  },

  async sendEventChatMessage(senderUserId: string, groupId: string, eventId: string, text: string) {
    const content = String(text || '').trim();
    if (!content) throw new Error('Message is empty.');
    const gid = String(groupId || '').trim();
    const eid = String(eventId || '').trim();
    if (!gid || !eid) throw new Error('Missing group/event context.');
    return enabledSocialApi.createPost(
      senderUserId,
      content,
      'event_chat',
      { kind: 'event_chat', eventId: eid },
      { audience: 'group', groupId: gid, isPublic: false }
    );
  },

  async upsertEventRsvp(userId: string, eventId: string, status: 'going' | 'maybe' | 'not_going', answers?: any) {
    const payload = {
      event_id: eventId,
      user_id: userId,
      status,
      answers: answers ?? null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from('event_rsvps')
      .upsert(payload, { onConflict: 'event_id,user_id' })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async followEvent(userId: string, eventId: string) {
    const { data, error } = await supabase
      .from('event_follows')
      .upsert({ user_id: userId, event_id: eventId }, { onConflict: 'event_id,user_id' })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async unfollowEvent(userId: string, eventId: string) {
    const { error } = await supabase.from('event_follows').delete().eq('user_id', userId).eq('event_id', eventId);
    if (error) throw error;
  },

  async isFollowingEvent(userId: string, eventId: string) {
    const { data, error } = await supabase
      .from('event_follows')
      .select('event_id')
      .eq('user_id', userId)
      .eq('event_id', eventId)
      .maybeSingle();
    if (error) throw error;
    return Boolean(data?.event_id);
  },

  async bootstrapGroupThread(input: { creatorUserId: string; groupId: string; groupName: string }) {
    const text = `Group created: ${String(input.groupName || 'New group').trim()}`;
    return enabledSocialApi.createPost(input.creatorUserId, text, 'system', { bootstrap: true }, {
      audience: 'group',
      groupId: input.groupId,
      isPublic: false,
    });
  },

  async sendDmMessage(senderUserId: string, dmGroupId: string, text: string) {
    const content = String(text || '').trim();
    if (!content) throw new Error('Message is empty.');
    return enabledSocialApi.createPost(senderUserId, content, 'dm', {}, { audience: 'group', groupId: dmGroupId, isPublic: false });
  },

  // ============================================
  // LEADERBOARDS
  // ============================================
  async getLeaderboard(
    input:
      | string
      | {
          leaderboardKey?: string;
          timeframe?: 'DAY' | 'WEEK' | 'MONTH';
          teamId?: string | null;
          limit?: number;
        } = 'weekly_xp',
    limitLegacy: number = 50
  ) {
    if (typeof input === 'string') {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, display_name, avatar_url, current_rank, total_xp, winning_days')
        .order('total_xp', { ascending: false })
        .limit(limitLegacy);
      if (error) throw error;
      return data;
    }

    const leaderboardKey = String(input.leaderboardKey || 'weekly_xp').trim();
    const timeframe = String(input.timeframe || 'WEEK').trim().toUpperCase();
    const teamId = input.teamId ? String(input.teamId).trim() : null;
    const limit = Math.max(1, Math.min(200, Number(input.limit || 50)));
    const scope = teamId ? 'team' : 'global';

    let leaderboardQuery = supabase
      .from('leaderboards')
      .select('id, leaderboard_type, scope, scope_id, rankings, updated_at')
      .eq('leaderboard_type', `${leaderboardKey}:${timeframe}`)
      .eq('scope', scope);
    leaderboardQuery = teamId ? leaderboardQuery.eq('scope_id', teamId) : leaderboardQuery.is('scope_id', null);
    const { data: row, error: boardErr } = await leaderboardQuery.limit(1);
    if (boardErr) throw boardErr;
    const board = Array.isArray(row) ? row[0] : null;
    const rankings = Array.isArray(board?.rankings) ? board.rankings : [];

    if (rankings.length > 0) {
      const userIds = Array.from(new Set(rankings.map((entry: any) => String(entry?.user_id || '')).filter(Boolean)));
      const { data: profiles, error: profilesErr } = userIds.length
        ? await supabase.from('profiles').select('id, username, display_name, avatar_url, current_rank, total_xp').in('id', userIds)
        : ({ data: [], error: null } as any);
      if (profilesErr) throw profilesErr;
      const profileById = new Map<string, any>((profiles || []).map((p: any) => [String(p?.id || ''), p]));
      return rankings.slice(0, limit).map((entry: any, index: number) => {
        const userId = String(entry?.user_id || '');
        const profile = profileById.get(userId) || null;
        return {
          rank: Number(entry?.rank || index + 1),
          value: Number(entry?.value || 0),
          unit: String(entry?.unit || ''),
          user_id: userId,
          ...profile,
        };
      });
    }

    // Fallback: derive from profiles for now when cached board is missing.
    const { data: fallback, error: fallbackErr } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url, current_rank, total_xp, winning_days')
      .order('total_xp', { ascending: false })
      .limit(limit);
    if (fallbackErr) throw fallbackErr;
    return (fallback || []).map((row: any, idx: number) => ({
      rank: idx + 1,
      value: Number(row?.total_xp || 0),
      unit: 'xp',
      user_id: String(row?.id || ''),
      ...row,
    }));
  },

  async getActivityFeed(userId: string, limit: number = 50) {
    const capped = Math.max(1, Math.min(200, Number(limit || 50)));
    const { data, error } = await supabase
      .from('activity_feed')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(capped);
    if (error) throw error;
    return data || [];
  },

  async createTeamChallenge(input: {
    teamId: string;
    creatorUserId: string;
    title: string;
    description?: string | null;
    challengeType: string;
    targetValue: number;
    startDate: string;
    endDate: string;
    rules?: Record<string, any> | null;
  }) {
    const payload = {
      team_id: input.teamId,
      title: input.title,
      description: input.description || null,
      challenge_type: input.challengeType,
      target_value: Math.max(1, Math.round(Number(input.targetValue || 0))),
      current_value: 0,
      status: 'active',
      start_date: input.startDate,
      end_date: input.endDate,
      created_by: input.creatorUserId,
      rules: input.rules || {},
    };
    const { data, error } = await supabase.from('team_challenges').insert(payload).select('*').single();
    if (error) throw error;
    return data;
  },

  async getTeamChallenges(teamId: string, status?: 'active' | 'completed' | 'expired') {
    let query = supabase.from('team_challenges').select('*').eq('team_id', teamId).order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  async getTeamChallenge(challengeId: string) {
    const { data, error } = await supabase.from('team_challenges').select('*').eq('id', challengeId).single();
    if (error) throw error;
    return data;
  },

  async getTeamChallengeParticipants(challengeId: string) {
    const { data, error } = await supabase
      .from('team_challenge_participants')
      .select(
        `
        *,
        profiles:user_id (
          id, username, display_name, avatar_url, current_rank, total_xp
        )
      `
      )
      .eq('challenge_id', challengeId)
      .order('best_score', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async joinTeamChallenge(challengeId: string, userId: string) {
    const payload = {
      challenge_id: challengeId,
      user_id: userId,
      status: 'JOINED',
      joined_at: new Date().toISOString(),
      progress: {},
    };
    const { data, error } = await supabase
      .from('team_challenge_participants')
      .upsert(payload, { onConflict: 'challenge_id,user_id' })
      .select('*')
      .single();
    if (error) throw error;
    return data;
  },

  async leaveTeamChallenge(challengeId: string, userId: string) {
    const { error } = await supabase
      .from('team_challenge_participants')
      .update({ status: 'LEFT', updated_at: new Date().toISOString() })
      .eq('challenge_id', challengeId)
      .eq('user_id', userId);
    if (error) throw error;
  },

  async evaluateTeamChallengesForWorkout(workoutId: string) {
    const { data, error } = await supabase.rpc('evaluate_team_challenges_for_workout', { p_workout_id: workoutId });
    if (error) throw error;
    return data;
  },

  // ============================================
  // REAL-TIME SUBSCRIPTIONS
  // ============================================
  subscribeToFeed(callback: (payload: any) => void) {
    return supabase
      .channel('public:posts')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, callback)
      .subscribe();
  },

  subscribeToPostLikes(postId: string, callback: (payload: any) => void) {
    return supabase
      .channel(`post:${postId}:likes`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'likes', filter: `post_id=eq.${postId}` }, callback)
      .subscribe();
  },

  subscribeToComments(postId: string, callback: (payload: any) => void) {
    return supabase
      .channel(`post:${postId}:comments`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments', filter: `post_id=eq.${postId}` }, callback)
      .subscribe();
  },
};

export const socialApi: typeof enabledSocialApi =
  new Proxy({} as typeof enabledSocialApi, {
    get(_target, prop) {
      const socialEnabled = APP_CONFIG.FEATURES.SOCIAL_FEATURES_ENABLED || APP_CONFIG.RUNTIME.OVERRIDES.SOCIAL_FEATURES_ENABLED;
      const api = socialEnabled && isSupabaseConfigured ? enabledSocialApi : createSocialApiDisabledProxy();
      return (api as any)[prop as any];
    },
  });
