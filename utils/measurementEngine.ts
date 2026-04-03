export type UnitsPreference = "lb-oz" | "kg-ml";

export type ItemKind = "food" | "drink";
export type CanonicalUnit = "g" | "ml";

export type UnitKey =
  | "g"
  | "oz"
  | "lb"
  | "ml"
  | "fl oz"
  | "L"
  | "cup"
  | "tbsp"
  | "tsp"
  | `serving:${string}`;

export type UnitOption = {
  key: UnitKey;
  label: string;
  disabledReason?: string;
  isEstimated?: boolean;
  canonicalPerUnit?: { unit: CanonicalUnit; amount: number };
};

export const MASS_OZ_TO_G = 28.349523125;
export const MASS_LB_TO_G = 453.59237;

export const VOL_FLOZ_TO_ML = 29.5735295625;
export const VOL_CUP_TO_ML = 236.5882365;
export const VOL_TBSP_TO_ML = 14.78676478125;
export const VOL_TSP_TO_ML = 4.92892159375;

export function roundTo(value: number, decimals: number) {
  const p = Math.pow(10, decimals);
  return Math.round(value * p) / p;
}

export function inferKind(input: { kind?: ItemKind; nutritionBasis?: "per100g" | "per100ml"; name?: string }): ItemKind {
  if (input.kind === "drink" || input.nutritionBasis === "per100ml") return "drink";
  if (input.kind === "food") return "food";
  const name = String(input.name || "").toLowerCase();
  const drinkTokens = ["water", "coffee", "tea", "juice", "soda", "cola", "milk", "latte", "espresso", "drink", "beverage"];
  if (drinkTokens.some((t) => name.includes(t))) return "drink";
  return "food";
}

export function canonicalUnitForKind(kind: ItemKind): CanonicalUnit {
  return kind === "drink" ? "ml" : "g";
}

export function formatCanonicalAmount(value: number, unit: CanonicalUnit) {
  if (unit === "g") return `${Math.round(value)} g`;
  return `${Math.round(value)} ml`;
}

export function convertToCanonical(input: {
  kind: ItemKind;
  unit: UnitKey;
  amount: number;
  servingSizes?: Array<{ label: string; grams?: number; ml?: number; estimated?: boolean }>;
  densityGPerMl?: number;
}): { unit: CanonicalUnit; amount: number; isEstimated: boolean } | null {
  const amt = Math.max(0, Number(input.amount) || 0);
  if (!Number.isFinite(amt)) return null;

  const kind = input.kind;
  const canonicalUnit = canonicalUnitForKind(kind);

  const unit = input.unit;
  if (kind === "food") {
    if (unit === "g") return { unit: "g", amount: amt, isEstimated: false };
    if (unit === "oz") return { unit: "g", amount: amt * MASS_OZ_TO_G, isEstimated: false };
    if (unit === "lb") return { unit: "g", amount: amt * MASS_LB_TO_G, isEstimated: false };

    if (unit === "ml" || unit === "fl oz" || unit === "L" || unit === "cup" || unit === "tbsp" || unit === "tsp") {
      // Foods: volume -> mass only allowed if density exists.
      const density = typeof input.densityGPerMl === "number" ? input.densityGPerMl : null;
      if (!density || density <= 0) return null;
      const ml =
        unit === "ml"
          ? amt
          : unit === "L"
            ? amt * 1000
            : unit === "fl oz"
              ? amt * VOL_FLOZ_TO_ML
              : unit === "cup"
                ? amt * VOL_CUP_TO_ML
                : unit === "tbsp"
                  ? amt * VOL_TBSP_TO_ML
                  : amt * VOL_TSP_TO_ML;
      return { unit: "g", amount: ml * density, isEstimated: true };
    }

    if (unit.startsWith("serving:")) {
      const label = unit.slice("serving:".length);
      const serving = (input.servingSizes || []).find((row) => row.label === label);
      if (serving?.grams) return { unit: "g", amount: amt * serving.grams, isEstimated: Boolean(serving.estimated) };
      if (serving?.ml && typeof input.densityGPerMl === "number" && input.densityGPerMl > 0) {
        return { unit: "g", amount: amt * serving.ml * input.densityGPerMl, isEstimated: true };
      }
      return null;
    }

    return null;
  }

  // Drinks (canonical ml)
  if (unit === "ml") return { unit: "ml", amount: amt, isEstimated: false };
  if (unit === "fl oz") return { unit: "ml", amount: amt * VOL_FLOZ_TO_ML, isEstimated: false };
  if (unit === "L") return { unit: "ml", amount: amt * 1000, isEstimated: false };
  if (unit === "cup") return { unit: "ml", amount: amt * VOL_CUP_TO_ML, isEstimated: false };
  if (unit === "tbsp") return { unit: "ml", amount: amt * VOL_TBSP_TO_ML, isEstimated: false };
  if (unit === "tsp") return { unit: "ml", amount: amt * VOL_TSP_TO_ML, isEstimated: false };

  if (unit === "g" || unit === "oz" || unit === "lb") {
    // Drinks do not support mass units by default.
    return null;
  }

  if (unit.startsWith("serving:")) {
    const label = unit.slice("serving:".length);
    const serving = (input.servingSizes || []).find((row) => row.label === label);
    if (serving?.ml) return { unit: canonicalUnit, amount: amt * serving.ml, isEstimated: Boolean(serving.estimated) };
    return null;
  }

  return null;
}

