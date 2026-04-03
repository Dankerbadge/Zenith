#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function fail(message, failures) {
  failures.push(message);
}

function main() {
  const failures = [];

  const catalogRaw = read('utils/commonFoodsCatalog.json');
  let catalog = [];
  try {
    catalog = JSON.parse(catalogRaw);
  } catch {
    fail('commonFoodsCatalog.json is not valid JSON', failures);
  }
  const ids = new Set((Array.isArray(catalog) ? catalog : []).map((row) => row && row.id).filter(Boolean));

  const service = read('utils/foodSearchService.ts');
  const modal = read('app/(modals)/food.tsx');
  const barcodeService = read('utils/barcodeService.ts');

  // Ensure the ship-blocker queries are guaranteed.
  const requiredQueries = [
    'eggs',
    'egg',
    'beef',
    'ground beef',
    'banana',
    'apple',
    'fruit',
    'chicken',
    'rice',
    'oats',
    'coffee',
    'water',
    'milk',
  ];

  requiredQueries.forEach((q) => {
    if (!new RegExp(`\\b${q.replace(/[-/\\^$*+?.()|[\\]{}]/g, '\\$&')}\\b`, 'i').test(service)) {
      fail(`Missing required query mapping token in foodSearchService.ts: "${q}"`, failures);
    }
  });

  // Ensure expanded branded-intent coverage remains present for common US brands/chains.
  const brandTokenMatch = service.match(/const BRAND_TOKENS = \[([\s\S]*?)\];/m);
  if (!brandTokenMatch) {
    fail('Missing BRAND_TOKENS in foodSearchService.ts', failures);
  } else {
    const brandTokenSet = new Set(
      Array.from(brandTokenMatch[1].matchAll(/"([^"]+)"/g)).map((m) => String(m[1] || '').trim().toLowerCase())
    );
    const requiredBrandIntentTokens = [
      'costco',
      'kroger',
      'walmart',
      'target',
      'trader joe',
      'whole foods',
      'wawa',
      'olive garden',
      'red lobster',
      'firehouse subs',
      'food lion',
      'sprouts farmers market',
      '7 eleven',
      'white castle',
      'wingstop',
      'jollibee',
    ];
    requiredBrandIntentTokens.forEach((token) => {
      if (!brandTokenSet.has(token)) {
        fail(`Missing branded-intent token in BRAND_TOKENS: "${token}"`, failures);
      }
    });
  }

  // Force top hits.
  if (!/eggs:\s*\[\s*"zenith-common:egg-whole"/.test(service)) {
    fail('Expected eggs -> zenith-common:egg-whole to be pinned first', failures);
  }
  if (!/coffee:\s*\[\s*"zenith-common:black-coffee"/.test(service)) {
    fail('Expected coffee -> zenith-common:black-coffee to be pinned', failures);
  }
  if (!/water:\s*\[\s*"zenith-common:water"/.test(service)) {
    fail('Expected water -> zenith-common:water to be pinned', failures);
  }
  if (!/potato:\s*\[\s*"zenith-common:potato-baked"/.test(service)) {
    fail('Expected potato -> zenith-common:potato-baked to be pinned', failures);
  }
  if (!/bread:\s*\[\s*"zenith-common:bread-slice"/.test(service)) {
    fail('Expected bread -> zenith-common:bread-slice to be pinned', failures);
  }

  // Ensure all pinned IDs exist in the catalog.
  const pinnedIdRe = /GUARANTEED_COMMON_QUERY_MAP[\s\S]*?=\s*{([\s\S]*?)};/m;
  const match = service.match(pinnedIdRe);
  if (!match) {
    fail('Missing GUARANTEED_COMMON_QUERY_MAP in foodSearchService.ts', failures);
  } else {
    const body = match[1];
    const idRe = /"zenith-common:[^"]+"/g;
    const found = body.match(idRe) || [];
    found.forEach((idLiteral) => {
      const id = idLiteral.replace(/"/g, '');
      if (!ids.has(id)) {
        fail(`Pinned common food id not found in catalog: ${id}`, failures);
      }
    });
  }

  // Search layer must enforce common guarantees.
  if (!/enforceCommonFoodGuarantees\(/.test(service)) {
    fail('searchFoods must call enforceCommonFoodGuarantees(...)', failures);
  }

  // Region cache keys must include admin region (e.g. US subregions) to avoid cross-region pollution.
  if (!service.includes('|${normalizeText(normalized.admin || "")}')) {
    fail('Food search persistent cache key must include locale.admin', failures);
  }
  if (!service.includes('|${normalizeText(normalizedLocale.admin || "")}')) {
    fail('Food search in-memory cache key must include locale.admin', failures);
  }

  // Apostrophe variants should normalize to contiguous tokens for brand/chain matching.
  if (!/replace\(\s*\/\[’'\]\/g,\s*""\s*\)/.test(service)) {
    fail('sanitizeName should strip apostrophes so branded-intent matching handles possessives', failures);
  }
  if (
    !/compactValue\s*=\s*sanitized\.replace\(\s*\/\\s\+\/g,\s*""\s*\)/.test(service) ||
    !/compactToken\.length\s*<\s*5/.test(service) ||
    !/compactValue\.includes\(compactToken\)/.test(service)
  ) {
    fail('containsBrandToken should match collapsed multi-word brand tokens (for example "wholefoods")', failures);
  }

  // Local-first fuzzy + phrase parsing helpers must exist.
  if (!/export function rankLocalFoodsForQuery\(/.test(service)) {
    fail('Missing rankLocalFoodsForQuery(...) in foodSearchService.ts', failures);
  }
  if (!/export function parseFoodPhrase\(/.test(service)) {
    fail('Missing parseFoodPhrase(...) in foodSearchService.ts', failures);
  }

  // Modal must surface common foods and seed canonical results immediately.
  if (!/Common Foods/.test(modal)) {
    fail('Food modal missing "Common Foods" surface', failures);
  }
  if (!/getCommonFoodsForQuery\(/.test(modal)) {
    fail('Food modal should seed results with getCommonFoodsForQuery(...)', failures);
  }
  if (!/Quick meal/.test(modal) || !/parseFoodPhrase\(/.test(modal)) {
    fail('Food modal should surface phrase parsing ("Quick meal") for multi-food entry', failures);
  }

  // Ensure no mock barcode fallbacks ship.
  if (/COMMON_FOODS/.test(barcodeService) || /0001111111111|0002222222222|0003333333333/.test(barcodeService)) {
    fail('barcodeService.ts must not include mock COMMON_FOODS barcode fallbacks', failures);
  }

  if (failures.length > 0) {
    console.error('Food search basics verification failed.\n');
    failures.forEach((f) => console.error(`- ${f}`));
    process.exit(1);
  }

  console.log('Food search basics verification passed.');
  console.log(`- Catalog items: ${ids.size}`);
  console.log('- Required canonical pins present');
  console.log('- Modal surfaces common foods');
}

main();
