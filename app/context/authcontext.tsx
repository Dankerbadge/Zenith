import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import type { Href } from 'expo-router';
import { useRouter, useSegments } from 'expo-router';
import { canUseSecurePasswordStorage, hasPasswordHash, setPasswordHash, verifyPasswordHash } from '../../utils/authSecurity';
import {
  getCanonicalUserProfileKey,
  migrateLegacyUserProfileForEmail,
  normalizeEmail,
  safeParseJson,
  getUserProfileByEmail,
} from '../../utils/storageUtils';
import { isSupabaseConfigured, runSupabaseProjectRefGuard, supabase } from '../../utils/supabaseClient';
import { captureException, captureMessage, setCrashAuthMode } from '../../utils/crashReporter';
import { buildFallbackUsername, isUsernameValid, normalizeUsername } from '../../utils/username';
import { flushCloudStateSyncQueue, restoreCloudStateIfLocalMissing } from '../../utils/cloudStateSync';

interface User {
  email: string;
  firstName: string;
}

export type CloudProfile = {
  id: string;
  email: string | null;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

type StoredAccount = {
  email: string;
  firstName: string;
  marketingOptIn?: boolean;
  marketingOptInAt?: string;
  createdAt?: string;
  updatedAt?: string;
  // Legacy migration only. This field is removed after successful auth migration.
  password?: string;
};

interface AuthContextType {
  user: User | null;
  authReady: boolean;
  cloudSessionResolved: boolean;
  hasSupabaseSession: boolean;
  supabaseUserId: string | null;
  supabaseAuthLastError: string | null;
  profile: CloudProfile | null;
  profileReady: boolean;
  getSupabaseAccessToken: () => Promise<string | null>;
  setUsername: (usernameInput: string) => Promise<{
    ok: boolean;
    reason?: 'invalid' | 'taken' | 'cooldown' | 'no_session' | 'unknown';
    nextAllowedAt?: string | null;
  }>;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
  signup: (firstName: string, email: string, password: string, options?: { marketingOptIn?: boolean }) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  completePasswordReset: (input: {
    newPassword: string;
    code?: string | null;
    tokenHash?: string | null;
    accessToken?: string | null;
    refreshToken?: string | null;
  }) => Promise<void>;
  hardResetToLoggedOut: () => Promise<void>;
  logout: () => Promise<void>;
}

const USER_STORAGE_KEY = 'user';
const REMEMBER_ME_KEY = 'rememberMe';
const ALL_ACCOUNTS_KEY = 'allAccounts';
const PASSWORD_SCRUB_MIGRATION_KEY = 'auth:migration:password_scrub_v1';
const PASSWORD_RESET_REDIRECT_URL = process.env.EXPO_PUBLIC_PASSWORD_RESET_REDIRECT_URL || Linking.createURL('/auth/reset-password');

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function normalizeAccountsRegistry(
  raw: Record<string, StoredAccount | undefined>
): { accounts: Record<string, StoredAccount>; changed: boolean } {
  let changed = false;
  const normalized: Record<string, StoredAccount> = {};

  Object.entries(raw || {}).forEach(([key, account]) => {
    if (!account || typeof account !== 'object') {
      changed = true;
      return;
    }

    const normalizedEmail = normalizeEmail(account.email || key);
    if (!normalizedEmail) {
      changed = true;
      return;
    }

    const firstName = String(account.firstName || '').trim() || normalizedEmail.split('@')[0];
    const marketingOptIn = Boolean(account.marketingOptIn);
    const marketingOptInAt =
      marketingOptIn && typeof account.marketingOptInAt === 'string'
        ? account.marketingOptInAt
        : marketingOptIn
        ? new Date().toISOString()
        : undefined;
    const next: StoredAccount = {
      email: normalizedEmail,
      firstName,
      marketingOptIn,
      marketingOptInAt,
      createdAt: account.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    // Never reserialize plaintext passwords. Any legacy password field is handled by scrub + secure hash migration.

    if (normalized[key] && normalized[key].email !== normalizedEmail) {
      changed = true;
    }
    if (key !== normalizedEmail) changed = true;
    normalized[normalizedEmail] = next;
  });

  const rawKeys = Object.keys(raw || {});
  const normalizedKeys = Object.keys(normalized);
  if (rawKeys.length !== normalizedKeys.length) changed = true;

  return { accounts: normalized, changed };
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function fallbackFirstNameFromEmail(email: string) {
  return normalizeEmail(email).split('@')[0] || 'athlete';
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [hasSupabaseSession, setHasSupabaseSession] = useState(false);
  const [supabaseUserId, setSupabaseUserId] = useState<string | null>(null);
  const [supabaseAuthLastError, setSupabaseAuthLastError] = useState<string | null>(null);
  const [profile, setProfile] = useState<CloudProfile | null>(null);
  const [profileReady, setProfileReady] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [cloudSessionResolved, setCloudSessionResolved] = useState(false);
  const router = useRouter();
  const segments = useSegments();

  const authDebugEnabled = process.env.EXPO_PUBLIC_AUTH_DEBUG === '1';

  useEffect(() => {
    void runSupabaseProjectRefGuard();
  }, []);

  const getUnavailableUsernames = useCallback(async (candidates: string[]): Promise<Set<string>> => {
    if (!isSupabaseConfigured || candidates.length === 0) return new Set();
    const normalized = Array.from(
      new Set(
        candidates
          .map((row) => normalizeUsername(row))
          .filter((row) => Boolean(row))
      )
    );
    if (!normalized.length) return new Set();

    const { data, error } = await supabase.from('profiles').select('username').in('username', normalized);
    if (error) return new Set();
    const used = new Set<string>();
    (Array.isArray(data) ? data : []).forEach((row: any) => {
      const username = normalizeUsername(String(row?.username || ''));
      if (username) used.add(username);
    });
    return used;
  }, []);

  const generateUniqueFallbackUsername = useCallback(
    async (base: string) => {
      const normalizedBase = normalizeUsername(base) || 'zenith-athlete';
      // Reserve room for "-####" suffix.
      const prefix = normalizedBase.slice(0, Math.max(3, 16));
      const candidates: string[] = [];
      for (let i = 0; i < 24; i++) {
        const suffix = Math.floor(1000 + Math.random() * 9000);
        candidates.push(`${prefix}-${String(suffix)}`.slice(0, 20));
      }
      const unavailable = await getUnavailableUsernames(candidates);
      for (let i = 0; i < candidates.length; i += 1) {
        const candidate = normalizeUsername(candidates[i]);
        if (candidate && !unavailable.has(candidate)) {
          return candidate;
        }
      }
      // Last resort: longer random.
      const suffix = Math.floor(100000 + Math.random() * 900000);
      return buildFallbackUsername(suffix);
    },
    [getUnavailableUsernames]
  );

  const ensureLocalUserFromSupabase = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const persistRecoveredIdentity = async (emailInput: string) => {
      const normalizedEmail = normalizeEmail(emailInput);
      if (!normalizedEmail) return;
      const recoveredUser: User = {
        email: normalizedEmail,
        firstName: fallbackFirstNameFromEmail(normalizedEmail),
      };
      setUser((prev) => prev || recoveredUser);
      try {
        await AsyncStorage.setItem(USER_STORAGE_KEY, JSON.stringify(recoveredUser));
      } catch {
        // ignore
      }
      try {
        const rememberMe = await AsyncStorage.getItem(REMEMBER_ME_KEY);
        if (rememberMe !== 'true') {
          await AsyncStorage.setItem(REMEMBER_ME_KEY, 'true');
        }
      } catch {
        // ignore
      }
      try {
        const allAccountsRaw = await AsyncStorage.getItem(ALL_ACCOUNTS_KEY);
        const parsedAccounts = safeParseJson<Record<string, StoredAccount | undefined>>(allAccountsRaw, {});
        const { accounts } = normalizeAccountsRegistry(parsedAccounts);
        if (!accounts[normalizedEmail]) {
          const nowIso = new Date().toISOString();
          accounts[normalizedEmail] = {
            email: normalizedEmail,
            firstName: recoveredUser.firstName,
            createdAt: nowIso,
            updatedAt: nowIso,
          };
          await AsyncStorage.setItem(ALL_ACCOUNTS_KEY, JSON.stringify(accounts));
        }
      } catch {
        // ignore
      }
    };

    // If we have a valid Supabase session but no local user, synthesize a minimal local user so
    // route guards and UI surfaces don't "half-sign-in" (cloud connected, local missing).
    const { data, error } = await supabase.auth.getSession();
    if (error) return;
    const token = data.session?.access_token ?? null;
    if (!token) return;
    const email = String(data.session?.user?.email || '').trim();
    if (!email) {
      try {
        const u = await supabase.auth.getUser();
        const fallbackEmail = String(u?.data?.user?.email || '').trim();
        if (!fallbackEmail) return;
        await persistRecoveredIdentity(fallbackEmail);
      } catch {
        return;
      }
      return;
    }
    await persistRecoveredIdentity(email);
  }, []);

  const scrubPlaintextPasswords = useCallback(async () => {
    // One-time scrub to eliminate any legacy plaintext password artifacts in AsyncStorage.
    // If a legacy password is present, migrate it into secure storage first, then remove it permanently.
    const alreadyScrubbed = (await AsyncStorage.getItem(PASSWORD_SCRUB_MIGRATION_KEY)) === 'true';

    const allAccountsRaw = await AsyncStorage.getItem(ALL_ACCOUNTS_KEY);
    const parsedAccounts = safeParseJson<Record<string, StoredAccount | undefined>>(allAccountsRaw, {});

    // Extract any plaintext password fields before normalization so we can migrate them into secure storage.
    const legacyPasswords: Record<string, string> = {};
    Object.entries(parsedAccounts || {}).forEach(([key, account]) => {
      if (!account || typeof account !== 'object') return;
      const normalizedEmail = normalizeEmail(account.email || key);
      if (!normalizedEmail) return;
      const maybePassword = (account as any).password;
      if (typeof maybePassword === 'string' && maybePassword.length > 0) {
        legacyPasswords[normalizedEmail] = maybePassword;
      }
    });

    // Always normalize + remove any password field. Even post-scrub, we re-assert this to prevent regressions.
    const { accounts, changed } = normalizeAccountsRegistry(parsedAccounts);

    // If there are legacy passwords, migrate into SecureStore (best-effort) before removing the field.
    // This preserves legacy local-only accounts without leaving plaintext behind.
    const legacyEntries = Object.entries(legacyPasswords);
    if (legacyEntries.length > 0 && canUseSecurePasswordStorage()) {
      for (const [email, plaintext] of legacyEntries) {
        try {
          const hasHash = await hasPasswordHash(email);
          if (!hasHash) {
            await setPasswordHash(email, plaintext);
          }
        } catch (err) {
          // Never keep plaintext as a fallback. If secure storage fails, user will need to reset.
          if (__DEV__) {
            console.warn('[auth] Failed to migrate legacy plaintext password into secure storage.', err);
          } else {
            void captureMessage('auth_migration_warning', {
              branch: 'legacy_password_migration_failed',
              secureStorageAvailable: canUseSecurePasswordStorage(),
              error: String((err as any)?.message || err),
            });
          }
        }
      }
    }

    // Persist normalized accounts if:
    // - we changed keys during normalization
    // - we found any legacy plaintext password fields
    // - we have not yet marked scrub complete
    const shouldPersist = changed || legacyEntries.length > 0 || !alreadyScrubbed;
    if (shouldPersist) {
      await AsyncStorage.setItem(ALL_ACCOUNTS_KEY, JSON.stringify(accounts));
    }

    if (!alreadyScrubbed) {
      await AsyncStorage.setItem(PASSWORD_SCRUB_MIGRATION_KEY, 'true');
    } else if (legacyEntries.length > 0) {
      // If plaintext reappeared after scrub, remove again and log once.
      if (__DEV__) {
        console.warn('[auth] Legacy plaintext password fields were detected after scrub and removed again.');
      } else {
        void captureMessage('auth_migration_warning', {
          branch: 'legacy_plaintext_detected_post_scrub',
          legacyCount: legacyEntries.length,
        });
      }
    }
  }, []);

  useEffect(() => {
    // Crash telemetry context only (never used for product behavior).
    setCrashAuthMode(hasSupabaseSession ? 'connected' : user ? 'local_only' : 'unknown');
  }, [hasSupabaseSession, user]);

  const getSupabaseAccessToken = useCallback(async () => {
    if (!isSupabaseConfigured) return null;

    const { data, error } = await supabase.auth.getSession();
    if (error) {
      setHasSupabaseSession(false);
      setSupabaseUserId(null);
      setSupabaseAuthLastError(error.message || 'Unable to read Supabase session.');
      return null;
    }

    const token = data.session?.access_token ?? null;
    setHasSupabaseSession(Boolean(token));
    let resolvedUserId = data.session?.user?.id ?? null;
    if (token && !resolvedUserId) {
      try {
        const userResult = await supabase.auth.getUser();
        resolvedUserId = userResult?.data?.user?.id ?? null;
      } catch {
        // ignore
      }
    }
    setSupabaseUserId(resolvedUserId);
    if (token) {
      setSupabaseAuthLastError(null);
    }
    return token;
  }, []);

  const hydrateSupabaseSession = useCallback(
    async (retry: boolean) => {
      const token = await getSupabaseAccessToken();
      if (token || !retry) return token;

      // Supabase React Native session recovery can race AsyncStorage hydration on cold start.
      // Retry a few times to avoid falsely treating the user as signed out.
      const delays = [250, 600, 1200];
      for (const ms of delays) {
        await sleep(ms);
        const next = await getSupabaseAccessToken();
        if (next) return next;
      }
      return null;
    },
    [getSupabaseAccessToken]
  );

  const hardResetToLoggedOut = useCallback(async () => {
    setUser(null);
    setHasSupabaseSession(false);
    setSupabaseUserId(null);
    setSupabaseAuthLastError(null);
    setProfile(null);
    setProfileReady(false);
    try {
      await AsyncStorage.multiRemove([USER_STORAGE_KEY, REMEMBER_ME_KEY]);
    } catch {
      // ignore
    }
    try {
      if (isSupabaseConfigured) {
        await supabase.auth.signOut();
      }
    } catch {
      // ignore
    }
    router.replace('/auth/login' as Href);
  }, [router]);

  const syncSupabaseLogin = useCallback(
    async (email: string, password: string): Promise<{ ok: boolean; firstName?: string | null; userId?: string | null }> => {
    if (!isSupabaseConfigured) return { ok: false };

    const signIn = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (!signIn.error) {
      setHasSupabaseSession(true);
      setSupabaseAuthLastError(null);
      const firstName = String((signIn.data.user?.user_metadata as { first_name?: string } | null)?.first_name || '').trim() || null;
      const userId = signIn.data.user?.id || null;
      setSupabaseUserId(userId);
      return { ok: true, firstName, userId };
    }

    const signInMessage = signIn.error.message?.toLowerCase() || '';
    const looksLikeMissingUser =
      signInMessage.includes('invalid login credentials') ||
      signInMessage.includes('user not found');

    // Local auth is already validated. If Supabase user is missing, bootstrap it now.
    if (looksLikeMissingUser) {
      const signUp = await supabase.auth.signUp({
        email,
        password,
      });
      if (signUp.error) {
        const signUpMessage = signUp.error.message?.toLowerCase() || '';
        const accountAlreadyExists = signUpMessage.includes('already') || signUpMessage.includes('registered');
        if (!accountAlreadyExists) {
          setHasSupabaseSession(false);
          setSupabaseAuthLastError(signUp.error.message || 'Supabase account bootstrap failed.');
          return { ok: false };
        }
      }

      const retrySignIn = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (retrySignIn.error) {
        setHasSupabaseSession(false);
        setSupabaseUserId(null);
        setSupabaseAuthLastError(retrySignIn.error.message || 'Supabase sign-in retry failed.');
        return { ok: false };
      }

      setHasSupabaseSession(true);
      setSupabaseAuthLastError(null);
      const firstName = String((retrySignIn.data.user?.user_metadata as { first_name?: string } | null)?.first_name || '').trim() || null;
      const userId = retrySignIn.data.user?.id || null;
      setSupabaseUserId(userId);
      return { ok: true, firstName, userId };
    }

    setHasSupabaseSession(false);
    setSupabaseUserId(null);
    setSupabaseAuthLastError(signIn.error.message || 'Supabase sign-in failed.');
    return { ok: false };
  }, []);

  const syncSupabaseSignup = useCallback(async (firstName: string, email: string, password: string, marketingOptIn = false) => {
    if (!isSupabaseConfigured) return;

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          first_name: firstName,
          marketing_opt_in: marketingOptIn,
        },
      },
    });

    if (error) {
      // If account already exists in Supabase, attempt sign-in for bridge continuity.
      const looksLikeExistingAccount =
        error.message?.toLowerCase().includes('already') ||
        error.message?.toLowerCase().includes('registered');
      if (looksLikeExistingAccount) {
        await syncSupabaseLogin(email, password);
      } else {
        setHasSupabaseSession(false);
        setSupabaseAuthLastError(error.message || 'Supabase sign-up failed.');
      }
      return;
    }

    // Supabase session persistence can take a moment to hydrate on React Native (SecureStore/AsyncStorage).
    // Do not surface a scary "session not ready" error to the user here; retry briefly and let the
    // auth state listener settle the final session state.
    const token = await hydrateSupabaseSession(true);
    setHasSupabaseSession(Boolean(token));
    setSupabaseAuthLastError(null);
  }, [hydrateSupabaseSession, syncSupabaseLogin]);

  const ensureSupabaseProfile = useCallback(
    async (input: { email: string; firstName: string; marketingOptIn?: boolean }) => {
      if (!isSupabaseConfigured) return;

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) {
        return;
      }

      const id = userData.user.id;
      const normalizedEmail = normalizeEmail(String(userData.user.email || input.email || ''));
      if (!normalizedEmail) return;
      const displayName = String(input.firstName || '').trim() || fallbackFirstNameFromEmail(normalizedEmail);
      // If the profile is missing a username (or never existed), ensure a per-account username exists.
      let existingUsername: string | null = null;
      try {
        const existing = await supabase.from('profiles').select('username').eq('id', id).maybeSingle();
        existingUsername = (existing.data as any)?.username ? String((existing.data as any).username) : null;
      } catch {
        existingUsername = null;
      }

      const ensuredUsername =
        existingUsername && isUsernameValid(existingUsername)
          ? normalizeUsername(existingUsername)
          : await generateUniqueFallbackUsername(displayName || normalizedEmail.split('@')[0] || 'zenith-athlete');

      const payload: Record<string, unknown> = {
        id,
        email: normalizedEmail,
        username: ensuredUsername,
        display_name: displayName,
      };

      let upsertError: any = null;
      // Username uniqueness is enforced in the DB; handle rare races deterministically.
      for (let attempt = 0; attempt < 3; attempt++) {
        const { error } = await supabase.from('profiles').upsert(payload, { onConflict: 'id', ignoreDuplicates: true });
        upsertError = error;
        if (!upsertError) break;
        const code = String((upsertError as any)?.code || '');
        const msg = String((upsertError as any)?.message || '').toLowerCase();
        const isUnique = code === '23505' || msg.includes('duplicate') || msg.includes('unique');
        if (isUnique) {
          const next = await generateUniqueFallbackUsername(displayName || normalizedEmail.split('@')[0] || 'zenith-athlete');
          payload.username = next;
          continue;
        }
        break;
      }

      if (upsertError) {
        const message = (upsertError.message || '').toLowerCase();
        if (message.includes('permission denied')) {
          setSupabaseAuthLastError(
            'Social backend permissions are missing for this build. Apply the latest Supabase migrations (profiles insert policy) and sign in again.'
          );
          return;
        }
        const isNonBlockingSchemaGap =
          message.includes('relation') ||
          message.includes('does not exist') ||
          message.includes('column') ||
          message.includes('schema cache');
        if (!isNonBlockingSchemaGap) {
          setSupabaseAuthLastError(upsertError.message || 'Supabase profile sync failed.');
        }
      }

      if (typeof input.marketingOptIn === 'boolean') {
        const { error: metadataError } = await supabase.auth.updateUser({
          data: {
            marketing_opt_in: input.marketingOptIn,
          },
        });
        if (metadataError) {
          setSupabaseAuthLastError(metadataError.message || 'Supabase metadata sync failed.');
        }
      }
    },
    [generateUniqueFallbackUsername]
  );

  const loadCloudProfile = useCallback(
    async (userId: string) => {
      if (!isSupabaseConfigured) return null;
      const { data, error } = await supabase
        .from('profiles')
        .select('id,email,username,display_name,avatar_url')
        .eq('id', userId)
        .maybeSingle();
      if (error) return null;
      if (!data) return null;
      return data as CloudProfile;
    },
    []
  );

  const setUsername = useCallback(
    async (
      usernameInput: string
    ): Promise<{
      ok: boolean;
      reason?: 'invalid' | 'taken' | 'cooldown' | 'no_session' | 'unknown';
      nextAllowedAt?: string | null;
    }> => {
      if (!isSupabaseConfigured || !hasSupabaseSession || !supabaseUserId) return { ok: false, reason: 'no_session' };
      const normalized = normalizeUsername(usernameInput);
      if (!isUsernameValid(normalized)) return { ok: false, reason: 'invalid' };

      const { data, error } = await supabase.rpc('change_username', { new_username: normalized });

      if (error) {
        const code = String((error as any)?.code || '');
        const msg = String((error as any)?.message || '').toLowerCase();
        const isUnique = code === '23505' || msg.includes('duplicate') || msg.includes('unique') || msg.includes('taken');
        if (isUnique) return { ok: false, reason: 'taken' };
        return { ok: false, reason: 'unknown' };
      }

      const row = Array.isArray(data) && data.length ? (data[0] as any) : null;
      if (!row) return { ok: false, reason: 'unknown' };

      if (!row.changed) {
        return { ok: false, reason: 'cooldown', nextAllowedAt: row.next_allowed_at ? String(row.next_allowed_at) : null };
      }

      // Keep display_name simple for now; can be customized later.
      try {
        await supabase.from('profiles').update({ display_name: normalized }).eq('id', supabaseUserId);
      } catch {
        // ignore
      }

      const next = await loadCloudProfile(supabaseUserId);
      setProfile(next);
      setProfileReady(true);
      return { ok: true };
    },
    [hasSupabaseSession, supabaseUserId, loadCloudProfile]
  );

  const routeAfterAuth = useCallback(
    async (email: string) => {
      const normalized = normalizeEmail(email);
      await migrateLegacyUserProfileForEmail(normalized);
      const profile = await getUserProfileByEmail(normalized);
      if (profile.onboardingCompleted) {
        router.replace('/(tabs)' as Href);
      } else {
        router.replace('/onboarding' as Href);
      }
    },
    [router]
  );

  const persistMarketingPreference = useCallback(async (email: string, marketingOptIn: boolean) => {
    const normalized = normalizeEmail(email);
    if (!normalized) return;

    const currentProfile = await getUserProfileByEmail(normalized);
    const existingPrefs =
      typeof currentProfile.marketingPreferences === 'object' && currentProfile.marketingPreferences
        ? (currentProfile.marketingPreferences as Record<string, unknown>)
        : {};

    const nextProfile = {
      ...currentProfile,
      marketingPreferences: {
        ...existingPrefs,
        newsletterOptIn: marketingOptIn,
        updatedAt: new Date().toISOString(),
      },
    };

    await AsyncStorage.setItem(getCanonicalUserProfileKey(normalized), JSON.stringify(nextProfile));
  }, []);

  const checkUser = useCallback(async () => {
    try {
      await scrubPlaintextPasswords();
      const rememberMe = await AsyncStorage.getItem(REMEMBER_ME_KEY);
      // If remember-me is off, the local profile might not hydrate, but Supabase may still have a
      // persisted session (TestFlight upgrades, auth flow changes). We still hydrate Supabase state
      // so the app doesn't get stuck in a half-signed-in state.

      const savedUser = await AsyncStorage.getItem(USER_STORAGE_KEY);
      const parsedUser = safeParseJson<User | null>(savedUser, null);
      const email = normalizeEmail(parsedUser?.email);
      if (!parsedUser || !email) {
        if (rememberMe === 'true') {
          await AsyncStorage.multiRemove([USER_STORAGE_KEY, REMEMBER_ME_KEY]);
        }
        // Community + social must not show a scary "missing/expired" gate if a valid cloud session
        // exists but is still hydrating (SecureStore/AsyncStorage races on cold start).
        await hydrateSupabaseSession(true);
        await ensureLocalUserFromSupabase();
        await restoreCloudStateIfLocalMissing();
        await flushCloudStateSyncQueue('manual');
        return;
      }

      const nextUser: User = {
        email,
        firstName: String(parsedUser.firstName || '').trim() || email.split('@')[0],
      };
      setUser(nextUser);
      await migrateLegacyUserProfileForEmail(email);
      await hydrateSupabaseSession(true);
      await ensureLocalUserFromSupabase();
      await restoreCloudStateIfLocalMissing();
      await flushCloudStateSyncQueue('manual');
    } catch (error) {
      setUser(null);
      setHasSupabaseSession(false);
      setSupabaseUserId(null);
      setProfile(null);
      setProfileReady(true);
      setSupabaseAuthLastError('Failed to restore session. Please sign in again.');
      if (__DEV__) {
        console.log('Error checking user:', error);
      } else {
        void captureException(error, { feature: 'auth', op: 'check_user' });
      }
    } finally {
      setIsReady(true);
      setCloudSessionResolved(true);
    }
  }, [ensureLocalUserFromSupabase, hydrateSupabaseSession, scrubPlaintextPasswords]);

  useEffect(() => {
    void checkUser();
  }, [checkUser]);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setHasSupabaseSession(false);
      setSupabaseUserId(null);
      setSupabaseAuthLastError(null);
      return;
    }

    // Seed initial auth state from any persisted Supabase session.
    // `onAuthStateChange` does not guarantee an initial callback on app start.
    void getSupabaseAccessToken();

    let alive = true;
    const { data: subscription } = supabase.auth.onAuthStateChange((event: string, session: any) => {
      if (!alive) return;
      const token = session?.access_token ?? null;
      if (event === 'SIGNED_OUT') {
        setHasSupabaseSession(false);
        setSupabaseUserId(null);
        setProfile(null);
        setProfileReady(false);
      }
      if (event === 'PASSWORD_RECOVERY') {
        router.replace('/auth/reset-password' as Href);
      }
      setHasSupabaseSession(Boolean(token));
      setSupabaseUserId(session?.user?.id ?? null);
      if (token) {
        setSupabaseAuthLastError(null);
      }
      if (authDebugEnabled) {
        console.log('[auth] onAuthStateChange', { event, hasSession: Boolean(token), userId: session?.user?.id || null });
      }
    });

    return () => {
      alive = false;
      subscription.subscription.unsubscribe();
    };
  }, [getSupabaseAccessToken, authDebugEnabled, router]);

  useEffect(() => {
    let cancelled = false;
    // Load and keep a single source of truth for the cloud profile (username/handle).
    const run = async () => {
      if (!isReady) return;
      if (!isSupabaseConfigured || !hasSupabaseSession || !supabaseUserId) {
        setProfile(null);
        setProfileReady(true);
        return;
      }

      setProfileReady(false);
      // Ensure required profile fields (username) exist, then load.
      const email = String(user?.email || '').trim();
      const firstName = String(user?.firstName || '').trim() || fallbackFirstNameFromEmail(email || 'athlete');
      try {
        await ensureSupabaseProfile({ email: email || '', firstName });
      } catch (err) {
        if (authDebugEnabled) console.log('[auth] ensureSupabaseProfile failed', err);
      }
      const next = await loadCloudProfile(supabaseUserId);
      if (cancelled) return;
      setProfile(next);
      setProfileReady(true);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [
    isReady,
    hasSupabaseSession,
    supabaseUserId,
    user?.email,
    user?.firstName,
    ensureSupabaseProfile,
    loadCloudProfile,
    authDebugEnabled,
  ]);

  useEffect(() => {
    if (!isReady) return;

    const group = segments[0];
    const publicGroups = new Set(['auth', 'onboarding', 'paywall', 'wearables', 'health-permissions']);
    const isPublicGroup = !group || publicGroups.has(group);
    const inAuthGroup = group === 'auth';

    // App-level auth is based on local account session; cloud session recovery is handled separately.
    // This avoids forcing a second hard login redirect while Supabase storage hydrates/reconnects.
    const authenticated = Boolean(user);
    if (!authenticated && !isPublicGroup) {
      router.replace('/auth/login' as Href);
      return;
    }

    if (user && inAuthGroup) {
      void routeAfterAuth(user.email);
    }
  }, [user, segments, isReady, router, routeAfterAuth]);

  const login = async (email: string, password: string, rememberMe = true) => {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || !password) {
      throw new Error('Email and password are required.');
    }
    if (!isValidEmail(normalizedEmail)) {
      throw new Error('Enter a valid email address.');
    }
    if (!canUseSecurePasswordStorage()) {
      throw new Error('Secure authentication is unavailable on this platform.');
    }

    await scrubPlaintextPasswords();

    const allAccountsRaw = await AsyncStorage.getItem(ALL_ACCOUNTS_KEY);
    const parsedAccounts = safeParseJson<Record<string, StoredAccount | undefined>>(allAccountsRaw, {});
    const { accounts, changed } = normalizeAccountsRegistry(parsedAccounts);
    const account = accounts[normalizedEmail];
    const nowIso = new Date().toISOString();
    let authenticated = false;
    let resolvedFirstName = account?.firstName || fallbackFirstNameFromEmail(normalizedEmail);
    let shouldPersistAccounts = changed;
    let supabaseLoginSucceeded = false;

    if (!account) {
      const supabaseLogin = await syncSupabaseLogin(normalizedEmail, password);
      if (supabaseLogin.ok) {
        authenticated = true;
        supabaseLoginSucceeded = true;
        resolvedFirstName = supabaseLogin.firstName || fallbackFirstNameFromEmail(normalizedEmail);
        await setPasswordHash(normalizedEmail, password);
        accounts[normalizedEmail] = {
          email: normalizedEmail,
          firstName: resolvedFirstName,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        shouldPersistAccounts = true;
      } else {
        throw new Error('Invalid email or password.');
      }
    } else {
      const hasSecureHash = await hasPasswordHash(normalizedEmail);
      if (hasSecureHash) {
        authenticated = await verifyPasswordHash(normalizedEmail, password);
      }

      if (!authenticated) {
        const supabaseLogin = await syncSupabaseLogin(normalizedEmail, password);
        if (supabaseLogin.ok) {
          authenticated = true;
          supabaseLoginSucceeded = true;
          await setPasswordHash(normalizedEmail, password);
          if (supabaseLogin.firstName) {
            resolvedFirstName = supabaseLogin.firstName;
          }
          shouldPersistAccounts = true;
        }
      }

      if (!authenticated) {
        if (!hasSecureHash) {
          throw new Error('Password vault was reset for this account. Use Forgot Password or Sign Up with the same email to repair access.');
        }
        throw new Error('Invalid email or password.');
      }

      const nextAccount: StoredAccount = {
        ...account,
        email: normalizedEmail,
        firstName: resolvedFirstName,
        updatedAt: nowIso,
      };
      accounts[normalizedEmail] = nextAccount;
      shouldPersistAccounts = true;
    }

    if (shouldPersistAccounts) {
      await AsyncStorage.setItem(ALL_ACCOUNTS_KEY, JSON.stringify(accounts));
    }

    const userData: User = {
      email: normalizedEmail,
      firstName: resolvedFirstName,
    };

    if (isSupabaseConfigured && !supabaseLoginSucceeded) {
      const supabaseLogin = await syncSupabaseLogin(normalizedEmail, password);
      supabaseLoginSucceeded = supabaseLogin.ok;
    }
    if (isSupabaseConfigured && !supabaseLoginSucceeded) {
      throw new Error(
        'Cloud session sign-in failed. Please try again. Community and social features require cloud auth.'
      );
    }

    await AsyncStorage.setItem(USER_STORAGE_KEY, JSON.stringify(userData));
    await AsyncStorage.setItem(REMEMBER_ME_KEY, rememberMe ? 'true' : 'false');
    setUser(userData);
    await ensureSupabaseProfile({
      email: normalizedEmail,
      firstName: resolvedFirstName,
      marketingOptIn: accounts[normalizedEmail]?.marketingOptIn,
    });
    await persistMarketingPreference(normalizedEmail, Boolean(accounts[normalizedEmail]?.marketingOptIn));

    await routeAfterAuth(normalizedEmail);
  };

  const signup = async (firstName: string, email: string, password: string, options?: { marketingOptIn?: boolean }) => {
    const normalizedEmail = normalizeEmail(email);
    const trimmedName = String(firstName || '').trim();
    const marketingOptIn = Boolean(options?.marketingOptIn);

    if (!normalizedEmail || !trimmedName || !password) {
      throw new Error('Missing signup fields.');
    }
    if (!isValidEmail(normalizedEmail)) {
      throw new Error('Enter a valid email address.');
    }
    if (password.length < 8) {
      throw new Error('Password must be at least 8 characters.');
    }
    if (!canUseSecurePasswordStorage()) {
      throw new Error('Secure authentication is unavailable on this platform.');
    }

    const allAccountsRaw = await AsyncStorage.getItem(ALL_ACCOUNTS_KEY);
    const parsedAccounts = safeParseJson<Record<string, StoredAccount | undefined>>(allAccountsRaw, {});
    const { accounts } = normalizeAccountsRegistry(parsedAccounts);

    if (accounts[normalizedEmail]) {
      // Recovery path: account exists in local registry but secure keychain hash is missing.
      // This can happen after simulator/device keychain resets.
      const hasSecureHashForExisting = await hasPasswordHash(normalizedEmail);
      if (!hasSecureHashForExisting) {
        await setPasswordHash(normalizedEmail, password);
        accounts[normalizedEmail] = {
          ...accounts[normalizedEmail],
          firstName: trimmedName,
          marketingOptIn,
          marketingOptInAt: marketingOptIn ? new Date().toISOString() : undefined,
          updatedAt: new Date().toISOString(),
        };
        await AsyncStorage.setItem(ALL_ACCOUNTS_KEY, JSON.stringify(accounts));

        const userData: User = {
          email: normalizedEmail,
          firstName: trimmedName,
        };
        await AsyncStorage.setItem(USER_STORAGE_KEY, JSON.stringify(userData));
        await AsyncStorage.setItem(REMEMBER_ME_KEY, 'true');
        setUser(userData);
        await syncSupabaseLogin(normalizedEmail, password);
        await ensureSupabaseProfile({
          email: normalizedEmail,
          firstName: trimmedName,
          marketingOptIn,
        });
        await persistMarketingPreference(normalizedEmail, marketingOptIn);
        await routeAfterAuth(normalizedEmail);
        return;
      }

      throw new Error('An account with this email already exists.');
    }

    accounts[normalizedEmail] = {
      email: normalizedEmail,
      firstName: trimmedName,
      marketingOptIn,
      marketingOptInAt: marketingOptIn ? new Date().toISOString() : undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await setPasswordHash(normalizedEmail, password);
    await AsyncStorage.setItem(ALL_ACCOUNTS_KEY, JSON.stringify(accounts));

    const userData: User = {
      email: normalizedEmail,
      firstName: trimmedName,
    };
    await AsyncStorage.setItem(USER_STORAGE_KEY, JSON.stringify(userData));
    await AsyncStorage.setItem(REMEMBER_ME_KEY, 'true');
    setUser(userData);
    await syncSupabaseSignup(trimmedName, normalizedEmail, password, marketingOptIn);
    await ensureSupabaseProfile({
      email: normalizedEmail,
      firstName: trimmedName,
      marketingOptIn,
    });
    await persistMarketingPreference(normalizedEmail, marketingOptIn);

    await migrateLegacyUserProfileForEmail(normalizedEmail);
    router.replace('/onboarding' as Href);
  };

  const requestPasswordReset = async (email: string) => {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      throw new Error('Email is required.');
    }
    if (!isValidEmail(normalizedEmail)) {
      throw new Error('Enter a valid email address.');
    }

    if (isSupabaseConfigured) {
      const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: PASSWORD_RESET_REDIRECT_URL,
      });
      if (!error) {
        setSupabaseAuthLastError(null);
        return;
      }
      setSupabaseAuthLastError(error.message || 'Could not send reset email.');
      throw new Error(error.message || 'Could not send reset email.');
    }

    const allAccountsRaw = await AsyncStorage.getItem(ALL_ACCOUNTS_KEY);
    const parsedAccounts = safeParseJson<Record<string, StoredAccount | undefined>>(allAccountsRaw, {});
    const { accounts } = normalizeAccountsRegistry(parsedAccounts);
    if (accounts[normalizedEmail]) {
      // Local-first fallback path when Supabase reset isn't available.
      return;
    }

    throw new Error('Password reset is unavailable for this account right now. Try signing up again with the same email to repair local access.');
  };

  const completePasswordReset = async (input: {
    newPassword: string;
    code?: string | null;
    tokenHash?: string | null;
    accessToken?: string | null;
    refreshToken?: string | null;
  }) => {
    const newPassword = String(input.newPassword || '');
    if (newPassword.length < 8) {
      throw new Error('Password must be at least 8 characters.');
    }
    if (!isSupabaseConfigured) {
      throw new Error('Cloud password reset is not configured in this build.');
    }

    const code = String(input.code || '').trim();
    const tokenHash = String(input.tokenHash || '').trim();
    const accessToken = String(input.accessToken || '').trim();
    const refreshToken = String(input.refreshToken || '').trim();

    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) throw new Error(error.message || 'Failed to verify reset link.');
    } else if (tokenHash) {
      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: 'recovery',
      });
      if (error) throw new Error(error.message || 'Failed to verify recovery token.');
    } else if (accessToken && refreshToken) {
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) throw new Error(error.message || 'Failed to establish recovery session.');
    }

    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      throw new Error(sessionError.message || 'Unable to read recovery session.');
    }
    if (!sessionData.session) {
      throw new Error('No recovery session found. Open the latest reset link from your email on this device.');
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    });
    if (updateError) {
      throw new Error(updateError.message || 'Could not update password.');
    }

    const resetEmail = normalizeEmail(sessionData.session.user?.email);
    if (resetEmail) {
      const allAccountsRaw = await AsyncStorage.getItem(ALL_ACCOUNTS_KEY);
      const parsedAccounts = safeParseJson<Record<string, StoredAccount | undefined>>(allAccountsRaw, {});
      const { accounts } = normalizeAccountsRegistry(parsedAccounts);
      const existing = accounts[resetEmail];
      const profileFirstName = String(
        ((sessionData.session.user?.user_metadata as { first_name?: string } | null)?.first_name || '')
      ).trim();
      const nowIso = new Date().toISOString();

      accounts[resetEmail] = {
        email: resetEmail,
        firstName: existing?.firstName || profileFirstName || fallbackFirstNameFromEmail(resetEmail),
        marketingOptIn: existing?.marketingOptIn,
        marketingOptInAt: existing?.marketingOptInAt,
        createdAt: existing?.createdAt || nowIso,
        updatedAt: nowIso,
      };
      await setPasswordHash(resetEmail, newPassword);
      await AsyncStorage.setItem(ALL_ACCOUNTS_KEY, JSON.stringify(accounts));
    }

    await supabase.auth.signOut();
    await AsyncStorage.multiRemove([USER_STORAGE_KEY, REMEMBER_ME_KEY]);
    setUser(null);
    setHasSupabaseSession(false);
    setSupabaseAuthLastError(null);
  };

  const logout = async () => {
    try {
      await AsyncStorage.multiRemove([USER_STORAGE_KEY, REMEMBER_ME_KEY]);
      if (isSupabaseConfigured) {
        await supabase.auth.signOut();
      }
      setUser(null);
      setHasSupabaseSession(false);
      setSupabaseUserId(null);
      setProfile(null);
      setProfileReady(false);
      setSupabaseAuthLastError(null);
      router.replace('/auth/login' as Href);
    } catch (error) {
      if (__DEV__) {
        console.log('Logout error:', error);
      } else {
        void captureException(error, { feature: 'auth', op: 'logout' });
      }
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        authReady: isReady,
        cloudSessionResolved,
        hasSupabaseSession,
        supabaseUserId,
        supabaseAuthLastError,
        profile,
        profileReady,
        getSupabaseAccessToken,
        setUsername,
        login,
        signup,
        requestPasswordReset,
        completePasswordReset,
        hardResetToLoggedOut,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

// Default export to satisfy expo-router requirement
export default AuthProvider;
