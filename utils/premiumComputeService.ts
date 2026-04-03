import { isSupabaseConfigured, supabase } from './supabaseClient';

export async function computeTrainingLoad(input?: { fromDay?: string; toDay?: string }) {
  if (!isSupabaseConfigured) throw new Error('supabase_not_configured');
  const { data, error } = await supabase.functions.invoke('compute-training-load', {
    body: { fromDay: input?.fromDay, toDay: input?.toDay },
  });
  if (error) throw error;
  return data as any;
}

export async function computeNutritionAggregates(input?: { fromDay?: string; toDay?: string }) {
  if (!isSupabaseConfigured) throw new Error('supabase_not_configured');
  const { data, error } = await supabase.functions.invoke('compute-nutrition-aggregates', {
    body: { fromDay: input?.fromDay, toDay: input?.toDay },
  });
  if (error) throw error;
  return data as any;
}

export async function computeReadiness(input?: { day?: string }) {
  if (!isSupabaseConfigured) throw new Error('supabase_not_configured');
  const { data, error } = await supabase.functions.invoke('compute-readiness', {
    body: { day: input?.day },
  });
  if (error) throw error;
  return data as any;
}

export async function computeInsights(input?: { day?: string }) {
  if (!isSupabaseConfigured) throw new Error('supabase_not_configured');
  const { data, error } = await supabase.functions.invoke('compute-insights', {
    body: { day: input?.day },
  });
  if (error) throw error;
  return data as any;
}

