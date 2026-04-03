import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type ManifestRow = {
  platform: string;
  release_channel: string;
  min_supported_app_version: string;
  latest_recommended_app_version: string;
  min_pack_schema_version: number;
  max_pack_schema_version: number;
  min_sync_protocol_version: number;
  max_sync_protocol_version: number;
  capabilities: Record<string, unknown>;
  degraded_mode: Record<string, unknown>;
  enabled: boolean;
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function toInt(value: string | null | undefined, fallback: number | null = null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
}

function parseVersion(version: string) {
  const parts = String(version || '')
    .split('.')
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part))
    .slice(0, 3);
  while (parts.length < 3) parts.push(0);
  return parts;
}

function compareVersion(a: string, b: string) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function isMissingTable(error: unknown) {
  const code = String((error as any)?.code || '').toLowerCase();
  const message = String((error as any)?.message || '').toLowerCase();
  return code === '42p01' || message.includes('does not exist') || message.includes('undefined_table');
}

async function readManifest(serviceClient: any, platform: string, releaseChannel: string): Promise<ManifestRow | null> {
  const { data, error } = await serviceClient
    .from('food_v2_release_manifest')
    .select(
      'platform,release_channel,min_supported_app_version,latest_recommended_app_version,min_pack_schema_version,max_pack_schema_version,min_sync_protocol_version,max_sync_protocol_version,capabilities,degraded_mode,enabled'
    )
    .eq('platform', platform)
    .eq('release_channel', releaseChannel)
    .eq('enabled', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error && !isMissingTable(error)) {
    throw error;
  }
  return data ? (data as ManifestRow) : null;
}

function fallbackManifest(platform: string, releaseChannel: string): ManifestRow {
  return {
    platform,
    release_channel: releaseChannel,
    min_supported_app_version: '3.8.0',
    latest_recommended_app_version: '9.9.9',
    min_pack_schema_version: 2,
    max_pack_schema_version: 3,
    min_sync_protocol_version: 1,
    max_sync_protocol_version: 2,
    capabilities: {
      offlinePacks: true,
      restaurantProvider: true,
      privacyHardening: true,
    },
    degraded_mode: {
      allowReadOnly: true,
      disableWritesWhenOutdated: true,
    },
    enabled: true,
  };
}

async function maybeWriteCompatEvent(serviceClient: any, payload: Record<string, unknown>) {
  const { error } = await serviceClient.from('food_v2_runtime_compat_events').insert(payload);
  if (error && !isMissingTable(error)) {
    throw error;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'missing_authorization' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: 'supabase_env_missing' }, 500);

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: auth, error: authErr } = await authClient.auth.getUser();
  if (authErr || !auth?.user?.id) return json({ error: 'unauthorized' }, 401);
  const userId = auth.user.id;

  const url = new URL(req.url);
  const platform = String(url.searchParams.get('platform') || 'ios').trim().toLowerCase();
  const appVersion = String(url.searchParams.get('appVersion') || '0.0.0').trim();
  const releaseChannel = String(url.searchParams.get('channel') || 'production').trim().toLowerCase();
  const requestedPackSchemaVersion = toInt(url.searchParams.get('packSchemaVersion'));
  const requestedSyncProtocolVersion = toInt(url.searchParams.get('syncProtocolVersion'));

  let manifest = fallbackManifest(platform, releaseChannel);
  try {
    const fromDb = await readManifest(serviceClient, platform, releaseChannel);
    if (fromDb) manifest = fromDb;
  } catch (error) {
    return json({ error: 'release_manifest_read_failed', detail: String((error as Error)?.message || error) }, 400);
  }

  const minPack = Number(manifest.min_pack_schema_version || 1);
  const maxPack = Number(manifest.max_pack_schema_version || minPack);
  const minSync = Number(manifest.min_sync_protocol_version || 1);
  const maxSync = Number(manifest.max_sync_protocol_version || minSync);

  const negotiatedPackSchemaVersion =
    requestedPackSchemaVersion == null ? maxPack : clamp(requestedPackSchemaVersion, minPack, maxPack);
  const negotiatedSyncProtocolVersion =
    requestedSyncProtocolVersion == null ? maxSync : clamp(requestedSyncProtocolVersion, minSync, maxSync);

  const appVersionCompatible = compareVersion(appVersion, manifest.min_supported_app_version) >= 0;
  const packCompatible =
    requestedPackSchemaVersion == null || (requestedPackSchemaVersion >= minPack && requestedPackSchemaVersion <= maxPack);
  const syncCompatible =
    requestedSyncProtocolVersion == null || (requestedSyncProtocolVersion >= minSync && requestedSyncProtocolVersion <= maxSync);
  const downgraded = requestedSyncProtocolVersion != null && requestedSyncProtocolVersion !== negotiatedSyncProtocolVersion;

  let compatibilityStatus = 'compatible';
  if (!appVersionCompatible) compatibilityStatus = 'upgrade_required';
  else if (!packCompatible || !syncCompatible) compatibilityStatus = 'degraded_mode';

  const degradedMode = {
    enabled: compatibilityStatus !== 'compatible',
    reason: !appVersionCompatible
      ? 'app_version_below_minimum'
      : !packCompatible
      ? 'pack_schema_not_supported'
      : !syncCompatible
      ? 'sync_protocol_not_supported'
      : null,
    policy: manifest.degraded_mode || {},
  };

  try {
    await maybeWriteCompatEvent(serviceClient, {
      user_id: userId,
      platform,
      app_version: appVersion,
      requested_pack_schema_version: requestedPackSchemaVersion,
      requested_sync_protocol_version: requestedSyncProtocolVersion,
      negotiated_pack_schema_version: negotiatedPackSchemaVersion,
      negotiated_sync_protocol_version: negotiatedSyncProtocolVersion,
      compatibility_status: compatibilityStatus,
      detail: {
        releaseChannel,
        minSupportedAppVersion: manifest.min_supported_app_version,
        latestRecommendedAppVersion: manifest.latest_recommended_app_version,
      },
    });
  } catch {
    // non-fatal
  }

  return json({
    ok: true,
    apiContractVersion: 2,
    generatedAt: new Date().toISOString(),
    platform,
    releaseChannel,
    appVersion,
    compatibilityStatus,
    release: {
      minSupportedAppVersion: manifest.min_supported_app_version,
      latestRecommendedAppVersion: manifest.latest_recommended_app_version,
    },
    capabilities: {
      ...(manifest.capabilities || {}),
      negotiatedPackSchemaVersion,
      negotiatedSyncProtocolVersion,
      supportsDowngrade: true,
    },
    degradedMode,
    pack: {
      requestedSchemaVersion: requestedPackSchemaVersion,
      negotiatedSchemaVersion: negotiatedPackSchemaVersion,
      minSupported: minPack,
      maxSupported: maxPack,
      compatible: packCompatible,
    },
    syncProtocol: {
      requestedVersion: requestedSyncProtocolVersion,
      negotiatedVersion: negotiatedSyncProtocolVersion,
      minSupported: minSync,
      maxSupported: maxSync,
      compatible: syncCompatible,
      downgraded,
    },
  });
});
