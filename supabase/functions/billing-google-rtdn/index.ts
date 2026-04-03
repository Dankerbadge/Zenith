import {
  corsHeaders,
  createServiceClient,
  json,
  parseJsonSafe,
  upsertEntitlement,
  verifyAndroidSubscription,
} from '../_shared/billing.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const secret = Deno.env.get('GOOGLE_RTND_SHARED_SECRET') || '';
  const got = req.headers.get('x-rtdn-secret') || req.headers.get('x-webhook-secret') || '';
  if (secret && got !== secret) return json({ error: 'forbidden' }, 403);

  const body = await req.json().catch(() => ({} as any));
  const msg = body?.message || {};
  const encoded = String(msg?.data || '');
  if (!encoded) return json({ error: 'missing_pubsub_message_data' }, 400);

  const decoded = parseJsonSafe<any>(atob(encoded));
  const notif = decoded?.subscriptionNotification || {};
  const purchaseToken = String(notif?.purchaseToken || '').trim();
  const packageName = String(decoded?.packageName || Deno.env.get('GOOGLE_PLAY_PACKAGE_NAME') || '').trim();
  const productId = String(notif?.subscriptionId || '').trim();
  if (!purchaseToken) return json({ error: 'missing_purchase_token' }, 400);

  const service = createServiceClient();
  const { data: mapped } = await service
    .from('iap_transactions')
    .select('user_id, product_id')
    .eq('platform', 'android')
    .eq('purchase_token', purchaseToken)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const userId = mapped?.user_id || null;

  await service.from('iap_events').insert({
    platform: 'android',
    event_type: `RTDN_${String(notif?.notificationType || 'UNKNOWN')}`,
    user_id: userId,
    purchase_token: purchaseToken,
    payload: decoded,
  });

  if (!userId) return json({ ok: true, mapped: false });

  try {
    const ent = await verifyAndroidSubscription({
      packageName,
      purchaseToken,
      productId: productId || String(mapped?.product_id || ''),
    });
    await upsertEntitlement(service, userId, ent);
  } catch {
    // Accept webhook regardless; reconcile will catch up.
  }

  return json({ ok: true, mapped: true, userId });
});
