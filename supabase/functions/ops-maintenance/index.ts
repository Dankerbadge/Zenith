import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-ops-key',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const opsKey = req.headers.get('x-ops-key') || '';
  const expected = Deno.env.get('OPS_AUTOMATION_KEY') || '';
  if (!expected || opsKey !== expected) {
    return new Response(JSON.stringify({ error: 'Unauthorized ops key' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: 'Supabase env missing' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  let body: { heartbeatComponent?: string; heartbeatMeta?: Record<string, unknown> } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const heartbeatComponent = String(body.heartbeatComponent || '').trim();
  const heartbeatMeta = body.heartbeatMeta && typeof body.heartbeatMeta === 'object' ? body.heartbeatMeta : {};

  try {
    const { data: tickData, error: tickError } = await supabase.rpc('food_search_maintenance_tick');
    if (tickError) throw tickError;

    if (heartbeatComponent) {
      const { error: hbError } = await supabase.rpc('record_backend_ops_heartbeat', {
        p_component: heartbeatComponent,
        p_meta: heartbeatMeta,
      });
      if (hbError) throw hbError;
    }

    return new Response(JSON.stringify({ ok: true, maintenance: tickData, heartbeatComponent: heartbeatComponent || null }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error)?.message || 'ops maintenance failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
