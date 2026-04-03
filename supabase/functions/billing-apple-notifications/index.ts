import {
  corsHeaders,
  createServiceClient,
  decodeJwtPayload,
  json,
  parseJsonSafe,
  upsertEntitlement,
  verifyIosSubscription,
} from '../_shared/billing.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const webhookSecret = Deno.env.get('APPLE_NOTIFICATION_SHARED_SECRET') || '';
  const gotSecret = req.headers.get('x-apple-webhook-secret') || req.headers.get('x-webhook-secret') || '';
  if (webhookSecret && gotSecret !== webhookSecret) return json({ error: 'forbidden' }, 403);

  const body = await req.json().catch(() => ({} as any));
  const signedPayload = String(body?.signedPayload || '');
  if (!signedPayload) return json({ error: 'missing_signed_payload' }, 400);

  const top = decodeJwtPayload(signedPayload);
  const data = parseJsonSafe<any>(JSON.stringify(top?.data || {}));
  const transactionInfoToken = String(data?.signedTransactionInfo || '');
  const renewalInfoToken = String(data?.signedRenewalInfo || '');

  const tx = transactionInfoToken ? decodeJwtPayload(transactionInfoToken) : null;
  const renewal = renewalInfoToken ? decodeJwtPayload(renewalInfoToken) : null;
  const appAccountToken = String(tx?.appAccountToken || renewal?.appAccountToken || '').trim();
  const productId = String(tx?.productId || renewal?.productId || '').trim();
  const originalTransactionId = String(tx?.originalTransactionId || renewal?.originalTransactionId || '').trim();
  const transactionId = String(tx?.transactionId || '').trim();

  const service = createServiceClient();
  let userId: string | null = appAccountToken || null;
  if (!userId && originalTransactionId) {
    const { data: row } = await service
      .from('iap_transactions')
      .select('user_id')
      .eq('platform', 'ios')
      .eq('original_transaction_id', originalTransactionId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    userId = row?.user_id || null;
  }

  await service.from('iap_events').insert({
    platform: 'ios',
    event_type: String(top?.notificationType || 'APPLE_NOTIFICATION'),
    user_id: userId,
    transaction_id: transactionId || null,
    original_transaction_id: originalTransactionId || null,
    payload: body,
  });

  if (!userId) return json({ ok: true, mapped: false });

  try {
    // Re-verify entitlement with receipt if provided in notification body, else update by decoded payload fallback.
    const receipt = String(body?.transactionReceipt || '');
    if (receipt) {
      const ent = await verifyIosSubscription({
        productId,
        transactionReceipt: receipt,
        transactionId: transactionId || null,
        originalTransactionId: originalTransactionId || null,
        appAccountToken: appAccountToken || null,
      });
      await upsertEntitlement(service, userId, ent);
    } else {
      const expiryMs = Number(tx?.expiresDate || renewal?.expiresDate || 0);
      const revoked = Boolean(tx?.revocationDate || renewal?.revocationDate);
      const status = revoked ? 'revoked' : expiryMs > Date.now() ? 'active' : 'inactive';
      await upsertEntitlement(service, userId, {
        isPro: status === 'active',
        status: status as any,
        currentPeriodEnd: Number.isFinite(expiryMs) && expiryMs > 0 ? new Date(expiryMs).toISOString() : null,
        platform: 'ios',
        productId: productId || 'unknown',
        raw: { top, tx, renewal, fallback: true },
        identifiers: {
          transactionId: transactionId || null,
          originalTransactionId: originalTransactionId || null,
          appAccountToken: appAccountToken || null,
          environment: String(top?.data?.environment || ''),
          bundleId: String(top?.bundleId || ''),
        },
      });
    }
  } catch {
    // Keep webhook accepted even when reconciliation fails; periodic reconcile fixes eventual consistency.
  }

  return json({ ok: true, mapped: true, userId });
});
