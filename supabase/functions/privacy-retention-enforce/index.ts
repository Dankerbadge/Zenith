import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-ops-key',
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  const opsKey = req.headers.get('x-ops-key') || '';
  const expected = Deno.env.get('OPS_AUTOMATION_KEY') || '';
  if (!expected || opsKey !== expected) return jsonResponse({ error: 'unauthorized_ops_key' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: 'supabase_env_missing' }, 500);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  let body: { dryRun?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const dryRun = body?.dryRun !== false;
  const { data, error } = await supabase.rpc('food_v2_enforce_retention_policies', {
    p_dry_run: dryRun,
  });
  if (error) return jsonResponse({ error: 'retention_enforce_failed', detail: error.message }, 500);

  return jsonResponse({
    ok: true,
    dryRun,
    result: data,
  });
});

