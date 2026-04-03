import AsyncStorage from '@react-native-async-storage/async-storage';

export type CoachAccessMode = 'training_only' | 'all_data';

const KEY_PREFIX = 'coachAccessPolicyV1:team:';

function keyForTeam(teamId: string) {
  return `${KEY_PREFIX}${String(teamId || '').trim()}`;
}

export async function getCoachAccessModeForTeam(teamId: string): Promise<CoachAccessMode> {
  const key = keyForTeam(teamId);
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw === 'all_data' ? 'all_data' : 'training_only';
  } catch {
    return 'training_only';
  }
}

export async function setCoachAccessModeForTeam(teamId: string, mode: CoachAccessMode): Promise<void> {
  const key = keyForTeam(teamId);
  const value = mode === 'all_data' ? 'all_data' : 'training_only';
  try {
    await AsyncStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

