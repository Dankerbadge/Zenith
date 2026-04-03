import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type Locale = {
  country?: string;
  admin?: string;
  language?: string;
};

type CanonicalFoodItem = {
  id: string;
  source: 'off' | 'usda' | 'user' | 'restaurant';
  sourceId: string;
  name: string;
  brand?: string;
  barcode?: string;
  country?: string;
  locale?: string;
  kind?: 'food' | 'drink';
  nutritionBasis?: 'per100g' | 'per100ml';
  servingSizes: Array<{ label: string; grams?: number; ml?: number; default?: boolean; estimated?: boolean }>;
  nutrientsPer100g: {
    caloriesKcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG?: number;
    sugarG?: number;
    sodiumMg?: number;
  };
  qualityTier: 'VERIFIED' | 'HIGH' | 'MEDIUM' | 'LOW' | 'USER';
  completeness: {
    hasCalories: boolean;
    hasMacros: boolean;
    hasServing: boolean;
  };
  imageUrls?: { front?: string };
  lastVerifiedAt?: string;
};

const OFF_SEARCH_URL = 'https://world.openfoodfacts.org/cgi/search.pl';
const OFF_BARCODE_URL = 'https://world.openfoodfacts.org/api/v0/product';
const USDA_SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';
const USDA_DEMO_KEY = 'DEMO_KEY';
const CACHE_TTL_HOURS = 24;
const PREFIX_CACHE_TTL_HOURS = 12;
const MAX_RESULTS = 60;
const MIN_RESULTS_FLOOR = 12;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const US_STATE_TO_REGION: Record<string, 'NORTHEAST' | 'MIDWEST' | 'SOUTH' | 'WEST'> = {
  CT: 'NORTHEAST', DE: 'NORTHEAST', MA: 'NORTHEAST', MD: 'NORTHEAST', ME: 'NORTHEAST',
  NH: 'NORTHEAST', NJ: 'NORTHEAST', NY: 'NORTHEAST', PA: 'NORTHEAST', RI: 'NORTHEAST',
  VT: 'NORTHEAST', DC: 'NORTHEAST',
  IA: 'MIDWEST', IL: 'MIDWEST', IN: 'MIDWEST', KS: 'MIDWEST', MI: 'MIDWEST', MN: 'MIDWEST',
  MO: 'MIDWEST', ND: 'MIDWEST', NE: 'MIDWEST', OH: 'MIDWEST', SD: 'MIDWEST', WI: 'MIDWEST',
  AL: 'SOUTH', AR: 'SOUTH', FL: 'SOUTH', GA: 'SOUTH', KY: 'SOUTH', LA: 'SOUTH', MS: 'SOUTH',
  NC: 'SOUTH', OK: 'SOUTH', SC: 'SOUTH', TN: 'SOUTH', TX: 'SOUTH', VA: 'SOUTH', WV: 'SOUTH',
  AK: 'WEST', AZ: 'WEST', CA: 'WEST', CO: 'WEST', HI: 'WEST', ID: 'WEST', MT: 'WEST', NM: 'WEST',
  NV: 'WEST', OR: 'WEST', UT: 'WEST', WA: 'WEST', WY: 'WEST',
};

const US_REGIONAL_BRANDS: Record<string, string[]> = {
  NORTHEAST: ['dunkin', 'wawa', 'wegmans', 'sheetz', 'stew leonard', 'cumberland farms'],
  MIDWEST: ['culver', 'casey', 'meijer', 'hy vee', 'kwik trip', 'menards'],
  SOUTH: ['whataburger', 'publix', 'bojangles', 'cook out', 'cookout', 'h e b', 'heb', 'waffle house', 'zaxby'],
  WEST: ['in n out', 'in-n-out', 'dutch bros', 'winco', 'stater bros', 'safeway'],
};

const US_NATIONAL_BRANDS = [
  'costco', 'kroger', 'walmart', 'target', 'trader joe', 'whole foods', 'aldi', 'safeway',
  'cvs', 'walgreens', 'mcdonald', 'starbucks', 'chick fil a', 'chipotle',
];

type RestaurantProviderSeed = {
  providerId: string;
  brand: string;
  aliases: string[];
  regions?: Array<'NORTHEAST' | 'MIDWEST' | 'SOUTH' | 'WEST'>;
  menu: Array<{
    name: string;
    caloriesKcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    servingLabel: string;
    servingGrams: number;
  }>;
};

