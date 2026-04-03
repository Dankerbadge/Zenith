import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function haversineMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2) ** 2;
  const s2 = Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(s1 + s2), Math.sqrt(1 - (s1 + s2)));
}

function parseGpx(content: string) {
  const trkptRegex = /<trkpt[^>]*lat="([^"]+)"[^>]*lon="([^"]+)"[^>]*>([\s\S]*?)<\/trkpt>/gim;
  const out: Array<{ lat: number; lon: number; ts: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = trkptRegex.exec(content))) {
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    const inner = m[3] || '';
    const timeMatch = inner.match(/<time>([^<]+)<\/time>/i);
    const ts = timeMatch ? new Date(timeMatch[1]).toISOString() : null;
    if (Number.isFinite(lat) && Number.isFinite(lon) && ts) out.push({ lat, lon, ts });
  }
  return out;
}

async function parseFit(content: Uint8Array): Promise<any> {
  try {
    const mod = await import('https://esm.sh/fit-file-parser@1.14.0');
    const FitFileParser = (mod as any).default || (mod as any);
    const parser = new FitFileParser({ force: true, speedUnit: 'm/s', lengthUnit: 'm', elapsedRecordField: true, mode: 'cascade' });
    const fitData = await new Promise<any>((resolve, reject) => {
      parser.parse(content.buffer, (err: any, data: any) => (err ? reject(err) : resolve(data)));
    });
    const records = Array.isArray(fitData?.records) ? fitData.records : [];
    const session = Array.isArray(fitData?.sessions) ? fitData.sessions[0] : fitData?.session || null;
    return { records, session, raw: fitData };
  } catch (err) {
    throw new Error(`fit_parse_failed:${String((err as any)?.message || err)}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST' && req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const auth = req.headers.get('Authorization') || '';
  if (!serviceKey || auth !== `Bearer ${serviceKey}`) return json({ error: 'forbidden' }, 403);

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceKey, { auth: { persistSession: false } });
  const { data: jobs, error: jobsErr } = await supabase
    .from('file_import_jobs')
    .select('*')
    .eq('status', 'UPLOADED')
    .order('created_at', { ascending: true })
    .limit(10);
  if (jobsErr) return json({ error: jobsErr.message }, 400);

  let processed = 0;
  let failed = 0;

  for (const job of jobs || []) {
    const jobId = String((job as any)?.id || '');
    try {
      await supabase.from('file_import_jobs').update({ status: 'PROCESSING', error: null }).eq('id', jobId);

      const path = String((job as any)?.file_path || '');
      const fileType = String((job as any)?.file_type || '').toLowerCase();
      const userId = String((job as any)?.user_id || '');

      const { data: blob, error: dlErr } = await supabase.storage.from('imports').download(path);
      if (dlErr || !blob) throw new Error(dlErr?.message || 'download_failed');
      const buf = new Uint8Array(await blob.arrayBuffer());

      let points: Array<{ lat: number; lon: number; ts: string }> = [];
      let activityType = 'running';
      let startTs = new Date().toISOString();
      let endTs = new Date().toISOString();
      let calories = 0;
      let avgHr: number | null = null;
      let raw: any = {};

      if (fileType === 'gpx') {
        const text = new TextDecoder().decode(buf);
        points = parseGpx(text);
        if (points.length < 2) throw new Error('gpx_no_trackpoints');
        startTs = points[0].ts;
        endTs = points[points.length - 1].ts;
        raw = { gpx: true, pointsCount: points.length };
      } else if (fileType === 'fit') {
        const parsed = await parseFit(buf);
        raw = parsed.raw || {};
        const recs = Array.isArray(parsed.records) ? parsed.records : [];
        points = recs
          .map((r: any) => ({ lat: Number(r?.position_lat), lon: Number(r?.position_long), ts: r?.timestamp ? new Date(r.timestamp).toISOString() : null }))
          .filter((p: any) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && p.ts);

        const ses = parsed.session || {};
        startTs = ses?.start_time ? new Date(ses.start_time).toISOString() : points[0]?.ts || new Date().toISOString();
        endTs = ses?.timestamp ? new Date(ses.timestamp).toISOString() : points[points.length - 1]?.ts || startTs;
        calories = Number(ses?.total_calories || 0) || 0;
        avgHr = Number.isFinite(Number(ses?.avg_heart_rate)) ? Number(ses.avg_heart_rate) : null;
        const sport = String(ses?.sport || '').toLowerCase();
        if (sport.includes('cycl')) activityType = 'cycling';
        else if (sport.includes('walk')) activityType = 'walking';
      } else {
        throw new Error('unsupported_file_type');
      }

      let dist = 0;
      const routeRows = points.map((p, idx) => {
        if (idx > 0) dist += haversineMeters(points[idx - 1], p);
        return {
          workout_id: null as any,
          seq: idx,
          lat: p.lat,
          lon: p.lon,
          ts: p.ts,
          dist_m: Math.round(dist * 100) / 100,
        };
      });

      const durationS = Math.max(0, Math.round((Date.parse(endTs) - Date.parse(startTs)) / 1000));
      const externalId = `import:${jobId}`;
      const workoutPayload = {
        user_id: userId,
        external_id: externalId,
        start_ts: startTs,
        end_ts: endTs,
        activity_type: activityType,
        location_type: 'outdoor',
        duration_s: durationS,
        distance_m: Math.round(dist * 100) / 100,
        active_kcal: calories > 0 ? calories : null,
        avg_hr_bpm: avgHr,
        source: 'IMPORT',
        was_user_entered: false,
        raw,
      };
      const { data: workout, error: wErr } = await supabase
        .from('workouts')
        .upsert(workoutPayload, { onConflict: 'user_id,external_id' })
        .select('*')
        .single();
      if (wErr || !workout?.id) throw new Error(wErr?.message || 'workout_upsert_failed');

      if (routeRows.length) {
        const payload = routeRows.map((r) => ({ ...r, workout_id: workout.id }));
        const { error: routeErr } = await supabase.from('workout_route_points').upsert(payload, { onConflict: 'workout_id,seq' });
        if (routeErr) throw new Error(routeErr.message);
      }

      await supabase
        .from('file_import_jobs')
        .update({ status: 'SUCCEEDED', processed_at: new Date().toISOString(), error: null })
        .eq('id', jobId);
      processed += 1;
    } catch (err: any) {
      failed += 1;
      await supabase
        .from('file_import_jobs')
        .update({ status: 'FAILED', error: String(err?.message || err || 'unknown').slice(0, 500), processed_at: new Date().toISOString() })
        .eq('id', String((job as any)?.id || ''));
    }
  }

  const { count: remaining } = await supabase
    .from('file_import_jobs')
    .select('id', { head: true, count: 'exact' })
    .eq('status', 'UPLOADED');
  await supabase.from('worker_runs').insert({
    source: 'imports-process-queue',
    processed,
    failed,
    claimed: (jobs || []).length,
    remaining_approx: Number(remaining || 0),
    oldest_unprocessed: null,
    error: null,
  });

  return json({ processed, failed, claimed: (jobs || []).length, remainingApprox: Number(remaining || 0) });
});
