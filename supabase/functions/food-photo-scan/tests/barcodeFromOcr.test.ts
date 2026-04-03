import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { extractBarcodesFromOcr, normalizeBarcodeCandidates, isValidEan13, isValidUpcA } from '../barcodeFromOcr.ts';

Deno.test('extractBarcodesFromOcr finds digit sequences (normalized)', () => {
  const ocr = `
    Nutrition Facts
    UPC 0360 0029-1452
    Some other text 4006381333931 end
  `;
  const raw = extractBarcodesFromOcr(ocr);
  // Order is not guaranteed here, just existence.
  assertEquals(raw.includes('036000291452'), true);
  assertEquals(raw.includes('4006381333931'), true);
});

Deno.test('normalizeBarcodeCandidates keeps only valid and ranks EAN-13 before UPC-A', () => {
  const codes = ['4006381333931', '036000291452', '4006381333932', '123456789012'];
  const norm = normalizeBarcodeCandidates(codes);
  assertEquals(norm[0], '4006381333931');
  assertEquals(norm.includes('036000291452'), true);
  assertEquals(norm.includes('4006381333932'), false);
});

Deno.test('check digit validators work for known good codes', () => {
  assertEquals(isValidEan13('4006381333931'), true);
  assertEquals(isValidEan13('4006381333932'), false);
  assertEquals(isValidUpcA('036000291452'), true);
});