const RESTAURANT_PROVIDER_SEEDS: RestaurantProviderSeed[] = [
  {
    providerId: 'restaurant:mcdonalds',
    brand: "McDonald's",
    aliases: ['mcdonald', 'mcdonalds', 'big mac', 'mcchicken'],
    menu: [
      { name: 'Big Mac', caloriesKcal: 257, proteinG: 12.5, carbsG: 20.6, fatG: 15.8, servingLabel: '1 sandwich', servingGrams: 219 },
      { name: 'McChicken', caloriesKcal: 255, proteinG: 10.4, carbsG: 23.2, fatG: 13.3, servingLabel: '1 sandwich', servingGrams: 143 },
    ],
  },
  {
    providerId: 'restaurant:starbucks',
    brand: 'Starbucks',
    aliases: ['starbucks', 'latte', 'frappuccino'],
    menu: [
      { name: 'Caffe Latte (2% milk)', caloriesKcal: 53, proteinG: 3.1, carbsG: 5.2, fatG: 2.1, servingLabel: '12 fl oz', servingGrams: 354 },
      { name: 'Turkey Bacon Sandwich', caloriesKcal: 247, proteinG: 15.6, carbsG: 27.6, fatG: 8.2, servingLabel: '1 sandwich', servingGrams: 116 },
    ],
  },
  {
    providerId: 'restaurant:chipotle',
    brand: 'Chipotle',
    aliases: ['chipotle', 'burrito bowl', 'burrito'],
    menu: [
      { name: 'Chicken Burrito Bowl', caloriesKcal: 180, proteinG: 10.5, carbsG: 16.2, fatG: 7.1, servingLabel: '1 bowl', servingGrams: 280 },
      { name: 'Steak Burrito Bowl', caloriesKcal: 176, proteinG: 10.1, carbsG: 16.1, fatG: 6.9, servingLabel: '1 bowl', servingGrams: 280 },
    ],
  },
  {
    providerId: 'restaurant:whataburger',
    brand: 'Whataburger',
    aliases: ['whataburger'],
    regions: ['SOUTH'],
    menu: [
      { name: 'Whataburger', caloriesKcal: 235, proteinG: 11.8, carbsG: 20.1, fatG: 11.6, servingLabel: '1 sandwich', servingGrams: 274 },
    ],
  },
  {
    providerId: 'restaurant:in_n_out',
    brand: 'In-N-Out',
    aliases: ['in n out', 'in-n-out', 'double double'],
    regions: ['WEST'],
    menu: [
      { name: 'Double-Double', caloriesKcal: 244, proteinG: 13.2, carbsG: 15.3, fatG: 14.2, servingLabel: '1 sandwich', servingGrams: 330 },
    ],
  },
  {
    providerId: 'restaurant:dunkin',
    brand: 'Dunkin',
    aliases: ['dunkin', 'doughnut', 'donut'],
    regions: ['NORTHEAST'],
    menu: [
      { name: 'Egg & Cheese Wake-Up Wrap', caloriesKcal: 281, proteinG: 10.2, carbsG: 30.4, fatG: 12.3, servingLabel: '1 wrap', servingGrams: 124 },
    ],
  },
];

const CURATED_FALLBACKS: Array<{ token: string; item: Omit<CanonicalFoodItem, 'id' | 'sourceId' | 'qualityTier' | 'completeness'> }> = [
  {
    token: 'egg',
    item: {
      source: 'user',
      name: 'Egg, whole',
      brand: 'Generic',
      kind: 'food',
      nutritionBasis: 'per100g',
      servingSizes: [{ label: '1 egg', grams: 50, default: true }, { label: '100g', grams: 100 }],
      nutrientsPer100g: { caloriesKcal: 143, proteinG: 12.6, carbsG: 0.7, fatG: 9.5 },
    },
  },
  {
    token: 'chicken',
    item: {
      source: 'user',
      name: 'Chicken breast, cooked',
      brand: 'Generic',
      kind: 'food',
      nutritionBasis: 'per100g',
      servingSizes: [{ label: '100g', grams: 100, default: true }, { label: '1 piece', grams: 120, estimated: true }],
      nutrientsPer100g: { caloriesKcal: 165, proteinG: 31, carbsG: 0, fatG: 3.6 },
    },
  },
  {
    token: 'rice',
    item: {
      source: 'user',
      name: 'Rice, cooked',
      brand: 'Generic',
      kind: 'food',
      nutritionBasis: 'per100g',
      servingSizes: [{ label: '1 cup', grams: 158, default: true }, { label: '100g', grams: 100 }],
      nutrientsPer100g: { caloriesKcal: 130, proteinG: 2.7, carbsG: 28.2, fatG: 0.3 },
    },
  },
  {
    token: 'banana',
    item: {
      source: 'user',
      name: 'Banana',
      brand: 'Generic',
      kind: 'food',
      nutritionBasis: 'per100g',
      servingSizes: [{ label: '1 medium banana', grams: 118, default: true }, { label: '100g', grams: 100 }],
      nutrientsPer100g: { caloriesKcal: 89, proteinG: 1.1, carbsG: 22.8, fatG: 0.3 },
    },
  },
  {
    token: 'yogurt',
    item: {
      source: 'user',
      name: 'Greek yogurt, plain',
      brand: 'Generic',
      kind: 'food',
      nutritionBasis: 'per100g',
      servingSizes: [{ label: '1 cup', grams: 170, default: true }, { label: '100g', grams: 100 }],
      nutrientsPer100g: { caloriesKcal: 59, proteinG: 10, carbsG: 3.6, fatG: 0.4 },
    },
  },
  {
    token: 'milk',
    item: {
      source: 'user',
      name: 'Milk, 2%',
      brand: 'Generic',
      kind: 'drink',
      nutritionBasis: 'per100ml',
      servingSizes: [{ label: '1 cup', ml: 240, default: true }, { label: '100ml', ml: 100 }],
      nutrientsPer100g: { caloriesKcal: 50, proteinG: 3.4, carbsG: 4.8, fatG: 2 },
    },
  },
];

