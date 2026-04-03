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

function loadTsModule(relPath) {
  const source = read(relPath);
  const out = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
      esModuleInterop: true,
      strict: true,
    },
    fileName: relPath,
  }).outputText;

  const module = { exports: {} };
  const sandbox = { module, exports: module.exports };
  vm.runInNewContext(out, sandbox, { filename: relPath });
  return sandbox.module.exports;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function main() {
  const policy = loadTsModule('utils/preparedFoodServingPolicy.ts');
  const measure = loadTsModule('utils/measurementEngine.ts');

  const { getEffectiveServingSizesForItem, getDefaultUnitPolicyForItem } = policy;
  const { convertToCanonical } = measure;

  const policyPizza = getDefaultUnitPolicyForItem({ kind: 'food', name: 'Pepperoni pizza', categoryTags: [] });
  assert(policyPizza === 'serving_first', 'Pizza must be serving_first');

  const baseline = [{ label: '100g', grams: 100, default: true }];
  const effective = getEffectiveServingSizesForItem({ kind: 'food', name: 'Pepperoni pizza', servingSizes: baseline });
  assert(effective[0].label === 'Slice (regular)', 'Pizza must inject Slice (regular) as first serving');
  assert(effective[0].grams === 110, 'Slice (regular) must map to 110g baseline');
  assert(effective[0].estimated === true, 'Injected slice should be marked estimated (trust: no fake precision)');

  const canonical = convertToCanonical({
    kind: 'food',
    unit: 'serving:Slice (regular)',
    amount: 1,
    servingSizes: effective,
  });
  assert(canonical && canonical.unit === 'g', 'Slice conversion must return canonical grams');
  assert(Math.round(canonical.amount) === 110, '1 slice must convert to ~110g');

  const policyChicken = getDefaultUnitPolicyForItem({ kind: 'food', name: 'Chicken breast cooked', categoryTags: ['protein'] });
  assert(policyChicken === 'weight_first', 'Chicken breast should remain weight_first');

  const foodSearchService = read('utils/foodSearchService.ts');
  assert(
    /policy === 'serving_first' \? \[\.\.\.servings, \.\.\.base\]/.test(foodSearchService),
    'Food unit picker must put servings before base units for serving_first'
  );
  assert(
    /policy === 'serving_first'/.test(foodSearchService),
    'Food unit selection must be policy-aware'
  );

  console.log('Prepared food unit defaults verification passed.');
  console.log('- Pizza defaults inject slice units');
  console.log('- Slice conversion produces sane canonical grams');
}

main();

