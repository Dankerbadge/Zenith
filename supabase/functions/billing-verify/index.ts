import {
  corsHeaders,
  createServiceClient,
  createUserClient,
  json,
  upsertEntitlement,
  verifyAndroidSubscription,
  verifyIosSubscription,
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
  const productId = String(body?.productId || '').trim();
  if (!productId) return json({ error: 'missing_productId' }, 400);

  try {
    let ent;
    if (platform === 'ios') {
      const ios = body?.ios || {};
      const appAccountToken = ios?.appAccountToken ? String(ios.appAccountToken) : null;
      if (appAccountToken && appAccountToken !== user.id) {
        return json({ error: 'app_account_token_mismatch' }, 403);
      }
      ent = await verifyIosSubscription({
        productId,
        transactionReceipt: ios?.transactionReceipt || null,
        transactionId: ios?.transactionId || null,
        originalTransactionId: ios?.originalTransactionId || null,
        appAccountToken,
        environment: ios?.environment || null,
      });
    } else if (platform === 'android') {
      const android = body?.android || {};
      ent = await verifyAndroidSubscription({
        packageName: String(android?.packageName || '').trim(),
        purchaseToken: String(android?.purchaseToken || '').trim(),
        productId,
      });
    } else {
      return json({ error: 'invalid_platform' }, 400);
    }

    const service = createServiceClient();
    await upsertEntitlement(service, user.id, ent);
    await service.from('iap_events').insert({
      platform,
      event_type: 'VERIFY',
      user_id: user.id,
      transaction_id: ent.identifiers.transactionId || null,
      original_transaction_id: ent.identifiers.originalTransactionId || null,
      purchase_token: ent.identifiers.purchaseToken || null,
      payload: { request: body, result: ent.raw },
    });

    return json({
      isPro: ent.isPro,
      status: ent.status,
      currentPeriodEnd: ent.currentPeriodEnd,
      platform: ent.platform,
      productId: ent.productId,
    });
  } catch (err: any) {
    return json({ error: String(err?.message || err || 'verify_failed') }, 400);
  }
});
