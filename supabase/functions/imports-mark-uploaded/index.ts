import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const auth = req.headers.get('Authorization');
  if (!auth) return json({ error: 'missing_auth' }, 401);
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: auth } },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ error: 'unauthorized' }, 401);

  const body = await req.json().catch(() => ({} as any));
  const jobId = String(body?.jobId || '').trim();
  if (!jobId) return json({ error: 'missing_jobId' }, 400);

  const { data: job, error: loadErr } = await supabase
    .from('file_import_jobs')
    .select('*')
    .eq('id', jobId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (loadErr) return json({ error: loadErr.message }, 400);
  if (!job) return json({ error: 'job_not_found' }, 404);

  const { error: upErr } = await supabase
    .from('file_import_jobs')
    .update({ status: 'UPLOADED', error: null })
    .eq('id', jobId)
    .eq('user_id', user.id);
  if (upErr) return json({ error: upErr.message }, 400);

  return json({ ok: true, jobId });
});
