// Google Encoded Polyline Algorithm Format (minimal implementation).
// Used for storing routes compactly and deterministically.

export type LatLng = { latitude: number; longitude: number };

function encodeSigned(value: number) {
  let s = value < 0 ? ~(value << 1) : value << 1;
  let out = '';
  while (s >= 0x20) {
    out += String.fromCharCode((0x20 | (s & 0x1f)) + 63);
    s >>= 5;
  }
  out += String.fromCharCode(s + 63);
  return out;
}

export function encodePolyline(points: LatLng[]): string {
  let lastLat = 0;
  let lastLon = 0;
  let result = '';
  for (const p of points) {
    const lat = Math.round(p.latitude * 1e5);
    const lon = Math.round(p.longitude * 1e5);
    result += encodeSigned(lat - lastLat);
    result += encodeSigned(lon - lastLon);
    lastLat = lat;
    lastLon = lon;
  }
  return result;
}

function decodeChunk(str: string, index: number) {
  let result = 0;
  let shift = 0;
  let b = 0;
  let i = index;
  do {
    if (i >= str.length) return { value: 0, next: str.length };
    b = str.charCodeAt(i++) - 63;
    result |= (b & 0x1f) << shift;
    shift += 5;
  } while (b >= 0x20);

  const delta = (result & 1) ? ~(result >> 1) : result >> 1;
  return { value: delta, next: i };
}

export function decodePolyline(encoded: string): LatLng[] {
  const str = String(encoded || '');
  const out: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  while (index < str.length) {
    const dLat = decodeChunk(str, index);
    index = dLat.next;
    const dLon = decodeChunk(str, index);
    index = dLon.next;
    lat += dLat.value;
    lon += dLon.value;
    out.push({ latitude: lat / 1e5, longitude: lon / 1e5 });
  }
  return out;
}

export function bboxForPoints(points: LatLng[]) {
  if (!points.length) return null;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let minLon = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    minLat = Math.min(minLat, p.latitude);
    maxLat = Math.max(maxLat, p.latitude);
    minLon = Math.min(minLon, p.longitude);
    maxLon = Math.max(maxLon, p.longitude);
  }
  return { minLat, minLon, maxLat, maxLon };
}

