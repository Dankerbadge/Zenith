import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { mapOffProductToCandidate } from '../offNutritionMapper.ts';

Deno.test('mapOffProductToCandidate maps PER_100G nutriments', () => {
  const off = {
    status: 1,
    product: {
      product_name: 'Test Bar',
      brands: 'Acme',
      nutriments: {
        'energy-kcal_100g': 420,
        proteins_100g: 10,
        fat_100g: 20,
        carbohydrates_100g: 50,
        fiber_100g: 5,
        sugars_100g: 12,
        sodium_100g: 0.5,
        sodium_unit: 'g',
      },
    },
  };

  const cand = mapOffProductToCandidate(off, '012345678905');
  if (!cand) throw new Error('expected candidate');
  assertEquals(cand.source, 'OPEN_FOOD_FACTS');
  assertEquals(cand.base.kind, 'PER_100G');
  assertEquals(cand.nutrients.caloriesKcal, 420);
  assertEquals(cand.nutrients.proteinG, 10);
  assertEquals(cand.nutrients.fatG, 20);
  assertEquals(cand.nutrients.carbsG, 50);
  // sodium g -> mg
  assertEquals(cand.nutrients.sodiumMg, 500);
  // OFF never HIGH
  assertEquals(cand.confidence.tier === 'HIGH', false);
});

Deno.test('mapOffProductToCandidate converts kJ to kcal when needed', () => {
  const off = {
    status: 1,
    product: {
      product_name: 'Test KJ',
      nutriments: {
        energy_100g: 1000, // kJ
        proteins_100g: 10,
        fat_100g: 10,
        carbohydrates_100g: 10,
      },
    },
  };

  const cand = mapOffProductToCandidate(off, '4006381333931');
  if (!cand) throw new Error('expected candidate');
  assertEquals(cand.nutrients.caloriesKcal, 239); // 1000 * 0.239005736 rounded
});

Deno.test('mapOffProductToCandidate rejects missing required macros', () => {
  const off = {
    status: 1,
    product: {
      product_name: 'Incomplete',
      nutriments: {
        'energy-kcal_100g': 100,
        proteins_100g: 1,
        fat_100g: 1,
        // carbohydrates missing
      },
    },
  };

  const cand = mapOffProductToCandidate(off, '036000291452');
  assertEquals(cand, null);
});

