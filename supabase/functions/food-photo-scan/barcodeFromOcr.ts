export function extractBarcodesFromOcr(ocrText: string): string[] {
  const raw = String(ocrText || '');
  if (!raw.trim()) return [];

  // Normalize spacing/hyphens that OCR often inserts into UPC/EAN.
  const normalized = raw.replace(/[\s-]+/g, '');
  const re = /(?<!\d)(\d{8}|\d{12}|\d{13}|\d{14})(?!\d)/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalized))) {
    out.push(m[1]);
    if (out.length >= 30) break;
  }
  return out;
}

function digitsOnly(s: string) {
  return String(s || '').replace(/\D/g, '');
}

function modulo10CheckDigit(payloadDigits: string, weightsFromRight: number[]) {
  const d = digitsOnly(payloadDigits);
  let sum = 0;
  let wIdx = 0;
  for (let i = d.length - 1; i >= 0; i -= 1) {
    const n = Number(d[i]);
    if (!Number.isFinite(n)) return null;
    const w = weightsFromRight[wIdx % weightsFromRight.length];
    sum += n * w;
    wIdx += 1;
  }
  const cd = (10 - (sum % 10)) % 10;
  return cd;
}

export function isValidEan13(code: string) {
  const d = digitsOnly(code);
  if (!/^\d{13}$/.test(d)) return false;
  const payload = d.slice(0, 12);
  const expected = modulo10CheckDigit(payload, [3, 1]);
  return expected != null && expected === Number(d[12]);
}

export function isValidUpcA(code: string) {
  const d = digitsOnly(code);
  if (!/^\d{12}$/.test(d)) return false;
  const payload = d.slice(0, 11);
  const expected = modulo10CheckDigit(payload, [3, 1]);
  return expected != null && expected === Number(d[11]);
}

export function isValidEan8(code: string) {
  const d = digitsOnly(code);
  if (!/^\d{8}$/.test(d)) return false;
  const payload = d.slice(0, 7);
  const expected = modulo10CheckDigit(payload, [3, 1]);
  return expected != null && expected === Number(d[7]);
}

export function isValidItf14(code: string) {
  const d = digitsOnly(code);
  if (!/^\d{14}$/.test(d)) return false;
  const payload = d.slice(0, 13);
  const expected = modulo10CheckDigit(payload, [3, 1]);
  return expected != null && expected === Number(d[13]);
}

export function normalizeBarcodeCandidates(codes: string[]): string[] {
  const uniq: string[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(codes) ? codes : []) {
    const d = digitsOnly(raw);
    if (!d) continue;
    if (seen.has(d)) continue;
    seen.add(d);
    uniq.push(d);
  }

  const valid: string[] = [];
  for (const d of uniq) {
    const ok =
      (d.length === 13 && isValidEan13(d)) ||
      (d.length === 12 && isValidUpcA(d)) ||
      (d.length === 8 && isValidEan8(d)) ||
      (d.length === 14 && isValidItf14(d));
    if (ok) valid.push(d);
  }

  // Rank: EAN-13, UPC-A, EAN-8, ITF-14. Cap at 3.
  const rank = (d: string) => (d.length === 13 ? 1 : d.length === 12 ? 2 : d.length === 8 ? 3 : 4);
  return valid.sort((a, b) => rank(a) - rank(b)).slice(0, 3);
}

