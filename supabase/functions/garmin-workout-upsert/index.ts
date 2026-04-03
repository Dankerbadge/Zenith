import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type GarminWorkoutPayload = {
  watchAppInstallId?: string;
  localSessionId?: string;
  sportType?: string;
  startTimestamp?: string;
  endTimestamp?: string;
  elapsedTimeSeconds?: number;
  distanceMeters?: number | null;
  avgHeartRate?: number | null;
  calories?: number | null;
  fitFileSaved?: boolean;
  deviceModel?: string | null;
  source?: string;
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body: GarminWorkoutPayload = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const localSessionId = String(body.localSessionId || '').trim();
  const startTimestamp = String(body.startTimestamp || '').trim();
  const endTimestamp = String(body.endTimestamp || '').trim();

  if (!localSessionId || !startTimestamp || !endTimestamp) {
    return new Response(JSON.stringify({ error: 'localSessionId, startTimestamp, and endTimestamp are required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    {
      global: {
        headers: { Authorization: authHeader },
      },
    }
  );

  const { data, error } = await supabase.rpc('upsert_garmin_workout_summary', {
    workout: {
      ...body,
      localSessionId,
      startTimestamp,
      endTimestamp,
    },
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
