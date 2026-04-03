import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function normalizeConsentRow(row: any) {
  return {
    notifications: Boolean(row?.notifications),
    analytics: Boolean(row?.analytics),
    publicSharing: Boolean(row?.public_sharing),
    consentUpdatedAt: row?.consent_updated_at || new Date(0).toISOString(),
    notes: row?.notes ?? null,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonResponse({ error: 'missing_authorization' }, 401);

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user?.id) return jsonResponse({ error: 'unauthorized' }, 401);
  const userId = auth.user.id;

  const { data: existing, error: selectErr } = await supabase
    .from('food_v2_user_consent')
    .select('user_id,notifications,analytics,public_sharing,consent_updated_at,notes')
    .eq('user_id', userId)
    .maybeSingle();
  if (selectErr) return jsonResponse({ error: 'consent_query_failed', detail: selectErr.message }, 400);

  if (req.method === 'GET') {
    return jsonResponse({
      ok: true,
      consent: normalizeConsentRow(existing),
    });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const next = {
    user_id: userId,
    notifications: typeof body?.notifications === 'boolean' ? body.notifications : Boolean(existing?.notifications),
    analytics: typeof body?.analytics === 'boolean' ? body.analytics : Boolean(existing?.analytics),
    public_sharing: typeof body?.publicSharing === 'boolean' ? body.publicSharing : Boolean(existing?.public_sharing),
    consent_updated_at: new Date().toISOString(),
    notes: body?.notes != null ? String(body.notes) : (existing?.notes ?? null),
  };

  const { data: upserted, error: upsertErr } = await supabase
    .from('food_v2_user_consent')
    .upsert(next, { onConflict: 'user_id' })
    .select('user_id,notifications,analytics,public_sharing,consent_updated_at,notes')
    .single();
  if (upsertErr) return jsonResponse({ error: 'consent_upsert_failed', detail: upsertErr.message }, 400);

  await supabase.rpc('food_v2_append_privacy_audit_event', {
    p_user_id: userId,
    p_action_type: 'consent_updated',
    p_payload: {
      previous: normalizeConsentRow(existing),
      current: normalizeConsentRow(upserted),
    },
  });

  return jsonResponse({
    ok: true,
    consent: normalizeConsentRow(upserted),
  });
});

