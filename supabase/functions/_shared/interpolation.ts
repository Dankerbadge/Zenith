type RoutePoint = {
  dist_m: number;
  ts: string | number | Date;
  seq?: number;
  lat?: number;
  lon?: number;
};

const EPS = 1e-6;

function toMs(ts: string | number | Date): number {
  if (typeof ts === 'number') return ts;
  if (ts instanceof Date) return ts.getTime();
  return Date.parse(String(ts));
}

export function assertMonotonic(points: RoutePoint[]) {
  if (!Array.isArray(points) || points.length < 2) throw new Error('Not enough route points.');
  let prevD = Number(points[0]?.dist_m);
  let prevT = toMs(points[0]?.ts);
  if (!Number.isFinite(prevD) || !Number.isFinite(prevT)) throw new Error('Invalid first point.');
  for (let i = 1; i < points.length; i += 1) {
    const d = Number(points[i]?.dist_m);
    const t = toMs(points[i]?.ts);
    if (!Number.isFinite(d) || !Number.isFinite(t)) throw new Error(`Invalid point at index ${i}.`);
    if (d + EPS < prevD) throw new Error(`Non-monotonic distance at index ${i}.`);
    if (t + EPS < prevT) throw new Error(`Non-monotonic time at index ${i}.`);
    prevD = d;
    prevT = t;
  }
}

function getRelativeTimeSec(points: RoutePoint[], index: number) {
  const t0 = toMs(points[0].ts);
  const ti = toMs(points[index].ts);
  return (ti - t0) / 1000;
}

export function interpolateTimeAtDistance(points: RoutePoint[], targetDistM: number): number | null {
  if (!Array.isArray(points) || points.length < 2 || !Number.isFinite(targetDistM)) return null;
  assertMonotonic(points);
  const firstDist = Number(points[0].dist_m);
  const lastDist = Number(points[points.length - 1].dist_m);
  if (targetDistM < firstDist - EPS || targetDistM > lastDist + EPS) return null;
  const tStart = toMs(points[0].ts);

  for (let i = 0; i < points.length - 1; i += 1) {
    const d0 = Number(points[i].dist_m);
    let d1 = Number(points[i + 1].dist_m);
    const t0 = toMs(points[i].ts);
    let t1 = toMs(points[i + 1].ts);
    if (targetDistM + EPS < d0 || targetDistM - EPS > d1) continue;

    if (Math.abs(d1 - d0) <= EPS) {
      let j = i + 1;
      while (j < points.length - 1 && Math.abs(Number(points[j + 1].dist_m) - Number(points[j].dist_m)) <= EPS) j += 1;
      if (j >= points.length - 1) return null;
      d1 = Number(points[j + 1].dist_m);
      t1 = toMs(points[j + 1].ts);
      if (Math.abs(d1 - d0) <= EPS) return null;
    }
    const fraction = (targetDistM - d0) / (d1 - d0);
    const t = t0 + fraction * (t1 - t0);
    return (t - tStart) / 1000;
  }
  return null;
}

export function interpolateDistanceAtTime(points: RoutePoint[], targetTimeMsFromStart: number): number | null {
  if (!Array.isArray(points) || points.length < 2 || !Number.isFinite(targetTimeMsFromStart)) return null;
  assertMonotonic(points);
  const t0 = toMs(points[0].ts);
  const targetMs = t0 + targetTimeMsFromStart;
  if (targetMs < t0 - EPS) return null;
  const tLast = toMs(points[points.length - 1].ts);
  if (targetMs > tLast + EPS) return null;

  for (let i = 0; i < points.length - 1; i += 1) {
    const a = toMs(points[i].ts);
    const b = toMs(points[i + 1].ts);
    if (targetMs + EPS < a || targetMs - EPS > b) continue;
    if (Math.abs(b - a) <= EPS) return Number(points[i].dist_m);
    const fraction = (targetMs - a) / (b - a);
    const d0 = Number(points[i].dist_m);
    const d1 = Number(points[i + 1].dist_m);
    return d0 + fraction * (d1 - d0);
  }
  return null;
}

