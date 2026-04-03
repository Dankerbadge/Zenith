import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-rtdn-secret',
};

export type EntitlementState = {
  isPro: boolean;
  status: 'active' | 'grace' | 'billing_retry' | 'paused' | 'inactive' | 'revoked';
  currentPeriodEnd: string | null;
  platform: 'ios' | 'android';
  productId: string;
  raw: any;
  identifiers: {
    transactionId?: string | null;
    originalTransactionId?: string | null;
    purchaseToken?: string | null;
    appAccountToken?: string | null;
    environment?: string | null;
    bundleId?: string | null;
    packageName?: string | null;
  };
};

export function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

export function parseJsonSafe<T = any>(raw: string): T {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {} as T;
  }
}

export function base64UrlDecode(input: string): string {
  const norm = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = norm.length % 4 === 0 ? '' : '='.repeat(4 - (norm.length % 4));
  return atob(norm + pad);
}

export function decodeJwtPayload(token: string): any | null {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    return parseJsonSafe(base64UrlDecode(parts[1]));
  } catch {
    return null;
  }
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const clean = pem.replace(/-----BEGIN PRIVATE KEY-----/g, '').replace(/-----END PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function signJwtRS256(payload: Record<string, any>, privateKeyPem: string): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT' };
  const enc = (obj: any) =>
    btoa(JSON.stringify(obj))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  const unsigned = `${enc(header)}.${enc(payload)}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `${unsigned}.${sigB64}`;
}

export async function getGoogleAccessToken(): Promise<string> {
  const raw = Deno.env.get('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON') || '';
  if (!raw) throw new Error('missing_google_service_account_json');
  const creds = parseJsonSafe<any>(raw);
  if (!creds.client_email || !creds.private_key) throw new Error('invalid_google_service_account_json');

  const now = Math.floor(Date.now() / 1000);
  const jwt = await signJwtRS256(
    {
      iss: creds.client_email,
      scope: 'https://www.googleapis.com/auth/androidpublisher',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now - 5,
      exp: now + 3600,
    },
    String(creds.private_key || '').replace(/\\n/g, '\n')
  );

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
  });
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body });
  if (!res.ok) throw new Error(`google_oauth_failed_${res.status}`);
  const data = await res.json();
  if (!data.access_token) throw new Error('google_oauth_missing_access_token');
  return String(data.access_token);
}

export async function verifyAndroidSubscription(input: {
  packageName: string;
  purchaseToken: string;
  productId: string;
}): Promise<EntitlementState> {
  const accessToken = await getGoogleAccessToken();
  const packageName = input.packageName || Deno.env.get('GOOGLE_PLAY_PACKAGE_NAME') || '';
  if (!packageName) throw new Error('missing_android_package_name');

  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}` +
    `/purchases/subscriptionsv2/tokens/${encodeURIComponent(input.purchaseToken)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`google_subscriptionsv2_failed_${res.status}`);
  const raw = await res.json();

  const lineItems = Array.isArray(raw?.lineItems) ? raw.lineItems : [];
  const latestExpiry = lineItems
    .map((li: any) => Date.parse(String(li?.expiryTime || '')))
    .filter((n: number) => Number.isFinite(n))
    .sort((a: number, b: number) => b - a)[0];
  const expiryIso = Number.isFinite(latestExpiry) ? new Date(latestExpiry).toISOString() : null;
  const now = Date.now();
  const activeByTime = Number.isFinite(latestExpiry) ? latestExpiry > now : false;

  const state = String(raw?.subscriptionState || '').toUpperCase();
  const revoked = state.includes('EXPIRED') || state.includes('CANCELED') || state.includes('REVOKED');
  const status: EntitlementState['status'] = revoked
    ? 'revoked'
    : activeByTime
    ? 'active'
    : state.includes('IN_GRACE')
    ? 'grace'
    : state.includes('ON_HOLD') || state.includes('PAUSED')
    ? 'paused'
    : state.includes('ACCOUNT_HOLD') || state.includes('PENDING')
    ? 'billing_retry'
    : 'inactive';

  return {
    isPro: status === 'active' || status === 'grace',
    status,
    currentPeriodEnd: expiryIso,
    platform: 'android',
    productId: input.productId,
    raw,
    identifiers: {
      purchaseToken: input.purchaseToken,
      packageName,
    },
  };
}

export async function verifyIosSubscription(input: {
  productId: string;
  transactionReceipt?: string | null;
  transactionId?: string | null;
  originalTransactionId?: string | null;
  appAccountToken?: string | null;
  environment?: string | null;
}): Promise<EntitlementState> {
  // P0 robust path uses verifyReceipt to resolve latest entitlement.
  const receipt = String(input.transactionReceipt || '').trim();
  if (!receipt) throw new Error('missing_ios_transaction_receipt');
  const sharedSecret = Deno.env.get('APPLE_IAP_SHARED_SECRET') || '';
  const body = {
    'receipt-data': receipt,
    password: sharedSecret || undefined,
    'exclude-old-transactions': false,
  };

  const prod = await fetch('https://buy.itunes.apple.com/verifyReceipt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let raw = await prod.json();
  if (Number(raw?.status) === 21007) {
    const sand = await fetch('https://sandbox.itunes.apple.com/verifyReceipt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    raw = await sand.json();
  }
  if (Number(raw?.status || 0) !== 0) throw new Error(`apple_verify_receipt_status_${String(raw?.status || 'unknown')}`);

  const latest = Array.isArray(raw?.latest_receipt_info) ? raw.latest_receipt_info : [];
  const target = latest
    .filter((row: any) => !input.productId || String(row?.product_id || '') === input.productId)
    .sort((a: any, b: any) => Number(b?.expires_date_ms || 0) - Number(a?.expires_date_ms || 0))[0];
  if (!target) throw new Error('apple_latest_receipt_missing');
  const expiryMs = Number(target?.expires_date_ms || 0);
  const now = Date.now();
  const cancelled = Boolean(target?.cancellation_date_ms);
  const status: EntitlementState['status'] = cancelled ? 'revoked' : expiryMs > now ? 'active' : 'inactive';

  return {
    isPro: status === 'active',
    status,
    currentPeriodEnd: Number.isFinite(expiryMs) && expiryMs > 0 ? new Date(expiryMs).toISOString() : null,
    platform: 'ios',
    productId: String(target?.product_id || input.productId || 'unknown'),
    raw,
    identifiers: {
      transactionId: String(target?.transaction_id || input.transactionId || ''),
      originalTransactionId: String(target?.original_transaction_id || input.originalTransactionId || ''),
      appAccountToken: input.appAccountToken || null,
      environment: Number(raw?.environment) ? String(raw.environment) : String(raw?.environment || input.environment || ''),
      bundleId: String(raw?.receipt?.bundle_id || ''),
    },
  };
}

export async function upsertEntitlement(
  supabaseService: ReturnType<typeof createClient>,
  userId: string,
  ent: EntitlementState
) {
  const txPayload = {
    user_id: userId,
    platform: ent.platform,
    product_id: ent.productId,
    transaction_id: ent.identifiers.transactionId || null,
    original_transaction_id: ent.identifiers.originalTransactionId || null,
    app_account_token: ent.identifiers.appAccountToken || null,
    bundle_id: ent.identifiers.bundleId || null,
    environment: ent.identifiers.environment || null,
    purchase_token: ent.identifiers.purchaseToken || null,
    package_name: ent.identifiers.packageName || null,
    raw: ent.raw || {},
  };
  const { error: txErr } = await supabaseService.from('iap_transactions').upsert(txPayload, {
    onConflict: ent.platform === 'ios' ? 'platform,transaction_id' : 'platform,purchase_token',
  });
  if (txErr) throw txErr;

  const { error: entErr } = await supabaseService.from('iap_entitlements').upsert({
    user_id: userId,
    is_pro: ent.isPro,
    plan: ent.productId?.toLowerCase().includes('year') ? 'yearly' : ent.productId?.toLowerCase().includes('month') ? 'monthly' : null,
    platform: ent.platform,
    product_id: ent.productId,
    current_period_end: ent.currentPeriodEnd,
    last_verified_at: new Date().toISOString(),
    status: ent.status,
    updated_at: new Date().toISOString(),
  });
  if (entErr) throw entErr;
}

export function createUserClient(req: Request) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return null;
  return createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authHeader } },
  });
}

export function createServiceClient() {
  return createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
    auth: { persistSession: false },
  });
}
