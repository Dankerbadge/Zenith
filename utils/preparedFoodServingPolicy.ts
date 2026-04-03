export type DefaultUnitPolicy = 'weight_first' | 'serving_first';

export type PreparedServingSize = {
  label: string;
  grams?: number;
  ml?: number;
  default?: boolean;
  estimated?: boolean;
};

const SERVING_FIRST_NAME_TOKENS = [
  'pizza',
  'burger',
  'sandwich',
  'bagel',
  'taco',
  'burrito',
  'cake',
  'cookie',
  'donut',
  'doughnut',
  'fries',
  'french fries',
  'wing',
  'wings',
  'slice',
] as const;

export function sanitizeName(value: string) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isGenericWeightServingLabel(label: string) {
  const normalized = sanitizeName(label);
  if (normalized === '100g' || normalized === '100 g') return true;
  if (/^\d+\s*g$/.test(normalized)) return true;
  return false;
}

export function getDefaultUnitPolicyForItem(input: {
  kind: 'food' | 'drink';
  name: string;
  categoryTags?: string[];
  defaultUnitPolicy?: DefaultUnitPolicy;
}): DefaultUnitPolicy {
  if (input.defaultUnitPolicy === 'serving_first' || input.defaultUnitPolicy === 'weight_first') {
    return input.defaultUnitPolicy;
  }
  if (input.kind === 'drink') return 'weight_first';

  const name = sanitizeName(input.name || '');
  if (SERVING_FIRST_NAME_TOKENS.some((token) => name.includes(token))) return 'serving_first';
  const tags = (Array.isArray(input.categoryTags) ? input.categoryTags : []).map((t) => sanitizeName(String(t)));
  if (tags.some((t) => t.includes('restaurant') || t.includes('prepared') || t.includes('fast food'))) return 'serving_first';
  return 'weight_first';
}

export function ensureBaselineServingSizes(input: {
  kind: 'food' | 'drink';
  servingSizes?: PreparedServingSize[];
}): PreparedServingSize[] {
  const sizes = Array.isArray(input.servingSizes) ? input.servingSizes.slice() : [];
  if (sizes.length > 0) return sizes;
  return [
    {
      label: input.kind === 'drink' ? '100ml' : '100g',
      ...(input.kind === 'drink' ? { ml: 100 } : { grams: 100 }),
      default: true,
    },
  ];
}

function injectedPreparedServings(name: string): PreparedServingSize[] | null {
  const normalized = sanitizeName(name);
  if (normalized.includes('pizza')) {
    const sliceG = 110;
    return [
      { label: 'Slice (regular)', grams: sliceG, default: true, estimated: true },
      { label: 'Slice (thin)', grams: 85, estimated: true },
      { label: 'Slice (deep dish)', grams: 140, estimated: true },
      { label: 'Half pizza', grams: sliceG * 4, estimated: true },
      { label: 'Whole pizza', grams: sliceG * 8, estimated: true },
    ];
  }
  if (normalized.includes('burger')) return [{ label: '1 burger', grams: 180, default: true, estimated: true }];
  if (normalized.includes('sandwich')) return [{ label: '1 sandwich', grams: 160, default: true, estimated: true }];
  if (normalized.includes('bagel')) return [{ label: '1 bagel', grams: 95, default: true, estimated: true }];
  if (normalized.includes('taco')) return [{ label: '1 taco', grams: 70, default: true, estimated: true }];
  if (normalized.includes('burrito')) return [{ label: '1 burrito', grams: 220, default: true, estimated: true }];
  if (normalized.includes('cake')) return [{ label: '1 slice', grams: 120, default: true, estimated: true }];
  if (normalized.includes('cookie')) return [{ label: '1 cookie', grams: 15, default: true, estimated: true }];
  if (normalized.includes('donut') || normalized.includes('doughnut')) return [{ label: '1 donut', grams: 70, default: true, estimated: true }];
  if (normalized.includes('fries')) return [{ label: '1 serving', grams: 120, default: true, estimated: true }];
  if (normalized.includes('wing')) return [{ label: '1 wing', grams: 35, default: true, estimated: true }];
  return null;
}

