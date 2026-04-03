import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  corsHeaders,
  createServiceClient,
  json,
  upsertEntitlement,
  verifyAndroidSubscription,
  verifyIosSubscription,
} from '../_shared/billing.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST' && req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);

  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const auth = req.headers.get('Authorization') || '';
  if (!serviceRole || auth !== `Bearer ${serviceRole}`) return json({ error: 'forbidden' }, 403);

  const service = createServiceClient();
  const staleBefore = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: ents, error } = await service
    .from('iap_entitlements')
    .select('user_id, platform, product_id, status, last_verified_at')
    .or(`is_pro.eq.true,last_verified_at.lt.${staleBefore}`)
    .limit(400);
  if (error) return json({ error: error.message }, 400);

  let processed = 0;
  let failed = 0;
  for (const ent of ents || []) {
    const userId = String((ent as any)?.user_id || '');
    const platform = String((ent as any)?.platform || '').toLowerCase();
    const productId = String((ent as any)?.product_id || '');
    if (!userId || !platform) continue;
    try {
      if (platform === 'ios') {
        const { data: tx } = await service
          .from('iap_transactions')
          .select('raw, transaction_id, original_transaction_id, app_account_token')
          .eq('user_id', userId)
          .eq('platform', 'ios')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        const receipt = String((tx as any)?.raw?.latest_receipt || (tx as any)?.raw?.latest_receipt_data || '');
        if (!receipt) throw new Error('missing_ios_receipt_for_reconcile');
        const verified = await verifyIosSubscription({
          productId,
          transactionReceipt: receipt,
          transactionId: (tx as any)?.transaction_id || null,
          originalTransactionId: (tx as any)?.original_transaction_id || null,
          appAccountToken: (tx as any)?.app_account_token || null,
        });
        await upsertEntitlement(service, userId, verified);
      } else if (platform === 'android') {
        const { data: tx } = await service
          .from('iap_transactions')
          .select('purchase_token, package_name, product_id')
          .eq('user_id', userId)
          .eq('platform', 'android')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        const purchaseToken = String((tx as any)?.purchase_token || '');
        if (!purchaseToken) throw new Error('missing_android_purchase_token_for_reconcile');
        const verified = await verifyAndroidSubscription({
          packageName: String((tx as any)?.package_name || ''),
          purchaseToken,
          productId: String((tx as any)?.product_id || productId || ''),
        });
        await upsertEntitlement(service, userId, verified);
      }
      processed += 1;
    } catch (e: any) {
      failed += 1;
      await service.from('iap_events').insert({
        platform,
        event_type: 'RECONCILE_FAILED',
        user_id: userId,
        payload: { error: String(e?.message || e || 'unknown') },
      });
    }
  }

  await service.from('worker_runs').insert({
    source: 'billing-reconcile',
    processed,
    failed,
    claimed: (ents || []).length,
    remaining_approx: 0,
    oldest_unprocessed: null,
    error: null,
  });
  return json({ processed, failed, claimed: (ents || []).length });
});
