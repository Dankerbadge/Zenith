import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { extractBarcodesFromOcr, normalizeBarcodeCandidates } from './barcodeFromOcr.ts';
import { getOffProductByBarcode } from './offService.ts';
import { mapOffProductToCandidate } from './offNutritionMapper.ts';

type ConfidenceTier = 'HIGH' | 'MEDIUM' | 'LOW';

type FoodCandidate = {
  candidateId: string;
  source: 'USDA_FDC' | 'USDA_FDC_BRANDED' | 'OPEN_FOOD_FACTS';
  fdcId?: number;
  offBarcode?: string;
  displayName: string;
  brandOwner?: string;
  dataType?: string;
  base: { kind: 'PER_100G' | 'PER_SERVING'; servingSize?: number; servingUnit?: string };
  nutrients: {
    caloriesKcal: number;
    proteinG: number;
    fatG: number;
    carbsG: number;
    fiberG?: number;
    sugarG?: number;
    sodiumMg?: number;
    satFatG?: number;
    transFatG?: number;
    addedSugarG?: number;
  };
  confidence: { score: number; tier: ConfidenceTier; reasons: string[] };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const VISION_URL = 'https://vision.googleapis.com/v1/images:annotate';
const USDA_SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';
const USDA_FOODS_BATCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods';

const OFF_FIELDS = ['product_name', 'brands', 'quantity', 'serving_size', 'nutrition_data_per', 'nutriments'] as const;

const SYNONYMS: Record<string, string> = {
  fries: 'french fries',
  soda: 'soft drink',
  sub: 'submarine sandwich',
  hoagie: 'submarine sandwich',
  ramen: 'ramen noodles',
  'pb&j': 'peanut butter and jelly sandwich',
  bbq: 'barbecue',
  'mac and cheese': 'macaroni and cheese',
  'ice cream': 'ice cream',
  yogurt: 'yogurt',
};

const STOPWORDS = new Set(['food', 'dish', 'meal', 'cuisine', 'restaurant', 'plate', 'table']);

function normalizeText(input: string) {
  return String(input || '').trim().toLowerCase();
}

function sanitizeQuery(input: string) {
  const raw = normalizeText(input)
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return '';
  const mapped = SYNONYMS[raw] || raw;
  const tokens = mapped.split(' ').filter(Boolean).filter((t) => !STOPWORDS.has(t));
  return tokens.join(' ').trim();
}

function tokenSet(input: string) {
  return new Set(sanitizeQuery(input).split(' ').filter(Boolean));
}

function textSimilarityScore(a: string, b: string) {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  const denom = Math.max(1, Math.max(A.size, B.size));
  return inter / denom;
}

function kcalFromMacros(p: number, c: number, f: number) {
  return 4 * (Number(p) || 0) + 4 * (Number(c) || 0) + 9 * (Number(f) || 0);
}

function confidenceTier(score: number): ConfidenceTier {
  if (score >= 0.75) return 'HIGH';
  if (score >= 0.55) return 'MEDIUM';
  return 'LOW';
}

function looksPreparedDish(q: string) {
  const s = sanitizeQuery(q);
  return /(burrito|pad thai|lasagna|fried|chicken|sandwich|taco|pizza|ramen|noodle|pasta|macaroni)/.test(s);
}

function looksSingleIngredient(q: string) {
  const s = sanitizeQuery(q);
  return /^(banana|egg|rice|apple|oat|oats|milk|yogurt|chicken|beef|salmon|bread)$/.test(s);
}

function uniq<T>(arr: T[]) {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const v of arr) {
    const key = typeof v === 'string' ? v : JSON.stringify(v);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

async function sha256Hex(data: string) {
  const enc = new TextEncoder().encode(data);
  const dig = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(dig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function extractVisionSummary(vision: any) {
  const labels = Array.isArray(vision?.labelAnnotations) ? vision.labelAnnotations.map((l: any) => String(l?.description || '').trim()).filter(Boolean) : [];
  const webEntities = Array.isArray(vision?.webDetection?.webEntities)
    ? vision.webDetection.webEntities.map((e: any) => String(e?.description || '').trim()).filter(Boolean)
    : [];
  const ocrText = String(vision?.fullTextAnnotation?.text || '');
  return { labels, webEntities, ocrText };
}

function detectPackagedLikely(input: { labels: string[]; ocrText: string }) {
  const ocr = normalizeText(input.ocrText);
  if (/(nutrition facts|ingredients|serving size)/.test(ocr)) return true;
  if (/\b\d{12,14}\b/.test(ocr)) return true; // UPC-like

  const lbl = input.labels.map(normalizeText);
  if (lbl.some((s) => /(label|packaging|bottle|box|barcode)/.test(s))) return true;
  return false;
}

function isKcalUnit(unitName: string) {
  const u = normalizeText(unitName);
  return u === 'kcal' || u.includes('kilocal');
}

function isG(unitName: string) {
  const u = normalizeText(unitName);
  return u === 'g' || u.includes('gram');
}

function isMg(unitName: string) {
  const u = normalizeText(unitName);
  return u === 'mg' || u.includes('milligram');
}

function nutrientByNumber(food: any, number: string) {
  const rows = Array.isArray(food?.foodNutrients) ? food.foodNutrients : [];
  for (const r of rows) {
    const n = r?.nutrient;
    if (String(n?.number || '') === number) return r;
  }
  return null;
}

function numberOrNull(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeFoodToCandidate(food: any, visionTermScore: number, query: string, preferType: string | null): FoodCandidate | null {
  const fdcId = Number(food?.fdcId);
  if (!Number.isFinite(fdcId) || fdcId <= 0) return null;
  const displayName = String(food?.description || food?.lowercaseDescription || '').trim();
  if (!displayName) return null;

  const dataType = String(food?.dataType || '').trim();
  const isBranded = normalizeText(dataType) === 'branded';

  let baseKind: 'PER_100G' | 'PER_SERVING' = 'PER_100G';
  let servingSize: number | undefined;
  let servingUnit: string | undefined;
  const reasons: string[] = [];

  let calories: number | null = null;
  let protein: number | null = null;
  let fat: number | null = null;
  let carbs: number | null = null;
  let fiber: number | null = null;
  let sugar: number | null = null;
  let sodium: number | null = null;
  let satFat: number | null = null;
  let transFat: number | null = null;
  let addedSugar: number | null = null;

  if (isBranded) {
    const ln = food?.labelNutrients || {};
    calories = numberOrNull(ln?.calories?.value ?? ln?.calories);
    protein = numberOrNull(ln?.protein?.value ?? ln?.protein);
    fat = numberOrNull(ln?.fat?.value ?? ln?.fat);
    carbs = numberOrNull(ln?.carbohydrates?.value ?? ln?.carbohydrates);
    fiber = numberOrNull(ln?.fiber?.value ?? ln?.fiber);
    sugar = numberOrNull(ln?.sugars?.value ?? ln?.sugars);
    sodium = numberOrNull(ln?.sodium?.value ?? ln?.sodium);
    satFat = numberOrNull(ln?.saturatedFat?.value ?? ln?.saturatedFat);
    transFat = numberOrNull(ln?.transFat?.value ?? ln?.transFat);
    addedSugar = numberOrNull(ln?.addedSugars?.value ?? ln?.addedSugars);

    baseKind = 'PER_SERVING';
    servingSize = numberOrNull(food?.servingSize) ?? undefined;
    servingUnit = typeof food?.servingSizeUnit === 'string' ? food.servingSizeUnit : undefined;

    // Hard requirement for P0 logging: serving grams must be known if we’re going to allow portion confirmation.
    if (!(servingSize && servingSize > 0 && servingUnit && isG(servingUnit))) {
      return null;
    }
  } else {
    const calRow = nutrientByNumber(food, '208');
    const calUnit = String(calRow?.nutrient?.unitName || '');
    calories = numberOrNull(calRow?.amount);
    if ((calories == null || calories <= 0) && Array.isArray(food?.foodNutrients)) {
      // Foundation fallback: metabolizable energy variants.
      const alt = food.foodNutrients.find((r: any) => Number(r?.nutrient?.id) === 2047 || Number(r?.nutrient?.id) === 2048);
      calories = numberOrNull(alt?.amount);
    }
    if (calories != null && calories > 0 && calUnit && !isKcalUnit(calUnit)) {
      // If kJ is present, convert best-effort.
      const u = normalizeText(calUnit);
      if (u === 'kj') calories = calories / 4.184;
      else return null;
    }

    protein = numberOrNull(nutrientByNumber(food, '203')?.amount);
    fat = numberOrNull(nutrientByNumber(food, '204')?.amount);
    carbs = numberOrNull(nutrientByNumber(food, '205')?.amount);
    fiber = numberOrNull(nutrientByNumber(food, '291')?.amount);
    sugar = numberOrNull(nutrientByNumber(food, '269')?.amount);
    sodium = numberOrNull(nutrientByNumber(food, '307')?.amount);
    satFat = numberOrNull(nutrientByNumber(food, '606')?.amount);
    transFat = numberOrNull(nutrientByNumber(food, '605')?.amount);
    addedSugar = numberOrNull(nutrientByNumber(food, '539')?.amount);
  }

  const required = [calories, protein, fat, carbs];
  if (required.some((v) => v == null || (v as number) < 0)) return null;

  // Units sanity: required macros should be grams.
  if (!isBranded) {
    const pUnit = String(nutrientByNumber(food, '203')?.nutrient?.unitName || 'g');
    const fUnit = String(nutrientByNumber(food, '204')?.nutrient?.unitName || 'g');
    const cUnit = String(nutrientByNumber(food, '205')?.nutrient?.unitName || 'g');
    if (![pUnit, fUnit, cUnit].every((u) => isG(u))) return null;
    if (fiber != null) {
      const u = String(nutrientByNumber(food, '291')?.nutrient?.unitName || 'g');
      if (!isG(u)) fiber = null;
    }
    if (sodium != null) {
      const u = String(nutrientByNumber(food, '307')?.nutrient?.unitName || 'mg');
      if (!isMg(u)) sodium = null;
    }
  }

  const caloriesKcal = Math.round(Math.max(0, Number(calories) || 0));
  const proteinG = Math.max(0, Number(protein) || 0);
  const fatG = Math.max(0, Number(fat) || 0);
  const carbsG = Math.max(0, Number(carbs) || 0);

  const kcalMacro = kcalFromMacros(proteinG, carbsG, fatG);
  const delta = caloriesKcal > 0 ? Math.abs(caloriesKcal - kcalMacro) / caloriesKcal : 0;
  let energyPenalty = 0;
  if (delta > 0.35) {
    energyPenalty = -0.25;
    reasons.push('Energy mismatch');
  }

  const similarity = textSimilarityScore(displayName, query);
  const dataTypeBonus = preferType && normalizeText(dataType) === normalizeText(preferType) ? 0.08 : 0;
  const macroCompletenessBonus = 0.15; // already enforced

  const score = Math.max(
    0,
    Math.min(
      1,
      0.50 * visionTermScore + 0.35 * similarity + dataTypeBonus + macroCompletenessBonus + energyPenalty
    )
  );

  const tier = confidenceTier(score);

  const source: FoodCandidate['source'] =
    isBranded ? 'USDA_FDC_BRANDED' : 'USDA_FDC';

  const cand: FoodCandidate = {
    candidateId: `fdc:${fdcId}`,
    source,
    fdcId,
    displayName,
    brandOwner: typeof food?.brandOwner === 'string' ? food.brandOwner : undefined,
    dataType: dataType || undefined,
    base: { kind: baseKind, servingSize, servingUnit },
    nutrients: {
      caloriesKcal,
      proteinG,
      fatG,
      carbsG,
      fiberG: fiber == null ? undefined : Math.max(0, Number(fiber) || 0),
      sugarG: sugar == null ? undefined : Math.max(0, Number(sugar) || 0),
      sodiumMg: sodium == null ? undefined : Math.max(0, Number(sodium) || 0),
      satFatG: satFat == null ? undefined : Math.max(0, Number(satFat) || 0),
      transFatG: transFat == null ? undefined : Math.max(0, Number(transFat) || 0),
      addedSugarG: addedSugar == null ? undefined : Math.max(0, Number(addedSugar) || 0),
    },
    confidence: { score, tier, reasons },
  };

  if (macroCompletenessBonus > 0) reasons.push('Macro completeness');
  if (similarity > 0.5) reasons.push('Strong text match');
  return cand;
}

async function tryCacheGet(serviceClient: any, scanKey: string) {
  try {
    const { data } = await serviceClient
      .from('food_photo_scan_cache')
      .select('response,hit_count')
      .eq('scan_key', scanKey)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (data?.response) {
      await serviceClient
        .from('food_photo_scan_cache')
        .update({ hit_count: (Number(data.hit_count) || 0) + 1 })
        .eq('scan_key', scanKey);
      return data.response;
    }
  } catch {
    // ignore
  }
  return null;
}

async function cachePut(serviceClient: any, scanKey: string, response: any, ttlHours = 24) {
  try {
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
    await serviceClient.from('food_photo_scan_cache').upsert({
      scan_key: scanKey,
      response,
      expires_at: expiresAt,
      hit_count: 0,
    });
  } catch {
    // ignore
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  // Accept multiple secret names so we can reuse existing project secrets without churn.
  const VISION_KEY = Deno.env.get('GOOGLE_VISION_API_KEY') ?? Deno.env.get('VISION_API_KEY') ?? '';
  const USDA_KEY = Deno.env.get('USDA_FDC_API_KEY') ?? Deno.env.get('USDA_API_KEY') ?? '';
  const OFF_BASE_URL = Deno.env.get('OFF_BASE_URL') ?? 'https://world.openfoodfacts.org';
  const OFF_USER_AGENT = Deno.env.get('OFF_USER_AGENT') ?? 'Zenith/1.0 (support@zenith.app)';

  const warnings: string[] = [];
  const debug: any = {};

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const imageBase64 = String(body?.imageBase64 || '').trim();
  const locale = String(body?.locale || 'en-US').trim() || 'en-US';
  const userId = typeof body?.userId === 'string' ? body.userId : null;

  if (!imageBase64) {
    return new Response(JSON.stringify({ error: 'missing_image' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (imageBase64.length > 12_000_000) {
    return new Response(JSON.stringify({ error: 'image_too_large' }), {
      status: 413,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const scanHash = await sha256Hex(imageBase64.slice(0, 200_000)); // bound work
  const scanKey = `scan:${scanHash}:v1`;
  const scanId = crypto.randomUUID();

  const serviceClient =
    SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
      ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
      : null;

  if (serviceClient) {
    const cached = await tryCacheGet(serviceClient, scanKey);
    if (cached) {
      return new Response(JSON.stringify(cached), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  if (!VISION_KEY) warnings.push('Vision unavailable; results may be limited.');
  if (!USDA_KEY) warnings.push('USDA lookup unavailable; try manual search.');

  let labels: string[] = [];
  let webEntities: string[] = [];
  let ocrText = '';
  let isPackagedLikely = false;

  if (VISION_KEY) {
    try {
      const visionReq = {
        requests: [
          {
            image: { content: imageBase64 },
            features: [
              { type: 'LABEL_DETECTION', maxResults: 10 },
              { type: 'WEB_DETECTION', maxResults: 10 },
              { type: 'TEXT_DETECTION', maxResults: 10 },
            ],
          },
        ],
      };
      const r = await fetch(`${VISION_URL}?key=${encodeURIComponent(VISION_KEY)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(visionReq),
      });
      if (r.ok) {
        const payload = await r.json();
        const anno = payload?.responses?.[0] || {};
        const v = extractVisionSummary(anno);
        labels = uniq(v.labels).slice(0, 10);
        webEntities = uniq(v.webEntities).slice(0, 10);
        ocrText = String(v.ocrText || '');
        isPackagedLikely = detectPackagedLikely({ labels, ocrText });
      } else {
        warnings.push('Vision request failed; try again.');
      }
    } catch {
      warnings.push('Vision request failed; try again.');
    }
  }

  const visionSummary = { labels: labels.slice(0, 6), webEntities: webEntities.slice(0, 4) };

  const queriesRaw = [
    ...labels.slice(0, 6).map((s, i) => ({ term: s, weight: 1 - i * 0.08 })),
    ...webEntities.slice(0, 4).map((s, i) => ({ term: s, weight: 0.72 - i * 0.08 })),
  ];
  const queries = uniq(
    queriesRaw
      .map((q) => ({ term: sanitizeQuery(q.term), weight: Math.max(0.15, Math.min(1, q.weight)) }))
      .filter((q) => q.term.length >= 3)
  ).slice(0, 10);

  const candidates: FoodCandidate[] = [];

  if (USDA_KEY && queries.length) {
    const dataTypesLane = (q: string) => {
      if (isPackagedLikely) return ['Branded'] as const;
      if (looksPreparedDish(q)) return ['Survey (FNDDS)', 'Foundation', 'SR Legacy'] as const;
      if (looksSingleIngredient(q)) return ['Foundation', 'Survey (FNDDS)', 'SR Legacy'] as const;
      return ['Survey (FNDDS)', 'Foundation', 'SR Legacy'] as const;
    };

    const preferredType = (q: string) => {
      if (isPackagedLikely) return 'Branded';
      if (looksPreparedDish(q)) return 'Survey (FNDDS)';
      if (looksSingleIngredient(q)) return 'Foundation';
      return 'Survey (FNDDS)';
    };

    const fdcIds: number[] = [];

    for (const q of queries) {
      try {
        const dt = dataTypesLane(q.term);
        const resp = await fetch(`${USDA_SEARCH_URL}?api_key=${encodeURIComponent(USDA_KEY)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: q.term,
            pageSize: 25,
            dataType: dt,
          }),
        });
        if (!resp.ok) continue;
        const payload = await resp.json();
        const foods = Array.isArray(payload?.foods) ? payload.foods : [];
        for (const row of foods.slice(0, 10)) {
          const id = Number(row?.fdcId);
          if (!Number.isFinite(id) || id <= 0) continue;
          fdcIds.push(id);
        }
      } catch {
        // ignore single lane errors
      }
    }

    const uniqueIds = uniq(fdcIds.map(String)).map((s) => Number(s)).filter((n) => Number.isFinite(n)).slice(0, 20);

    let foods: any[] = [];
    if (uniqueIds.length) {
      try {
        const detailsResp = await fetch(`${USDA_FOODS_BATCH_URL}?api_key=${encodeURIComponent(USDA_KEY)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fdcIds: uniqueIds }),
        });
        if (detailsResp.ok) {
          const payload = await detailsResp.json();
          foods = Array.isArray(payload) ? payload : [];
        } else if (detailsResp.status === 429) {
          warnings.push('USDA lookup unavailable; try manual search');
        }
      } catch {
        warnings.push('USDA lookup unavailable; try manual search');
      }
    }

    // Score candidates by best matching query term weight.
    for (const food of foods) {
      let best: { q: string; w: number; prefer: string | null } = { q: '', w: 0.15, prefer: null };
      for (const q of queries) {
        const sim = textSimilarityScore(String(food?.description || ''), q.term);
        const w = q.weight * (0.55 + sim * 0.45);
        if (w > best.w) best = { q: q.term, w, prefer: preferredType(q.term) };
      }
      const cand = normalizeFoodToCandidate(food, best.w, best.q || queries[0]?.term || '', best.prefer);
      if (cand) candidates.push(cand);
    }
  }

  // Dedupe and sort.
  const deduped = new Map<string, FoodCandidate>();
  for (const c of candidates) {
    deduped.set(c.candidateId, c);
  }

  const ranked = Array.from(deduped.values())
    .map((c) => ({ c, s: Number(c.confidence?.score) || 0 }))
    .sort((a, b) => b.s - a.s)
    .map((r) => r.c)
    .slice(0, 10);

  // OFF barcode fallback:
  // Only for packaged scans AND only when USDA yields zero usable candidates after our filters.
  let finalCandidates: FoodCandidate[] = ranked;
  if (isPackagedLikely && finalCandidates.length === 0) {
    if (!ocrText || !ocrText.trim()) {
      warnings.push('Packaged item detected but no readable barcode text; try Scan Barcode');
    } else {
      const barcodes = normalizeBarcodeCandidates(extractBarcodesFromOcr(ocrText));
      if (!barcodes.length) {
        warnings.push('No valid barcode found in photo; try Scan Barcode');
      } else {
        // Cap OFF network calls (best effort) to avoid rate-limit blowups.
        let offCalls = 0;
        let offRateLimited = false;

        const tryCachedOff = async (barcode: string) => {
          if (!serviceClient) return null;
          const cached = await tryCacheGet(serviceClient, `off:product:${barcode}`);
          if (!cached) return null;
          if (cached?.kind === 'miss') return { kind: 'miss' as const };
          if (cached?.kind === 'candidate' && cached?.candidate) return { kind: 'candidate' as const, candidate: cached.candidate as FoodCandidate };
          // Back-compat: allow caching the candidate directly.
          if (cached?.candidateId && cached?.source === 'OPEN_FOOD_FACTS') return { kind: 'candidate' as const, candidate: cached as FoodCandidate };
          return null;
        };

        const cacheOff = async (barcode: string, payload: any, ttlHours: number) => {
          if (!serviceClient) return;
          await cachePut(serviceClient, `off:product:${barcode}`, payload, ttlHours);
        };

        const attemptLookup = async (barcode: string) => {
          // Cache first.
          const cached = await tryCachedOff(barcode);
          if (cached?.kind === 'candidate') return cached.candidate;
          if (cached?.kind === 'miss') return null;

          if (offCalls >= 2) return null;
          offCalls += 1;

          const offJson = await getOffProductByBarcode({
            barcode,
            fields: Array.from(OFF_FIELDS),
            baseUrl: OFF_BASE_URL,
            userAgent: OFF_USER_AGENT,
            timeoutMs: 7500,
            // Keep internal retries small; we cap outer calls.
            maxAttempts: 2,
          });

          if (offJson?.rateLimited) {
            offRateLimited = true;
            await cacheOff(barcode, { kind: 'miss', rateLimited: true }, 1);
            return null;
          }

          if (!offJson) {
            await cacheOff(barcode, { kind: 'miss' }, 24);
            return null;
          }

          const cand = mapOffProductToCandidate(offJson, barcode);
          if (!cand) {
            await cacheOff(barcode, { kind: 'miss' }, 24);
            return null;
          }

          await cacheOff(barcode, { kind: 'candidate', candidate: cand }, 24 * 30);
          return cand;
        };

        let found: FoodCandidate | null = null;

        // Try up to 2 OFF calls total. If we see UPC-A, try its leading-zero variant too.
        for (const code of barcodes) {
          if (found || offRateLimited) break;
          const variants = code.length === 12 ? [code, `0${code}`] : [code];
          for (const v of variants) {
            if (found || offRateLimited) break;
            found = await attemptLookup(v);
          }
        }

        if (offRateLimited) {
          warnings.push('Open Food Facts rate-limited; try Scan Barcode');
        } else if (found) {
          finalCandidates = [found];
          warnings.push('Open Food Facts fallback used (crowd-sourced). Verify selection and portion.');
        } else {
          warnings.push('No usable packaged match found; try Scan Barcode');
        }
      }
    }
  }

  const response = {
    scanId,
    isPackagedLikely,
    visionSummary,
    candidates: finalCandidates,
    warnings,
    debug: (Deno.env.get('ENV') || '').toLowerCase().includes('dev') ? debug : undefined,
  };

  if (serviceClient) {
    await cachePut(serviceClient, scanKey, response, 24);
    // Optional ops metric hook can be added later; keep P0 minimal.
    void userId;
    void locale;
  }

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
