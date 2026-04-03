import {
  corsHeaders,
  createServiceClient,
  createUserClient,
  json,
  upsertEntitlement,
  verifyAndroidSubscription,
  verifyIosSubscription,
  type EntitlementState,
} from '../_shared/billing.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const userClient = createUserClient(req);
  if (!userClient) return json({ error: 'missing_auth' }, 401);
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();
  if (userErr || !user) return json({ error: 'unauthorized' }, 401);

  const body = await req.json().catch(() => ({} as any));
  const platform = String(body?.platform || '').toLowerCase();
  const purchases = Array.isArray(body?.purchases) ? body.purchases : [];
  if (!purchases.length) return json({ error: 'missing_purchases' }, 400);

  try {
    const entitlements: EntitlementState[] = [];
    for (const row of purchases) {
      if (platform === 'ios') {
        const ent = await verifyIosSubscription({
          productId: String(row?.productId || body?.productId || ''),
          transactionReceipt: row?.transactionReceipt || null,
          transactionId: row?.transactionId || null,
          originalTransactionId: row?.originalTransactionId || null,
          appAccountToken: row?.appAccountToken || user.id,
          environment: row?.environment || null,
        });
        entitlements.push(ent);
      } else if (platform === 'android') {
        const ent = await verifyAndroidSubscription({
          packageName: String(row?.packageName || body?.packageName || '').trim(),
          purchaseToken: String(row?.purchaseToken || '').trim(),
          productId: String(row?.productId || body?.productId || ''),
        });
        entitlements.push(ent);
      }
    }

    if (!entitlements.length) return json({ error: 'no_entitlements_resolved' }, 400);
    const best = entitlements.sort((a, b) => Date.parse(String(b.currentPeriodEnd || 0)) - Date.parse(String(a.currentPeriodEnd || 0)))[0];

    const service = createServiceClient();
    await upsertEntitlement(service, user.id, best);
    await service.from('iap_events').insert({
      platform,
      event_type: 'RESTORE',
      user_id: user.id,
      transaction_id: best.identifiers.transactionId || null,
      original_transaction_id: best.identifiers.originalTransactionId || null,
      purchase_token: best.identifiers.purchaseToken || null,
      payload: { request: body, result: best.raw },
    });

    return json({
      isPro: best.isPro,
      status: best.status,
      currentPeriodEnd: best.currentPeriodEnd,
      platform: best.platform,
      productId: best.productId,
    });
  } catch (err: any) {
    return json({ error: String(err?.message || err || 'restore_failed') }, 400);
  }
});
