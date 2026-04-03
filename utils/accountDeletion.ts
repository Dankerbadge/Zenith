import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { canUseSecurePasswordStorage, deletePasswordHash } from './authSecurity';
import { isSupabaseConfigured, supabase } from './supabaseClient';

export type DeleteAccountMode =
  | { kind: 'local_only' }
  | { kind: 'connected_full' }; // server delete + local wipe, requires online and valid session

export type DeleteAccountResult = {
  ok: boolean;
  serverDeleted: boolean;
  localWipe: {
    wiped: string[];
    failed: { key: string; error: string }[];
  };
};

const ORCHESTRATOR_VERSION = 'v1';

type WipeLocalOptions = {
  emailForSecureWipe?: string | null;
};

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

function getSupabaseRefFromUrl(): string {
  const raw = process.env.EXPO_PUBLIC_SUPABASE_URL || readExtra('EXPO_PUBLIC_SUPABASE_URL') || '';
  const match = String(raw).trim().match(/^https:\/\/([^.]+)\.supabase\.co/i);
  return match?.[1] || '';
}

export async function wipeLocalZenithData(options: WipeLocalOptions = {}): Promise<DeleteAccountResult['localWipe']> {
  const failed: { key: string; error: string }[] = [];
  let keys: string[] = [];
  try {
    keys = Array.from(await AsyncStorage.getAllKeys());
  } catch (err) {
    failed.push({
      key: 'AsyncStorage.getAllKeys',
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // AsyncStorage is app-scoped; clearing it is the safest way to guarantee no data rehydrates.
  try {
    await AsyncStorage.clear();
  } catch (err) {
    failed.push({
      key: 'AsyncStorage.clear',
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // SecureStore cannot be enumerated. We delete known Zenith-owned secrets.
  const email = options.emailForSecureWipe ? String(options.emailForSecureWipe) : '';
  if (email && canUseSecurePasswordStorage()) {
    try {
      await deletePasswordHash(email);
    } catch (err) {
      failed.push({
        key: `SecureStore.deletePasswordHash(${email})`,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Best-effort cleanup for any legacy keys we may have used historically.
  // If this fails, it should not block deletion; the AsyncStorage clear already removed them.
  try {
    await SecureStore.deleteItemAsync(`zenith:${ORCHESTRATOR_VERSION}:deletion_pending`);
  } catch {
    // ignore
  }

  const ref = getSupabaseRefFromUrl();
  if (ref) {
    const secureKeys = [
      `sb-${ref}-auth-token`,
      `sb-${ref}-auth-token-code-verifier`,
    ];
    for (const key of secureKeys) {
      try {
        await SecureStore.deleteItemAsync(key);
      } catch (err) {
        failed.push({
          key: `SecureStore.deleteItemAsync(${key})`,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return { wiped: keys, failed };
}

export async function deleteServerAccountMe(): Promise<void> {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured in this build.');
  }

  // Server deletion is performed via an authenticated Edge Function (delete_me).
  // Mode A requirement: this must succeed before local wipe.
  const { error } = await supabase.functions.invoke('delete-me', {
    body: { reason: 'user_requested' },
  });
  if (error) {
    throw new Error(error.message || 'Unable to delete server account right now.');
  }

  // Best-effort session invalidation server-side after deletion.
  try {
    await supabase.auth.signOut();
  } catch {
    // ignore
  }
}

export async function deleteAccount(mode: DeleteAccountMode, options: WipeLocalOptions = {}): Promise<DeleteAccountResult> {
  if (mode.kind === 'connected_full') {
    if (!isSupabaseConfigured) {
      return {
        ok: false,
        serverDeleted: false,
        localWipe: { wiped: [], failed: [{ key: 'supabase', error: 'Supabase is not configured in this build.' }] },
      };
    }

    // Server delete must succeed first (Mode A).
    await deleteServerAccountMe();
    const localWipe = await wipeLocalZenithData(options);
    return { ok: true, serverDeleted: true, localWipe };
  }

  const localWipe = await wipeLocalZenithData(options);
  return { ok: true, serverDeleted: false, localWipe };
}
