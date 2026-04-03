import { supabase, isSupabaseConfigured } from './supabaseClient';

export type PhotoScanCandidate = {
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
  confidence: { score: number; tier: 'HIGH' | 'MEDIUM' | 'LOW'; reasons: string[] };
};

export type PhotoScanResponse = {
  scanId: string;
  isPackagedLikely: boolean;
  visionSummary?: { labels?: string[]; webEntities?: string[] };
  candidates: PhotoScanCandidate[];
  warnings: string[];
};

export async function photoScanFood(input: { imageBase64: string; locale?: string }) {
  if (!isSupabaseConfigured) {
    throw new Error('supabase_not_configured');
  }

  const locale = String(input.locale || 'en-US').trim() || 'en-US';
  const imageBase64 = String(input.imageBase64 || '').trim();
  if (!imageBase64) throw new Error('missing_image');

  const { data, error } = await supabase.functions.invoke('food-photo-scan', {
    body: { imageBase64, locale },
  });

  if (error) throw error;
  return data as PhotoScanResponse;
}