export function computeDistanceSplits(
  points: RoutePoint[],
  splitUnitM: number,
  opts: { numSplits?: number | null; targetDistanceM?: number | null }
): { splitTimesS: number[]; boundaryTimesS: number[] } | null {
  if (!Number.isFinite(splitUnitM) || splitUnitM <= 0) return null;
  assertMonotonic(points);
  const boundaries: number[] = [];
  const maxDist = Number(points[points.length - 1].dist_m);

  if (Number.isFinite(Number(opts?.numSplits)) && Number(opts.numSplits) > 0) {
    const count = Math.floor(Number(opts.numSplits));
    for (let i = 1; i <= count; i += 1) boundaries.push(i * splitUnitM);
  } else if (Number.isFinite(Number(opts?.targetDistanceM)) && Number(opts.targetDistanceM) > 0) {
    let k = 1;
    while (k * splitUnitM <= Number(opts.targetDistanceM) + EPS) {
      boundaries.push(k * splitUnitM);
      k += 1;
    }
  } else {
    return null;
  }

  if (!boundaries.length) return null;
  if (boundaries[boundaries.length - 1] > maxDist + EPS) return null;
  const boundaryTimesS: number[] = [];
  for (const d of boundaries) {
    const t = interpolateTimeAtDistance(points, d);
    if (t == null || !Number.isFinite(t)) return null;
    boundaryTimesS.push(t);
  }
  const splitTimesS = boundaryTimesS.map((t, i) => (i === 0 ? t : t - boundaryTimesS[i - 1]));
  return { splitTimesS, boundaryTimesS };
}

export function computeTimeSplits(
  points: RoutePoint[],
  splitEveryS: number,
  numSplits: number
): { splitDistancesM: number[]; boundaryDistancesM: number[] } | null {
  if (!Number.isFinite(splitEveryS) || splitEveryS <= 0 || !Number.isFinite(numSplits) || numSplits <= 0) return null;
  assertMonotonic(points);
  const boundaryDistancesM: number[] = [];
  for (let i = 1; i <= Math.floor(numSplits); i += 1) {
    const d = interpolateDistanceAtTime(points, i * splitEveryS * 1000);
    if (d == null || !Number.isFinite(d)) return null;
    boundaryDistancesM.push(d);
  }
  const splitDistancesM = boundaryDistancesM.map((d, i) => (i === 0 ? d : d - boundaryDistancesM[i - 1]));
  return { splitDistancesM, boundaryDistancesM };
}

export function bestEffortTimeForDistance(
  points: RoutePoint[],
  targetDistM: number
): { bestTimeS: number; startIndex: number; endIndex: number } | null {
  if (!Array.isArray(points) || points.length < 2 || !Number.isFinite(targetDistM) || targetDistM <= 0) return null;
  assertMonotonic(points);

  const n = points.length;
  const dist = points.map((p) => Number(p.dist_m));
  const rt = points.map((_, i) => getRelativeTimeSec(points, i));
  if (dist[n - 1] - dist[0] + EPS < targetDistM) return null;

  let j = 1;
  let bestTime = Number.POSITIVE_INFINITY;
  let bestI = -1;
  let bestJ = -1;

  for (let i = 0; i < n - 1; i += 1) {
    if (j < i + 1) j = i + 1;
    while (j < n && dist[j] - dist[i] + EPS < targetDistM) j += 1;
    if (j >= n) break;

    const endTargetDist = dist[i] + targetDistM;
    const endTimeFromStart = interpolateTimeAtDistance(points, endTargetDist);
    if (endTimeFromStart == null || !Number.isFinite(endTimeFromStart)) continue;
    const segmentTime = endTimeFromStart - rt[i];
    if (segmentTime > 0 && segmentTime < bestTime) {
      bestTime = segmentTime;
      bestI = i;
      bestJ = j;
    }
  }

  if (!Number.isFinite(bestTime) || bestI < 0 || bestJ < 0) return null;
  return { bestTimeS: bestTime, startIndex: bestI, endIndex: bestJ };
}