const TOP_QUERY_SEEDS = ['egg', 'chicken', 'rice', 'banana', 'milk', 'yogurt', 'oats', 'apple', 'bread', 'protein'];

function normalizeText(input: string) {
  return String(input || '').trim().toLowerCase();
}

function sanitizeName(value: string) {
  return normalizeText(value).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenize(value: string) {
  return sanitizeName(value).split(' ').filter(Boolean);
}

function boundedEditDistance(aRaw: string, bRaw: string, maxDistance: number) {
  const a = sanitizeName(aRaw);
  const b = sanitizeName(bRaw);
  if (!a || !b) return maxDistance + 1;
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    let rowMin = curr[0];
    const ac = a[i - 1];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = ac === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      rowMin = Math.min(rowMin, curr[j]);
    }
    if (rowMin > maxDistance) return maxDistance + 1;
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }
  return prev[b.length];
}

function fuzzyTextMatchScore(candidateText: string, query: string) {
  const q = sanitizeName(query);
  const c = sanitizeName(candidateText);
  if (!q || !c || c.includes(q)) return 0;
  const qTokens = tokenize(q);
  const cTokens = tokenize(c);
  if (!qTokens.length || !cTokens.length) return 0;
  let score = 0;
  for (const qt of qTokens) {
    const maxDist = qt.length <= 5 ? 1 : 2;
    let best = maxDist + 1;
    for (const ct of cTokens) {
      if (ct.length < 2) continue;
      const d = boundedEditDistance(qt, ct, maxDist);
      if (d < best) best = d;
      if (best === 0) break;
    }
    if (best > maxDist) continue;
    score += best === 0 ? 8 : best === 1 ? 5 : 3;
  }
  return Math.min(22, score);
}

function looksLikeBarcode(query: string) {
  const q = String(query || '').trim();
  return /^[0-9]{8,14}$/.test(q);
}

function curatedFallbackForQuery(query: string): CanonicalFoodItem[] {
  const q = sanitizeName(query);
  const out: CanonicalFoodItem[] = [];
  for (const row of CURATED_FALLBACKS) {
    if (!q.includes(row.token) && !row.token.includes(q)) continue;
    const base = row.item;
    const materialized: Omit<CanonicalFoodItem, 'qualityTier' | 'completeness'> = {
      ...base,
      id: `curated:${row.token}`,
      sourceId: `curated:${row.token}`,
      servingSizes: Array.isArray(base.servingSizes) ? base.servingSizes : [{ label: '100g', grams: 100, default: true }],
      nutrientsPer100g: base.nutrientsPer100g,
    };
    out.push({ ...materialized, ...computeQuality(materialized) });
  }
  return out;
}

function applyResultFloor(query: string, items: CanonicalFoodItem[]) {
  const deduped = dedupeFoods(items);
  if (deduped.length >= MIN_RESULTS_FLOOR) return deduped;
  return dedupeFoods([...deduped, ...curatedFallbackForQuery(query)]);
}

function normalizeLocale(locale?: Locale) {
  return {
    country: String(locale?.country || '').trim().toUpperCase() || 'US',
    admin: String(locale?.admin || '').trim().toUpperCase() || undefined,
    language: String(locale?.language || '').trim().toLowerCase() || 'en',
  };
}

function normalizeCountryToken(raw: string) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^([a-z]{2,3}):/, '')
    .replace(/[^a-z0-9]/g, '');
}

function localeCountryAliases(countryCode: string) {
  const code = String(countryCode || '').trim().toUpperCase();
  const aliases = new Set<string>([normalizeCountryToken(code)]);
  if (code === 'US') {
    aliases.add('usa');
    aliases.add('unitedstates');
    aliases.add('unitedstatesofamerica');
    aliases.add('estadosunidos');
    aliases.add('etatsunis');
  }
  return aliases;
}

function countryTokenMatchesAliases(token: string, aliases: Set<string>) {
  if (!token) return false;
  if (aliases.has(token)) return true;
  for (const alias of aliases.values()) {
    if (alias.length >= 4 && token.includes(alias)) return true;
  }
  return false;
}

function extractOffCountryTokens(product: any) {
  const out: string[] = [];
  const fromTags = Array.isArray(product?.countries_tags) ? product.countries_tags : [];
  for (const value of fromTags) out.push(String(value || ''));
  const countriesRaw = String(product?.countries || '').trim();
  if (countriesRaw) {
    countriesRaw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .forEach((value) => out.push(value));
  }
  return out.map(normalizeCountryToken).filter(Boolean);
}

function isOffCountryMatch(product: any, locale: ReturnType<typeof normalizeLocale>) {
  const aliases = localeCountryAliases(locale.country);
  const tokens = extractOffCountryTokens(product);
  if (tokens.length === 0) return 'unknown' as const;
  const match = tokens.some((token) => countryTokenMatchesAliases(token, aliases));
  return match ? ('match' as const) : ('mismatch' as const);
}

