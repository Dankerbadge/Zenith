import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function fnv1a(input: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function parseDayFromStateKey(stateKey: string) {
  const match = String(stateKey || '').match(/^dailyLog_(\d{4}-\d{2}-\d{2})$/);
  return match ? match[1] : null;
}

function normalizeDay(raw: unknown, stateKey: string) {
  const fromBody = String(raw || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(fromBody)) return fromBody;
  return parseDayFromStateKey(stateKey);
}

function isMissingTable(error: unknown) {
  const code = String((error as any)?.code || '').toLowerCase();
  const msg = String((error as any)?.message || '').toLowerCase();
  return code === '42p01' || msg.includes('does not exist') || msg.includes('undefined_table');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

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

  const body = await req.json().catch(() => ({} as any));
  const stateKey = String(body?.stateKey || '').trim();
  const payload = body?.payload;
  if (!stateKey || !payload || typeof payload !== 'object') {
    return json({ error: 'invalid_payload' }, 400);
  }

  const day = normalizeDay(body?.day, stateKey);
  const payloadJson = JSON.stringify(payload);
  const payloadHash = fnv1a(payloadJson);
  const clientEventIdRaw = String(body?.clientEventId || '').trim();
  const clientEventId = clientEventIdRaw || `${stateKey}:${payloadHash}`;
  const loggedAtRaw = String(body?.loggedAt || '').trim();
  const loggedAt = loggedAtRaw ? new Date(loggedAtRaw).toISOString() : new Date().toISOString();

  const row = {
    user_id: userId,
    client_event_id: clientEventId,
    state_key: stateKey,
    day,
    payload,
    payload_hash: payloadHash,
    logged_at: loggedAt,
  };

  const insert = await serviceClient
    .from('food_v2_log_entries')
    .insert(row)
    .select('event_id,payload_hash,logged_at')
    .single();

  let inserted = false;
  let eventId = '';
  let storedHash = payloadHash;
  let storedLoggedAt = loggedAt;

  if (insert.error) {
    if (isMissingTable(insert.error)) {
      return json({ error: 'log_table_missing', detail: insert.error.message }, 503);
    }
    const code = String((insert.error as any)?.code || '');
    if (code !== '23505') {
      return json({ error: 'log_insert_failed', detail: insert.error.message }, 400);
    }
    const existing = await serviceClient
      .from('food_v2_log_entries')
      .select('event_id,payload_hash,logged_at')
      .eq('user_id', userId)
      .eq('client_event_id', clientEventId)
      .limit(1)
      .maybeSingle();
    if (existing.error) {
      return json({ error: 'log_existing_read_failed', detail: existing.error.message }, 400);
    }
    eventId = String((existing.data as any)?.event_id || '');
    storedHash = String((existing.data as any)?.payload_hash || payloadHash);
    storedLoggedAt = String((existing.data as any)?.logged_at || loggedAt);
  } else {
    inserted = true;
    eventId = String((insert.data as any)?.event_id || '');
    storedHash = String((insert.data as any)?.payload_hash || payloadHash);
    storedLoggedAt = String((insert.data as any)?.logged_at || loggedAt);
  }

  const parity = await serviceClient.from('food_v2_dual_write_parity').upsert(
    {
      user_id: userId,
      state_key: stateKey,
      day,
      snapshot_hash: payloadHash,
      log_hash: storedHash,
      parity_ok: payloadHash === storedHash,
      source: 'runtime',
      checked_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,state_key,day' }
  );

  if (parity.error && !isMissingTable(parity.error)) {
    return json({ error: 'parity_write_failed', detail: parity.error.message }, 400);
  }

  return json({
    ok: true,
    inserted,
    idempotentReplay: !inserted,
    eventId,
    payloadHash,
    storedHash,
    parityOk: payloadHash === storedHash,
    loggedAt: storedLoggedAt,
  });
});