function hasHumanServingLabel(sizes: PreparedServingSize[]) {
  return sizes.some((row) => {
    const label = sanitizeName(String(row.label || ''));
    if (!label) return false;
    if (isGenericWeightServingLabel(label)) return false;
    return /\b(piece|item|slice|stick|wing|bar|cookie|donut|doughnut|egg|banana|apple|orange|bagel|taco|burrito|burger|sandwich|serving)\b/.test(label);
  });
}

function inferredPieceServing(name: string): PreparedServingSize | null {
  const normalized = sanitizeName(name);
  if (!normalized) return null;

  const map: Array<{ tokens: string[]; label: string; grams: number }> = [
    { tokens: ['mozzarella', 'stick'], label: '1 stick', grams: 28 },
    { tokens: ['chicken', 'nugget'], label: '1 piece', grams: 17 },
    { tokens: ['meatball'], label: '1 meatball', grams: 28 },
    { tokens: ['dumpling'], label: '1 dumpling', grams: 24 },
    { tokens: ['spring', 'roll'], label: '1 roll', grams: 45 },
    { tokens: ['sushi'], label: '1 piece', grams: 20 },
    { tokens: ['sausage', 'link'], label: '1 link', grams: 70 },
    { tokens: ['hot', 'dog'], label: '1 hot dog', grams: 52 },
    { tokens: ['shrimp'], label: '1 shrimp', grams: 12 },
    { tokens: ['egg'], label: '1 egg', grams: 50 },
    { tokens: ['strawberry'], label: '1 strawberry', grams: 12 },
    { tokens: ['grape'], label: '1 grape', grams: 5 },
    { tokens: ['olive'], label: '1 olive', grams: 4 },
    { tokens: ['cracker'], label: '1 cracker', grams: 4 },
    { tokens: ['chip'], label: '1 chip', grams: 2.2 },
    { tokens: ['cookie'], label: '1 cookie', grams: 15 },
    { tokens: ['donut'], label: '1 donut', grams: 70 },
    { tokens: ['doughnut'], label: '1 doughnut', grams: 70 },
    { tokens: ['wing'], label: '1 wing', grams: 35 },
    { tokens: ['slice'], label: '1 slice', grams: 35 },
    { tokens: ['pizza'], label: '1 slice', grams: 110 },
  ];

  for (const row of map) {
    if (row.tokens.every((token) => normalized.includes(token))) {
      return { label: row.label, grams: row.grams, estimated: true };
    }
  }

  // Broad fallback: many branded/packaged foods can still be logged per item.
  if (/\b(bar|biscuit|brownie|muffin|cupcake|macaron|truffle|nuggets?|strips?|tenders?|bites?)\b/.test(normalized)) {
    return { label: '1 piece', grams: 30, estimated: true };
  }

  return null;
}

export function getEffectiveServingSizesForItem(input: {
  kind: 'food' | 'drink';
  name: string;
  categoryTags?: string[];
  defaultUnitPolicy?: DefaultUnitPolicy;
  servingSizes?: PreparedServingSize[];
}): PreparedServingSize[] {
  const policy = getDefaultUnitPolicyForItem({
    kind: input.kind,
    name: input.name,
    categoryTags: input.categoryTags,
    defaultUnitPolicy: input.defaultUnitPolicy,
  });
  const baseline = ensureBaselineServingSizes({ kind: input.kind, servingSizes: input.servingSizes });

  if (input.kind !== 'food') return baseline;

  const hasHuman = hasHumanServingLabel(baseline);
  let out = baseline.slice();

  if (policy === 'serving_first' && !hasHuman) {
    const injected = injectedPreparedServings(input.name);
    if (injected && injected.length > 0) {
      out = [...injected, ...out.map((row) => ({ ...row, default: false }))];
    }
  }

  // Universal "per item/piece" path: when no human serving exists, infer a single-piece option.
  if (!hasHumanServingLabel(out)) {
    const piece = inferredPieceServing(input.name);
    if (piece) {
      out = [{ ...piece, default: policy === 'serving_first' }, ...out.map((row) => ({ ...row, default: policy === 'serving_first' ? false : Boolean(row.default) }))];
    }
  }

  return out;
}