function qualityWeight(tier: CanonicalFoodItem['qualityTier']) {
  if (tier === 'VERIFIED') return 40;
  if (tier === 'HIGH') return 30;
  if (tier === 'MEDIUM') return 20;
  if (tier === 'USER') return 15;
  return 8;
}

function computeQuality(item: Omit<CanonicalFoodItem, 'qualityTier' | 'completeness'>) {
  const calories = Number(item.nutrientsPer100g.caloriesKcal) || 0;
  const protein = Number(item.nutrientsPer100g.proteinG) || 0;
  const carbs = Number(item.nutrientsPer100g.carbsG) || 0;
  const fat = Number(item.nutrientsPer100g.fatG) || 0;
  const hasCalories = calories > 0;
  const hasMacros = protein + carbs + fat > 0;
  const hasServing = Array.isArray(item.servingSizes) && item.servingSizes.length > 0;

  let qualityTier: CanonicalFoodItem['qualityTier'] = 'LOW';
  if (item.source === 'usda') qualityTier = 'VERIFIED';
  else if (hasCalories && hasMacros && hasServing) qualityTier = 'HIGH';
  else if ((hasCalories || hasMacros) && hasServing) qualityTier = 'MEDIUM';
  else if (item.source === 'user') qualityTier = 'USER';

  return { qualityTier, completeness: { hasCalories, hasMacros, hasServing } };
}

function canonicalId(source: 'off' | 'usda' | 'user' | 'restaurant', sourceId: string, barcode?: string) {
  return barcode ? `${source}:barcode:${barcode}` : `${source}:${sourceId}`;
}

function mapOpenFoodFactsProduct(product: any): CanonicalFoodItem | null {
  const nutriments = product?.nutriments || {};
  const servingG = Number(nutriments['serving_quantity']) || undefined;
  const servingLabel = typeof product?.serving_size === 'string' ? product.serving_size : undefined;
  const servingLabelLower = String(servingLabel || '').toLowerCase();
  const servingIsMl = /\bml\b|\bcl\b|\bl\b|\bfl\s?oz\b/.test(servingLabelLower);

  const base: Omit<CanonicalFoodItem, 'qualityTier' | 'completeness'> = {
    id: canonicalId('off', String(product?._id || product?.id || product?.code || Date.now()), product?.code),
    source: 'off',
    sourceId: String(product?._id || product?.id || product?.code || ''),
    name: String(product?.product_name || product?.generic_name || '').trim() || 'Unknown product',
    brand: String(product?.brands || '').split(',')[0]?.trim() || undefined,
    barcode: typeof product?.code === 'string' ? product.code : undefined,
    country: typeof product?.countries_tags?.[0] === 'string' ? product.countries_tags[0] : undefined,
    locale: typeof product?.lang === 'string' ? product.lang : undefined,
    kind: 'food',
    nutritionBasis: undefined,
    servingSizes: [
      { label: '100g', grams: 100, default: !servingLabel },
      ...(servingLabel
        ? [
            servingIsMl
              ? { label: servingLabel, ml: servingG, default: true }
              : { label: servingLabel, grams: servingG, default: true },
          ]
        : []),
    ],
    nutrientsPer100g: {
      caloriesKcal:
        Number(nutriments['energy-kcal_100g']) ||
        Number(nutriments['energy-kcal']) ||
        Math.round((Number(nutriments['energy_100g']) || 0) / 4.184),
      proteinG: Number(nutriments['proteins_100g']) || Number(nutriments['proteins']) || 0,
      carbsG: Number(nutriments['carbohydrates_100g']) || Number(nutriments['carbohydrates']) || 0,
      fatG: Number(nutriments['fat_100g']) || Number(nutriments['fat']) || 0,
      fiberG: Number(nutriments['fiber_100g']) || undefined,
      sugarG: Number(nutriments['sugars_100g']) || undefined,
      sodiumMg: Number(nutriments['sodium_100g']) ? Number(nutriments['sodium_100g']) * 1000 : undefined,
    },
    imageUrls: { front: typeof product?.image_front_small_url === 'string' ? product.image_front_small_url : undefined },
    lastVerifiedAt: new Date().toISOString(),
  };

  const quality = computeQuality(base);
  return { ...base, ...quality };
}

function mapUsdaFood(food: any): CanonicalFoodItem | null {
  const nutrients = Array.isArray(food?.foodNutrients) ? food.foodNutrients : [];
  const findNutrient = (name: string) => {
    const n = nutrients.find((row: any) => String(row?.nutrientName || '').toLowerCase().includes(name.toLowerCase()));
    return Number(n?.value) || 0;
  };

  const base: Omit<CanonicalFoodItem, 'qualityTier' | 'completeness'> = {
    id: canonicalId('usda', String(food?.fdcId || food?.description || Date.now()), food?.gtinUpc),
    source: 'usda',
    sourceId: String(food?.fdcId || ''),
    name: String(food?.description || '').trim() || 'USDA food',
    brand: typeof food?.brandOwner === 'string' ? food.brandOwner : undefined,
    barcode: typeof food?.gtinUpc === 'string' ? food.gtinUpc : undefined,
    locale: 'en',
    kind: 'food',
    nutritionBasis: 'per100g',
    servingSizes: [{ label: '100g', grams: 100, default: true }],
    nutrientsPer100g: {
      caloriesKcal: findNutrient('energy'),
      proteinG: findNutrient('protein'),
      carbsG: findNutrient('carbohydrate'),
      fatG: findNutrient('fat'),
      fiberG: findNutrient('fiber') || undefined,
      sugarG: findNutrient('sugar') || undefined,
      sodiumMg: findNutrient('sodium') || undefined,
    },
    lastVerifiedAt: new Date().toISOString(),
  };

  const quality = computeQuality(base);
  return { ...base, ...quality };
}

