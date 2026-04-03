import AsyncStorage from '@react-native-async-storage/async-storage';

type RawRunHistoryEntry = {
  runId?: string;
  timestamp?: string;
  kind?: 'gps_outdoor' | 'manual_treadmill' | 'manual_distance';
  distance?: number;
  averagePace?: number;
  confidenceSummary?: {
    distanceConfidence?: number;
    paceConfidence?: number;
    hrConfidence?: number | null;
  };
  diagnostics?: {
    estimatedGapDistanceMiles?: number;
  };
};

export type ConfidenceWeightedRunTrend = {
  runCount: number;
  weightedRuns: number;
  weightedAveragePace: number | null;
  weightedAverageDistanceMiles: number | null;
  trendDeltaPace: number | null;
  trendLabel: 'improving' | 'stable' | 'slower' | 'insufficient_data';
  confidenceCoveragePct: number;
  lowConfidenceRuns: number;
};

function safeParseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function runWeight(run: RawRunHistoryEntry): number {
  const distanceConfidence = Number(run.confidenceSummary?.distanceConfidence);
  const estimatedGapDistanceMiles = Math.max(0, Number(run.diagnostics?.estimatedGapDistanceMiles) || 0);
  const kind = String(run.kind || '');

  let weight = Number.isFinite(distanceConfidence) ? distanceConfidence / 100 : 0.65;
  if (estimatedGapDistanceMiles > 0) {
    weight *= 0.85;
  }
  if (kind === 'manual_treadmill' || kind === 'manual_distance') {
    weight *= 0.6;
  }
  return clamp(weight, 0.2, 1);
}

function weightedAverage(values: Array<{ value: number; weight: number }>): number | null {
  const valid = values.filter((row) => Number.isFinite(row.value) && Number.isFinite(row.weight) && row.weight > 0);
  if (!valid.length) return null;
  const numerator = valid.reduce((sum, row) => sum + row.value * row.weight, 0);
  const denominator = valid.reduce((sum, row) => sum + row.weight, 0);
  if (denominator <= 0) return null;
  return numerator / denominator;
}

export async function getConfidenceWeightedRunTrend(input: {
  rangeDays: number;
}): Promise<ConfidenceWeightedRunTrend> {
  const raw = await AsyncStorage.getItem('runsHistory');
  const history = safeParseJson<RawRunHistoryEntry[]>(raw, []);
  const now = Date.now();
  const lowerBound = now - Math.max(1, Math.round(input.rangeDays)) * 24 * 60 * 60 * 1000;

  const runs = (Array.isArray(history) ? history : [])
    .filter((row) => {
      const ts = Date.parse(String(row.timestamp || ''));
      return Number.isFinite(ts) && ts >= lowerBound;
    })
    .sort((a, b) => Date.parse(String(a.timestamp || '')) - Date.parse(String(b.timestamp || '')));

  if (!runs.length) {
    return {
      runCount: 0,
      weightedRuns: 0,
      weightedAveragePace: null,
      weightedAverageDistanceMiles: null,
      trendDeltaPace: null,
      trendLabel: 'insufficient_data',
      confidenceCoveragePct: 0,
      lowConfidenceRuns: 0,
    };
  }

  const weightedSamples = runs.map((run) => {
    const pace = Number(run.averagePace) || 0;
    const distance = Number(run.distance) || 0;
    return {
      pace,
      distance,
      weight: runWeight(run),
    };
  });

  const confidenceCoveragePct = Math.round(
    (weightedSamples.reduce((sum, row) => sum + row.weight, 0) / Math.max(1, weightedSamples.length)) * 100
  );
  const lowConfidenceRuns = weightedSamples.filter((row) => row.weight < 0.7).length;
  const weightedAveragePace = weightedAverage(
    weightedSamples
      .filter((row) => row.pace > 0)
      .map((row) => ({ value: row.pace, weight: row.weight }))
  );
  const weightedAverageDistanceMiles = weightedAverage(
    weightedSamples
      .filter((row) => row.distance > 0)
      .map((row) => ({ value: row.distance, weight: row.weight }))
  );

  const midpoint = Math.floor(weightedSamples.length / 2);
  const previousSlice = weightedSamples.slice(0, midpoint);
  const recentSlice = weightedSamples.slice(midpoint);
  const previousPace = weightedAverage(
    previousSlice.filter((row) => row.pace > 0).map((row) => ({ value: row.pace, weight: row.weight }))
  );
  const recentPace = weightedAverage(
    recentSlice.filter((row) => row.pace > 0).map((row) => ({ value: row.pace, weight: row.weight }))
  );
  const trendDeltaPace =
    previousPace !== null && recentPace !== null ? Number((recentPace - previousPace).toFixed(2)) : null;

  let trendLabel: ConfidenceWeightedRunTrend['trendLabel'] = 'insufficient_data';
  if (trendDeltaPace !== null) {
    trendLabel = trendDeltaPace <= -0.15 ? 'improving' : trendDeltaPace >= 0.15 ? 'slower' : 'stable';
  }

  return {
    runCount: runs.length,
    weightedRuns: weightedSamples.filter((row) => row.weight >= 0.7).length,
    weightedAveragePace:
      weightedAveragePace !== null ? Number(weightedAveragePace.toFixed(2)) : null,
    weightedAverageDistanceMiles:
      weightedAverageDistanceMiles !== null ? Number(weightedAverageDistanceMiles.toFixed(2)) : null,
    trendDeltaPace,
    trendLabel,
    confidenceCoveragePct,
    lowConfidenceRuns,
  };
}
