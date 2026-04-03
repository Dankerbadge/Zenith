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

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function main() {
  const { groupFoodEntriesByMeal, MEAL_ORDER } = loadTsModule('utils/foodLogGrouping.ts');

  assert(Array.isArray(MEAL_ORDER), 'MEAL_ORDER must be exported as an array');
  assert(
    JSON.stringify(MEAL_ORDER) === JSON.stringify(['breakfast', 'lunch', 'dinner', 'snack']),
    'MEAL_ORDER must be [breakfast, lunch, dinner, snack]'
  );

  // Unit test: grouping by explicit meal and fallback time windows.
  const entries = [
    { id: '1', ts: '2026-02-07T12:29:00', meal: 'lunch', calories: 280, protein: 13, carbs: 0, fat: 0, label: 'Chicken breast' },
    { id: '2', ts: '2026-02-07T05:10:00', calories: 120, protein: 10, carbs: 0, fat: 0, label: 'Eggs' }, // inferred breakfast
    { id: '3', ts: '2026-02-07T11:01:00', meal: 'lunch', calories: 360, protein: 8, carbs: 0, fat: 0, label: 'Rice' },
    { id: '4', ts: '2026-02-07T22:15:00', calories: 200, protein: 2, carbs: 0, fat: 0, label: 'Snack bar' }, // inferred snack
    { id: '5', ts: '2026-02-07T18:10:00', meal: 'dinner', calories: 500, protein: 35, carbs: 0, fat: 0, label: 'Steak' },
  ];

  const sections = groupFoodEntriesByMeal(entries);
  assert(Array.isArray(sections) && sections.length === 4, 'Expected 4 meal sections');
  assert(sections[0].meal === 'breakfast', 'Expected breakfast first');
  assert(sections[1].meal === 'lunch', 'Expected lunch second');
  assert(sections[2].meal === 'dinner', 'Expected dinner third');
  assert(sections[3].meal === 'snack', 'Expected snack fourth');

  const breakfastIds = sections[0].rows.map((r) => r.entry.id);
  assert(deepEqual(breakfastIds, ['2']), 'Breakfast should contain inferred entry id=2');

  const lunchIds = sections[1].rows.map((r) => r.entry.id);
  assert(deepEqual(lunchIds, ['3', '1']), 'Lunch should be ordered by loggedAt ascending (11:01 then 12:29)');

  assert(sections[1].caloriesTotal === 640, 'Lunch calories total should be 640');
  assert(Math.round(sections[1].proteinTotal) === 21, 'Lunch protein total should be 21');

  // Unit test: identical items collapse within a meal when identity matches.
  const dupEntries = [
    { id: 'p1', ts: '2026-02-07T18:00:00', meal: 'dinner', calories: 263, protein: 12, carbs: 0, fat: 0, label: 'Pizza', unit: 'serving:Slice (regular)', amount: 1, quantity: 1 },
    { id: 'p2', ts: '2026-02-07T18:05:00', meal: 'dinner', calories: 263, protein: 12, carbs: 0, fat: 0, label: 'Pizza', unit: 'serving:Slice (regular)', amount: 1, quantity: 1 },
  ];
  const dupSections = groupFoodEntriesByMeal(dupEntries);
  const dinnerRows = dupSections[2].rows;
  assert(dinnerRows.length === 1, 'Identical dinner items should collapse into a single row');
  assert(dinnerRows[0].quantity === 2, 'Collapsed row quantity should be 2');
  assert(Math.round(dinnerRows[0].entry.calories) === 526, 'Collapsed row calories should sum');

  // Snapshot-style regression: 0 items, 1 item, multi-meal.
  const snapshot = (rows) =>
    groupFoodEntriesByMeal(rows).map((s) => ({
      meal: s.meal,
      caloriesTotal: Math.round(s.caloriesTotal),
      proteinTotal: Math.round(s.proteinTotal),
      items: s.rows.map((r) => r.entry.label),
    }));

  const snap0 = snapshot([]);
  const expected0 = [
    { meal: 'breakfast', caloriesTotal: 0, proteinTotal: 0, items: [] },
    { meal: 'lunch', caloriesTotal: 0, proteinTotal: 0, items: [] },
    { meal: 'dinner', caloriesTotal: 0, proteinTotal: 0, items: [] },
    { meal: 'snack', caloriesTotal: 0, proteinTotal: 0, items: [] },
  ];
  assert(deepEqual(snap0, expected0), 'Snapshot mismatch for 0 items');

  const snap1 = snapshot([{ id: 'a', ts: '2026-02-07T08:00:00', calories: 100, protein: 5, carbs: 0, fat: 0, label: 'Oats' }]);
  assert(snap1[0].items[0] === 'Oats', 'Single entry should land in Breakfast by time window');

  const snapMulti = snapshot(entries);
  assert(snapMulti[1].items.length === 2, 'Expected 2 lunch items in snapshot');

  // Static check: Today Detail must use grouping util.
  const todayDetail = read('app/home/today-detail.tsx');
  assert(/groupFoodEntriesByMeal\(/.test(todayDetail), 'Today Detail should call groupFoodEntriesByMeal(...)');
  assert(/What you ate today/.test(todayDetail), 'Today Detail should render "What you ate today" section');

  console.log('Today Detail foods verification passed.');
  console.log('- Grouping + ordering unit tests passed');
  console.log('- Snapshot-style regressions passed');
}

main();
