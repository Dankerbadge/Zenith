import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { normalizeCaloriesFromMacros } from "./nutritionIntegrity";
import { FoodEntry, getDailyLog, saveDailyLog, todayKey } from "./storageUtils";
import commonFoodsCatalog from "./commonFoodsCatalog.json";
import { foodEntryIdentityKey, inferMealFromTimeWindow } from "./foodLogGrouping";
import { getDefaultUnitPolicyForItem, getEffectiveServingSizesForItem, type DefaultUnitPolicy } from "./preparedFoodServingPolicy";
import {
  convertToCanonical,
  defaultUnitForKind,
  equivalentsForDisplay,
  getBaseUnitOptions,
  getServingUnitOptions,
  inferKind,
  roundTo,
  type CanonicalUnit,
  type ItemKind,
  type UnitKey,
  type UnitOption,
  type UnitsPreference,
} from "./measurementEngine";
import { recordFoodSearchPerf } from "./foodSearchPerf";
import { isSupabaseConfigured, supabase } from "./supabaseClient";

export type FoodQualityTier = "VERIFIED" | "HIGH" | "MEDIUM" | "LOW" | "USER";
export type FoodSource = "off" | "usda" | "user";
export type FoodSearchTier = "ESSENTIAL" | "STAPLE" | "LONG_TAIL";
export type FoodResultTag = "Essential" | "Your usual" | "Frequent" | "Recent" | "Verified";

export type FoodServing = {
  label: string;
  grams?: number;
  ml?: number;
  default?: boolean;
  estimated?: boolean;
};

export type CanonicalFoodItem = {
  id: string;
  source: FoodSource;
  sourceId: string;
  name: string;
  brand?: string;
  barcode?: string;
  country?: string;
  locale?: string;
  kind?: "food" | "drink";
  nutritionBasis?: "per100g" | "per100ml";
  synonyms?: string[];
  categoryTags?: string[];
  defaultUnitPolicy?: DefaultUnitPolicy;
  servingSizes: FoodServing[];
  nutrientsPer100g: {
    caloriesKcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG?: number;
    sugarG?: number;
    sodiumMg?: number;
  };
  qualityTier: FoodQualityTier;
  completeness: {
    hasCalories: boolean;
    hasMacros: boolean;
    hasServing: boolean;
  };
  imageUrls?: { front?: string };
  lastVerifiedAt?: string;
};

export type SearchLocale = {
  country?: string;
  admin?: string;
  language?: string;
};

export type FoodUnitSelection = {
  unitKey: UnitKey;
  label: string;
  kind: ItemKind;
  options: UnitOption[];
  defaultUnitKey: UnitKey;
};

type UsageStatsRow = {
  id: string;
  timesUsed: number;
  lastUsedAt: string;
  lastQuantity?: number;
  lastServingLabel?: string;
  item?: CanonicalFoodItem;
};

export type FoodUsageStatsRow = UsageStatsRow;

type BarcodeCacheRow = {
  item: CanonicalFoodItem;
  cachedAt: string;
};

const OFF_SEARCH_URL = "https://world.openfoodfacts.org/cgi/search.pl";
const OFF_BARCODE_URL = "https://world.openfoodfacts.org/api/v0/product";
const USDA_SEARCH_URL = "https://api.nal.usda.gov/fdc/v1/foods/search";
const FOOD_SEARCH_CLOUD_TIMEOUT_MS = 1400;

const FOOD_RECENTS_KEY = "foodRecents";
const FOOD_FAVORITES_KEY = "foodFavorites";
const BARCODE_CACHE_KEY = "barcodeCache";
const FOOD_USAGE_STATS_KEY = "foodUsageStats";

const MAX_RECENTS = 50;
const MAX_FAVORITES = 100;
const MAX_BARCODE_CACHE = 200;
const MAX_SEARCH_CACHE = 120;
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const PERSISTENT_SEARCH_CACHE_KEY = "zenith.foodSearchCache.v1";
const MAX_PERSISTENT_QUERIES_PER_REGION = 20;
const ESSENTIAL_TOKENS = [
  "chicken breast",
  "chicken",
  "ground beef",
  "beef",
  "rice",
  "egg",
  "eggs",
  "oats",
  "milk",
  "greek yogurt",
  "yogurt",
  "salmon",
  "potato",
  "banana",
  "olive oil",
  "pasta",
  "bread",
  "peanut butter",
  "broccoli",
  "turkey",
  "tuna",
  "sweet potato",
];
const BRAND_TOKENS = [
  "tyson",
  "oikos",
  "chobani",
  "fairlife",
  "quest",
  "gatorade",
  "coca",
  "pepsi",
  "kellogg",
  "general mills",
  "nature valley",
  "dannon",
  "fage",
  "premier protein",
  "muscle milk",
  "bodyarmor",
  "core power",
  "powerade",
  "ensure max",
  "atkins",
  "kind bar",
  "kind protein",
  "rxbar",
  "clif",
  "built bar",
  "orgain",
  "oatly",
  "silk almond",
  "huel",
  "chipotle",
  "starbucks",
  "mcdonald",
  "chick fil a",
  "panera",
  "subway",
  "taco bell",
  "wendys",
  "burger king",
  "kfc",
  "dominos",
  "pizza hut",
  "panda express",
  "popeyes",
  "dunkin",
  "in n out",
  "whataburger",
  "shake shack",
  "five guys",
  "jimmy john",
  "jersey mike",
  "sweetgreen",
  "cava",
  "qdoba",
  "noodles and company",
  "raising canes",
  "buffalo wild wings",
  "pf chang",
  "applebee",
  "cheesecake factory",
  "costco",
  "kroger",
  "walmart",
  "target",
  "trader joe",
  "whole foods",
  "aldi",
  "safeway",
  "cvs",
  "walgreens",
  "heb",
  "h e b",
  "publix",
  "meijer",
  "hy vee",
  "winco",
  "dutch bros",
  "waffle house",
  "bojangles",
  "zaxby",
  "zaxbys",
  "culver",
  "culvers",
  "casey",
  "caseys",
  "wawa",
  "wegmans",
  "sheetz",
  "kwik trip",
  "stater bros",
  "cumberland farms",
  "stew leonard",
  "cookout",
  "menards",
  "olive garden",
  "red lobster",
  "cracker barrel",
  "dennys",
  "ihop",
  "sonic",
  "arbys",
  "jack in the box",
  "little caesars",
  "papa john",
  "papa murphy",
  "outback",
  "texas roadhouse",
  "longhorn steakhouse",
  "carrabba",
  "bonefish grill",
  "chilis",
  "tgi fridays",
  "ruby tuesday",
  "bjs",
  "california pizza kitchen",
  "noodles world kitchen",
  "erbert and gerbert",
  "firehouse subs",
  "potbelly",
  "jasons deli",
  "einstein bros",
  "tropical smoothie cafe",
  "pei wei",
  "food lion",
  "sprouts farmers market",
  "rite aid",
  "7 eleven",
  "7-eleven",
  "circle k",
  "speedway",
  "giant eagle",
  "stop and shop",
  "shoprite",
  "hannaford",
  "giant food",
  "acme",
  "tom thumb",
  "raleys",
  "vons",
  "fred meyer",
  "jewel osco",
  "save a lot",
  "pavilions",
  "harveys supermarket",
  "brookshire brothers",
  "schnucks",
  "king soopers",
  "ralphs",
  "smiths food and drug",
  "marianos",
  "fareway",
  "ingles market",
  "lowes foods",
  "market basket",
  "white castle",
  "del taco",
  "hardees",
  "carls jr",
  "steak n shake",
  "freddys",
  "moes",
  "zoes kitchen",
  "jets pizza",
  "hungry howies",
  "marcos pizza",
  "wingstop",
  "blimpie",
  "mcalisters deli",
  "fazolis",
  "churchs chicken",
  "boston market",
  "sbarro",
  "tim hortons",
  "captain ds",
  "long john silvers",
  "checkers",
  "rallys",
  "portillos",
  "jollibee",
  "el pollo loco",
  "pollo tropical",
  "krystal",
  "tijuana flats",
  "wienerschnitzel",
];

type CommonFoodCatalogRow = {
  id: string;
  name: string;
  kind: "food" | "drink";
  nutritionBasis: "per100g" | "per100ml";
  synonyms: string[];
  categoryTags?: string[];
  nutrientsPer100: {
    caloriesKcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG?: number;
    sugarG?: number;
    sodiumMg?: number;
  };
  servingSizes: Array<{ label: string; grams?: number; ml?: number; default?: boolean }>;
};

type TokenRequirement = string | string[];

type FoodSearchIntentSpec = {
  key:
    | "chicken_breast"
    | "egg"
    | "rice"
    | "oats"
    | "milk"
    | "greek_yogurt"
    | "yogurt"
    | "banana"
    | "olive_oil"
    | "peanut_butter"
    | "ground_beef";
  displayName: string;
  match: TokenRequirement[];
  excludedTokens?: string[];
  fallbackNutrientsPer100g: CanonicalFoodItem["nutrientsPer100g"];
};

const FOOD_SEARCH_INTENTS: FoodSearchIntentSpec[] = [
  {
    key: "chicken_breast",
    displayName: "Chicken breast",
    match: ["chicken", ["breast", "breasts"]],
    excludedTokens: [
      "breaded",
      "battered",
      "nugget",
      "nuggets",
      "tender",
      "tenders",
      "strip",
      "strips",
      "sliced",
      "slice",
      "deli",
      "lunchmeat",
      "jerky",
      "sausage",
      "wing",
      "wings",
      "thigh",
      "thighs",
      "drumstick",
      "drumsticks",
      "leg",
      "legs",
      "rotisserie",
      "fried",
      "patty",
      "patties",
      "burger",
      "sandwich",
    ],
    fallbackNutrientsPer100g: {
      caloriesKcal: 120,
      proteinG: 24,
      carbsG: 0,
      fatG: 2,
    },
  },
  {
    key: "greek_yogurt",
    displayName: "Greek yogurt",
    match: ["greek", ["yogurt", "yoghurt"]],
    fallbackNutrientsPer100g: {
      caloriesKcal: 59,
      proteinG: 10,
      carbsG: 4,
      fatG: 0,
    },
  },
  {
    key: "peanut_butter",
    displayName: "Peanut butter",
    match: ["peanut", "butter"],
    fallbackNutrientsPer100g: {
      caloriesKcal: 588,
      proteinG: 25,
      carbsG: 20,
      fatG: 50,
      fiberG: 6,
      sugarG: 9,
      sodiumMg: 17,
    },
  },
  {
    key: "olive_oil",
    displayName: "Olive oil",
    match: ["olive", "oil"],
    fallbackNutrientsPer100g: {
      caloriesKcal: 884,
      proteinG: 0,
      carbsG: 0,
      fatG: 100,
    },
  },
  {
    key: "ground_beef",
    displayName: "Ground beef",
    match: ["ground", "beef"],
    fallbackNutrientsPer100g: {
      caloriesKcal: 250,
      proteinG: 26,
      carbsG: 0,
      fatG: 17,
    },
  },
  {
    key: "oats",
    displayName: "Oats",
    match: [["oat", "oats"]],
    fallbackNutrientsPer100g: {
      caloriesKcal: 389,
      proteinG: 17,
      carbsG: 66,
      fatG: 7,
      fiberG: 10,
      sugarG: 1,
    },
  },
  {
    key: "rice",
    displayName: "Rice (cooked)",
    match: ["rice"],
    fallbackNutrientsPer100g: {
      caloriesKcal: 130,
      proteinG: 2,
      carbsG: 29,
      fatG: 0,
      fiberG: 0,
      sugarG: 0,
    },
  },
  {
    key: "egg",
    displayName: "Egg",
    match: [["egg", "eggs"]],
    fallbackNutrientsPer100g: {
      caloriesKcal: 143,
      proteinG: 13,
      carbsG: 1,
      fatG: 10,
    },
  },
  {
    key: "milk",
    displayName: "Milk",
    match: ["milk"],
    fallbackNutrientsPer100g: {
      caloriesKcal: 50,
      proteinG: 3,
      carbsG: 5,
      fatG: 2,
      sugarG: 5,
      sodiumMg: 44,
    },
  },
  {
    key: "yogurt",
    displayName: "Yogurt",
    match: [["yogurt", "yoghurt"]],
    fallbackNutrientsPer100g: {
      caloriesKcal: 61,
      proteinG: 3,
      carbsG: 5,
      fatG: 3,
      sugarG: 5,
    },
  },
  {
    key: "banana",
    displayName: "Banana",
    match: [["banana", "bananas"]],
    fallbackNutrientsPer100g: {
      caloriesKcal: 89,
      proteinG: 1,
      carbsG: 23,
      fatG: 0,
      fiberG: 3,
      sugarG: 12,
    },
  },
];