function dedupeFoods(items: CanonicalFoodItem[]) {
  const map = new Map<string, CanonicalFoodItem>();
  for (const item of items) {
    const key = item.barcode
      ? `barcode:${item.barcode}`
      : `name:${sanitizeName(item.name)}|brand:${sanitizeName(item.brand || '')}|cal:${Math.round(item.nutrientsPer100g.caloriesKcal || 0)}`;
    const existing = map.get(key);
    if (!existing || qualityWeight(item.qualityTier) > qualityWeight(existing.qualityTier)) {
      map.set(key, item);
    }
  }
  return Array.from(map.values());
}

function resolveUsRegion(admin?: string) {
  const normalized = String(admin || '').trim().toUpperCase();
  if (!normalized) return '';
  return US_STATE_TO_REGION[normalized] || normalized;
}

function searchRestaurantProvider(query: string, locale: ReturnType<typeof normalizeLocale>) {
  const q = sanitizeName(query);
  const region = resolveUsRegion(locale.admin);
  const asksForRestaurant = /\b(restaurant|fast food|menu|meal combo|takeout|delivery)\b/i.test(query);
  const out: CanonicalFoodItem[] = [];

  for (const provider of RESTAURANT_PROVIDER_SEEDS) {
    if (
      provider.regions &&
      provider.regions.length > 0 &&
      locale.country === 'US' &&
      region &&
      !provider.regions.map((value) => String(value)).includes(region)
    ) {
      continue;
    }

    const providerTokens = [
      sanitizeName(provider.brand),
      ...provider.aliases.map((alias) => sanitizeName(alias)),
      ...provider.menu.map((item) => sanitizeName(item.name)),
    ].filter(Boolean);

    const matched = providerTokens.some((token) => token.includes(q) || q.includes(token));
    if (!matched && !asksForRestaurant) continue;

    for (const item of provider.menu) {
      const base: Omit<CanonicalFoodItem, 'qualityTier' | 'completeness'> = {
        id: canonicalId('restaurant', `${provider.providerId}:${sanitizeName(item.name).replace(/\s+/g, '_')}`),
        source: 'restaurant',
        sourceId: provider.providerId,
        name: item.name,
        brand: provider.brand,
        locale: locale.language,
        country: locale.country,
        kind: 'food',
        nutritionBasis: 'per100g',
        servingSizes: [
          { label: '100g', grams: 100 },
          { label: item.servingLabel, grams: item.servingGrams, default: true, estimated: true },
        ],
        nutrientsPer100g: {
          caloriesKcal: item.caloriesKcal,
          proteinG: item.proteinG,
          carbsG: item.carbsG,
          fatG: item.fatG,
        },
        lastVerifiedAt: new Date().toISOString(),
      };
      out.push({ ...base, ...computeQuality(base) });
    }
  }

  return out;
}

function brandBoost(item: CanonicalFoodItem, locale: ReturnType<typeof normalizeLocale>, query: string) {
  if (locale.country !== 'US') return 0;
  const preferBranded = /\b(brand|restaurant|store|mcdonald|starbucks|chipotle|costco|walmart|target)\b/i.test(query);
  const brand = sanitizeName(item.brand || '');
  if (!brand) return 0;

  let score = 0;
  const region = resolveUsRegion(locale.admin);
  if (region && Array.isArray(US_REGIONAL_BRANDS[region])) {
    if (US_REGIONAL_BRANDS[region].some((token) => brand.includes(sanitizeName(token)))) {
      score += preferBranded ? 22 : 10;
    }
  }
  if (US_NATIONAL_BRANDS.some((token) => brand.includes(sanitizeName(token)))) {
    score += preferBranded ? 10 : 4;
  }
  return score;
}

function personalizationBoost(item: CanonicalFoodItem, tokenWeights: Map<string, number>) {
  if (!tokenWeights.size) return 0;
  const nameTokens = tokenize(item.name || '');
  const brandTokens = tokenize(item.brand || '');
  const combined = new Set<string>([...nameTokens, ...brandTokens]);
  let boost = 0;
  for (const token of combined) {
    const w = tokenWeights.get(token);
    if (!w) continue;
    boost += Math.min(10, w);
  }
  return Math.min(24, boost);
}