export function defaultUnitForKind(kind: ItemKind, units: UnitsPreference): UnitKey {
  if (kind === "drink") return units === "kg-ml" ? "ml" : "fl oz";
  return "g";
}

export function getBaseUnitOptions(kind: ItemKind, units: UnitsPreference): UnitOption[] {
  if (kind === "drink") {
    if (units === "kg-ml") {
      return [
        { key: "ml", label: "ml" },
        { key: "L", label: "L" },
        { key: "fl oz", label: "fl oz" },
      ];
    }
    return [
      { key: "fl oz", label: "fl oz" },
      { key: "ml", label: "ml" },
      { key: "L", label: "L" },
    ];
  }

  return [
    { key: "g", label: "g" },
    { key: "oz", label: "oz" },
    { key: "lb", label: "lb" },
  ];
}

export function getServingUnitOptions(input: {
  kind: ItemKind;
  servingSizes?: Array<{ label: string; grams?: number; ml?: number; default?: boolean; estimated?: boolean }>;
}): UnitOption[] {
  const sizes = Array.isArray(input.servingSizes) ? input.servingSizes : [];
  const seen = new Set<string>();
  const out: UnitOption[] = [];

  sizes.forEach((row) => {
    const label = String(row.label || "").trim();
    if (!label) return;
    if (seen.has(label)) return;
    seen.add(label);

    if (input.kind === "food" && typeof row.grams === "number" && row.grams > 0) {
      out.push({
        key: `serving:${label}`,
        label,
        isEstimated: Boolean(row.estimated),
        canonicalPerUnit: { unit: "g", amount: row.grams },
      });
      return;
    }

    if (input.kind === "drink" && typeof row.ml === "number" && row.ml > 0) {
      out.push({
        key: `serving:${label}`,
        label,
        isEstimated: Boolean(row.estimated),
        canonicalPerUnit: { unit: "ml", amount: row.ml },
      });
      return;
    }
  });

  return out;
}

export function equivalentsForDisplay(input: { kind: ItemKind; canonical: { unit: CanonicalUnit; amount: number }; units: UnitsPreference }) {
  if (input.kind === "drink") {
    const ml = input.canonical.unit === "ml" ? input.canonical.amount : 0;
    const floz = ml / VOL_FLOZ_TO_ML;
    return {
      primary: input.units === "kg-ml" ? `${Math.round(ml)} ml` : `${roundTo(floz, 1)} fl oz`,
      secondary: input.units === "kg-ml" ? `${roundTo(floz, 1)} fl oz` : `${Math.round(ml)} ml`,
    };
  }
  const g = input.canonical.unit === "g" ? input.canonical.amount : 0;
  const oz = g / MASS_OZ_TO_G;
  return {
    primary: input.units === "kg-ml" ? `${Math.round(g)} g` : `${roundTo(oz, 1)} oz`,
    secondary: input.units === "kg-ml" ? `${roundTo(oz, 1)} oz` : `${Math.round(g)} g`,
  };
}