const INTENT_DESCRIPTOR_TOKENS = new Set([
  "raw",
  "cooked",
  "grilled",
  "roasted",
  "baked",
  "boiled",
  "steamed",
  "boneless",
  "skinless",
  "plain",
  "unsweetened",
  "sweetened",
  "nonfat",
  "fatfree",
  "lowfat",
  "reduced",
  "whole",
  "skim",
  "lean",
  "extra",
  "virgin",
  "organic",
  "fresh",
  "frozen",
  "fat",
  "free",
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
]);

type SearchCacheRow = {
  items: CanonicalFoodItem[];
  cachedAt: number;
};

type PersistentSearchCacheEntry = {
  query: string;
  region: { country: string; admin?: string; language: string };
  results: CanonicalFoodItem[];
  cachedAt: string;
};

const searchCache = new Map<string, SearchCacheRow>();
const inFlightSearch = new Map<string, Promise<CanonicalFoodItem[]>>();
let usageStatsCache: { data: Record<string, UsageStatsRow>; cachedAt: number } | null = null;
let lastPrewarmAt = 0;
let persistentHydrated = false;

function isZenithCommonFood(item: Pick<CanonicalFoodItem, "id" | "sourceId">) {
  return String(item.id).startsWith("zenith-common:") || String(item.sourceId).startsWith("zenith-common:");
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function clamp(n: number, low: number, high: number) {
  return Math.max(low, Math.min(high, n));
}

function normalizeText(input: string) {
  return input.trim().toLowerCase();
}

function normalizeLocale(locale?: SearchLocale) {
  return {
    country: String(locale?.country || "").trim().toUpperCase() || "US",
    admin: String(locale?.admin || "").trim() || undefined,
    language: String(locale?.language || "").trim().toLowerCase() || "en",
  };
}

function persistentRegionKey(locale?: SearchLocale) {
  const normalized = normalizeLocale(locale);
  return `${normalized.country}|${normalized.admin || ""}|${normalized.language}`;
}

function normalizeCommonKey(input: string) {
  // Canonical common-food normalization: lower, punctuation stripped, whitespace collapsed.
  return sanitizeName(input);
}

function containsBrandToken(value: string) {
  const normalized = normalizeText(value);
  const sanitized = sanitizeName(value);
  const compactValue = sanitized.replace(/\s+/g, "");
  return BRAND_TOKENS.some((token) => {
    const normalizedToken = normalizeText(token);
    if (normalized.includes(normalizedToken)) return true;
    const sanitizedToken = sanitizeName(token);
    if (sanitized.includes(sanitizedToken)) return true;
    const compactToken = sanitizedToken.replace(/\s+/g, "");
    if (compactToken.length < 5) return false;
    return compactValue.includes(compactToken);
  });
}

function sanitizeName(value: string) {
  return normalizeText(value)
    // Keep possessive/plural brand tokens contiguous: "wendy's" -> "wendys".
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string) {
  return sanitizeName(value).split(" ").filter(Boolean);
}

function normalizeCountryToken(raw: string) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^([a-z]{2,3}):/, "")
    .replace(/[^a-z0-9]/g, "");
}