function score(item: CanonicalFoodItem, query: string, locale: ReturnType<typeof normalizeLocale>, tokenWeights: Map<string, number>) {
  const q = normalizeText(query);
  const name = normalizeText(item.name);
  const brand = normalizeText(item.brand || '');
  let value = 0;
  if (name === q) value += 140;
  if (name.startsWith(q)) value += 95;
  if (name.includes(q)) value += 60;
  value += fuzzyTextMatchScore(name, q);
  if (brand.startsWith(q) || brand.includes(q)) value += 20;
  value += fuzzyTextMatchScore(brand, q);
  value += qualityWeight(item.qualityTier);
  value += brandBoost(item, locale, query);
  value += personalizationBoost(item, tokenWeights);
  if ((item.nutrientsPer100g.caloriesKcal || 0) <= 0 && (item.nutrientsPer100g.proteinG || 0) <= 0) value -= 12;
  return value;
}

async function searchOpenFoodFacts(query: string, locale: ReturnType<typeof normalizeLocale>, pageSize = 50): Promise<CanonicalFoodItem[]> {
  const lc = encodeURIComponent(locale.language || 'en');
  const cc = encodeURIComponent(String(locale.country || 'US').toLowerCase());
  const url = `${OFF_SEARCH_URL}?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=${pageSize}&lc=${lc}&cc=${cc}`;
  const res = await fetch(url);
  const data = await res.json();
  const products: unknown[] = Array.isArray(data?.products) ? data.products : [];

  const mapped = products
    .map((row) => {
      const product = row as any;
      const item = mapOpenFoodFactsProduct(product);
      if (!item) return null;
      const countryMatch = isOffCountryMatch(product, locale);
      return { item, countryMatch };
    })
    .filter((row): row is { item: CanonicalFoodItem; countryMatch: 'match' | 'mismatch' | 'unknown' } => Boolean(row));

  if (locale.country !== 'US') return mapped.map((row) => row.item);

  return mapped
    .filter((row) => row.countryMatch !== 'mismatch')
    .sort((a, b) => {
      const aRank = a.countryMatch === 'match' ? 0 : 1;
      const bRank = b.countryMatch === 'match' ? 0 : 1;
      return aRank - bRank;
    })
    .map((row) => row.item);
}

