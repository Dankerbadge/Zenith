import { Linking, Platform } from 'react-native';

type PermissionState = 'granted' | 'partial' | 'denied';

function getModule(): any | null {
  if (Platform.OS !== 'android') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('react-native-health-connect');
  } catch {
    return null;
  }
}

export async function isHealthConnectAvailable(): Promise<{ available: boolean; needsInstall: boolean }> {
  const mod = getModule();
  if (!mod) return { available: false, needsInstall: false };
  try {
    if (typeof mod.getSdkStatus === 'function') {
      const status = await mod.getSdkStatus();
      const available =
        status === mod.SdkAvailabilityStatus?.SDK_AVAILABLE ||
        status === 'SDK_AVAILABLE' ||
        String(status).toUpperCase().includes('AVAILABLE');
      const needsInstall = String(status).toUpperCase().includes('PROVIDER_UPDATE_REQUIRED') || String(status).toUpperCase().includes('NOT_INSTALLED');
      return { available, needsInstall };
    }
    return { available: true, needsInstall: false };
  } catch {
    return { available: false, needsInstall: false };
  }
}

const REQUIRED_PERMS = [
  { accessType: 'read', recordType: 'ExerciseSession' },
  { accessType: 'read', recordType: 'Steps' },
  { accessType: 'read', recordType: 'Distance' },
  { accessType: 'read', recordType: 'ActiveCaloriesBurned' },
  { accessType: 'read', recordType: 'HeartRate' },
];

export async function requestHealthConnectPermissions(): Promise<PermissionState> {
  const mod = getModule();
  if (!mod) return 'denied';
  try {
    if (typeof mod.initialize === 'function') await mod.initialize();
    const granted = (await mod.requestPermission?.(REQUIRED_PERMS)) || [];
    if (!Array.isArray(granted)) return 'denied';
    if (granted.length >= REQUIRED_PERMS.length) return 'granted';
    return granted.length > 0 ? 'partial' : 'denied';
  } catch {
    return 'denied';
  }
}

export async function getHealthConnectPermissionStatus(): Promise<PermissionState> {
  const mod = getModule();
  if (!mod) return 'denied';
  try {
    const granted = (await mod.getGrantedPermissions?.()) || [];
    if (!Array.isArray(granted)) return 'denied';
    if (granted.length >= REQUIRED_PERMS.length) return 'granted';
    return granted.length > 0 ? 'partial' : 'denied';
  } catch {
    return 'denied';
  }
}

export async function readHealthConnectWorkouts(startTime: string, endTime: string): Promise<any[]> {
  const mod = getModule();
  if (!mod) return [];
  try {
    const sessions = (await mod.readRecords?.('ExerciseSession', {
      timeRangeFilter: { operator: 'between', startTime, endTime },
      pageSize: 200,
    })) || { records: [] };
    const records = Array.isArray(sessions?.records) ? sessions.records : [];
    return records.map((row: any) => {
      const startTs = String(row?.startTime || row?.start_time || '');
      const endTs = String(row?.endTime || row?.end_time || startTs);
      const durationS = Math.max(0, Math.round((Date.parse(endTs) - Date.parse(startTs)) / 1000));
      return {
        externalId: String(row?.metadata?.id || row?.metadata?.clientRecordId || row?.id || `${startTs}_${endTs}`),
        startTs,
        endTs,
        durationS,
        distanceM: Number(row?.distance?.inMeters || row?.totalDistance?.inMeters || 0) || 0,
        activeKcal: Number(row?.activeCaloriesBurned?.inKilocalories || row?.energy?.inKilocalories || 0) || 0,
        avgHrBpm: Number(row?.avgHeartRate || 0) || null,
        activityType: String(row?.exerciseType || 'workout').toLowerCase(),
        locationType: String(row?.exerciseRoute?.length ? 'outdoor' : 'indoor'),
        raw: row,
      };
    });
  } catch {
    return [];
  }
}

export async function openHealthConnectSettings(): Promise<void> {
  const mod = getModule();
  try {
    if (mod?.openHealthConnectSettings) {
      await mod.openHealthConnectSettings();
      return;
    }
  } catch {
    // fallback below
  }
  const playUrl = 'market://details?id=com.google.android.apps.healthdata';
  try {
    await Linking.openURL(playUrl);
  } catch {
    await Linking.openURL('https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata');
  }
}