function localeCountryAliases(countryCode: string) {
  const code = String(countryCode || "").trim().toUpperCase();
  const aliases = new Set<string>([normalizeCountryToken(code)]);
  if (code === "US") {
    aliases.add("usa");
    aliases.add("unitedstates");
    aliases.add("unitedstatesofamerica");
    aliases.add("estadosunidos");
    aliases.add("etatsunis");
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
  for (const value of fromTags) out.push(String(value || ""));
  const countriesRaw = String(product?.countries || "").trim();
  if (countriesRaw) {
    countriesRaw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .forEach((value) => out.push(value));
  }
  return out.map(normalizeCountryToken).filter(Boolean);
}

function isOffProductCountryMatch(product: any, locale?: SearchLocale) {
  const normalized = normalizeLocale(locale);
  const aliases = localeCountryAliases(normalized.country);
  const tokens = extractOffCountryTokens(product);
  if (tokens.length === 0) return "unknown" as const;
  const isMatch = tokens.some((token) => countryTokenMatchesAliases(token, aliases));
  return isMatch ? ("match" as const) : ("mismatch" as const);
}

function localeCountryPenalty(item: CanonicalFoodItem, locale?: SearchLocale) {
  const normalized = normalizeLocale(locale);
  if (normalized.country !== "US") return 0;
  if (item.source !== "off") return 0;
  const token = normalizeCountryToken(String(item.country || ""));
  if (!token) return 0;
  const usAliases = localeCountryAliases("US");
  if (countryTokenMatchesAliases(token, usAliases)) return 0;
  return 90;
}

function isItemCountryMatchLocale(item: CanonicalFoodItem, locale?: SearchLocale) {
  const normalized = normalizeLocale(locale);
  const token = normalizeCountryToken(String(item.country || ""));
  if (!token) return true;
  const aliases = localeCountryAliases(normalized.country);
  return countryTokenMatchesAliases(token, aliases);
}

function enforceLocaleCountryScope(items: CanonicalFoodItem[], locale?: SearchLocale) {
  if (!Array.isArray(items) || items.length === 0) return [];
  return items.filter((item) => {
    // Always keep user-curated rows even when provider country metadata is noisy.
    if (item.source === "user") return true;
    return isItemCountryMatchLocale(item, locale);
  });
}

function boundedEditDistance(aRaw: string, bRaw: string, maxDistance: number) {
  const a = sanitizeName(aRaw);
  const b = sanitizeName(bRaw);
  if (!a || !b) return maxDistance + 1;
  if (a === b) return 0;
  const lenA = a.length;
  const lenB = b.length;
  if (Math.abs(lenA - lenB) > maxDistance) return maxDistance + 1;

  // Levenshtein distance with early exit.
  const prev = new Array<number>(lenB + 1);
  const curr = new Array<number>(lenB + 1);
  for (let j = 0; j <= lenB; j += 1) prev[j] = j;

  for (let i = 1; i <= lenA; i += 1) {
    curr[0] = i;
    let rowMin = curr[0];
    const aChar = a[i - 1];
    for (let j = 1; j <= lenB; j += 1) {
      const cost = aChar === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      rowMin = Math.min(rowMin, curr[j]);
    }
    if (rowMin > maxDistance) return maxDistance + 1;
    for (let j = 0; j <= lenB; j += 1) prev[j] = curr[j];
  }
  return prev[lenB];
}

function fuzzyTokenMatchScore(queryTokens: string[], candidateTokens: string[]) {
  if (queryTokens.length === 0 || candidateTokens.length === 0) return 0;
  let total = 0;
  for (const qt of queryTokens) {
    if (qt.length < 3) return 0;
    const maxDist = qt.length <= 5 ? 1 : 2;
    let best = maxDist + 1;
    for (const ct of candidateTokens) {
      if (ct.length < 3) continue;
      const d = boundedEditDistance(qt, ct, maxDist);
      if (d < best) best = d;
      if (best === 0) break;
    }
    if (best > maxDist) return 0;
    total += best === 0 ? 18 : best === 1 ? 10 : 6;
  }
  return total;
}

function fuzzyTextMatchScore(candidateText: string, query: string) {
  const q = sanitizeName(query);
  const c = sanitizeName(candidateText);
  if (!q || !c) return 0;
  if (c.includes(q)) return 0;

  const qTokens = tokenize(q);
  const cTokens = tokenize(c);
  if (qTokens.length === 1 && cTokens.length === 1) {
    const maxDist = qTokens[0].length <= 5 ? 1 : 2;
    const d = boundedEditDistance(qTokens[0], cTokens[0], maxDist);
    if (d > maxDist) return 0;
    return d === 0 ? 65 : d === 1 ? 48 : 28;
  }

  const tokenScore = fuzzyTokenMatchScore(qTokens, cTokens);
  if (tokenScore <= 0) return 0;
  return Math.min(55, 20 + tokenScore);
}

function pluralVariants(tokens: string[]) {
  const out = new Set<string>();
  tokens.forEach((token) => {
    out.add(token);
    if (token.endsWith("s") && token.length > 3) out.add(token.slice(0, -1));
    else out.add(`${token}s`);
  });
  return Array.from(out);
}

const COMMON_FOODS: CanonicalFoodItem[] = (() => {
  const rows = (Array.isArray(commonFoodsCatalog) ? commonFoodsCatalog : []) as CommonFoodCatalogRow[];
  return rows.map((row) => {
    const base: Omit<CanonicalFoodItem, "qualityTier" | "completeness"> = {
      id: row.id,
      source: "user",
      sourceId: row.id,
      name: row.name,
      brand: "Generic",
      kind: row.kind,
      nutritionBasis: row.nutritionBasis,
      synonyms: Array.isArray(row.synonyms) ? row.synonyms : [],
      categoryTags: Array.isArray(row.categoryTags) ? row.categoryTags : [],
      servingSizes: Array.isArray(row.servingSizes) ? row.servingSizes : [{ label: row.kind === "drink" ? "100ml" : "100g", ...(row.kind === "drink" ? { ml: 100 } : { grams: 100 }), default: true }],
      nutrientsPer100g: {
        caloriesKcal: Number(row.nutrientsPer100?.caloriesKcal) || 0,
        proteinG: Number(row.nutrientsPer100?.proteinG) || 0,
        carbsG: Number(row.nutrientsPer100?.carbsG) || 0,
        fatG: Number(row.nutrientsPer100?.fatG) || 0,
        fiberG: typeof row.nutrientsPer100?.fiberG === "number" ? row.nutrientsPer100.fiberG : undefined,
        sugarG: typeof row.nutrientsPer100?.sugarG === "number" ? row.nutrientsPer100.sugarG : undefined,
        sodiumMg: typeof row.nutrientsPer100?.sodiumMg === "number" ? row.nutrientsPer100.sodiumMg : undefined,
      },
      lastVerifiedAt: new Date().toISOString(),
    };
    const quality = computeQuality(base);
    // Treat curated canonical items as at least HIGH quality for ranking purposes.
    return { ...base, ...quality, qualityTier: quality.qualityTier === "LOW" ? "HIGH" : quality.qualityTier };
  });
})();

const COMMON_FOODS_BY_ID = new Map<string, CanonicalFoodItem>(COMMON_FOODS.map((row) => [row.id, row]));

const GUARANTEED_COMMON_QUERY_MAP: Record<string, string[]> = {
  eggs: ["zenith-common:egg-whole", "zenith-common:egg-whites", "zenith-common:egg-scrambled"],
  egg: ["zenith-common:egg-whole", "zenith-common:egg-whites", "zenith-common:egg-scrambled"],
  beef: ["zenith-common:ground-beef-90-10", "zenith-common:ground-beef-85-15", "zenith-common:steak"],
  "ground beef": ["zenith-common:ground-beef-90-10", "zenith-common:ground-beef-85-15"],
  fruit: ["zenith-common:banana", "zenith-common:apple", "zenith-common:strawberries", "zenith-common:blueberries"],
  chicken: ["zenith-common:chicken-breast-cooked", "zenith-common:chicken-thigh-cooked"],
  rice: ["zenith-common:rice-white-cooked", "zenith-common:rice-brown-cooked"],
  oats: ["zenith-common:oats-dry", "zenith-common:oatmeal-cooked"],
  coffee: ["zenith-common:black-coffee"],
  "black coffee": ["zenith-common:black-coffee"],
  water: ["zenith-common:water"],
  milk: ["zenith-common:milk-2pct", "zenith-common:milk-whole"],
  potato: ["zenith-common:potato-baked", "zenith-common:potato-mashed"],
  bread: ["zenith-common:bread-slice", "zenith-common:bagel", "zenith-common:tortilla"],
};

const NEVER_EMPTY_COMMON_QUERIES = new Set([
  "eggs",
  "egg",
  "beef",
  "ground beef",
  "banana",
  "apple",
  "fruit",
  "chicken",
  "rice",
  "oats",
  "coffee",
  "black coffee",
  "water",
  "milk",
  "potato",
  "bread",
]);

function commonPinnedForQuery(query: string) {
  const key = normalizeCommonKey(query);
  const pinnedIds = GUARANTEED_COMMON_QUERY_MAP[key] || null;
  if (!pinnedIds) return [];
  return pinnedIds.map((id) => COMMON_FOODS_BY_ID.get(id)).filter((row): row is CanonicalFoodItem => Boolean(row));
}

function scoreCommonMatch(item: CanonicalFoodItem, query: string) {
  const q = normalizeCommonKey(query);
  if (!q) return 0;
  const candidates = [item.name, ...(Array.isArray(item.synonyms) ? item.synonyms : [])].map(normalizeCommonKey);
  if (candidates.some((row) => row === q)) return 520;
  if (candidates.some((row) => row.startsWith(q))) return 360;
  if (candidates.some((row) => row.includes(q))) return 250;
  const tokens = tokenize(q);
  if (tokens.length) {
    const tokenVariants = new Set(pluralVariants(tokens));
    const text = `${normalizeCommonKey(item.name)} ${(Array.isArray(item.synonyms) ? item.synonyms : []).map(normalizeCommonKey).join(" ")}`;
    const present = Array.from(tokenVariants).every((t) => text.includes(t));
    if (present) return 160;
  }
  // Fuzzy fallback: tolerate short misspellings in local-first search.
  const fuzzyCandidates = [item.name, ...(Array.isArray(item.synonyms) ? item.synonyms : [])];
  const fuzzyBest = fuzzyCandidates
    .map((row) => fuzzyTextMatchScore(row, q))
    .reduce((max, v) => Math.max(max, v), 0);
  if (fuzzyBest > 0) return fuzzyBest;
  return 0;
}

function commonCandidatesForQuery(query: string) {
  const pinned = commonPinnedForQuery(query);
  const scored = COMMON_FOODS.map((item) => ({ item, score: scoreCommonMatch(item, query) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((row) => row.item);
  const merged = dedupeFoods([...pinned, ...scored]);
  return merged.slice(0, 18);
}

function enforceCommonFoodGuarantees(items: CanonicalFoodItem[], query: string) {
  const key = normalizeCommonKey(query);
  const pinned = commonPinnedForQuery(query);
  const match = key ? commonCandidatesForQuery(query) : [];
  const forced = dedupeFoods([...pinned, ...match]).slice(0, 6);
  if (forced.length === 0 && NEVER_EMPTY_COMMON_QUERIES.has(key)) {
    // Last-resort: show at least something canonical even if synonyms missed.
    const fallback = commonPinnedForQuery(key);
    if (fallback.length) return fallback;
  }
  const withoutForced = items.filter((row) => !forced.some((f) => f.id === row.id));
  return [...forced, ...withoutForced];
}

export function getCommonFoodsCatalog() {
  return COMMON_FOODS.slice();
}

export function getCommonFoodsForQuery(query: string) {
  return commonCandidatesForQuery(query.trim());
}

export function getCommonFoodsQuickAdd(options?: { limit?: number; usage?: Record<string, FoodUsageStatsRow> }) {
  const limit = Math.max(6, Math.min(36, options?.limit ?? 24));
  const usage = options?.usage || {};
  const defaults = [
    "zenith-common:egg-whole",
    "zenith-common:chicken-breast-cooked",
    "zenith-common:rice-white-cooked",
    "zenith-common:oats-dry",
    "zenith-common:banana",
    "zenith-common:apple",
    "zenith-common:water",
    "zenith-common:black-coffee",
    "zenith-common:milk-2pct",
    "zenith-common:greek-yogurt",
    "zenith-common:peanut-butter",
    "zenith-common:olive-oil",
    "zenith-common:almonds",
    "zenith-common:salmon",
    "zenith-common:tuna",
    "zenith-common:broccoli",
    "zenith-common:spinach",
    "zenith-common:bread-slice",
  ]
    .map((id) => COMMON_FOODS_BY_ID.get(id))
    .filter((row): row is CanonicalFoodItem => Boolean(row));

  const personalized = Object.values(usage)
    .filter((row) => row.item)
    .map((row) => row.item as CanonicalFoodItem)
    .filter((row) => isZenithCommonFood(row))
    .sort((a, b) => (usage[b.id]?.timesUsed || 0) - (usage[a.id]?.timesUsed || 0))
    .slice(0, 16);

  return dedupeFoods([...personalized, ...defaults]).slice(0, limit);
}

function requirementSatisfied(tokens: Set<string>, requirement: TokenRequirement) {
  if (Array.isArray(requirement)) return requirement.some((token) => tokens.has(token));
  return tokens.has(requirement);
}

function intentForQuery(query: string): FoodSearchIntentSpec | null {
  const qTokens = new Set(tokenize(query));
  for (const intent of FOOD_SEARCH_INTENTS) {
    if (!intent.match.every((req) => requirementSatisfied(qTokens, req))) continue;

    const allowed = new Set<string>();
    intent.match.forEach((req) => {
      if (Array.isArray(req)) req.forEach((token) => allowed.add(token));
      else allowed.add(req);
    });
    const excluded = new Set<string>(Array.isArray(intent.excludedTokens) ? intent.excludedTokens : []);
    const extraTokens = Array.from(qTokens).filter(
      (token) => !allowed.has(token) && !excluded.has(token) && !INTENT_DESCRIPTOR_TOKENS.has(token)
    );
    if (extraTokens.length > 0) continue;

    return intent;
  }
  return null;
}

function isNonGenericBranded(item: CanonicalFoodItem) {
  const brand = sanitizeName(item.brand || "");
  return !!brand && brand !== "generic";
}

function passesIntentFilter(item: CanonicalFoodItem, queryTokens: Set<string>, intent: FoodSearchIntentSpec) {
  const nameTokens = new Set(tokenize(item.name));
  if (!intent.match.every((req) => requirementSatisfied(nameTokens, req))) return false;
  const excluded = Array.isArray(intent.excludedTokens) ? intent.excludedTokens : [];
  for (const token of excluded) {
    if (queryTokens.has(token)) continue;
    if (nameTokens.has(token)) return false;
  }
  return true;
}

function createZenithGenericItem(intent: FoodSearchIntentSpec) {
  const base: Omit<CanonicalFoodItem, "qualityTier" | "completeness"> = {
    id: canonicalId("user", `zenith-generic:${intent.key}`),
    source: "user",
    sourceId: `zenith-generic:${intent.key}`,
    name: intent.displayName,
    brand: "Generic",
    servingSizes: [{ label: "100g", grams: 100, default: true }],
    nutrientsPer100g: intent.fallbackNutrientsPer100g,
    lastVerifiedAt: new Date().toISOString(),
  };
  const quality = computeQuality(base);
  return { ...base, ...quality };
}

function pickBestGenericCandidate(items: CanonicalFoodItem[], queryTokens: Set<string>, intent: FoodSearchIntentSpec) {
  const candidates = items.filter((item) => {
    const brand = sanitizeName(item.brand || "");
    const brandOk = !brand || brand === "generic";
    if (!brandOk) return false;
    return passesIntentFilter(item, queryTokens, intent);
  });
  if (!candidates.length) return null;

  const ideal = sanitizeName(intent.displayName);
  candidates.sort((a, b) => {
    const score = (item: CanonicalFoodItem) => {
      let s = 0;
      if (item.source === "usda") s += 40;
      if (item.qualityTier === "VERIFIED") s += 30;
      const name = sanitizeName(item.name);
      if (name === ideal) s += 18;
      if (name.startsWith(ideal)) s += 10;
      s -= Math.min(item.name.length, 80) / 20;
      return s;
    };
    return score(b) - score(a);
  });

  return candidates[0] || null;
}

function pickUsualForIntent(intent: FoodSearchIntentSpec, queryTokens: Set<string>, usage: Record<string, UsageStatsRow>) {
  const candidates = Object.values(usage)
    .filter((row) => row.item && (row.timesUsed || 0) >= 3)
    .filter((row) => passesIntentFilter(row.item as CanonicalFoodItem, queryTokens, intent))
    .sort((a, b) => {
      const freqDelta = (b.timesUsed || 0) - (a.timesUsed || 0);
      if (freqDelta !== 0) return freqDelta;
      return new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime();
    });
  return (candidates[0]?.item as CanonicalFoodItem | undefined) || null;
}

function refineSearchResults(items: CanonicalFoodItem[], query: string, usage: Record<string, UsageStatsRow>) {
  const intent = intentForQuery(query);
  if (!intent) return items;
  const preferBranded = containsBrandToken(query);
  const queryTokens = new Set(tokenize(query));

  const filtered = items.filter((item) => passesIntentFilter(item, queryTokens, intent));
  const usual = pickUsualForIntent(intent, queryTokens, usage);

  const canonicalFromResults = pickBestGenericCandidate(filtered, queryTokens, intent);
  const canonical = canonicalFromResults || createZenithGenericItem(intent);

  const pinned: CanonicalFoodItem[] = [];
  if (usual && usual.id !== canonical.id) pinned.push(usual);
  pinned.push(canonical);

  const remaining = filtered.filter((item) => item.id !== canonical.id && item.id !== usual?.id);
  const unbranded: CanonicalFoodItem[] = [];
  const branded: CanonicalFoodItem[] = [];
  remaining.forEach((item) => (isNonGenericBranded(item) ? branded : unbranded).push(item));

  return preferBranded ? [...pinned, ...branded, ...unbranded] : [...pinned, ...unbranded, ...branded];
}

function isEssentialFood(item: CanonicalFoodItem) {
  const name = sanitizeName(item.name);
  const brand = sanitizeName(item.brand || "");
  if (brand && brand !== "generic") return false;
  return ESSENTIAL_TOKENS.some((token) => name.includes(token));
}

function isStapleBrandedFood(item: CanonicalFoodItem) {
  const brand = sanitizeName(item.brand || "");
  return !!brand && BRAND_TOKENS.some((token) => brand.includes(token));
}

export function classifyFoodTier(item: CanonicalFoodItem): FoodSearchTier {
  if (isEssentialFood(item)) return "ESSENTIAL";
  if (isStapleBrandedFood(item)) return "STAPLE";
  return "LONG_TAIL";
}

function qualityWeight(tier: FoodQualityTier) {
  if (tier === "VERIFIED") return 40;
  if (tier === "HIGH") return 30;
  if (tier === "MEDIUM") return 20;
  if (tier === "USER") return 15;
  return 8;
}

function tierWeight(tier: FoodSearchTier, preferBranded = false) {
  if (preferBranded) {
    if (tier === "STAPLE") return 42;
    if (tier === "ESSENTIAL") return 32;
    return 8;
  }
  if (tier === "ESSENTIAL") return 45;
  if (tier === "STAPLE") return 18;
  return 4;
}

function computeQuality(item: Omit<CanonicalFoodItem, "qualityTier" | "completeness">): {
  qualityTier: FoodQualityTier;
  completeness: CanonicalFoodItem["completeness"];
} {
  const calories = Number(item.nutrientsPer100g.caloriesKcal) || 0;
  const protein = Number(item.nutrientsPer100g.proteinG) || 0;
  const carbs = Number(item.nutrientsPer100g.carbsG) || 0;
  const fat = Number(item.nutrientsPer100g.fatG) || 0;
  const hasCalories = calories > 0;
  const hasMacros = protein + carbs + fat > 0;
  const hasServing = Array.isArray(item.servingSizes) && item.servingSizes.length > 0;

  let qualityTier: FoodQualityTier = "LOW";
  if (item.source === "usda") qualityTier = "VERIFIED";
  else if (hasCalories && hasMacros && hasServing) qualityTier = "HIGH";
  else if ((hasCalories || hasMacros) && hasServing) qualityTier = "MEDIUM";
  else if (item.source === "user") qualityTier = "USER";

  return { qualityTier, completeness: { hasCalories, hasMacros, hasServing } };
}

function canonicalId(source: FoodSource, sourceId: string, barcode?: string) {
  return barcode ? `${source}:barcode:${barcode}` : `${source}:${sourceId}`;
}

function mapOpenFoodFactsProduct(product: any): CanonicalFoodItem | null {
  const nutriments = product?.nutriments || {};
  const servingG = Number(nutriments["serving_quantity"]) || undefined;
  const servingLabel = typeof product?.serving_size === "string" ? product.serving_size : undefined;
  const servingLabelLower = String(servingLabel || "").toLowerCase();
  const servingIsMl = /\bml\b|\bcl\b|\bl\b|\bfl\s?oz\b/.test(servingLabelLower);
  const base: Omit<CanonicalFoodItem, "qualityTier" | "completeness"> = {
    id: canonicalId("off", String(product?._id || product?.id || product?.code || Date.now()), product?.code),
    source: "off",
    sourceId: String(product?._id || product?.id || product?.code || ""),
    name: String(product?.product_name || product?.generic_name || "").trim() || "Unknown product",
    brand: String(product?.brands || "").split(",")[0]?.trim() || undefined,
    barcode: typeof product?.code === "string" ? product.code : undefined,
    country: typeof product?.countries_tags?.[0] === "string" ? product.countries_tags[0] : undefined,
    locale: typeof product?.lang === "string" ? product.lang : undefined,
    kind: inferKind({ name: product?.product_name || product?.generic_name, nutritionBasis: undefined }),
    nutritionBasis: undefined,
    servingSizes: [
      { label: "100g", grams: 100, default: !servingLabel },
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
        Number(nutriments["energy-kcal_100g"]) ||
        Number(nutriments["energy-kcal"]) ||
        Math.round((Number(nutriments["energy_100g"]) || 0) / 4.184),
      proteinG: Number(nutriments["proteins_100g"]) || Number(nutriments["proteins"]) || 0,
      carbsG: Number(nutriments["carbohydrates_100g"]) || Number(nutriments["carbohydrates"]) || 0,
      fatG: Number(nutriments["fat_100g"]) || Number(nutriments["fat"]) || 0,
      fiberG: Number(nutriments["fiber_100g"]) || undefined,
      sugarG: Number(nutriments["sugars_100g"]) || undefined,
      sodiumMg: Number(nutriments["sodium_100g"]) ? Number(nutriments["sodium_100g"]) * 1000 : undefined,
    },
    imageUrls: { front: typeof product?.image_front_small_url === "string" ? product.image_front_small_url : undefined },
    lastVerifiedAt: new Date().toISOString(),
  };

  const quality = computeQuality(base);
  return { ...base, ...quality };
}

function mapUsdaFood(food: any): CanonicalFoodItem | null {
  const nutrients = Array.isArray(food?.foodNutrients) ? food.foodNutrients : [];
  const findNutrient = (name: string) => {
    const n = nutrients.find((row: any) =>
      String(row?.nutrientName || "").toLowerCase().includes(name.toLowerCase())
    );
    return Number(n?.value) || 0;
  };

  const base: Omit<CanonicalFoodItem, "qualityTier" | "completeness"> = {
    id: canonicalId("usda", String(food?.fdcId || food?.description || Date.now()), food?.gtinUpc),
    source: "usda",
    sourceId: String(food?.fdcId || ""),
    name: String(food?.description || "").trim() || "USDA food",
    brand: typeof food?.brandOwner === "string" ? food.brandOwner : undefined,
    barcode: typeof food?.gtinUpc === "string" ? food.gtinUpc : undefined,
    locale: "en",
    kind: inferKind({ name: food?.description, nutritionBasis: undefined }),
    nutritionBasis: undefined,
    categoryTags: food?.foodCategory ? [String(food.foodCategory).toLowerCase()] : [],
    servingSizes: [{ label: "100g", grams: 100, default: true }],
    nutrientsPer100g: {
      caloriesKcal: findNutrient("energy"),
      proteinG: findNutrient("protein"),
      carbsG: findNutrient("carbohydrate"),
      fatG: findNutrient("fat"),
      fiberG: findNutrient("fiber") || undefined,
      sugarG: findNutrient("sugar") || undefined,
      sodiumMg: findNutrient("sodium") || undefined,
    },
    lastVerifiedAt: new Date().toISOString(),
  };

  const quality = computeQuality(base);
  return { ...base, ...quality };
}

async function searchOpenFoodFacts(query: string, locale?: SearchLocale, pageSize = 35): Promise<CanonicalFoodItem[]> {
  const lc = encodeURIComponent(locale?.language || "en");
  const cc = encodeURIComponent(String(locale?.country || "US").toLowerCase());
  const url = `${OFF_SEARCH_URL}?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=${pageSize}&lc=${lc}&cc=${cc}`;
  const res = await fetch(url, { signal: (locale as any)?.signal });
  const data = await res.json();
  const products: unknown[] = Array.isArray(data?.products) ? data.products : [];
  const normalizedLocale = normalizeLocale(locale);
  const mapped = products
    .map((row) => {
      const product = row as any;
      const item = mapOpenFoodFactsProduct(product);
      if (!item) return null;
      const countryMatch = isOffProductCountryMatch(product, normalizedLocale);
      return { item, countryMatch };
    })
    .filter((row): row is { item: CanonicalFoodItem; countryMatch: "match" | "mismatch" | "unknown" } => Boolean(row));

  if (normalizedLocale.country !== "US") return mapped.map((row) => row.item);

  // US locale: keep US matches first, allow unknown-country items as fallback, and drop explicit non-US.
  return mapped
    .filter((row) => row.countryMatch !== "mismatch")
    .sort((a, b) => {
      const aRank = a.countryMatch === "match" ? 0 : 1;
      const bRank = b.countryMatch === "match" ? 0 : 1;
      return aRank - bRank;
    })
    .map((row) => row.item);
}

async function searchUsda(query: string, pageSize = 20, signal?: AbortSignal): Promise<CanonicalFoodItem[]> {
  const apiKey =
    (Constants.expoConfig?.extra as any)?.USDA_API_KEY ||
    process.env.EXPO_PUBLIC_USDA_API_KEY;
  if (!apiKey) return [];

  const url = `${USDA_SEARCH_URL}?query=${encodeURIComponent(query)}&pageSize=${pageSize}&api_key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { signal });
  const data = await res.json();
  const foods: unknown[] = Array.isArray(data?.foods) ? data.foods : [];
  return foods
    .map((row) => mapUsdaFood(row as any))
    .filter((item: CanonicalFoodItem | null): item is CanonicalFoodItem => Boolean(item));
}

function safeCanonicalFoodItem(raw: any): CanonicalFoodItem | null {
  const item = raw as Partial<CanonicalFoodItem> | null | undefined;
  if (!item || typeof item !== "object") return null;
  const name = String(item.name || "").trim();
  if (!name) return null;

  const source: FoodSource = item.source === "off" || item.source === "usda" || item.source === "user" ? item.source : "off";
  const sourceId = String(item.sourceId || item.id || name).trim();
  if (!sourceId) return null;

  const servingSizes = Array.isArray(item.servingSizes)
    ? item.servingSizes
        .map((row: any) => ({
          label: String(row?.label || "").trim(),
          grams: typeof row?.grams === "number" ? row.grams : undefined,
          ml: typeof row?.ml === "number" ? row.ml : undefined,
          default: Boolean(row?.default),
          estimated: Boolean(row?.estimated),
        }))
        .filter((row) => row.label.length > 0 && ((typeof row.grams === "number" && row.grams > 0) || (typeof row.ml === "number" && row.ml > 0)))
    : [];

  const fallbackKind = inferKind({ name });
  const kind = item.kind === "drink" || item.kind === "food" ? item.kind : fallbackKind;
  const baselineServing = kind === "drink" ? { label: "100ml", ml: 100, default: true } : { label: "100g", grams: 100, default: true };
  const nutrients = item.nutrientsPer100g || ({} as any);
  const base: Omit<CanonicalFoodItem, "qualityTier" | "completeness"> = {
    id: String(item.id || canonicalId(source, sourceId, item.barcode)),
    source,
    sourceId,
    name,
    brand: typeof item.brand === "string" && item.brand.trim() ? item.brand.trim() : undefined,
    barcode: typeof item.barcode === "string" && item.barcode.trim() ? item.barcode.trim() : undefined,
    country: typeof item.country === "string" && item.country.trim() ? item.country.trim() : undefined,
    locale: typeof item.locale === "string" && item.locale.trim() ? item.locale.trim() : undefined,
    kind,
    nutritionBasis: kind === "drink" ? "per100ml" : "per100g",
    synonyms: Array.isArray(item.synonyms) ? item.synonyms.map((v) => String(v || "").trim()).filter(Boolean) : [],
    categoryTags: Array.isArray(item.categoryTags) ? item.categoryTags.map((v) => String(v || "").trim()).filter(Boolean) : [],
    defaultUnitPolicy: item.defaultUnitPolicy === "serving_first" || item.defaultUnitPolicy === "weight_first" ? item.defaultUnitPolicy : undefined,
    servingSizes: servingSizes.length > 0 ? servingSizes : [baselineServing as FoodServing],
    nutrientsPer100g: {
      caloriesKcal: Number((nutrients as any).caloriesKcal) || 0,
      proteinG: Number((nutrients as any).proteinG) || 0,
      carbsG: Number((nutrients as any).carbsG) || 0,
      fatG: Number((nutrients as any).fatG) || 0,
      fiberG: typeof (nutrients as any).fiberG === "number" ? (nutrients as any).fiberG : undefined,
      sugarG: typeof (nutrients as any).sugarG === "number" ? (nutrients as any).sugarG : undefined,
      sodiumMg: typeof (nutrients as any).sodiumMg === "number" ? (nutrients as any).sodiumMg : undefined,
    },
    imageUrls: typeof item.imageUrls?.front === "string" && item.imageUrls.front ? { front: item.imageUrls.front } : undefined,
    lastVerifiedAt: typeof item.lastVerifiedAt === "string" && item.lastVerifiedAt ? item.lastVerifiedAt : new Date().toISOString(),
  };
  const quality = computeQuality(base);
  return { ...base, ...quality };
}

async function searchCloudFoods(query: string, locale: SearchLocale, signal?: AbortSignal, timeoutMs = FOOD_SEARCH_CLOUD_TIMEOUT_MS) {
  if (!isSupabaseConfigured) return [];
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const invokePromise = supabase.functions.invoke("food-search", {
    body: {
      query,
      locale: {
        country: locale.country,
        admin: locale.admin,
        language: locale.language,
      },
      limit: 40,
    },
  });

  const timeoutPromise = new Promise<{ data: null; error: Error }>((resolve) => {
    const timer = setTimeout(() => {
      clearTimeout(timer);
      resolve({ data: null, error: new Error("cloud_search_timeout") });
    }, Math.max(300, timeoutMs));
  });

  const result = await Promise.race([invokePromise, timeoutPromise]);
  if (!result || (result as any).error) return [];

  const payload: any = (result as any).data;
  const rawItems = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload) ? payload : [];
  const items = rawItems.map((row: any) => safeCanonicalFoodItem(row)).filter((row: CanonicalFoodItem | null): row is CanonicalFoodItem => Boolean(row));
  return dedupeFoods(items);
}

function dedupeFoods(items: CanonicalFoodItem[]) {
  const map = new Map<string, CanonicalFoodItem>();
  for (const item of items) {
    const key = item.barcode
      ? `barcode:${item.barcode}`
      : `name:${sanitizeName(item.name)}|brand:${sanitizeName(item.brand || "")}|cal:${Math.round(item.nutrientsPer100g.caloriesKcal || 0)}|p:${Math.round(item.nutrientsPer100g.proteinG || 0)}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, item);
      continue;
    }
    if (qualityWeight(item.qualityTier) > qualityWeight(existing.qualityTier)) {
      map.set(key, item);
    }
  }
  return Array.from(map.values());
}

async function getUsageStatsMap() {
  if (usageStatsCache && Date.now() - usageStatsCache.cachedAt < SEARCH_CACHE_TTL_MS) {
    return usageStatsCache.data;
  }
  const raw = await AsyncStorage.getItem(FOOD_USAGE_STATS_KEY);
  const parsed = safeParse<Record<string, UsageStatsRow>>(raw, {});
  usageStatsCache = { data: parsed, cachedAt: Date.now() };
  return parsed;
}

function reliabilityPenalty(item: CanonicalFoodItem) {
  let penalty = 0;
  const macros = item.nutrientsPer100g;
  const kcalPer100g = Number(macros.caloriesKcal) || 0;
  const gramsServing = Number(item.servingSizes?.[0]?.grams) || 0;
  if (!(Number(item.nutrientsPer100g.proteinG) || Number(item.nutrientsPer100g.carbsG) || Number(item.nutrientsPer100g.fatG))) penalty += 14;
  if (kcalPer100g > 900 || kcalPer100g < 0) penalty += 24;
  if (kcalPer100g > 0 && kcalPer100g < 20 && !isEssentialFood(item)) penalty += 10;
  if (gramsServing && (gramsServing > 1200 || gramsServing < 1)) penalty += 10;
  if ((item.name || "").length > 70) penalty += 8;
  return penalty;
}

function isAbortError(err: any) {
  const name = String(err?.name || "");
  return name === "AbortError" || name === "DOMException";
}

function normalizeBrandKey(input: string) {
  return sanitizeName(input).replace(/\s+/g, " ").trim();
}

const US_REGIONAL_BRANDS: Record<string, string[]> = {
  // These do not inject results. They only bias ranking *if* the brand already exists in the dataset.
  NORTHEAST: ["dunkin", "wawa", "wegmans", "sheetz", "stew leonard", "cumberland farms"],
  MIDWEST: ["culver", "casey", "meijer", "hy vee", "kwik trip", "menards"],
  SOUTH: ["whataburger", "publix", "bojangles", "cook out", "cookout", "h e b", "heb", "waffle house", "zaxby"],
  WEST: ["in n out", "in-n-out", "dutch bros", "dutch bros.", "winco", "stater bros", "safeway"],
};

const US_STATE_TO_REGION: Record<string, keyof typeof US_REGIONAL_BRANDS> = {
  // Northeast
  CT: "NORTHEAST", DE: "NORTHEAST", MA: "NORTHEAST", MD: "NORTHEAST", ME: "NORTHEAST",
  NH: "NORTHEAST", NJ: "NORTHEAST", NY: "NORTHEAST", PA: "NORTHEAST", RI: "NORTHEAST",
  VT: "NORTHEAST", DC: "NORTHEAST",
  // Midwest
  IA: "MIDWEST", IL: "MIDWEST", IN: "MIDWEST", KS: "MIDWEST", MI: "MIDWEST", MN: "MIDWEST",
  MO: "MIDWEST", ND: "MIDWEST", NE: "MIDWEST", OH: "MIDWEST", SD: "MIDWEST", WI: "MIDWEST",
  // South
  AL: "SOUTH", AR: "SOUTH", FL: "SOUTH", GA: "SOUTH", KY: "SOUTH", LA: "SOUTH", MS: "SOUTH",
  NC: "SOUTH", OK: "SOUTH", SC: "SOUTH", TN: "SOUTH", TX: "SOUTH", VA: "SOUTH", WV: "SOUTH",
  // West
  AK: "WEST", AZ: "WEST", CA: "WEST", CO: "WEST", HI: "WEST", ID: "WEST", MT: "WEST", NM: "WEST",
  NV: "WEST", OR: "WEST", UT: "WEST", WA: "WEST", WY: "WEST",
};

const US_NATIONAL_BRANDS = [
  "costco",
  "kroger",
  "walmart",
  "target",
  "trader joe",
  "whole foods",
  "aldi",
  "safeway",
  "cvs",
  "walgreens",
  "mcdonald",
  "starbucks",
  "chick fil a",
  "chipotle",
];

function resolveUsRegion(admin: string) {
  const normalized = String(admin || "").trim().toUpperCase();
  if (!normalized) return "";
  if (US_REGIONAL_BRANDS[normalized]) return normalized;
  return US_STATE_TO_REGION[normalized] || "";
}

function regionalBrandBoost(item: CanonicalFoodItem, locale: SearchLocale | undefined, preferBranded: boolean) {
  const normalized = normalizeLocale(locale);
  if (normalized.country !== "US") return 0;
  const region = resolveUsRegion(String(normalized.admin || ""));
  if (!region) return 0;
  const candidates = US_REGIONAL_BRANDS[region];
  if (!candidates || candidates.length === 0) return 0;
  const brandKey = normalizeBrandKey(item.brand || "");
  if (!brandKey) return 0;
  const hit = candidates.some((token) => brandKey.includes(normalizeBrandKey(token)));
  if (!hit) return 0;
  // Prefer stronger bias when the user is explicitly searching branded items.
  return preferBranded ? 28 : 12;
}

function nationalUsBrandBoost(item: CanonicalFoodItem, locale: SearchLocale | undefined, preferBranded: boolean) {
  const normalized = normalizeLocale(locale);
  if (normalized.country !== "US") return 0;
  const brandKey = normalizeBrandKey(item.brand || "");
  if (!brandKey) return 0;
  const hit = US_NATIONAL_BRANDS.some((token) => brandKey.includes(normalizeBrandKey(token)));
  if (!hit) return 0;
  return preferBranded ? 10 : 4;
}

function scoreSearchResult(item: CanonicalFoodItem, query: string, usage?: UsageStatsRow, recencyBoost = 0, locale?: SearchLocale) {
  const queryRaw = normalizeText(query);
  const q = sanitizeName(query);
  const name = sanitizeName(item.name);
  const brand = sanitizeName(item.brand || "");
  const preferBranded = containsBrandToken(queryRaw);
  const tier = classifyFoodTier(item);
  let score = 0;
  if (item.barcode === queryRaw) score += 200;
  if (name === q) score += 140;
  if (name.startsWith(q)) score += 95;
  if (name.includes(q)) score += 60;
  if (brand.startsWith(q) || brand.includes(q)) score += preferBranded ? 35 : 10;
  if (isZenithCommonFood(item)) score += 200;
  score += scoreCommonMatch(item, query);
  score += qualityWeight(item.qualityTier);
  score += tierWeight(tier, preferBranded);
  score += regionalBrandBoost(item, locale, preferBranded);
  score += nationalUsBrandBoost(item, locale, preferBranded);
  score += recencyBoost;
  score -= reliabilityPenalty(item);
  score -= localeCountryPenalty(item, locale);
  if (!preferBranded && isNonGenericBranded(item)) score -= 12;
  if (usage) {
    score += Math.min(usage.timesUsed * 8, 80);
    const ageHours = Math.max(0, (Date.now() - new Date(usage.lastUsedAt).getTime()) / (1000 * 60 * 60));
    score += clamp(36 - ageHours, 0, 36);
  }
  return score;
}

export async function getFoodRecents() {
  const raw = await AsyncStorage.getItem(FOOD_RECENTS_KEY);
  return safeParse<CanonicalFoodItem[]>(raw, []);
}

export async function getFoodFavorites() {
  const raw = await AsyncStorage.getItem(FOOD_FAVORITES_KEY);
  return safeParse<CanonicalFoodItem[]>(raw, []);
}

export async function toggleFavoriteFood(item: CanonicalFoodItem) {
  const favorites = await getFoodFavorites();
  const exists = favorites.some((row) => row.id === item.id);
  const next = exists ? favorites.filter((row) => row.id !== item.id) : [item, ...favorites].slice(0, MAX_FAVORITES);
  await AsyncStorage.setItem(FOOD_FAVORITES_KEY, JSON.stringify(next));
  return !exists;
}

export async function rememberRecentFood(item: CanonicalFoodItem) {
  const recents = await getFoodRecents();
  const next = [item, ...recents.filter((row) => row.id !== item.id)].slice(0, MAX_RECENTS);
  await AsyncStorage.setItem(FOOD_RECENTS_KEY, JSON.stringify(next));
}

async function readPersistentSearchCache() {
  const raw = await AsyncStorage.getItem(PERSISTENT_SEARCH_CACHE_KEY);
  const parsed = safeParse<PersistentSearchCacheEntry[]>(raw, []);
  const now = Date.now();
  return (Array.isArray(parsed) ? parsed : []).filter((row) => {
    const cachedAtMs = Date.parse(row.cachedAt || "");
    if (!Number.isFinite(cachedAtMs)) return false;
    return now - cachedAtMs < SEARCH_CACHE_TTL_MS;
  });
}

async function writePersistentSearchCache(entries: PersistentSearchCacheEntry[]) {
  await AsyncStorage.setItem(PERSISTENT_SEARCH_CACHE_KEY, JSON.stringify(entries.slice(0, 200)));
}

async function upsertPersistentSearchEntry(entry: PersistentSearchCacheEntry) {
  const regionKey = persistentRegionKey(entry.region);
  const normalizedQuery = normalizeText(entry.query);

  const existing = await readPersistentSearchCache();
  const next: PersistentSearchCacheEntry[] = [
    entry,
    ...existing.filter((row) => {
      const rowRegionKey = persistentRegionKey(row.region);
      if (rowRegionKey !== regionKey) return true;
      return normalizeText(row.query) !== normalizedQuery;
    }),
  ];

  // Enforce last 20 queries per region.
  const regionBuckets = new Map<string, PersistentSearchCacheEntry[]>();
  for (const row of next) {
    const key = persistentRegionKey(row.region);
    const bucket = regionBuckets.get(key) || [];
    bucket.push(row);
    regionBuckets.set(key, bucket);
  }
  const flattened: PersistentSearchCacheEntry[] = [];
  for (const [key, bucket] of regionBuckets.entries()) {
    const limited = bucket.slice(0, MAX_PERSISTENT_QUERIES_PER_REGION);
    limited.forEach((row) => flattened.push(row));
  }

  // Keep deterministic order: newest first.
  flattened.sort((a, b) => Date.parse(b.cachedAt) - Date.parse(a.cachedAt));
  await writePersistentSearchCache(flattened);
}

export async function hydratePersistentFoodSearchCache(locale?: SearchLocale) {
  if (persistentHydrated) return;
  persistentHydrated = true;
  const rows = await readPersistentSearchCache();
  rows.forEach((row) => {
    const normalized = normalizeLocale(row.region);
    const cacheKey = `${normalizeText(row.query)}|${normalizeText(normalized.language)}|${normalizeText(normalized.country)}|${normalizeText(normalized.admin || "")}`;
    searchCache.set(cacheKey, { items: Array.isArray(row.results) ? row.results : [], cachedAt: Date.parse(row.cachedAt) || Date.now() });
  });
}

export async function searchFoods(query: string, locale?: SearchLocale, options?: { signal?: AbortSignal }) {
  const startedAt = Date.now();
  const trimmed = query.trim();
  await hydratePersistentFoodSearchCache(locale);
  const usage = await getUsageStatsMap();
  if (!trimmed) {
    const [recents, favorites] = await Promise.all([getFoodRecents(), getFoodFavorites()]);
    const essentialPool = dedupeFoods(
      ESSENTIAL_TOKENS.slice(0, 12).flatMap((seed) => getCachedSearchFoods(seed, locale).slice(0, 2))
    );
    const usageRanked = Object.values(usage)
      .filter((row) => row.item)
      .sort((a, b) => {
        const freqDelta = (b.timesUsed || 0) - (a.timesUsed || 0);
        if (freqDelta !== 0) return freqDelta;
        return new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime();
      })
      .slice(0, 40)
      .map((row) => row.item as CanonicalFoodItem);

    const pool = enforceLocaleCountryScope(
      dedupeFoods([...getCommonFoodsQuickAdd({ usage }), ...usageRanked, ...recents, ...essentialPool, ...favorites]),
      locale
    );
    const results = pool
      .map((item, index) => {
        const row = usage[item.id];
        const tier = classifyFoodTier(item);
        const favoriteBoost = favorites.some((f) => f.id === item.id) ? 55 : 0;
        const recencyBoost = Math.max(0, 40 - index);
        const score =
          (row ? row.timesUsed * 16 : 0) +
          favoriteBoost +
          recencyBoost +
          qualityWeight(item.qualityTier) +
          tierWeight(tier, false) -
          reliabilityPenalty(item);
        return { item, score };
      })
      .sort((a, b) => b.score - a.score)
      .map((row) => row.item)
      .slice(0, 60);

    void recordFoodSearchPerf({
      query: "",
      region: normalizeLocale(locale),
      source: "discover",
      durationMs: Date.now() - startedAt,
      resultCount: results.length,
      recordedAt: new Date().toISOString(),
    });
    return results;
  }
  const normalizedLocale = normalizeLocale(locale);
  const cacheKey = `${normalizeText(trimmed)}|${normalizeText(normalizedLocale.language)}|${normalizeText(normalizedLocale.country)}|${normalizeText(normalizedLocale.admin || "")}`;
  const now = Date.now();
  const cached = searchCache.get(cacheKey);
  if (cached && now - cached.cachedAt < SEARCH_CACHE_TTL_MS) {
    const scopedCached = enforceLocaleCountryScope(cached.items, normalizedLocale);
    void recordFoodSearchPerf({
      query: trimmed,
      region: normalizedLocale,
      source: "cache",
      durationMs: Date.now() - startedAt,
      resultCount: scopedCached.length,
      recordedAt: new Date().toISOString(),
    });
    return scopedCached;
  }

  const pending = inFlightSearch.get(cacheKey);
  if (pending) {
    return pending;
  }

  const run = (async () => {
    const [recents, favorites] = await Promise.all([getFoodRecents(), getFoodFavorites()]);
    const cloud = await searchCloudFoods(trimmed, normalizedLocale, options?.signal, FOOD_SEARCH_CLOUD_TIMEOUT_MS);
    if (options?.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    const commonMatches = commonCandidatesForQuery(trimmed);
    let merged: CanonicalFoodItem[] = [];
    let perfSource: "cloud" | "remote" = "cloud";
    if (cloud.length > 0) {
      merged = dedupeFoods([...commonMatches, ...cloud]);
    } else {
      perfSource = "remote";
      const [off, usda] = await Promise.allSettled([
        searchOpenFoodFacts(trimmed, { ...(locale || {}), signal: options?.signal } as any),
        searchUsda(trimmed, 20, options?.signal),
      ]);
      merged = dedupeFoods([
        ...commonMatches,
        ...(off.status === "fulfilled" ? off.value : []),
        ...(usda.status === "fulfilled" ? usda.value : []),
      ]);
    }

    const scopedMerged = enforceLocaleCountryScope(merged, normalizedLocale);
    const ranked = scopedMerged
      .map((item, index) => {
        const usageRow = usage[item.id];
        const favoriteBoost = favorites.some((row) => row.id === item.id) ? 18 : 0;
        const recentIndex = recents.findIndex((row) => row.id === item.id);
        const recencyBoost = recentIndex >= 0 ? Math.max(0, 16 - recentIndex) : Math.max(0, 6 - index / 5);
        return { item, score: scoreSearchResult(item, trimmed, usageRow, favoriteBoost + recencyBoost, locale) };
      })
      .sort((a, b) => b.score - a.score)
      .map((row) => row.item);

    const refined = enforceLocaleCountryScope(
      enforceCommonFoodGuarantees(refineSearchResults(ranked, trimmed, usage), trimmed),
      normalizedLocale
    );

    searchCache.set(cacheKey, { items: refined, cachedAt: Date.now() });
    await upsertPersistentSearchEntry({
      query: trimmed,
      region: { country: normalizedLocale.country, admin: normalizedLocale.admin, language: normalizedLocale.language },
      results: refined.slice(0, 30),
      cachedAt: new Date().toISOString(),
    });
    if (searchCache.size > MAX_SEARCH_CACHE) {
      const oldest = Array.from(searchCache.entries()).sort((a, b) => a[1].cachedAt - b[1].cachedAt);
      oldest.slice(0, searchCache.size - MAX_SEARCH_CACHE).forEach(([key]) => searchCache.delete(key));
    }
    void recordFoodSearchPerf({
      query: trimmed,
      region: normalizedLocale,
      source: perfSource,
      durationMs: Date.now() - startedAt,
      resultCount: refined.length,
      recordedAt: new Date().toISOString(),
    });
    return refined;
  })();

  inFlightSearch.set(cacheKey, run);
  try {
    return await run;
  } finally {
    inFlightSearch.delete(cacheKey);
  }
}

export function getFoodResultTags(
  item: CanonicalFoodItem,
  options: { isUsual?: boolean; isFrequent?: boolean; isRecent?: boolean }
) {
  const tags: FoodResultTag[] = [];
  if (options.isUsual) tags.push("Your usual");
  if (classifyFoodTier(item) === "ESSENTIAL") tags.push("Essential");
  if (options.isFrequent) tags.push("Frequent");
  if (options.isRecent) tags.push("Recent");
  if (item.qualityTier === "VERIFIED") tags.push("Verified");
  return tags;
}

export function filterFoodsForQuery(items: CanonicalFoodItem[], query: string) {
  const trimmed = query.trim();
  if (!trimmed) return items;
  const intent = intentForQuery(trimmed);
  if (!intent) return items;
  const queryTokens = new Set(tokenize(trimmed));
  return items.filter((item) => passesIntentFilter(item, queryTokens, intent));
}

export function rankLocalFoodsForQuery(
  pool: CanonicalFoodItem[],
  query: string,
  usage: Record<string, FoodUsageStatsRow>,
  options?: { limit?: number }
) {
  const trimmed = query.trim();
  const limit = Math.max(5, Math.min(50, options?.limit ?? 25));
  if (!trimmed) return dedupeFoods(pool).slice(0, limit);

  const queryRaw = normalizeText(trimmed);
  const q = sanitizeName(trimmed);
  const preferBranded = containsBrandToken(queryRaw);
  const scored = dedupeFoods(pool)
    .map((item, index) => {
      const name = sanitizeName(item.name);
      const brand = sanitizeName(item.brand || "");
      let relevance = 0;
      if (item.barcode && item.barcode === queryRaw) relevance += 200;
      if (name === q) relevance += 140;
      if (name.startsWith(q)) relevance += 95;
      if (name.includes(q)) relevance += 60;
      if (brand.startsWith(q) || brand.includes(q)) relevance += preferBranded ? 35 : 10;
      relevance += scoreCommonMatch(item, trimmed);
      if (relevance <= 0) return null;

      const usageRow = usage[item.id];
      const tier = classifyFoodTier(item);
      const recencyBoost = Math.max(0, 10 - index / 5);
      const ageHours = usageRow ? Math.max(0, (Date.now() - new Date(usageRow.lastUsedAt).getTime()) / (1000 * 60 * 60)) : 1e9;
      const score =
        relevance +
        qualityWeight(item.qualityTier) +
        tierWeight(tier, preferBranded) +
        recencyBoost -
        reliabilityPenalty(item) +
        (usageRow ? Math.min(usageRow.timesUsed * 8, 80) : 0) +
        (usageRow ? clamp(36 - ageHours, 0, 36) : 0) -
        (!preferBranded && isNonGenericBranded(item) ? 12 : 0);
      return { item, score };
    })
    .filter((row): row is { item: CanonicalFoodItem; score: number } => Boolean(row))
    .sort((a, b) => b.score - a.score)
    .map((row) => row.item)
    .slice(0, limit);

  return scored;
}

export type ParsedFoodPhrasePart = {
  raw: string;
  query: string;
  quantity?: number;
  unitHint?: string;
};

const PHRASE_SPLIT_RE = /\s*(?:,|&|\+|\band\b|\bwith\b)\s*/i;
const UNIT_HINTS = new Set([
  "g",
  "gram",
  "grams",
  "kg",
  "oz",
  "lb",
  "ml",
  "l",
  "cup",
  "cups",
  "tbsp",
  "tsp",
  "slice",
  "slices",
  "serving",
  "servings",
]);

export function parseFoodPhrase(input: string): ParsedFoodPhrasePart[] {
  const raw = String(input || "").trim();
  if (!raw) return [];
  const parts = raw
    .split(PHRASE_SPLIT_RE)
    .map((p) => String(p || "").trim())
    .filter(Boolean)
    .slice(0, 6);
  if (parts.length < 2) return [];

  const parsed: ParsedFoodPhrasePart[] = [];
  for (const partRaw of parts) {
    const m = partRaw.match(/^\s*(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?\s*(.*)$/);
    if (!m) continue;
    const qty = Number(m[1]);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const maybeUnit = String(m[2] || "").trim().toLowerCase();
    const rest = String(m[3] || "").trim();

    if (!maybeUnit) {
      if (rest.length < 2) continue;
      parsed.push({ raw: partRaw, query: rest, quantity: qty });
      continue;
    }

    if (UNIT_HINTS.has(maybeUnit)) {
      const q = rest.length >= 2 ? rest : partRaw.replace(m[1], "").trim();
      if (q.length < 2) continue;
      parsed.push({ raw: partRaw, query: q, quantity: qty, unitHint: maybeUnit });
      continue;
    }

    const q = `${maybeUnit} ${rest}`.trim();
    if (q.length < 2) continue;
    parsed.push({ raw: partRaw, query: q, quantity: qty });
  }

  return parsed.slice(0, 5);
}

export function getCachedSearchFoods(query: string, locale?: SearchLocale) {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const normalizedLocale = normalizeLocale(locale);
  const cacheKey = `${normalizeText(trimmed)}|${normalizeText(normalizedLocale.language)}|${normalizeText(normalizedLocale.country)}|${normalizeText(normalizedLocale.admin || "")}`;
  const exact = searchCache.get(cacheKey);
  if (exact && Date.now() - exact.cachedAt < SEARCH_CACHE_TTL_MS) {
    return enforceLocaleCountryScope(exact.items, normalizedLocale);
  }

  // Prefix fallback: if we cached a longer query, filter it for immediate perceived speed.
  const prefix = `${normalizeText(trimmed)}|`;
  const candidates = Array.from(searchCache.entries())
    .filter(([key, row]) => Date.now() - row.cachedAt < SEARCH_CACHE_TTL_MS && key.startsWith(prefix))
    .sort((a, b) => b[1].cachedAt - a[1].cachedAt);

  if (!candidates.length) return [];
  const q = sanitizeName(trimmed);
  if (!q) return [];
  const source = candidates[0][1].items;
  return enforceLocaleCountryScope(source, normalizedLocale).filter((item) => {
    const name = sanitizeName(item.name);
    const brand = sanitizeName(item.brand || "");
    return name.includes(q) || brand.includes(q);
  });
}

export async function getFoodUsageStats() {
  return await getUsageStatsMap();
}

export async function prewarmFoodSearchCache(locale?: SearchLocale) {
  // Battery-safe prewarm: small bounded set, max once per session window.
  if (Date.now() - lastPrewarmAt < 20 * 60 * 1000) return;
  lastPrewarmAt = Date.now();
  await hydratePersistentFoodSearchCache(locale);
  const seeds = ["chicken", "egg", "banana", "rice", "protein"];
  await Promise.allSettled(seeds.map((q) => searchFoods(q, locale)));
}

export async function lookupFoodBarcode(barcode: string) {
  const normalized = barcode.trim();
  if (!normalized) return null;

  const rawCache = await AsyncStorage.getItem(BARCODE_CACHE_KEY);
  const cache = safeParse<Record<string, BarcodeCacheRow>>(rawCache, {});
  if (cache[normalized]?.item) return cache[normalized].item;

  let candidate: CanonicalFoodItem | null = null;
  try {
    const res = await fetch(`${OFF_BARCODE_URL}/${encodeURIComponent(normalized)}.json`);
    const data = await res.json();
    if (data?.status === 1 && data?.product) {
      candidate = mapOpenFoodFactsProduct(data.product);
    }
  } catch {}

  if (!candidate) {
    const usda = await searchUsda(normalized, 5);
    candidate = usda.find((item) => item.barcode === normalized) || usda[0] || null;
  }

  if (candidate) {
    const nextCache = {
      ...cache,
      [normalized]: {
        item: candidate,
        cachedAt: new Date().toISOString(),
      },
    };

    const keys = Object.keys(nextCache);
    if (keys.length > MAX_BARCODE_CACHE) {
      keys
        .sort((a, b) => new Date(nextCache[a].cachedAt).getTime() - new Date(nextCache[b].cachedAt).getTime())
        .slice(0, keys.length - MAX_BARCODE_CACHE)
        .forEach((key) => {
          delete nextCache[key];
        });
    }
    await AsyncStorage.setItem(BARCODE_CACHE_KEY, JSON.stringify(nextCache));
  }

  return candidate;
}

export function servingToGrams(item: CanonicalFoodItem, servingLabel: string, quantity: number) {
  const kind = inferKind(item);
  const unitKey = normalizeUnitKeyFromLabel(item, servingLabel);
  const canonical = convertToCanonical({ kind, unit: unitKey, amount: quantity, servingSizes: getEffectiveServingSizes(item) });
  if (!canonical) return 0;
  if (canonical.unit !== "g") return 0;
  return Math.max(0, canonical.amount);
}

export function computeMacrosForGrams(item: CanonicalFoodItem, grams: number) {
  const kind = inferKind(item);
  const basis = item.nutritionBasis || (kind === "drink" ? "per100ml" : "per100g");
  const canonicalUnit: CanonicalUnit = basis === "per100ml" ? "ml" : "g";
  const canonicalAmount = canonicalUnit === "g" ? Math.max(0, grams) : 0;
  const ratio = canonicalUnit === "g" ? canonicalAmount / 100 : 0;
  const protein = roundTo((item.nutrientsPer100g.proteinG || 0) * ratio, 1);
  const carbs = roundTo((item.nutrientsPer100g.carbsG || 0) * ratio, 1);
  const fat = roundTo((item.nutrientsPer100g.fatG || 0) * ratio, 1);
  const caloriesFromLabel = Math.round((item.nutrientsPer100g.caloriesKcal || 0) * ratio);
  const normalized = normalizeCaloriesFromMacros({
    calories: caloriesFromLabel,
    protein,
    carbs,
    fat,
    qualityTier: item.qualityTier,
  });
  const calories = normalized.calories;
  return { calories, protein, carbs, fat };
}

export function normalizeUnitKeyFromLabel(item: CanonicalFoodItem, label: string): UnitKey {
  const raw = String(label || "").trim();
  const normalized = raw.toLowerCase();
  const baseUnits: UnitKey[] = ["g", "oz", "lb", "ml", "fl oz", "L", "cup", "tbsp", "tsp"];

  // Handle common variants like "floz" -> "fl oz"
  if (normalized === "floz" || normalized === "fl_oz" || normalized === "fl-oz") return "fl oz";
  if (normalized === "l") return "L";

  const direct = baseUnits.find((u) => u.toLowerCase() === normalized);
  if (direct) return direct;

  // Legacy/serving labels (including "100g", "1 large egg", etc.)
  const serving = getEffectiveServingSizes(item).find((row) => String(row.label).trim() === raw);
  if (serving) return `serving:${String(serving.label).trim()}`;
  return `serving:${raw}`;
}

export function getDefaultUnitPolicy(item: CanonicalFoodItem): DefaultUnitPolicy {
  const kind = inferKind(item);
  return getDefaultUnitPolicyForItem({
    kind,
    name: item.name || '',
    categoryTags: item.categoryTags,
    defaultUnitPolicy: item.defaultUnitPolicy,
  });
}

export function isServingFirstFoodItem(item: CanonicalFoodItem) {
  const kind = inferKind(item);
  if (kind !== 'food') return false;
  return getDefaultUnitPolicy(item) === 'serving_first';
}

function getEffectiveServingSizes(item: CanonicalFoodItem): FoodServing[] {
  const kind = inferKind(item);
  return getEffectiveServingSizesForItem({
    kind,
    name: item.name || '',
    categoryTags: item.categoryTags,
    defaultUnitPolicy: item.defaultUnitPolicy,
    servingSizes: item.servingSizes,
  }) as FoodServing[];
}

export function getFoodUnitSelection(item: CanonicalFoodItem, units: UnitsPreference): FoodUnitSelection {
  const kind = inferKind(item);
  const base = getBaseUnitOptions(kind, units);
  const policy = getDefaultUnitPolicy(item);
  const servingSizes = getEffectiveServingSizes(item);
  const servings = getServingUnitOptions({ kind, servingSizes });
  const options: UnitOption[] = kind === 'food' && policy === 'serving_first' ? [...servings, ...base] : [...base, ...servings];

  const defaultKey = defaultUnitForKind(kind, units);
  const defaultServing = servingSizes.find((row) => row.default && ((kind === "food" && row.grams) || (kind === "drink" && row.ml)));
  const firstServing = servings[0]?.key;
  const defaultServingKey = defaultServing ? (`serving:${defaultServing.label}` as UnitKey) : (firstServing as UnitKey | undefined);
  const defaultUnitKey: UnitKey =
    kind === "drink"
      ? defaultKey
      : policy === 'serving_first'
        ? (defaultServingKey || (`serving:${servingSizes[0]?.label || '100g'}` as UnitKey) || defaultKey)
        : defaultServing
          ? (`serving:${defaultServing.label}` as UnitKey)
          : defaultKey;

  return {
    unitKey: defaultUnitKey,
    defaultUnitKey,
    label: item.name,
    kind,
    options,
  };
}

export function convertSelectionToCanonical(item: CanonicalFoodItem, unitKey: UnitKey, amount: number) {
  const kind = inferKind(item);
  const result = convertToCanonical({ kind, unit: unitKey, amount, servingSizes: getEffectiveServingSizes(item) });
  if (!result) return null;
  return { ...result, kind };
}

export function computeMacrosForCanonical(item: CanonicalFoodItem, canonical: { unit: CanonicalUnit; amount: number }) {
  const kind = inferKind(item);
  const basis = item.nutritionBasis || (kind === "drink" ? "per100ml" : "per100g");
  if (basis === "per100ml") {
    if (canonical.unit !== "ml") return { calories: 0, protein: 0, carbs: 0, fat: 0 };
    const ratio = Math.max(0, canonical.amount) / 100;
    const protein = roundTo((item.nutrientsPer100g.proteinG || 0) * ratio, 1);
    const carbs = roundTo((item.nutrientsPer100g.carbsG || 0) * ratio, 1);
    const fat = roundTo((item.nutrientsPer100g.fatG || 0) * ratio, 1);
    const fiber = typeof item.nutrientsPer100g.fiberG === "number" ? roundTo(item.nutrientsPer100g.fiberG * ratio, 1) : undefined;
    const sugar = typeof item.nutrientsPer100g.sugarG === "number" ? roundTo(item.nutrientsPer100g.sugarG * ratio, 1) : undefined;
    const sodiumMg = typeof item.nutrientsPer100g.sodiumMg === "number" ? Math.round(item.nutrientsPer100g.sodiumMg * ratio) : undefined;
    const caloriesFromLabel = Math.round((item.nutrientsPer100g.caloriesKcal || 0) * ratio);
    const normalized = normalizeCaloriesFromMacros({ calories: caloriesFromLabel, protein, carbs, fat, qualityTier: item.qualityTier });
    return { calories: normalized.calories, protein, carbs, fat, fiber, sugar, sodiumMg };
  }

  if (canonical.unit !== "g") return { calories: 0, protein: 0, carbs: 0, fat: 0 };
  const ratio = Math.max(0, canonical.amount) / 100;
  const protein = roundTo((item.nutrientsPer100g.proteinG || 0) * ratio, 1);
  const carbs = roundTo((item.nutrientsPer100g.carbsG || 0) * ratio, 1);
  const fat = roundTo((item.nutrientsPer100g.fatG || 0) * ratio, 1);
  const fiber = typeof item.nutrientsPer100g.fiberG === "number" ? roundTo(item.nutrientsPer100g.fiberG * ratio, 1) : undefined;
  const sugar = typeof item.nutrientsPer100g.sugarG === "number" ? roundTo(item.nutrientsPer100g.sugarG * ratio, 1) : undefined;
  const sodiumMg = typeof item.nutrientsPer100g.sodiumMg === "number" ? Math.round(item.nutrientsPer100g.sodiumMg * ratio) : undefined;
  const caloriesFromLabel = Math.round((item.nutrientsPer100g.caloriesKcal || 0) * ratio);
  const normalized = normalizeCaloriesFromMacros({ calories: caloriesFromLabel, protein, carbs, fat, qualityTier: item.qualityTier });
  return { calories: normalized.calories, protein, carbs, fat, fiber, sugar, sodiumMg };
}

export function previewEquivalents(item: CanonicalFoodItem, canonical: { unit: CanonicalUnit; amount: number }, units: UnitsPreference) {
  const kind = inferKind(item);
  return equivalentsForDisplay({ kind, canonical, units });
}

export async function addFoodToDailyLog(input: {
  item: CanonicalFoodItem;
  servingLabel: string;
  quantity: number;
  meal?: "breakfast" | "lunch" | "dinner" | "snack";
  note?: string;
}) {
  const date = todayKey();
  const unitKey = normalizeUnitKeyFromLabel(input.item, input.servingLabel);
  const canonical = convertSelectionToCanonical(input.item, unitKey, input.quantity);
  if (!canonical) {
    throw new Error("Invalid unit conversion");
  }
  const macros = computeMacrosForCanonical(input.item, { unit: canonical.unit, amount: canonical.amount });

  const log = await getDailyLog(date);
  const entry: FoodEntry = {
    id: String(Date.now()),
    ts: new Date().toISOString(),
    meal: input.meal,
    calories: macros.calories,
    protein: macros.protein,
    carbs: macros.carbs,
    fat: macros.fat,
    fiber: typeof (macros as any).fiber === "number" ? (macros as any).fiber : undefined,
    sugar: typeof (macros as any).sugar === "number" ? (macros as any).sugar : undefined,
    sodiumMg: typeof (macros as any).sodiumMg === "number" ? (macros as any).sodiumMg : undefined,
    label: input.item.name,
    brand: input.item.brand,
    barcode: input.item.barcode,
    source: input.item.source,
    servingLabel: input.servingLabel,
    quantity: input.quantity,
    amount: input.quantity,
    unit: unitKey,
    canonicalAmount: canonical.amount,
    canonicalUnit: canonical.unit,
    conversionEstimated: canonical.isEstimated,
    note: input.note?.trim() || `${input.item.brand ? `${input.item.brand} · ` : ""}${input.servingLabel} x${input.quantity}`,
  };

  // Normalize duplicates on write: increment an identical existing row in the same meal instead of storing
  // duplicates forever. Rendering still aggregates defensively.
  const mealKey = (entry.meal || inferMealFromTimeWindow(entry.ts)) as any;
  const newKey = foodEntryIdentityKey(entry);
  const existing = (log.foodEntries || []).find((row) => {
    const rowMeal = ((row as any).meal || inferMealFromTimeWindow((row as any).ts)) as any;
    if (rowMeal !== mealKey) return false;
    return foodEntryIdentityKey(row as any) === newKey;
  });

  if (existing) {
    const nextEntries = (log.foodEntries || []).map((row) => {
      if (row.id !== existing.id) return row;
      const prevQty = Number((row as any).amount ?? (row as any).quantity ?? 1) || 1;
      const addQty = Number(entry.amount ?? entry.quantity ?? input.quantity) || 1;
      const nextQty = prevQty + addQty;
      const nextCanonicalAmount =
        typeof row.canonicalAmount === "number" && typeof entry.canonicalAmount === "number"
          ? (row.canonicalAmount || 0) + (entry.canonicalAmount || 0)
          : row.canonicalAmount;
      return {
        ...row,
        calories: (Number(row.calories) || 0) + macros.calories,
        protein: (Number(row.protein) || 0) + macros.protein,
        carbs: (Number(row.carbs) || 0) + macros.carbs,
        fat: (Number(row.fat) || 0) + macros.fat,
        quantity: nextQty,
        amount: nextQty,
        canonicalAmount: nextCanonicalAmount,
        conversionEstimated: Boolean(row.conversionEstimated || entry.conversionEstimated),
      };
    });

    await saveDailyLog(date, {
      ...log,
      calories: (log.calories || 0) + macros.calories,
      macros: {
        protein: (log.macros?.protein || 0) + macros.protein,
        carbs: (log.macros?.carbs || 0) + macros.carbs,
        fat: (log.macros?.fat || 0) + macros.fat,
      },
      foodEntries: nextEntries,
    });
  } else {
    await saveDailyLog(date, {
      ...log,
      calories: (log.calories || 0) + macros.calories,
      macros: {
        protein: (log.macros?.protein || 0) + macros.protein,
        carbs: (log.macros?.carbs || 0) + macros.carbs,
        fat: (log.macros?.fat || 0) + macros.fat,
      },
      foodEntries: [entry, ...(log.foodEntries || [])],
    });
  }

  await rememberRecentFood(input.item);

  const usage = await getUsageStatsMap();
  const row = usage[input.item.id] || {
    id: input.item.id,
    timesUsed: 0,
    lastUsedAt: new Date(0).toISOString(),
  };
  usage[input.item.id] = {
    ...row,
    item: input.item,
    timesUsed: row.timesUsed + 1,
    lastUsedAt: new Date().toISOString(),
    lastQuantity: input.quantity,
    lastServingLabel: input.servingLabel,
  };
  await AsyncStorage.setItem(FOOD_USAGE_STATS_KEY, JSON.stringify(usage));
  usageStatsCache = { data: usage, cachedAt: Date.now() };

  return { entry, macros, grams: canonical.unit === "g" ? canonical.amount : 0, canonical };
}

export function qualityColor(tier: FoodQualityTier) {
  if (tier === "VERIFIED") return "#6EE7B7";
  if (tier === "HIGH") return "#7DD3FC";
  if (tier === "MEDIUM") return "#FCD34D";
  if (tier === "USER") return "#C4B5FD";
  return "#FCA5A5";
}

export function getFoodStorageKeys() {
  return {
    FOOD_RECENTS_KEY,
    FOOD_FAVORITES_KEY,
    BARCODE_CACHE_KEY,
    FOOD_USAGE_STATS_KEY,
  };
}
