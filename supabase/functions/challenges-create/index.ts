import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'missing_authorization' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user?.id) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const userId = auth.user.id;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const title = String(body?.title || '').trim();
  const activityType = String(body?.activityType || '').trim();
  const mode = String(body?.mode || '').trim();
  const scoreType = String(body?.scoreType || '').trim();
  const startTs = String(body?.startTs || '').trim();
  const endTs = String(body?.endTs || '').trim();
  const rules = body?.rules && typeof body.rules === 'object' ? body.rules : {};
  const participantUserIds = Array.from(new Set((Array.isArray(body?.participantUserIds) ? body.participantUserIds : []).map((v: any) => String(v || '').trim()).filter(Boolean)));
  const teamFanout = body?.teamFanout !== false;
  const visibility = String(body?.visibility || (body?.teamId ? 'TEAM' : 'PRIVATE')).trim().toUpperCase();
  const teamId = body?.teamId ? String(body.teamId).trim() : null;

  if (!title || !activityType || !mode || !scoreType || !startTs || !endTs) {
    return new Response(JSON.stringify({ error: 'invalid_payload', detail: 'Missing required fields.' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (teamId) {
    const { data: membership, error: membershipErr } = await supabase
      .from('team_members')
      .select('team_id,user_id,role')
      .eq('team_id', teamId)
      .eq('user_id', userId)
      .limit(1);
    if (membershipErr || !Array.isArray(membership) || membership.length === 0) {
      return new Response(JSON.stringify({ error: 'team_access_denied' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  let resolvedParticipants = participantUserIds.slice();
  if (teamId && teamFanout) {
    const { data: teamMembers, error: teamMemberErr } = await supabase
      .from('team_members')
      .select('user_id')
      .eq('team_id', teamId);
    if (teamMemberErr) {
      return new Response(JSON.stringify({ error: 'team_members_fetch_failed', detail: teamMemberErr.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const ids = (Array.isArray(teamMembers) ? teamMembers : []).map((row: any) => String(row?.user_id || '')).filter(Boolean);
    resolvedParticipants = Array.from(new Set([...resolvedParticipants, ...ids]));
  }

  const { data: challenge, error: challengeErr } = await supabase
    .from('workout_challenges')
    .insert({
      creator_user_id: userId,
      title,
      description: body?.description ? String(body.description).trim() : null,
      activity_type: activityType,
      mode,
      score_type: scoreType,
      rules,
      start_ts: startTs,
      end_ts: endTs,
      visibility,
      team_id: teamId,
    })
    .select('*')
    .single();
  if (challengeErr || !challenge) {
    return new Response(JSON.stringify({ error: 'create_failed', detail: challengeErr?.message || 'unknown' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const challengeId = String((challenge as any).id || '');
  const participants = [
    {
      challenge_id: challengeId,
      user_id: userId,
      role: 'CREATOR',
      status: 'ACCEPTED',
      joined_at: new Date().toISOString(),
      completion_state: 'NOT_STARTED',
      progress: {},
    },
    ...resolvedParticipants
      .filter((id) => id !== userId)
      .map((id) => ({
        challenge_id: challengeId,
        user_id: id,
        role: 'PARTICIPANT',
        status: 'INVITED',
        completion_state: 'NOT_STARTED',
        progress: {},
      })),
  ];
  if (participants.length) await supabase.from('workout_challenge_participants').insert(participants);

  const events = [
    { challenge_id: challengeId, user_id: userId, type: 'CREATED', data: { title, activityType, scoreType } },
    ...resolvedParticipants.filter((id) => id !== userId).map((id) => ({
      challenge_id: challengeId,
      user_id: id,
      type: 'INVITED',
      data: { inviterUserId: userId },
    })),
  ];
  if (events.length) await supabase.from('workout_challenge_events').insert(events);

  return new Response(JSON.stringify({ challengeId, invitedCount: resolvedParticipants.filter((id) => id !== userId).length }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
