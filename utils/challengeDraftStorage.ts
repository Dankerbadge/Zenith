import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_PREFIX = 'challengeWizardDraftV1:';

export type DraftChallenge = {
  activityType: string;
  mode: 'SINGLE_SESSION' | 'CUMULATIVE';
  scoreType: string;
  target: {
    distanceM?: number | null;
    timeS?: number | null;
    paceSPerKm?: number | null;
    splits?: {
      splitType: 'DISTANCE' | 'TIME';
      splitUnitM?: number | null;
      numSplits?: number | null;
      maxSplitTimeS?: number | null;
      maxPaceSPerKm?: number | null;
      mustNegativeSplit?: boolean | null;
      toleranceS?: number | null;
    } | null;
  };
  constraints: {
    locationRequirement: 'OUTDOOR_ONLY' | 'INDOOR_ONLY' | 'EITHER';
    requiresRoute: boolean;
    requiresNonUserEntered: boolean;
    allowedSources: Array<'WATCH' | 'PHONE' | 'IMPORT'>;
    distanceTolerancePct: number;
    allowLongerWorkoutForDistanceGoal: boolean;
    minDurationS?: number | null;
    minDistanceM?: number | null;
  };
  attemptPolicy: {
    attemptsAllowed: 'UNLIMITED' | 'FIRST_ONLY' | 'BEST_ONLY';
    bestBy: 'TIME_ASC' | 'DIST_DESC' | 'PACE_ASC';
  };
  window: {
    startTs: string;
    endTs: string;
    timezone: string;
  };
  title: string;
  description?: string;
  participants: {
    userIds: string[];
    teamIds: string[];
    teamFanout: boolean;
  };
};

function key(userId: string) {
  return `${KEY_PREFIX}${String(userId || 'anon')}`;
}

export async function loadChallengeDraft(userId: string): Promise<DraftChallenge | null> {
  try {
    const raw = await AsyncStorage.getItem(key(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as DraftChallenge;
  } catch {
    return null;
  }
}

export async function saveChallengeDraft(userId: string, draft: DraftChallenge): Promise<void> {
  try {
    await AsyncStorage.setItem(key(userId), JSON.stringify(draft));
  } catch {
    // ignore
  }
}

export async function clearChallengeDraft(userId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key(userId));
  } catch {
    // ignore
  }
}

