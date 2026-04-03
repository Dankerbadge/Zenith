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
  const fileType = String(body?.fileType || '').toLowerCase();
  if (!['fit', 'gpx'].includes(fileType)) return json({ error: 'invalid_file_type' }, 400);

  const fileName = String(body?.originalFilename || `${fileType}_${Date.now()}.${fileType}`);
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${user.id}/${crypto.randomUUID()}_${safeName}`;

  const { data: job, error: jobErr } = await supabase
    .from('file_import_jobs')
    .insert({
      user_id: user.id,
      file_path: path,
      file_type: fileType,
      status: 'CREATED',
    })
    .select('*')
    .single();
  if (jobErr) return json({ error: jobErr.message }, 400);

  const { data: signed, error: signedErr } = await supabase.storage.from('imports').createSignedUploadUrl(path);
  if (signedErr) return json({ error: signedErr.message }, 400);

  return json({
    jobId: job.id,
    filePath: path,
    uploadUrl: signed?.signedUrl || null,
    token: signed?.token || null,
  });
});
