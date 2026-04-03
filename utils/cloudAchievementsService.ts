import { isSupabaseConfigured, supabase } from './supabaseClient';

export type CloudAchievementRow = {
  achievementId: string;
  key: string;
  title: string;
  description: string;
  icon: string | null;
  points: number;
  earnedAt: string | null;
  progressValue: number;
  progressPct: number;
};

export async function recomputeCloudAchievements(userId?: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  const { error } = await supabase.functions.invoke('achievements-recompute', {
    body: userId ? { userId } : {},
  });
  if (error) throw error;
}

export async function fetchCloudAchievements(): Promise<CloudAchievementRow[]> {
  if (!isSupabaseConfigured) return [];
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return [];

  const { data, error } = await supabase
    .from('user_achievements')
    .select(
      `
      achievement_id,
      progress_value,
      progress,
      earned_at,
      achievements_definitions:achievement_id (
        key,title,description,icon,points
      )
    `
    )
    .eq('user_id', user.id);
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  return rows.map((r: any) => ({
    achievementId: String(r?.achievement_id || ''),
    key: String(r?.achievements_definitions?.key || ''),
    title: String(r?.achievements_definitions?.title || ''),
    description: String(r?.achievements_definitions?.description || ''),
    icon: r?.achievements_definitions?.icon ? String(r.achievements_definitions.icon) : null,
    points: Number(r?.achievements_definitions?.points || 0),
    earnedAt: r?.earned_at ? String(r.earned_at) : null,
    progressValue: Number(r?.progress_value || 0),
    progressPct: Number(r?.progress?.pct || 0),
  }));
}
