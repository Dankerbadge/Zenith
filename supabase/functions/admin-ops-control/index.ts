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

function isMissingTable(error: unknown) {
  const code = String((error as any)?.code || '').toLowerCase();
  const message = String((error as any)?.message || '').toLowerCase();
  return code === '42p01' || message.includes('does not exist') || message.includes('undefined_table');
}

async function appendAudit(serviceClient: any, actorUserId: string, action: string, payload: Record<string, unknown>) {
  try {
    await serviceClient.from('food_v2_admin_audit_events').insert({
      actor_user_id: actorUserId,
      action,
      payload,
    });
  } catch {
    // non-fatal
  }
}

async function loadAdminAccess(serviceClient: any, userId: string) {
  const nowIso = new Date().toISOString();
  const role = await serviceClient
    .from('food_v2_admin_role_bindings')
    .select('role,expires_at,active')
    .eq('user_id', userId)
    .eq('active', true)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .limit(1)
    .maybeSingle();

  if (role.error && !isMissingTable(role.error)) throw new Error(`admin_role_read_failed:${role.error.message}`);

  const breakGlass = await serviceClient
    .from('food_v2_admin_break_glass_sessions')
    .select('session_id,status,expires_at')
    .eq('admin_user_id', userId)
    .eq('status', 'active')
    .gt('expires_at', nowIso)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (breakGlass.error && !isMissingTable(breakGlass.error)) {
    throw new Error(`break_glass_read_failed:${breakGlass.error.message}`);
  }

  return {
    hasRole: Boolean(role.data),
    breakGlassSessionId: String((breakGlass.data as any)?.session_id || ''),
  };
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
  const action = String(body?.action || '').trim().toLowerCase();
  if (!action) return json({ error: 'missing_action' }, 400);

  const access = await loadAdminAccess(serviceClient, userId).catch((error) => ({ error }));
  if ((access as any)?.error) {
    const message = String(((access as any).error as Error)?.message || 'admin_access_read_failed');
    return json({ error: message }, 400);
  }
  const hasRole = Boolean((access as any).hasRole);
  const hasBreakGlass = Boolean((access as any).breakGlassSessionId);
  const hasAdminAccess = hasRole || hasBreakGlass;

  if (action === 'start_break_glass') {
    if (!hasRole) return json({ error: 'admin_role_required' }, 403);
    const reason = String(body?.reason || '').trim();
    if (!reason) return json({ error: 'reason_required' }, 400);
    const ttlMinutes = Math.max(5, Math.min(180, Number(body?.ttlMinutes) || 30));
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
    const insert = await serviceClient
      .from('food_v2_admin_break_glass_sessions')
      .insert({
        admin_user_id: userId,
        reason,
        status: 'active',
        expires_at: expiresAt,
        metadata: { requestedBy: 'admin-ops-control', ttlMinutes },
      })
      .select('session_id,status,expires_at')
      .single();
    if (insert.error) return json({ error: `break_glass_start_failed:${insert.error.message}` }, 400);
    await appendAudit(serviceClient, userId, 'break_glass_started', { sessionId: insert.data?.session_id, ttlMinutes });
    return json({ ok: true, action, session: insert.data });
  }

  if (!hasAdminAccess) return json({ error: 'admin_access_required' }, 403);

  if (action === 'end_break_glass') {
    const sessionId = String(body?.sessionId || (access as any).breakGlassSessionId || '').trim();
    if (!sessionId) return json({ error: 'active_break_glass_session_missing' }, 400);
    const update = await serviceClient
      .from('food_v2_admin_break_glass_sessions')
      .update({
        status: 'revoked',
        revoked_at: new Date().toISOString(),
      })
      .eq('session_id', sessionId)
      .eq('admin_user_id', userId)
      .select('session_id,status,revoked_at')
      .single();
    if (update.error) return json({ error: `break_glass_end_failed:${update.error.message}` }, 400);
    await appendAudit(serviceClient, userId, 'break_glass_ended', { sessionId });
    return json({ ok: true, action, session: update.data });
  }

  if (action === 'enqueue') {
    const queueType = String(body?.queueType || '').trim();
    if (!queueType) return json({ error: 'queue_type_required' }, 400);
    const priority = Math.max(1, Math.min(100, Number(body?.priority) || 50));
    const payload = typeof body?.payload === 'object' && body?.payload != null ? body.payload : {};
    const insert = await serviceClient
      .from('food_v2_admin_work_queue')
      .insert({
        queue_type: queueType,
        payload,
        priority,
        status: 'queued',
        created_by: userId,
      })
      .select('queue_id,queue_type,status,priority,created_at')
      .single();
    if (insert.error) return json({ error: `queue_enqueue_failed:${insert.error.message}` }, 400);
    await appendAudit(serviceClient, userId, 'queue_enqueued', { queueId: insert.data?.queue_id, queueType, priority });
    return json({ ok: true, action, queueItem: insert.data });
  }

  if (action === 'claim') {
    const next = await serviceClient
      .from('food_v2_admin_work_queue')
      .select('queue_id,queue_type,payload,priority,status')
      .eq('status', 'queued')
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (next.error) return json({ error: `queue_claim_read_failed:${next.error.message}` }, 400);
    if (!next.data) return json({ ok: true, action, queueItem: null, message: 'queue_empty' });

    const claim = await serviceClient
      .from('food_v2_admin_work_queue')
      .update({
        status: 'claimed',
        claimed_by: userId,
        claimed_at: new Date().toISOString(),
      })
      .eq('queue_id', next.data.queue_id)
      .eq('status', 'queued')
      .select('queue_id,queue_type,status,claimed_by,claimed_at,payload')
      .single();
    if (claim.error) return json({ error: `queue_claim_update_failed:${claim.error.message}` }, 400);
    await appendAudit(serviceClient, userId, 'queue_claimed', { queueId: claim.data?.queue_id });
    return json({ ok: true, action, queueItem: claim.data });
  }

  if (action === 'complete') {
    const queueId = Number(body?.queueId);
    if (!Number.isFinite(queueId)) return json({ error: 'queue_id_required' }, 400);
    const success = body?.success !== false;
    const status = success ? 'completed' : 'failed';
    const update = await serviceClient
      .from('food_v2_admin_work_queue')
      .update({
        status,
        completed_at: new Date().toISOString(),
        last_error: success ? null : String(body?.error || 'unknown').slice(0, 500),
      })
      .eq('queue_id', Math.trunc(queueId))
      .eq('claimed_by', userId)
      .select('queue_id,queue_type,status,completed_at,last_error')
      .single();
    if (update.error) return json({ error: `queue_complete_failed:${update.error.message}` }, 400);
    await appendAudit(serviceClient, userId, 'queue_completed', {
      queueId: update.data?.queue_id,
      success,
      status,
    });
    return json({ ok: true, action, queueItem: update.data });
  }

  if (action === 'list_queue') {
    const limit = Math.max(1, Math.min(100, Number(body?.limit) || 25));
    const read = await serviceClient
      .from('food_v2_admin_work_queue')
      .select('queue_id,queue_type,status,priority,created_at,claimed_at,completed_at,claimed_by,last_error')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (read.error) return json({ error: `queue_list_failed:${read.error.message}` }, 400);
    return json({ ok: true, action, items: Array.isArray(read.data) ? read.data : [] });
  }

  return json({ error: `unsupported_action:${action}` }, 400);
});
