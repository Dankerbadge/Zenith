import Constants from 'expo-constants';
import { Platform } from 'react-native';
import Purchases, {
  LOG_LEVEL,
  PRODUCT_CATEGORY,
  type CustomerInfo,
  type PurchasesStoreProduct,
  type PurchasesStoreTransaction,
} from 'react-native-purchases';
import { getAuthenticatedUserId } from './authIdentity';

export type BillingPlatform = 'ios' | 'android';

export type NativeBillingArtifact = {
  platform: BillingPlatform;
  productId: string;
  appAccountToken: string | null;
  transactionId: string | null;
  originalTransactionId: string | null;
  transactionReceipt: string | null;
  purchaseToken: string | null;
  packageName: string | null;
  environment: 'Sandbox' | 'Production' | null;
};

export type NativePurchaseResult = {
  state: 'success' | 'cancelled' | 'failed';
  packId: string;
  platform: BillingPlatform | null;
  productId: string | null;
  purchasedProductIds: string[];
  artifact: NativeBillingArtifact | null;
  message: string;
  code: string;
};

export type NativeRestoreResult = {
  state: 'success' | 'failed';
  platform: BillingPlatform | null;
  purchasedProductIds: string[];
  artifacts: NativeBillingArtifact[];
  message: string;
  code: string;
};

const PACK_FALLBACK_PRODUCT_IDS: Record<string, string> = {
  zenith_pro: 'zenith_pro',
  lifting_pack: 'lifting_pack',
  running_pack: 'running_pack',
  calisthenics_pack: 'calisthenics_pack',
};

const PACK_ENV_PRODUCT_KEYS: Record<string, { ios: string[]; android: string[] }> = {
  zenith_pro: {
    ios: ['EXPO_PUBLIC_IAP_PRODUCT_ZENITH_PRO_IOS', 'EXPO_PUBLIC_IAP_PRODUCT_ZENITH_PRO'],
    android: ['EXPO_PUBLIC_IAP_PRODUCT_ZENITH_PRO_ANDROID', 'EXPO_PUBLIC_IAP_PRODUCT_ZENITH_PRO'],
  },
  lifting_pack: {
    ios: ['EXPO_PUBLIC_IAP_PRODUCT_LIFTING_PACK_IOS', 'EXPO_PUBLIC_IAP_PRODUCT_LIFTING_PACK'],
    android: ['EXPO_PUBLIC_IAP_PRODUCT_LIFTING_PACK_ANDROID', 'EXPO_PUBLIC_IAP_PRODUCT_LIFTING_PACK'],
  },
  running_pack: {
    ios: ['EXPO_PUBLIC_IAP_PRODUCT_RUNNING_PACK_IOS', 'EXPO_PUBLIC_IAP_PRODUCT_RUNNING_PACK'],
    android: ['EXPO_PUBLIC_IAP_PRODUCT_RUNNING_PACK_ANDROID', 'EXPO_PUBLIC_IAP_PRODUCT_RUNNING_PACK'],
  },
  calisthenics_pack: {
    ios: ['EXPO_PUBLIC_IAP_PRODUCT_CALISTHENICS_PACK_IOS', 'EXPO_PUBLIC_IAP_PRODUCT_CALISTHENICS_PACK'],
    android: ['EXPO_PUBLIC_IAP_PRODUCT_CALISTHENICS_PACK_ANDROID', 'EXPO_PUBLIC_IAP_PRODUCT_CALISTHENICS_PACK'],
  },
};

type EnsureClientResult = {
  platform: BillingPlatform;
  userId: string;
};

type TransactionLike = Partial<PurchasesStoreTransaction> & Record<string, unknown>;

function getPlatform(): BillingPlatform | null {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return null;
}

function cleanString(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  return normalized.length ? normalized : null;
}

function readEnv(keys: string[]): string | null {
  for (const key of keys) {
    const value = cleanString((process.env as Record<string, string | undefined>)[key]);
    if (value) return value;
  }
  return null;
}

function readRevenueCatApiKey(platform: BillingPlatform): string | null {
  const platformKey =
    platform === 'ios'
      ? readEnv(['EXPO_PUBLIC_REVENUECAT_IOS_API_KEY'])
      : readEnv(['EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY']);
  if (platformKey) return platformKey;
  return readEnv(['EXPO_PUBLIC_REVENUECAT_API_KEY']);
}

function getAndroidPackageName(): string | null {
  const fromEnv = readEnv(['EXPO_PUBLIC_ANDROID_PACKAGE_NAME', 'EXPO_PUBLIC_ANDROID_APPLICATION_ID']);
  if (fromEnv) return fromEnv;
  const constantsAny = Constants as unknown as {
    expoConfig?: { android?: { package?: string } } | null;
    manifest?: { android?: { package?: string } } | null;
    manifest2?: { extra?: { androidPackage?: string } } | null;
  };
  return (
    cleanString(constantsAny.expoConfig?.android?.package) ||
    cleanString(constantsAny.manifest?.android?.package) ||
    cleanString(constantsAny.manifest2?.extra?.androidPackage) ||
    null
  );
}

