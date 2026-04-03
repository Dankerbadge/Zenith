import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type CategorySource = {
  table: string;
  userColumn: string;
};

type CategoryConfig = {
  category: string;
  description: string;
  fallbackRetentionDays: number;
  sources: CategorySource[];
};

const CATEGORY_CONFIGS: CategoryConfig[] = [
  {
    category: 'logs',
    description: 'Logged nutrition snapshots and daily nutrition aggregates.',
    fallbackRetentionDays: 3650,
    sources: [
      { table: 'food_v2_log_entries', userColumn: 'user_id' },
      { table: 'nutrition_daily', userColumn: 'user_id' },
    ],
  },
  {
    category: 'recipes',
    description: 'User-created recipes and version metadata.',
    fallbackRetentionDays: 3650,
    sources: [{ table: 'food_v2_recipes', userColumn: 'user_id' }],
  },
  {
    category: 'meal_templates',
    description: 'Saved meal templates and related items.',
    fallbackRetentionDays: 3650,
    sources: [{ table: 'food_v2_meal_templates', userColumn: 'user_id' }],
  },
  {
    category: 'goal_snapshots',
    description: 'Daily goal progress snapshots generated from your logs.',
    fallbackRetentionDays: 730,
    sources: [{ table: 'food_v2_daily_goal_snapshots', userColumn: 'user_id' }],
  },
  {
    category: 'offline_packs',
    description: 'Offline pack install metadata linked to your account.',
    fallbackRetentionDays: 30,
    sources: [{ table: 'food_v2_offline_pack_installs', userColumn: 'user_id' }],
  },
  {
    category: 'user_preferences',
    description: 'Onboarding, preference, and retention settings.',
    fallbackRetentionDays: 3650,
    sources: [
      { table: 'food_v2_user_consent', userColumn: 'user_id' },
      { table: 'food_v2_user_data_explanation', userColumn: 'user_id' },
      { table: 'food_v2_user_retention_prefs', userColumn: 'user_id' },
      { table: 'food_v2_user_preference_profile', userColumn: 'user_id' },
    ],
  },
];

function jsonResponse(payload: unknown, status = 200) {
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

async function safeCountForUser(supabase: any, source: CategorySource, userId: string): Promise<{ count: number; missing: boolean; error?: string }> {
  const query = supabase
    .from(source.table)
    .select('*', { count: 'exact', head: true })
    .eq(source.userColumn, userId);

  const { count, error } = await query;
  if (error) {
    if (isMissingTable(error)) return { count: 0, missing: true };
    return { count: 0, missing: false, error: error.message };
  }
  return { count: Number(count || 0), missing: false };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'GET') return jsonResponse({ error: 'method_not_allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonResponse({ error: 'missing_authorization' }, 401);

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user?.id) return jsonResponse({ error: 'unauthorized' }, 401);
  const userId = auth.user.id;

  const { data: consent, error: consentErr } = await supabase
    .from('food_v2_user_consent')
    .select('notifications,analytics,public_sharing,consent_updated_at,notes')
    .eq('user_id', userId)
    .maybeSingle();
  if (consentErr) return jsonResponse({ error: 'consent_query_failed', detail: consentErr.message }, 400);

  const { data: policies, error: policyErr } = await supabase
    .from('food_v2_retention_policies')
    .select('category,retention_days,purge_action,enabled')
    .eq('enabled', true)
    .order('category', { ascending: true });
  if (policyErr) return jsonResponse({ error: 'retention_policy_query_failed', detail: policyErr.message }, 400);

  const policyMap = new Map<string, any>();
  for (const row of Array.isArray(policies) ? policies : []) {
    policyMap.set(String(row.category), row);
  }

  const categoryRows: Array<Record<string, unknown>> = [];
  for (const config of CATEGORY_CONFIGS) {
    let estimatedCount = 0;
    const missingTables: string[] = [];
    const errors: string[] = [];
    const sourceTables: string[] = [];

    for (const source of config.sources) {
      const result = await safeCountForUser(supabase, source, userId);
      if (result.missing) {
        missingTables.push(source.table);
        continue;
      }
      if (result.error) {
        errors.push(`${source.table}: ${result.error}`);
        continue;
      }
      sourceTables.push(source.table);
      estimatedCount += result.count;
    }

    const policy = policyMap.get(config.category);
    const retentionDays = Number(policy?.retention_days ?? config.fallbackRetentionDays);
    categoryRows.push({
      user_id: userId,
      category: config.category,
      description: config.description,
      retention_days: Number.isFinite(retentionDays) ? retentionDays : config.fallbackRetentionDays,
      updated_at: new Date().toISOString(),
      notes: {
        estimatedRecordCount: estimatedCount,
        sourceTables,
        missingTables,
        warnings: errors,
        purgeAction: policy?.purge_action ?? 'delete',
      },
    });
  }

  if (categoryRows.length) {
    const { error: upsertErr } = await supabase
      .from('food_v2_user_data_explanation')
      .upsert(categoryRows, { onConflict: 'user_id,category' });
    if (upsertErr) return jsonResponse({ error: 'data_explanation_upsert_failed', detail: upsertErr.message }, 400);
  }

  const { data: dataExplanation, error: explanationErr } = await supabase
    .from('food_v2_user_data_explanation')
    .select('category,description,retention_days,last_purged_at,notes,updated_at')
    .eq('user_id', userId)
    .order('category', { ascending: true });
  if (explanationErr) return jsonResponse({ error: 'data_explanation_query_failed', detail: explanationErr.message }, 400);

  const { data: shares, error: shareErr } = await supabase
    .from('food_v2_public_shares')
    .select('share_id,object_type,object_id,share_status,created_at,revoked_at,provenance')
    .eq('user_id', userId)
    .eq('share_status', 'active')
    .order('created_at', { ascending: false });
  if (shareErr) return jsonResponse({ error: 'public_share_query_failed', detail: shareErr.message }, 400);

  await supabase.rpc('food_v2_append_privacy_audit_event', {
    p_user_id: userId,
    p_action_type: 'data_explanation_viewed',
    p_payload: {
      categoriesReturned: Array.isArray(dataExplanation) ? dataExplanation.length : 0,
      activePublicShares: Array.isArray(shares) ? shares.length : 0,
    },
  });

  return jsonResponse({
    ok: true,
    consent: {
      notifications: Boolean(consent?.notifications),
      analytics: Boolean(consent?.analytics),
      publicSharing: Boolean(consent?.public_sharing),
      consentUpdatedAt: consent?.consent_updated_at || new Date(0).toISOString(),
      notes: consent?.notes ?? null,
    },
    retentionPolicies: (Array.isArray(policies) ? policies : []).map((row) => ({
      category: row.category,
      retentionDays: row.retention_days,
      purgeAction: row.purge_action,
      enabled: row.enabled,
    })),
    dataCategories: Array.isArray(dataExplanation) ? dataExplanation : [],
    activePublicShares: Array.isArray(shares) ? shares : [],
  });
});

