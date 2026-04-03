import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';

export type OfflinePackManifest = {
  schemaVersion: number;
  protocolVersion: number;
  datasetVersion: string;
  generatedAt: string;
  files: {
    database: string;
    attribution: string;
    checksums: string;
  };
  compatibility: {
    minAppVersion: string;
    minPackSchemaVersion: number;
    maxPackSchemaVersion: number;
    minSyncProtocolVersion: number;
    maxSyncProtocolVersion: number;
  };
};

export type OfflinePackIntegrityResult = {
  ok: boolean;
  reason: string;
  manifest: OfflinePackManifest | null;
};

const OFFLINE_PACK_DIR = `${FileSystem.documentDirectory}food-offline-pack/`;

function joinUri(base: string, relativePath: string) {
  return `${base}${relativePath}`;
}

async function readJson<T>(uri: string): Promise<T | null> {
  try {
    const raw = await FileSystem.readAsStringAsync(uri);
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function sha256OfFile(uri: string): Promise<string | null> {
  try {
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    return await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, base64);
  } catch {
    return null;
  }
}

export async function ensureOfflinePackDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(OFFLINE_PACK_DIR);
  if (info.exists) return;
  await FileSystem.makeDirectoryAsync(OFFLINE_PACK_DIR, { intermediates: true });
}

export async function installOfflinePackFromUris(input: {
  manifestUri: string;
  checksumsUri: string;
  attributionUri: string;
  databaseUri: string;
}): Promise<void> {
  await ensureOfflinePackDir();
  await Promise.all([
    FileSystem.copyAsync({ from: input.manifestUri, to: joinUri(OFFLINE_PACK_DIR, 'manifest.json') }),
    FileSystem.copyAsync({ from: input.checksumsUri, to: joinUri(OFFLINE_PACK_DIR, 'checksums.json') }),
    FileSystem.copyAsync({ from: input.attributionUri, to: joinUri(OFFLINE_PACK_DIR, 'attribution.json') }),
    FileSystem.copyAsync({ from: input.databaseUri, to: joinUri(OFFLINE_PACK_DIR, 'food_offline_pack.sqlite') }),
  ]);
}

export async function loadInstalledOfflinePackManifest(): Promise<OfflinePackManifest | null> {
  return readJson<OfflinePackManifest>(joinUri(OFFLINE_PACK_DIR, 'manifest.json'));
}

export async function verifyInstalledOfflinePackIntegrity(): Promise<OfflinePackIntegrityResult> {
  const manifest = await loadInstalledOfflinePackManifest();
  if (!manifest) return { ok: false, reason: 'manifest_missing_or_invalid', manifest: null };

  const checksums = await readJson<Record<string, { sha256: string }>>(joinUri(OFFLINE_PACK_DIR, manifest.files.checksums));
  if (!checksums) return { ok: false, reason: 'checksums_missing_or_invalid', manifest };

  const dbSha = await sha256OfFile(joinUri(OFFLINE_PACK_DIR, manifest.files.database));
  const attributionSha = await sha256OfFile(joinUri(OFFLINE_PACK_DIR, manifest.files.attribution));
  if (!dbSha || !attributionSha) return { ok: false, reason: 'asset_read_failed', manifest };

  const expectedDb = String(checksums[manifest.files.database]?.sha256 || '').toLowerCase();
  const expectedAttribution = String(checksums[manifest.files.attribution]?.sha256 || '').toLowerCase();
  if (!expectedDb || !expectedAttribution) return { ok: false, reason: 'checksum_entries_missing', manifest };
  if (dbSha.toLowerCase() !== expectedDb) return { ok: false, reason: 'database_checksum_mismatch', manifest };
  if (attributionSha.toLowerCase() !== expectedAttribution) return { ok: false, reason: 'attribution_checksum_mismatch', manifest };

  return { ok: true, reason: 'ok', manifest };
}
