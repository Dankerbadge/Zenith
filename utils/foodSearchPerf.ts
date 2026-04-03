import AsyncStorage from "@react-native-async-storage/async-storage";

export type FoodSearchPerfSource = "discover" | "cache" | "remote" | "cloud";

export type FoodSearchPerfEvent = {
  query: string;
  region: { country?: string; admin?: string; language?: string };
  source: FoodSearchPerfSource;
  durationMs: number;
  resultCount: number;
  recordedAt: string; // ISO
};

const PERF_KEY = "zenith.foodSearchPerf.v1";
const MAX_EVENTS = 120;

export async function recordFoodSearchPerf(event: FoodSearchPerfEvent) {
  try {
    const raw = await AsyncStorage.getItem(PERF_KEY);
    const existing = raw ? (JSON.parse(raw) as FoodSearchPerfEvent[]) : [];
    const next = [event, ...(Array.isArray(existing) ? existing : [])].slice(0, MAX_EVENTS);
    await AsyncStorage.setItem(PERF_KEY, JSON.stringify(next));
  } catch {
    // Perf logging must never break search.
  }
}

export async function getFoodSearchPerfEvents(): Promise<FoodSearchPerfEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(PERF_KEY);
    const existing = raw ? (JSON.parse(raw) as FoodSearchPerfEvent[]) : [];
    return Array.isArray(existing) ? existing : [];
  } catch {
    return [];
  }
}
