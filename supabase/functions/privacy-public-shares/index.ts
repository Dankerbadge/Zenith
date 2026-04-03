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

function normalizeShare(row: any) {
  return {
    shareId: row?.share_id,
    objectType: row?.object_type,
    objectId: row?.object_id,
    shareStatus: row?.share_status,
    createdAt: row?.created_at,
    revokedAt: row?.revoked_at ?? null,
    provenance: row?.provenance ?? {},
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

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('food_v2_public_shares')
      .select('share_id,object_type,object_id,share_status,created_at,revoked_at,provenance')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) return jsonResponse({ error: 'share_list_failed', detail: error.message }, 400);
    return jsonResponse({
      ok: true,
      shares: (Array.isArray(data) ? data : []).map(normalizeShare),
    });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const shareId = String(body?.shareId || '').trim();
  const action = String(body?.action || '').trim().toLowerCase();
  if (!shareId || (action !== 'activate' && action !== 'revoke')) {
    return jsonResponse({ error: 'invalid_payload', detail: 'shareId + action(activate|revoke) are required' }, 400);
  }

  const { data: share, error: shareErr } = await supabase
    .from('food_v2_public_shares')
    .select('share_id,object_type,object_id,share_status,created_at,revoked_at,provenance')
    .eq('user_id', userId)
    .eq('share_id', shareId)
    .maybeSingle();
  if (shareErr) return jsonResponse({ error: 'share_lookup_failed', detail: shareErr.message }, 400);
  if (!share) return jsonResponse({ error: 'share_not_found' }, 404);

  if (action === 'activate') {
    const { data: consent, error: consentErr } = await supabase
      .from('food_v2_user_consent')
      .select('public_sharing')
      .eq('user_id', userId)
      .maybeSingle();
    if (consentErr) return jsonResponse({ error: 'consent_lookup_failed', detail: consentErr.message }, 400);
    if (!consent?.public_sharing) return jsonResponse({ error: 'public_sharing_consent_required' }, 403);
  }

  const now = new Date().toISOString();
  const nextStatus = action === 'activate' ? 'active' : 'revoked';
  const nextProvenance = {
    ...(share?.provenance && typeof share.provenance === 'object' ? share.provenance : {}),
    updatedAt: now,
    updatedBy: 'privacy-public-shares',
    consentChecked: action === 'activate',
  };

  const { data: updated, error: updateErr } = await supabase
    .from('food_v2_public_shares')
    .update({
      share_status: nextStatus,
      revoked_at: action === 'revoke' ? now : null,
      provenance: nextProvenance,
    })
    .eq('user_id', userId)
    .eq('share_id', shareId)
    .select('share_id,object_type,object_id,share_status,created_at,revoked_at,provenance')
    .single();
  if (updateErr) return jsonResponse({ error: 'share_update_failed', detail: updateErr.message }, 400);

  await supabase.rpc('food_v2_append_privacy_audit_event', {
    p_user_id: userId,
    p_action_type: action === 'activate' ? 'public_share_activated' : 'public_share_revoked',
    p_payload: {
      shareId,
      objectType: share.object_type,
      objectId: share.object_id,
      previousStatus: share.share_status,
      nextStatus,
    },
  });

  return jsonResponse({
    ok: true,
    share: normalizeShare(updated),
  });
});

