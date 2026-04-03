import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { socialApi } from './supabaseClient';

type SocialOutboxOp =
  | { type: 'create_post'; payload: { viewerUserId: string; content: string; composerType: string; data: any; options?: any } }
  | { type: 'like_post'; payload: { viewerUserId: string; postId: string } }
  | { type: 'unlike_post'; payload: { viewerUserId: string; postId: string } }
  | { type: 'create_comment'; payload: { viewerUserId: string; postId: string; text: string } };

export type SocialOutboxItem = {
  id: string;
  op: SocialOutboxOp;
  createdAtIso: string;
  attemptCount: number;
  lastError?: string | null;
};

function keyFeedCache(viewerUserId: string, scope: string) {
  return `zenith_social_feed_cache_v1:${viewerUserId}:${scope}`;
}

function keyOutbox(viewerUserId: string) {
  return `zenith_social_outbox_v1:${viewerUserId}`;
}

function looksLikeNetworkError(err: any): boolean {
  const msg = String(err?.message || err || '').toLowerCase();
  if (!msg) return false;
  return (
    msg.includes('network') ||
    msg.includes('failed to fetch') ||
    msg.includes('fetch') && msg.includes('failed') ||
    msg.includes('connection') ||
    msg.includes('timeout') ||
    msg.includes('offline') ||
    msg.includes('socket')
  );
}

export async function loadCachedFeed<T>(viewerUserId: string, scope: string): Promise<{ rows: T[]; cachedAtIso: string | null }> {
  const raw = await AsyncStorage.getItem(keyFeedCache(viewerUserId, scope));
  if (!raw) return { rows: [], cachedAtIso: null };
  try {
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed?.rows) ? (parsed.rows as T[]) : [];
    const cachedAtIso = typeof parsed?.cachedAtIso === 'string' ? parsed.cachedAtIso : null;
    return { rows, cachedAtIso };
  } catch {
    return { rows: [], cachedAtIso: null };
  }
}

export async function saveCachedFeed<T>(viewerUserId: string, scope: string, rows: T[]) {
  const payload = { cachedAtIso: new Date().toISOString(), rows };
  await AsyncStorage.setItem(keyFeedCache(viewerUserId, scope), JSON.stringify(payload));
}

export async function enqueueOutbox(viewerUserId: string, op: SocialOutboxOp): Promise<string> {
  const id = Crypto.randomUUID();
  const item: SocialOutboxItem = {
    id,
    op,
    createdAtIso: new Date().toISOString(),
    attemptCount: 0,
    lastError: null,
  };

  const raw = await AsyncStorage.getItem(keyOutbox(viewerUserId));
  const rows: SocialOutboxItem[] = (() => {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as SocialOutboxItem[]) : [];
    } catch {
      return [];
    }
  })();

  rows.push(item);
  // Keep the queue bounded to avoid unbounded growth in pathological offline sessions.
  const bounded = rows.slice(-500);
  await AsyncStorage.setItem(keyOutbox(viewerUserId), JSON.stringify(bounded));
  return id;
}

export async function getOutbox(viewerUserId: string): Promise<SocialOutboxItem[]> {
  const raw = await AsyncStorage.getItem(keyOutbox(viewerUserId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SocialOutboxItem[]) : [];
  } catch {
    return [];
  }
}

async function setOutbox(viewerUserId: string, rows: SocialOutboxItem[]) {
  await AsyncStorage.setItem(keyOutbox(viewerUserId), JSON.stringify(rows));
}

export async function flushOutbox(viewerUserId: string): Promise<{ flushed: number; remaining: number; stoppedOnNetworkError: boolean }> {
  const queue = await getOutbox(viewerUserId);
  if (queue.length === 0) return { flushed: 0, remaining: 0, stoppedOnNetworkError: false };

  const nextQueue: SocialOutboxItem[] = [];
  let flushed = 0;
  let stoppedOnNetworkError = false;

  for (const item of queue) {
    try {
      item.attemptCount = (item.attemptCount || 0) + 1;
      item.lastError = null;

      const op = item.op;
      if (op.type === 'create_post') {
        const { content, composerType, data, options } = op.payload;
        await socialApi.createPost(viewerUserId, content, composerType as any, data, options);
      } else if (op.type === 'like_post') {
        await socialApi.likePost(viewerUserId, op.payload.postId);
      } else if (op.type === 'unlike_post') {
        await socialApi.unlikePost(viewerUserId, op.payload.postId);
      } else if (op.type === 'create_comment') {
        await socialApi.createComment(viewerUserId, op.payload.postId, op.payload.text);
      }

      flushed += 1;
      continue;
    } catch (err: any) {
      item.lastError = String(err?.message || err || 'unknown_error');

      if (looksLikeNetworkError(err)) {
        // Stop processing; we likely lost connectivity. Keep remaining items.
        stoppedOnNetworkError = true;
        nextQueue.push(item);
        // Preserve the rest untouched.
        const remaining = queue.slice(queue.indexOf(item) + 1);
        nextQueue.push(...remaining);
        break;
      }

      // Non-network error: keep item for retry (it may be transient), but don't block the queue forever.
      nextQueue.push(item);
    }
  }

  await setOutbox(viewerUserId, nextQueue);
  return { flushed, remaining: nextQueue.length, stoppedOnNetworkError };
}

export function isProbablyOffline(err: any): boolean {
  return looksLikeNetworkError(err);
}

