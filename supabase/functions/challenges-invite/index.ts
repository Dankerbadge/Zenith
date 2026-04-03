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
  const participantUserIds = Array.from(new Set((Array.isArray(body?.participantUserIds) ? body.participantUserIds : []).map((v: any) => String(v || '').trim()).filter(Boolean)));
  if (!challengeId || !participantUserIds.length) return new Response(JSON.stringify({ error: 'invalid_payload' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const { data: challenge, error: challengeErr } = await supabase.from('workout_challenges').select('id,creator_user_id').eq('id', challengeId).single();
  if (challengeErr || !challenge) return new Response(JSON.stringify({ error: 'challenge_not_found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  if (String((challenge as any).creator_user_id || '') !== userId) return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const rows = participantUserIds.map((uid) => ({
    challenge_id: challengeId,
    user_id: uid,
    role: 'PARTICIPANT',
    status: 'INVITED',
    completion_state: 'NOT_STARTED',
    progress: {},
  }));
  const { error: upsertErr } = await supabase.from('workout_challenge_participants').upsert(rows, { onConflict: 'challenge_id,user_id' });
  if (upsertErr) return new Response(JSON.stringify({ error: 'invite_failed', detail: upsertErr.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  await supabase.from('workout_challenge_events').insert(participantUserIds.map((uid) => ({
    challenge_id: challengeId,
    user_id: uid,
    type: 'INVITED',
    data: { inviterUserId: userId },
  })));

  return new Response(JSON.stringify({ ok: true, invited: participantUserIds.length }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});

