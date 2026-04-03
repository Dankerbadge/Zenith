type ConfidenceTier = 'HIGH' | 'MEDIUM' | 'LOW';

export type FoodCandidate = {
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

function n(v: any) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function parseServingGrams(servingSize: string) {
  const s = String(servingSize || '');
  const m = s.match(/(\d+(?:\.\d+)?)\s*g\b/i);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function capReasonScore(score: number) {
  const s = Math.max(0, Math.min(0.70, Number(score) || 0));
  return s;
}

function tierForScore(score: number): 'MEDIUM' | 'LOW' {
  return score >= 0.58 ? 'MEDIUM' : 'LOW';
}

function rejectAbsurd(caloriesKcal: number, proteinG: number, carbsG: number, fatG: number) {
  if (![caloriesKcal, proteinG, carbsG, fatG].every((v) => Number.isFinite(v) && v >= 0)) return true;
  if (caloriesKcal > 2000) return true;
  if (proteinG > 200 || carbsG > 200 || fatG > 200) return true;
  return false;
}

function sodiumToMg(value: number | null, unit: string | null) {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  const u = String(unit || '').trim().toLowerCase();
  if (u === 'mg') return value;
  if (u === 'g' || u === '') return value * 1000;
  return null;
}

export function mapOffProductToCandidate(offJson: any, barcodeUsed: string): FoodCandidate | null {
  const product = offJson?.product;
  if (!product || Number(offJson?.status) !== 1) return null;

  const displayName = String(product.product_name || '').trim();
  if (!displayName) return null;

  const nutr = product.nutriments || {};

  // Prefer per-100g.
  const kcal100 = n(nutr['energy-kcal_100g']);
  const kj100 = n(nutr['energy_100g']);
  const p100 = n(nutr['proteins_100g']);
  const f100 = n(nutr['fat_100g']);
  const c100 = n(nutr['carbohydrates_100g']);

  let basis: 'PER_100G' | 'PER_SERVING' = 'PER_100G';
  let caloriesKcal: number | null = null;
  let reasons: string[] = ['Barcode match (OFF)', 'Crowd-sourced data; verify label'];

  if (kcal100 != null && p100 != null && f100 != null && c100 != null) {
    caloriesKcal = kcal100;
  } else if (kcal100 == null && kj100 != null && p100 != null && f100 != null && c100 != null) {
    caloriesKcal = kj100 * 0.239005736;
    reasons = [...reasons, 'Energy converted from kJ'];
  } else {
    // Fallback to per-serving only if serving grams parseable and required macros exist.
    const kcalS = n(nutr['energy-kcal_serving']);
    const kjS = n(nutr['energy_serving']);
    const pS = n(nutr['proteins_serving']);
    const fS = n(nutr['fat_serving']);
    const cS = n(nutr['carbohydrates_serving']);
    const servingG = parseServingGrams(String(product.serving_size || ''));
    if (!servingG || !(pS != null && fS != null && cS != null) || !(kcalS != null || kjS != null)) return null;
    basis = 'PER_SERVING';
    caloriesKcal = kcalS != null ? kcalS : (kjS as number) * 0.239005736;
    if (kcalS == null && kjS != null) reasons = [...reasons, 'Energy converted from kJ'];
  }

  if (caloriesKcal == null) return null;

  const proteinG = basis === 'PER_SERVING' ? n(nutr['proteins_serving']) : p100;
  const fatG = basis === 'PER_SERVING' ? n(nutr['fat_serving']) : f100;
  const carbsG = basis === 'PER_SERVING' ? n(nutr['carbohydrates_serving']) : c100;
  if (proteinG == null || fatG == null || carbsG == null) return null;

  const fiberG = basis === 'PER_SERVING' ? n(nutr['fiber_serving']) : n(nutr['fiber_100g']);
  const sugarG = basis === 'PER_SERVING' ? n(nutr['sugars_serving']) : n(nutr['sugars_100g']);
  const satFatG = basis === 'PER_SERVING' ? n(nutr['saturated-fat_serving']) : n(nutr['saturated-fat_100g']);
  const transFatG = basis === 'PER_SERVING' ? n(nutr['trans-fat_serving']) : n(nutr['trans-fat_100g']);

  const sodiumRaw = basis === 'PER_SERVING' ? n(nutr['sodium_serving']) : n(nutr['sodium_100g']);
  const sodiumUnit = String(nutr['sodium_unit'] || nutr['sodium_100g_unit'] || nutr['sodium_serving_unit'] || '').trim().toLowerCase() || null;
  const sodiumMg = sodiumToMg(sodiumRaw, sodiumUnit) ?? undefined;

  const ckcal = Math.round(Math.max(0, caloriesKcal));
  const cp = Math.max(0, proteinG);
  const cf = Math.max(0, fatG);
  const cc = Math.max(0, carbsG);

  if (rejectAbsurd(ckcal, cp, cc, cf)) return null;

  const servingG = basis === 'PER_SERVING' ? parseServingGrams(String(product.serving_size || '')) : null;
  const base =
    basis === 'PER_SERVING'
      ? { kind: 'PER_SERVING' as const, servingSize: servingG ?? undefined, servingUnit: servingG ? 'g' : undefined }
      : { kind: 'PER_100G' as const };

  // OFF is never HIGH confidence.
  const score = capReasonScore(basis === 'PER_100G' ? 0.62 : 0.58);
  const tier = tierForScore(score);

  return {
    candidateId: `off:${barcodeUsed}`,
    source: 'OPEN_FOOD_FACTS',
    offBarcode: barcodeUsed,
    displayName,
    brandOwner: typeof product.brands === 'string' && product.brands.trim() ? product.brands.trim() : undefined,
    base,
    nutrients: {
      caloriesKcal: ckcal,
      proteinG: cp,
      fatG: cf,
      carbsG: cc,
      fiberG: fiberG == null ? undefined : Math.max(0, fiberG),
      sugarG: sugarG == null ? undefined : Math.max(0, sugarG),
      sodiumMg,
      satFatG: satFatG == null ? undefined : Math.max(0, satFatG),
      transFatG: transFatG == null ? undefined : Math.max(0, transFatG),
      addedSugarG: undefined,
    },
    confidence: {
      score,
      tier,
      reasons,
    },
  };
}

