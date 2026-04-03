export type OffProductResponse = {
  status: number;
  product?: any;
  // Set only when the OFF API responded with 429 and we intentionally stop.
  rateLimited?: boolean;
};

function sleepMs(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(250, timeoutMs));
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function getOffProductByBarcode(input: {
  barcode: string;
  fields: string[];
  baseUrl?: string;
  userAgent?: string;
  timeoutMs?: number;
  maxAttempts?: number; // max HTTP attempts for this lookup (default: 2)
}): Promise<OffProductResponse | null> {
  const barcode = String(input.barcode || '').trim();
  if (!/^\d{8,14}$/.test(barcode)) return null;

  const baseUrl = String(input.baseUrl || 'https://world.openfoodfacts.org').replace(/\/+$/, '');
  const fields = Array.isArray(input.fields) && input.fields.length ? input.fields : ['product_name', 'brands', 'serving_size', 'nutrition_data_per', 'nutriments'];
  const userAgent = String(input.userAgent || 'Zenith/1.0 (support@zenith.app)');
  const timeoutMs = Number.isFinite(Number(input.timeoutMs)) ? Number(input.timeoutMs) : 7500;
  const maxAttempts = Number.isFinite(Number(input.maxAttempts)) ? Math.max(1, Math.min(3, Number(input.maxAttempts))) : 2;

  const url = `${baseUrl}/api/v2/product/${encodeURIComponent(barcode)}?fields=${encodeURIComponent(fields.join(','))}`;
  const headers = {
    'User-Agent': userAgent,
    'Accept': 'application/json',
  } as Record<string, string>;

  // Retry is only for 429 to avoid hammering OFF. Keep total attempts bounded.
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const r = await fetchWithTimeout(url, { method: 'GET', headers }, timeoutMs);
      if (r.status === 429) {
        const hasRetry = attempt + 1 < maxAttempts;
        if (hasRetry) {
          const jitter = 500 + Math.floor(Math.random() * 500);
          await sleepMs(jitter);
          continue;
        }
        return { status: 0, rateLimited: true };
      }
      if (r.status === 404) return null;
      if (r.status >= 400 && r.status < 500) return null;
      if (r.status >= 500) return null;
      const json = (await r.json()) as any;
      if (!json || Number(json.status) !== 1 || !json.product) return null;
      return json as OffProductResponse;
    } catch {
      // Network/timeouts/etc: treat as not found for P0 and rely on barcode scan UX.
      return null;
    }
  }

  return null;
}
