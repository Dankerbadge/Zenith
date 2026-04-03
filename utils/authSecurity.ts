import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { normalizeEmail } from './storageUtils';

type StoredPasswordHash = {
  version: number;
  salt: string;
  hash: string;
  updatedAt: string;
};

const PASSWORD_HASH_VERSION = 1;
const PASSWORD_HASH_KEY_PREFIX = 'auth_password_';
const LEGACY_PASSWORD_HASH_KEY_PREFIX = 'auth:password:';
const PASSWORD_HASH_KEYCHAIN_SERVICE = 'zenith.auth.passwords';
const SECURE_STORE_KEY_REGEX = /^[A-Za-z0-9._-]+$/;

function sanitizeKeyPart(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9._-]/g, '_');
}

function getPasswordStorageKeys(email: string) {
  const normalized = normalizeEmail(email);
  return {
    primary: `${PASSWORD_HASH_KEY_PREFIX}${sanitizeKeyPart(normalized)}`,
    legacy: `${LEGACY_PASSWORD_HASH_KEY_PREFIX}${normalized}`,
  };
}

function isValidSecureStoreKey(key: string) {
  return Boolean(key) && SECURE_STORE_KEY_REGEX.test(key);
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((row) => row.toString(16).padStart(2, '0'))
    .join('');
}

async function digestPassword(password: string, salt: string) {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${password}`);
}

function timingSafeEqualHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function parseStoredHash(raw: string | null): StoredPasswordHash | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredPasswordHash>;
    if (
      Number(parsed.version) === PASSWORD_HASH_VERSION &&
      typeof parsed.salt === 'string' &&
      typeof parsed.hash === 'string'
    ) {
      return {
        version: PASSWORD_HASH_VERSION,
        salt: parsed.salt,
        hash: parsed.hash,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      };
    }
  } catch {}
  return null;
}

async function getStoredHash(email: string): Promise<StoredPasswordHash | null> {
  const { primary, legacy } = getPasswordStorageKeys(email);
  const primaryRaw = await SecureStore.getItemAsync(primary, {
    keychainService: PASSWORD_HASH_KEYCHAIN_SERVICE,
  });
  const primaryParsed = parseStoredHash(primaryRaw);
  if (primaryParsed) return primaryParsed;

  // Best-effort migration path for any older key format.
  if (!isValidSecureStoreKey(legacy)) return null;

  let legacyRaw: string | null = null;
  try {
    legacyRaw = await SecureStore.getItemAsync(legacy, {
      keychainService: PASSWORD_HASH_KEYCHAIN_SERVICE,
    });
  } catch {
    return null;
  }
  const legacyParsed = parseStoredHash(legacyRaw);
  if (!legacyParsed) return null;

  try {
    await SecureStore.setItemAsync(primary, JSON.stringify(legacyParsed), {
      keychainService: PASSWORD_HASH_KEYCHAIN_SERVICE,
    });
    await SecureStore.deleteItemAsync(legacy, {
      keychainService: PASSWORD_HASH_KEYCHAIN_SERVICE,
    });
  } catch {
    // Non-fatal; we can still use the legacy value for this auth attempt.
  }

  return legacyParsed;
}

export function canUseSecurePasswordStorage() {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

export async function hasPasswordHash(email: string) {
  if (!canUseSecurePasswordStorage()) return false;
  const stored = await getStoredHash(email);
  return Boolean(stored);
}

export async function setPasswordHash(email: string, password: string) {
  if (!canUseSecurePasswordStorage()) {
    throw new Error('Secure password storage is unavailable on this platform.');
  }
  const saltBytes = await Crypto.getRandomBytesAsync(16);
  const salt = toHex(saltBytes);
  const hash = await digestPassword(password, salt);
  const payload: StoredPasswordHash = {
    version: PASSWORD_HASH_VERSION,
    salt,
    hash,
    updatedAt: new Date().toISOString(),
  };
  const { primary, legacy } = getPasswordStorageKeys(email);
  await SecureStore.setItemAsync(primary, JSON.stringify(payload), {
    keychainService: PASSWORD_HASH_KEYCHAIN_SERVICE,
  });
  if (legacy !== primary && isValidSecureStoreKey(legacy)) {
    try {
      await SecureStore.deleteItemAsync(legacy, {
        keychainService: PASSWORD_HASH_KEYCHAIN_SERVICE,
      });
    } catch {
      // Ignore legacy cleanup errors.
    }
  }
}

export async function verifyPasswordHash(email: string, password: string) {
  if (!canUseSecurePasswordStorage()) return false;
  const stored = await getStoredHash(email);
  if (!stored) return false;
  const expected = await digestPassword(password, stored.salt);
  return timingSafeEqualHex(expected, stored.hash);
}

export async function deletePasswordHash(email: string) {
  if (!canUseSecurePasswordStorage()) return;
  const { primary, legacy } = getPasswordStorageKeys(email);
  try {
    await SecureStore.deleteItemAsync(primary, {
      keychainService: PASSWORD_HASH_KEYCHAIN_SERVICE,
    });
  } catch {
    // ignore
  }
  if (legacy !== primary && isValidSecureStoreKey(legacy)) {
    try {
      await SecureStore.deleteItemAsync(legacy, {
        keychainService: PASSWORD_HASH_KEYCHAIN_SERVICE,
      });
    } catch {
      // ignore
    }
  }
}
