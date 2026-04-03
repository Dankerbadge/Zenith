import { type LocationPoint } from './gpsService';

function toRad(value: number) {
  return (value * Math.PI) / 180;
}

function distanceMeters(a: LocationPoint, b: LocationPoint) {
  const R = 6371000;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
}

function toXYMeters(origin: LocationPoint, point: LocationPoint) {
  const latScale = 111320;
  const lonScale = Math.cos(toRad(origin.latitude)) * 111320;
  return {
    x: (point.longitude - origin.longitude) * lonScale,
    y: (point.latitude - origin.latitude) * latScale,
  };
}

function pointToSegmentDistanceMeters(point: LocationPoint, start: LocationPoint, end: LocationPoint) {
  const origin = start;
  const p = toXYMeters(origin, point);
  const a = toXYMeters(origin, start);
  const b = toXYMeters(origin, end);

  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const abLenSq = abx * abx + aby * aby;
  if (abLenSq === 0) {
    return Math.hypot(apx, apy);
  }

  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLenSq));
  const projX = a.x + abx * t;
  const projY = a.y + aby * t;
  return Math.hypot(p.x - projX, p.y - projY);
}

function rdp(points: LocationPoint[], epsilonMeters: number): LocationPoint[] {
  if (points.length <= 2) return points;

  let maxDistance = 0;
  let index = 0;
  const start = points[0];
  const end = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i += 1) {
    const dist = pointToSegmentDistanceMeters(points[i], start, end);
    if (dist > maxDistance) {
      maxDistance = dist;
      index = i;
    }
  }

  if (maxDistance > epsilonMeters) {
    const left = rdp(points.slice(0, index + 1), epsilonMeters);
    const right = rdp(points.slice(index), epsilonMeters);
    return [...left.slice(0, -1), ...right];
  }

  return [start, end];
}

export function simplifyRoute(
  route: LocationPoint[],
  options?: { minDistanceMeters?: number; epsilonMeters?: number }
): LocationPoint[] {
  if (!Array.isArray(route) || route.length <= 2) return route;

  const minDistanceMeters = Math.max(1, options?.minDistanceMeters ?? 4);
  const epsilonMeters = Math.max(2, options?.epsilonMeters ?? 8);

  const filtered: LocationPoint[] = [route[0]];
  for (let i = 1; i < route.length - 1; i += 1) {
    const prev = filtered[filtered.length - 1];
    if (distanceMeters(prev, route[i]) >= minDistanceMeters) {
      filtered.push(route[i]);
    }
  }
  filtered.push(route[route.length - 1]);

  if (filtered.length <= 2) return filtered;
  return rdp(filtered, epsilonMeters);
}