function resolveProductId(packId: string, platform: BillingPlatform): string | null {
  const envKeys = PACK_ENV_PRODUCT_KEYS[packId]?.[platform] || [];
  const fromEnv = readEnv(envKeys);
  if (fromEnv) return fromEnv;
  return cleanString(PACK_FALLBACK_PRODUCT_IDS[packId]);
}

function getErrorCode(err: unknown): string {
  if (!err || typeof err !== 'object') return 'unknown_error';
  const row = err as Record<string, unknown>;
  return (
    cleanString(row.code) ||
    cleanString((row.userInfo as Record<string, unknown> | undefined)?.code) ||
    cleanString(row.message) ||
    'unknown_error'
  );
}

function getErrorMessage(err: unknown): string {
  if (!err || typeof err !== 'object') return 'Unexpected billing error.';
  const row = err as Record<string, unknown>;
  return cleanString(row.message) || cleanString((row.userInfo as Record<string, unknown> | undefined)?.message) || 'Unexpected billing error.';
}

function isCancelledPurchaseError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const row = err as Record<string, unknown>;
  if (row.userCancelled === true) return true;
  const code = String(getErrorCode(err)).toUpperCase();
  return code.includes('PURCHASE_CANCELLED') || code.includes('USER_CANCELLED');
}

function extractField(transaction: TransactionLike | null, keys: string[]): string | null {
  if (!transaction) return null;
  for (const key of keys) {
    const value = cleanString(transaction[key]);
    if (value) return value;
  }
  return null;
}

function inferEnvironment(productId: string, customerInfo: CustomerInfo | null, transaction: TransactionLike | null): 'Sandbox' | 'Production' | null {
  const txEnv = cleanString(transaction?.environment);
  if (txEnv) {
    return txEnv.toLowerCase().includes('sandbox') ? 'Sandbox' : 'Production';
  }
  const sub = customerInfo?.subscriptionsByProductIdentifier?.[productId];
  if (!sub) return null;
  if (sub.isSandbox === true) return 'Sandbox';
  if (sub.isSandbox === false) return 'Production';
  return null;
}

function buildArtifact(
  input: {
    platform: BillingPlatform;
    productId: string;
    userId: string;
    customerInfo: CustomerInfo | null;
    transaction: TransactionLike | null;
  }
): NativeBillingArtifact {
  const tx = input.transaction;
  const sub = input.customerInfo?.subscriptionsByProductIdentifier?.[input.productId];
  const transactionId =
    extractField(tx, ['transactionIdentifier', 'transactionId', 'storeTransactionId']) ||
    cleanString(sub?.storeTransactionId) ||
    null;
  const originalTransactionId = extractField(tx, ['originalTransactionId', 'originalTransactionIdentifier']);
  const transactionReceipt = extractField(tx, ['transactionReceipt', 'receipt', 'receiptData', 'appStoreReceipt']);
  const purchaseToken = extractField(tx, ['purchaseToken', 'token', 'googlePurchaseToken', 'purchaseTokenAndroid']);
  return {
    platform: input.platform,
    productId: input.productId,
    appAccountToken: input.userId,
    transactionId,
    originalTransactionId,
    transactionReceipt,
    purchaseToken,
    packageName: input.platform === 'android' ? getAndroidPackageName() : null,
    environment: input.platform === 'ios' ? inferEnvironment(input.productId, input.customerInfo, tx) : null,
  };
}