async function searchUsda(query: string, pageSize = 20): Promise<CanonicalFoodItem[]> {
  const apiKey = Deno.env.get('USDA_API_KEY') || USDA_DEMO_KEY;
  if (!apiKey) return [];
  const url = `${USDA_SEARCH_URL}?query=${encodeURIComponent(query)}&pageSize=${pageSize}&api_key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  const data = await res.json();
  const foods: unknown[] = Array.isArray(data?.foods) ? data.foods : [];
  return foods
    .map((row) => mapUsdaFood(row as any))
    .filter((item: CanonicalFoodItem | null): item is CanonicalFoodItem => Boolean(item));
}

async function searchOffBarcode(barcode: string): Promise<CanonicalFoodItem[]> {
  try {
    const res = await fetch(`${OFF_BARCODE_URL}/${encodeURIComponent(barcode)}.json`);
    const data = await res.json();
    if (data?.status !== 1 || !data?.product) return [];
    const mapped = mapOpenFoodFactsProduct(data.product);
    return mapped ? [mapped] : [];
  } catch {
    return [];
  }
}

async function loadUserTokenWeights(serviceClient: any, userId: string) {
  try {
    const { data } = await serviceClient
      .from('food_user_query_profile')
      .select('token,weight')
      .eq('user_id', userId)
      .order('weight', { ascending: false })
      .limit(80);
    const out = new Map<string, number>();
    (Array.isArray(data) ? data : []).forEach((row: any) => {
      const token = sanitizeName(String(row?.token || ''));
      if (!token) return;
      out.set(token, Number(row?.weight) || 0);
    });
    return out;
  } catch {
    return new Map<string, number>();
  }
}

async function upsertUserTokenWeights(serviceClient: any, userId: string, query: string) {
  const tokens = tokenize(query).filter((token) => token.length >= 2).slice(0, 8);
  if (!tokens.length) return;
  await Promise.allSettled(tokens.map(async (token) => {
    const nowIso = new Date().toISOString();
    const { data: existing } = await serviceClient
      .from('food_user_query_profile')
      .select('weight')
      .eq('user_id', userId)
      .eq('token', token)
      .maybeSingle();
    const current = Number(existing?.weight || 0);
    const nextWeight = Math.min(120, current + 1);
    await serviceClient
      .from('food_user_query_profile')
      .upsert({ user_id: userId, token, weight: nextWeight, last_seen_at: nowIso }, { onConflict: 'user_id,token' });
  }));
  try {
    await serviceClient.rpc('trim_food_user_query_profile', { p_user_id: userId });
  } catch {
    // non-fatal
  }
}

async function tryGetPrefixCache(serviceClient: any, prefixKey: string, query: string) {
  try {
    const { data } = await serviceClient
      .from('food_search_prefix_cache')
      .select('results,hit_count')
      .eq('prefix_key', prefixKey)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (!data?.results || !Array.isArray(data.results)) return null;
    const q = sanitizeName(query);
    const filtered = (data.results as CanonicalFoodItem[]).filter((item) => {
      const name = sanitizeName(item.name || '');
      const brand = sanitizeName(item.brand || '');
      return name.includes(q) || brand.includes(q);
    });
    await serviceClient
      .from('food_search_prefix_cache')
      .update({ hit_count: Number((data as any).hit_count || 0) + 1 })
      .eq('prefix_key', prefixKey);
    return filtered;
  } catch {
    return null;
  }
}

async function upsertPrefixCache(serviceClient: any, prefixKey: string, prefix: string, locale: ReturnType<typeof normalizeLocale>, results: CanonicalFoodItem[]) {
  const expiresAt = new Date(Date.now() + PREFIX_CACHE_TTL_HOURS * 60 * 60 * 1000).toISOString();
  try {
    await serviceClient
      .from('food_search_prefix_cache')
      .upsert({
        prefix_key: prefixKey,
        prefix,
        country: locale.country,
        admin: locale.admin ?? null,
        language: locale.language,
        results: results.slice(0, 40),
        expires_at: expiresAt,
      });
  } catch {
    // non-fatal
  }
}

async function precomputeSeedPrefixCaches(serviceClient: any, locale: ReturnType<typeof normalizeLocale>) {
  const tasks = TOP_QUERY_SEEDS.map(async (seed) => {
    const prefix = normalizeText(seed).slice(0, Math.min(4, seed.length));
    const key = `${prefix}|${normalizeText(locale.language)}|${normalizeText(locale.country)}|${normalizeText(locale.admin || '')}`;
    const { data: existing } = await serviceClient
      .from('food_search_prefix_cache')
      .select('prefix_key')
      .eq('prefix_key', key)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (existing?.prefix_key) return;
    const seeded = applyResultFloor(seed, curatedFallbackForQuery(seed));
    if (!seeded.length) return;
    await upsertPrefixCache(serviceClient, key, prefix, locale, seeded);
  });
  await Promise.allSettled(tasks);
}

async function logSearchMetric(serviceClient: any, payload: {
  userId: string;
  query: string;
  locale: ReturnType<typeof normalizeLocale>;
  source: string;
  durationMs: number;
  resultCount: number;
}) {
  try {
    await serviceClient.from('food_search_metrics').insert({
      user_id: payload.userId,
      query: payload.query,
      country: payload.locale.country,
      admin: payload.locale.admin ?? null,
      language: payload.locale.language,
      source: payload.source,
      duration_ms: Math.max(0, Math.round(payload.durationMs)),
      result_count: Math.max(0, Math.round(payload.resultCount)),
    });
  } catch {
    // non-fatal
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: 'Supabase env missing' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: userData, error: userError } = await authClient.auth.getUser();
  if (userError || !userData?.user?.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const userId = String(userData.user.id);
  const startedAt = Date.now();

  let body: { query?: string; locale?: Locale; limit?: number } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const query = String(body.query || '').trim();
  if (!query || query.length < 2) {
    return new Response(JSON.stringify({ items: [], source: 'invalid_query' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const locale = normalizeLocale(body.locale);
  const limit = Math.max(10, Math.min(80, Number(body.limit) || 40));
  const normalizedQuery = normalizeText(query);
  const queryKey = `${normalizedQuery}|${normalizeText(locale.language)}|${normalizeText(locale.country)}|${normalizeText(locale.admin || '')}`;
  const queryPrefix = normalizedQuery.slice(0, Math.min(4, normalizedQuery.length));
  const prefixKey = `${queryPrefix}|${normalizeText(locale.language)}|${normalizeText(locale.country)}|${normalizeText(locale.admin || '')}`;

  // Hard rate limits (minute + day) to protect backend and upstream APIs.
  const [minuteLimit, dayLimit] = await Promise.all([
    serviceClient.rpc('food_search_allow_request', {
      p_user_id: userId,
      p_scope: 'food_search_minute',
      p_window_seconds: 60,
      p_limit: 80,
    }),
    serviceClient.rpc('food_search_allow_request', {
      p_user_id: userId,
      p_scope: 'food_search_day',
      p_window_seconds: 86400,
      p_limit: 2500,
    }),
  ]);

  const rateLimited = Boolean(minuteLimit?.error || dayLimit?.error || minuteLimit?.data === false || dayLimit?.data === false);
  if (rateLimited) {
    await Promise.allSettled([
      logSearchMetric(serviceClient, {
        userId,
        query,
        locale,
        source: 'rate_limited',
        durationMs: Date.now() - startedAt,
        resultCount: 0,
      }),
      serviceClient.rpc('insert_backend_ops_alert', {
        p_alert_key: 'food_search_rate_limited',
        p_severity: 'medium',
        p_source: 'food_search',
        p_message: 'Food search requests exceeded configured rate limit',
        p_details: { user_id: userId },
        p_dedupe_minutes: 15,
      }),
    ]);
    return new Response(JSON.stringify({ error: 'Rate limit exceeded. Try again shortly.' }), {
      status: 429,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Exact barcode lane for deterministic speed/accuracy.
  if (looksLikeBarcode(query)) {
    const exactItems = await searchOffBarcode(query);
    const finalItems = applyResultFloor(query, exactItems).slice(0, limit);
    await Promise.allSettled([
      logSearchMetric(serviceClient, {
        userId,
        query,
        locale,
        source: 'barcode_exact',
        durationMs: Date.now() - startedAt,
        resultCount: finalItems.length,
      }),
      upsertUserTokenWeights(serviceClient, userId, query),
    ]);
    return new Response(JSON.stringify({ items: finalItems, source: 'barcode_exact' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Prefix cache for fast first keystrokes.
  if (normalizedQuery.length <= 4 && queryPrefix.length >= 2) {
    const prefixCached = await tryGetPrefixCache(serviceClient, prefixKey, query);
    if (prefixCached && prefixCached.length > 0) {
      const finalItems = applyResultFloor(query, prefixCached).slice(0, limit);
      await Promise.allSettled([
        logSearchMetric(serviceClient, {
          userId,
          query,
          locale,
          source: 'prefix_cache',
          durationMs: Date.now() - startedAt,
          resultCount: finalItems.length,
        }),
        upsertUserTokenWeights(serviceClient, userId, query),
      ]);
      return new Response(JSON.stringify({ items: finalItems, source: 'prefix_cache' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  try {
    const { data: cached } = await serviceClient
      .from('food_search_cache')
      .select('results,hit_count')
      .eq('query_key', queryKey)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (cached?.results && Array.isArray(cached.results)) {
      const items = applyResultFloor(query, cached.results as CanonicalFoodItem[]).slice(0, limit);
      await serviceClient
        .from('food_search_cache')
        .update({ hit_count: ((cached as any).hit_count || 0) + 1 })
        .eq('query_key', queryKey);

      await Promise.allSettled([
        logSearchMetric(serviceClient, {
          userId,
          query,
          locale,
          source: 'cache',
          durationMs: Date.now() - startedAt,
          resultCount: items.length,
        }),
        upsertUserTokenWeights(serviceClient, userId, query),
      ]);

      return new Response(JSON.stringify({ items, source: 'cache' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  } catch {
    // Continue with live fetch.
  }

  try {
    const tokenWeights = await loadUserTokenWeights(serviceClient, userId);
    const [off, usda, restaurant] = await Promise.allSettled([
      searchOpenFoodFacts(query, locale, 50),
      searchUsda(query, 24),
      Promise.resolve(searchRestaurantProvider(query, locale)),
    ]);

    const merged = dedupeFoods([
      ...(off.status === 'fulfilled' ? off.value : []),
      ...(usda.status === 'fulfilled' ? usda.value : []),
      ...(restaurant.status === 'fulfilled' ? restaurant.value : []),
    ]);

    const exactName = sanitizeName(query);
    const exactMatches = merged.filter((item) => sanitizeName(item.name || '') === exactName);
    if (exactMatches.length > 0) {
      const exactResult = applyResultFloor(query, [...exactMatches, ...merged]).slice(0, limit);
      await Promise.allSettled([
        logSearchMetric(serviceClient, {
          userId,
          query,
          locale,
          source: 'exact_name',
          durationMs: Date.now() - startedAt,
          resultCount: exactResult.length,
        }),
        upsertUserTokenWeights(serviceClient, userId, query),
      ]);
      if (queryPrefix.length >= 2) {
        void upsertPrefixCache(serviceClient, prefixKey, queryPrefix, locale, exactResult);
      }
      return new Response(JSON.stringify({ items: exactResult, source: 'exact_name' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const ranked = applyResultFloor(query, merged)
      .map((item) => ({ item, score: score(item, query, locale, tokenWeights) }))
      .sort((a, b) => b.score - a.score)
      .map((row) => row.item)
      .slice(0, Math.min(MAX_RESULTS, limit));

    const expiresAt = new Date(Date.now() + CACHE_TTL_HOURS * 60 * 60 * 1000).toISOString();

    try {
      await serviceClient
        .from('food_search_cache')
        .upsert({
          query_key: queryKey,
          query,
          country: locale.country,
          admin: locale.admin ?? null,
          language: locale.language,
          results: ranked,
          source: 'off_usda_restaurant',
          expires_at: expiresAt,
        });
    } catch {
      // Cache write failures should not fail user search.
    }

    if (queryPrefix.length >= 2) {
      void upsertPrefixCache(serviceClient, prefixKey, queryPrefix, locale, ranked);
    }

    await Promise.allSettled([
      logSearchMetric(serviceClient, {
        userId,
        query,
        locale,
        source: 'live',
        durationMs: Date.now() - startedAt,
        resultCount: ranked.length,
      }),
      upsertUserTokenWeights(serviceClient, userId, query),
    ]);

    return new Response(JSON.stringify({ items: ranked, source: 'live' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    await Promise.allSettled([
      logSearchMetric(serviceClient, {
        userId,
        query,
        locale,
        source: 'error_live',
        durationMs: Date.now() - startedAt,
        resultCount: 0,
      }),
      serviceClient.rpc('insert_backend_ops_alert', {
        p_alert_key: 'food_search_live_error',
        p_severity: 'high',
        p_source: 'food_search',
        p_message: 'Food search live execution failed',
        p_details: { error: String((error as Error)?.message || 'unknown') },
        p_dedupe_minutes: 10,
      }),
    ]);
    return new Response(JSON.stringify({ error: (error as Error)?.message || 'food search failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
