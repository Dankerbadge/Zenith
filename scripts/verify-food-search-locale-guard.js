#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function loadFoodSearchService(fetchImpl) {
  const source = read('utils/foodSearchService.ts');
  const out = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
      esModuleInterop: true,
      resolveJsonModule: true,
      strict: true,
    },
    fileName: 'utils/foodSearchService.ts',
  }).outputText;

  const commonFoodsCatalog = JSON.parse(read('utils/commonFoodsCatalog.json'));
  const storage = new Map();
  const asyncStorage = {
    async getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    async setItem(key, value) {
      storage.set(key, value);
    },
    async removeItem(key) {
      storage.delete(key);
    },
  };

  const requireMap = {
    '@react-native-async-storage/async-storage': { __esModule: true, default: asyncStorage },
    'expo-constants': { __esModule: true, default: { expoConfig: { extra: {} } } },
    './nutritionIntegrity': { normalizeCaloriesFromMacros: () => 0 },
    './storageUtils': {
      getDailyLog: async () => [],
      saveDailyLog: async () => {},
      todayKey: () => '2026-04-01',
    },
    './commonFoodsCatalog.json': commonFoodsCatalog,
    './foodLogGrouping': {
      foodEntryIdentityKey: () => '',
      inferMealFromTimeWindow: () => 'meal',
    },
    './preparedFoodServingPolicy': {
      getDefaultUnitPolicyForItem: () => 'weight_first',
      getEffectiveServingSizesForItem: (item) => item.servingSizes || [],
    },
    './measurementEngine': {
      convertToCanonical: ({ amount, unit }) => ({ amount, unit: /ml/.test(unit) ? 'ml' : 'g' }),
      defaultUnitForKind: (kind) => (kind === 'drink' ? 'ml' : 'g'),
      equivalentsForDisplay: () => [],
      getBaseUnitOptions: () => [],
      getServingUnitOptions: () => [],
      inferKind: ({ name }) => (/coffee|water|milk|tea|juice|drink/i.test(String(name || '')) ? 'drink' : 'food'),
      roundTo: (value) => value,
    },
    './foodSearchPerf': { recordFoodSearchPerf: async () => {} },
    './supabaseClient': {
      isSupabaseConfigured: false,
      supabase: { functions: { invoke: async () => ({ data: null, error: new Error('disabled') }) } },
    },
  };

  function localRequire(specifier) {
    if (requireMap[specifier]) return requireMap[specifier];
    throw new Error(`Unmocked require: ${specifier}`);
  }

  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require: localRequire,
    console,
    process,
    setTimeout,
    clearTimeout,
    Date,
    URL,
    fetch: fetchImpl,
    DOMException:
      global.DOMException ||
      class DOMException extends Error {
        constructor(message, name) {
          super(message);
          this.name = name;
        }
      },
  };

  vm.runInNewContext(out, sandbox, { filename: 'utils/foodSearchService.ts' });
  return module.exports;
}

function makeOffProduct({ id, name, brand, country, calories = 100, protein = 10, carbs = 10, fat = 1 }) {
  return {
    _id: id,
    product_name: name,
    brands: brand,
    countries_tags: [country],
    nutriments: {
      'energy-kcal_100g': calories,
      proteins_100g: protein,
      carbohydrates_100g: carbs,
      fat_100g: fat,
    },
  };
}

const fixtures = {
  eggs: [
    makeOffProduct({ id: 'us-eggs', name: 'Large Eggs', brand: 'Eggland\'s Best', country: 'en:united-states', calories: 143, protein: 13, carbs: 1, fat: 10 }),
    makeOffProduct({ id: 'uk-eggs', name: 'Free Range Eggs', brand: 'Tesco', country: 'en:united-kingdom', calories: 145, protein: 13, carbs: 1, fat: 10 }),
  ],
  chicken: [
    makeOffProduct({ id: 'us-chicken', name: 'Chicken Breast', brand: 'Tyson', country: 'en:united-states', calories: 165, protein: 31, carbs: 0, fat: 4 }),
    makeOffProduct({ id: 'ca-chicken', name: 'Chicken Breast Fillets', brand: 'Maple Leaf', country: 'en:canada', calories: 160, protein: 30, carbs: 0, fat: 4 }),
  ],
  yogurt: [
    makeOffProduct({ id: 'us-yogurt', name: 'Greek Yogurt Plain', brand: 'Chobani', country: 'en:united-states', calories: 59, protein: 10, carbs: 4, fat: 0 }),
    makeOffProduct({ id: 'fr-yogurt', name: 'Yaourt Grec', brand: 'Danone', country: 'en:france', calories: 61, protein: 9, carbs: 4, fat: 3 }),
  ],
  dunkin: [
    makeOffProduct({ id: 'us-dunkin', name: 'Iced Coffee', brand: 'Dunkin', country: 'en:united-states', calories: 5, protein: 0, carbs: 1, fat: 0 }),
    makeOffProduct({ id: 'au-donut', name: 'Glazed Donut', brand: 'Donut King', country: 'en:australia', calories: 400, protein: 5, carbs: 50, fat: 20 }),
  ],
  wegmans: [
    makeOffProduct({ id: 'us-wegmans', name: 'Greek Yogurt', brand: 'Wegmans', country: 'en:united-states', calories: 97, protein: 10, carbs: 5, fat: 0 }),
    makeOffProduct({ id: 'de-wegmanns', name: 'Protein Yogurt', brand: 'Wegmanns', country: 'en:germany', calories: 100, protein: 10, carbs: 6, fat: 1 }),
  ],
};

async function fetchStub(url) {
  const raw = String(url);
  if (raw.includes('world.openfoodfacts.org/cgi/search.pl')) {
    const parsed = new URL(raw);
    const query = String(parsed.searchParams.get('search_terms') || '').toLowerCase();
    return {
      async json() {
        return { products: fixtures[query] || [] };
      },
    };
  }
  if (raw.includes('api.nal.usda.gov')) {
    return { async json() { return { foods: [] }; } };
  }
  if (raw.includes('world.openfoodfacts.org/api/v0/product')) {
    return { async json() { return { status: 0 }; } };
  }
  throw new Error(`Unexpected fetch URL: ${raw}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isExplicitNonUs(item) {
  const country = String(item.country || '').toLowerCase();
  if (!country) return false;
  return !country.includes('united-states') && country !== 'us' && country !== 'usa' && !country.endsWith(':us');
}

async function main() {
  const { searchFoods } = loadFoodSearchService(fetchStub);
  const locale = { country: 'US', admin: 'NY', language: 'en' };
  const queries = ['eggs', 'chicken', 'yogurt', 'dunkin', 'wegmans'];

  for (const query of queries) {
    const results = await searchFoods(query, locale);
    const explicitNonUs = results.filter(isExplicitNonUs);
    assert(explicitNonUs.length === 0, `Query "${query}" leaked explicit non-US items: ${explicitNonUs.map((item) => `${item.brand || item.name} [${item.country}]`).join(', ')}`);
  }

  console.log('Food search locale guard verification passed.');
  console.log('- Representative US/NY queries stay free of explicit non-US OFF items');
  console.log('- Short country aliases no longer false-match tokens like australia');
}

main().catch((error) => {
  console.error('Food search locale guard verification failed.\\n');
  console.error(`- ${error.message}`);
  process.exit(1);
});