function collectRestoreArtifacts(platform: BillingPlatform, userId: string, customerInfo: CustomerInfo): NativeBillingArtifact[] {
  const transactionMap = new Map<string, TransactionLike[]>();
  (customerInfo.nonSubscriptionTransactions || []).forEach((tx) => {
    const productId = cleanString(tx.productIdentifier);
    if (!productId) return;
    const list = transactionMap.get(productId) || [];
    list.push(tx as TransactionLike);
    transactionMap.set(productId, list);
  });

  const productIds = new Set<string>();
  Object.keys(customerInfo.subscriptionsByProductIdentifier || {}).forEach((key) => {
    if (cleanString(key)) productIds.add(key);
  });
  (customerInfo.allPurchasedProductIdentifiers || []).forEach((key) => {
    if (cleanString(key)) productIds.add(key);
  });
  transactionMap.forEach((_, key) => productIds.add(key));

  const artifacts: NativeBillingArtifact[] = [];
  productIds.forEach((productId) => {
    const txs = transactionMap.get(productId) || [];
    if (txs.length) {
      txs.forEach((tx) => {
        artifacts.push(
          buildArtifact({
            platform,
            productId,
            userId,
            customerInfo,
            transaction: tx,
          })
        );
      });
      return;
    }
    const fallbackTxId = cleanString(customerInfo.subscriptionsByProductIdentifier?.[productId]?.storeTransactionId);
    artifacts.push(
      buildArtifact({
        platform,
        productId,
        userId,
        customerInfo,
        transaction: fallbackTxId
          ? ({
              transactionIdentifier: fallbackTxId,
              productIdentifier: productId,
            } as TransactionLike)
          : null,
      })
    );
  });

  const seen = new Set<string>();
  return artifacts.filter((artifact) => {
    const key = [
      artifact.platform,
      artifact.productId,
      artifact.transactionId || '',
      artifact.originalTransactionId || '',
      artifact.purchaseToken || '',
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function resolveStoreProduct(productId: string): Promise<PurchasesStoreProduct | null> {
  const categories: PRODUCT_CATEGORY[] = [PRODUCT_CATEGORY.SUBSCRIPTION, PRODUCT_CATEGORY.NON_SUBSCRIPTION];
  for (const category of categories) {
    try {
      const products = await Purchases.getProducts([productId], category);
      if (products.length > 0) return products[0];
    } catch {
      // keep trying next category
    }
  }
  try {
    const products = await Purchases.getProducts([productId]);
    if (products.length > 0) return products[0];
  } catch {
    // no-op
  }
  return null;
}

async function ensurePurchasesClient(): Promise<EnsureClientResult> {
  const platform = getPlatform();
  if (!platform) throw new Error('unsupported_platform');
  const userId = cleanString(await getAuthenticatedUserId(true));
  if (!userId) throw new Error('missing_authenticated_user');

  const apiKey = readRevenueCatApiKey(platform);
  if (!apiKey) throw new Error(`missing_revenuecat_api_key_${platform}`);

  const configured = await Purchases.isConfigured().catch(() => false);
  if (!configured) {
    Purchases.configure({ apiKey, appUserID: userId });
    if (__DEV__) {
      await Purchases.setLogLevel(LOG_LEVEL.DEBUG).catch(() => undefined);
    }
  }

  const currentAppUserId = cleanString(await Purchases.getAppUserID().catch(() => null));
  if (currentAppUserId && currentAppUserId !== userId) {
    await Purchases.logIn(userId);
  }

  return { platform, userId };
}

export async function purchasePackNative(packId: string): Promise<NativePurchaseResult> {
  let platform: BillingPlatform | null = null;
  try {
    const ensured = await ensurePurchasesClient();
    platform = ensured.platform;
    const productId = resolveProductId(packId, ensured.platform);
    if (!productId) {
      return {
        state: 'failed',
        packId,
        platform,
        productId: null,
        purchasedProductIds: [],
        artifact: null,
        message: `No store product mapping configured for ${packId}.`,
        code: 'missing_store_product_mapping',
      };
    }

    const product = await resolveStoreProduct(productId);
    if (!product) {
      return {
        state: 'failed',
        packId,
        platform,
        productId,
        purchasedProductIds: [],
        artifact: null,
        message: `Store product ${productId} is unavailable on this device/account.`,
        code: 'store_product_not_found',
      };
    }

    const purchaseResult = await Purchases.purchaseStoreProduct(product);
    const syncedInfo = await Purchases.syncPurchasesForResult().catch(() => null);
    const customerInfo = syncedInfo?.customerInfo || purchaseResult.customerInfo;
    const artifact = buildArtifact({
      platform: ensured.platform,
      productId: cleanString(purchaseResult.productIdentifier) || productId,
      userId: ensured.userId,
      customerInfo,
      transaction: (purchaseResult.transaction || null) as TransactionLike | null,
    });

    return {
      state: 'success',
      packId,
      platform,
      productId: artifact.productId,
      purchasedProductIds: Array.from(new Set([...(customerInfo.allPurchasedProductIdentifiers || []), artifact.productId])),
      artifact,
      message: 'Native checkout completed.',
      code: 'ok',
    };
  } catch (err) {
    const code = getErrorCode(err);
    const message = getErrorMessage(err);
    if (isCancelledPurchaseError(err)) {
      return {
        state: 'cancelled',
        packId,
        platform,
        productId: null,
        purchasedProductIds: [],
        artifact: null,
        message: 'Checkout was cancelled.',
        code,
      };
    }
    return {
      state: 'failed',
      packId,
      platform,
      productId: null,
      purchasedProductIds: [],
      artifact: null,
      message,
      code,
    };
  }
}

export async function restorePurchasesNative(): Promise<NativeRestoreResult> {
  let platform: BillingPlatform | null = null;
  try {
    const ensured = await ensurePurchasesClient();
    platform = ensured.platform;
    const restoredInfo = await Purchases.restorePurchases();
    const syncedInfo = await Purchases.syncPurchasesForResult().catch(() => null);
    const customerInfo = syncedInfo?.customerInfo || restoredInfo;
    return {
      state: 'success',
      platform,
      purchasedProductIds: Array.from(new Set(customerInfo.allPurchasedProductIdentifiers || [])),
      artifacts: collectRestoreArtifacts(ensured.platform, ensured.userId, customerInfo),
      message: 'Native restore completed.',
      code: 'ok',
    };
  } catch (err) {
    return {
      state: 'failed',
      platform,
      purchasedProductIds: [],
      artifacts: [],
      message: getErrorMessage(err),
      code: getErrorCode(err),
    };
  }
}
