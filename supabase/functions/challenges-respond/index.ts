import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response(JSON.stringify({ error: 'missing_authorization' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user?.id) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  const userId = auth.user.id;

  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const challengeId = String(body?.challengeId || '').trim();
  const response = String(body?.response || '').trim().toUpperCase();
  if (!challengeId || (response !== 'ACCEPT' && response !== 'DECLINE')) {
    return new Response(JSON.stringify({ error: 'invalid_payload' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  const status = response === 'ACCEPT' ? 'ACCEPTED' : 'DECLINED';
  const patch: Record<string, any> = { status, updated_at: new Date().toISOString() };
  if (status === 'ACCEPTED') patch.joined_at = new Date().toISOString();
  const { error } = await supabase
    .from('workout_challenge_participants')
    .update(patch)
    .eq('challenge_id', challengeId)
    .eq('user_id', userId);
  if (error) {
    return new Response(JSON.stringify({ error: 'update_failed', detail: error.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  await supabase.from('workout_challenge_events').insert({
    challenge_id: challengeId,
    user_id: userId,
    type: status === 'ACCEPTED' ? 'ACCEPTED' : 'DECLINED',
    data: {},
  });
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});

