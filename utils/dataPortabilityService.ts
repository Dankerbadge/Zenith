import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { STORAGE_SCHEMA_VERSION, WEIGHT_LOG_KEY } from './storageUtils';

export type BackupPayload = {
  app: 'zenith';
  version: number;
  exportedAt: string;
  records: Record<string, string | null>;
};

export type RestoreResult = {
  restored: number;
  removed: number;
};

function csvEscape(value: unknown): string {
  const raw = String(value ?? '');
  if (raw.includes(',') || raw.includes('"') || raw.includes('\n')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

export async function buildBackupPayload(): Promise<BackupPayload> {
  const keys = await AsyncStorage.getAllKeys();
  const rows = await AsyncStorage.multiGet(keys);
  const records: Record<string, string | null> = {};
  rows.forEach(([key, value]) => {
    records[key] = value;
  });

  return {
    app: 'zenith',
    version: STORAGE_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    records,
  };
}

export async function shareBackupJson(payload?: BackupPayload): Promise<boolean> {
  const snapshot = payload || (await buildBackupPayload());
  const fileName = `zenith_backup_${new Date().toISOString().slice(0, 10)}.json`;
  const fileUri = `${FileSystem.documentDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(snapshot, null, 2));

  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(fileUri, {
    mimeType: 'application/json',
    dialogTitle: 'Export Zenith Backup',
  });
  return true;
}

export async function shareDailyLogsCsv(): Promise<boolean> {
  const rows = await getDailyLogRows();

  let csv = 'date,calories,protein,carbs,fat,water,weight,workouts,activeRest,foodEntries\n';

  rows.forEach(([key, value]) => {
    const date = key.replace('dailyLog_', '');
    let parsed: any = {};
    try {
      parsed = value ? JSON.parse(value) : {};
    } catch {
      parsed = {};
    }

    csv += [
      csvEscape(date),
      csvEscape(parsed?.calories || 0),
      csvEscape(parsed?.macros?.protein || 0),
      csvEscape(parsed?.macros?.carbs || 0),
      csvEscape(parsed?.macros?.fat || 0),
      csvEscape(parsed?.water || 0),
      csvEscape(parsed?.weight ?? ''),
      csvEscape(Array.isArray(parsed?.workouts) ? parsed.workouts.length : 0),
      csvEscape(Array.isArray(parsed?.activeRest) ? parsed.activeRest.length : 0),
      csvEscape(Array.isArray(parsed?.foodEntries) ? parsed.foodEntries.length : 0),
    ].join(',');
    csv += '\n';
  });

  const fileName = `zenith_logs_${new Date().toISOString().slice(0, 10)}.csv`;
  const fileUri = `${FileSystem.documentDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(fileUri, csv);

  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(fileUri, {
    mimeType: 'text/csv',
    dialogTitle: 'Export Zenith CSV',
  });
  return true;
}

async function getDailyLogRows() {
  const keys = (await AsyncStorage.getAllKeys())
    .filter((key) => key.startsWith('dailyLog_'))
    .sort();
  return AsyncStorage.multiGet(keys);
}

function parseRow(value: string | null): any {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

async function shareCsvFile(fileName: string, csv: string, dialogTitle: string): Promise<boolean> {
  const fileUri = `${FileSystem.documentDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(fileUri, csv);
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(fileUri, {
    mimeType: 'text/csv',
    dialogTitle,
  });
  return true;
}

async function shareJsonFile(fileName: string, json: any, dialogTitle: string): Promise<boolean> {
  const fileUri = `${FileSystem.documentDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(json, null, 2));
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(fileUri, {
    mimeType: 'application/json',
    dialogTitle,
  });
  return true;
}

export async function shareWeeklyRecapJson(payload: {
  generatedAt: string;
  rangeLabel: string;
  signals: {
    activeDays: number;
    winningDays: number;
    workouts: number;
    runs: number;
    avgProtein: number | null;
    avgWater: number | null;
  };
  summary: string;
  evidence?: string | null;
  confidence?: string | null;
}): Promise<boolean> {
  return shareJsonFile(`zenith_weekly_recap_${payload.generatedAt.slice(0, 10)}.json`, payload, 'Export Weekly Recap');
}

export async function shareWorkoutsCsv(): Promise<boolean> {
  const rows = await getDailyLogRows();
  let csv = 'date,workout_id,type,intensity,duration_min,total_sets,total_reps,total_volume,calories_burned,label,note,session_recovered,recovery_reason,recovery_detected_at,recovery_notes\n';

  rows.forEach(([key, value]) => {
    const date = key.replace('dailyLog_', '');
    const parsed = parseRow(value);
    const workouts = Array.isArray(parsed?.workouts) ? parsed.workouts : [];
    workouts.forEach((row: any) => {
      const recovered = row?.sessionRecovered === true;
      csv += [
        csvEscape(date),
        csvEscape(row?.id || ''),
        csvEscape(row?.type || ''),
        csvEscape(row?.intensity || ''),
        csvEscape(row?.durationMin ?? row?.minutes ?? ''),
        csvEscape(row?.totalSets ?? ''),
        csvEscape(row?.totalReps ?? ''),
        csvEscape(row?.totalVolume ?? ''),
        csvEscape(row?.caloriesBurned ?? ''),
        csvEscape(row?.label || ''),
        csvEscape(row?.note || row?.notes || ''),
        csvEscape(recovered ? 'true' : ''),
        csvEscape(row?.recoveryReason || ''),
        csvEscape(row?.recoveryDetectedAt || ''),
        csvEscape(row?.recoveryNotes || ''),
      ].join(',');
      csv += '\n';
    });
  });

  return shareCsvFile(`zenith_workouts_${new Date().toISOString().slice(0, 10)}.csv`, csv, 'Export Workouts CSV');
}

export async function shareFoodCsv(): Promise<boolean> {
  const rows = await getDailyLogRows();
  let csv = 'date,entry_id,meal,label,brand,calories,protein,carbs,fat,fiber,sugar,sodium_mg,serving_label,quantity,note\n';

  rows.forEach(([key, value]) => {
    const date = key.replace('dailyLog_', '');
    const parsed = parseRow(value);
    const entries = Array.isArray(parsed?.foodEntries) ? parsed.foodEntries : [];
    entries.forEach((row: any) => {
      csv += [
        csvEscape(date),
        csvEscape(row?.id || ''),
        csvEscape(row?.meal || ''),
        csvEscape(row?.label || ''),
        csvEscape(row?.brand || ''),
        csvEscape(row?.calories ?? 0),
        csvEscape(row?.protein ?? 0),
        csvEscape(row?.carbs ?? 0),
        csvEscape(row?.fat ?? 0),
        csvEscape(row?.fiber ?? ''),
        csvEscape(row?.sugar ?? ''),
        csvEscape(row?.sodiumMg ?? ''),
        csvEscape(row?.servingLabel || ''),
        csvEscape(row?.quantity ?? ''),
        csvEscape(row?.note || ''),
      ].join(',');
      csv += '\n';
    });
  });

  return shareCsvFile(`zenith_food_${new Date().toISOString().slice(0, 10)}.csv`, csv, 'Export Food CSV');
}

export async function shareActiveRestCsv(): Promise<boolean> {
  const rows = await getDailyLogRows();
  let csv = 'date,entry_id,type,intensity,minutes,calories_burned,label,note\n';

  rows.forEach(([key, value]) => {
    const date = key.replace('dailyLog_', '');
    const parsed = parseRow(value);
    const entries = Array.isArray(parsed?.activeRest) ? parsed.activeRest : [];
    entries.forEach((row: any) => {
      csv += [
        csvEscape(date),
        csvEscape(row?.id || ''),
        csvEscape(row?.type || ''),
        csvEscape(row?.intensity || ''),
        csvEscape(row?.minutes ?? 0),
        csvEscape(row?.caloriesBurned ?? ''),
        csvEscape(row?.label || ''),
        csvEscape(row?.note || ''),
      ].join(',');
      csv += '\n';
    });
  });

  return shareCsvFile(`zenith_active_rest_${new Date().toISOString().slice(0, 10)}.csv`, csv, 'Export Active Rest CSV');
}

export async function shareWeightCsv(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(WEIGHT_LOG_KEY);
  const entries = parseRow(raw);
  const list = Array.isArray(entries) ? entries : [];
  let csv = 'entry_id,date,timestamp,weight_lb,note\n';
  list.forEach((row: any) => {
    csv += [
      csvEscape(row?.id || ''),
      csvEscape(row?.date || ''),
      csvEscape(row?.ts || ''),
      csvEscape(row?.weight ?? ''),
      csvEscape(row?.note || ''),
    ].join(',');
    csv += '\n';
  });

  return shareCsvFile(`zenith_weight_${new Date().toISOString().slice(0, 10)}.csv`, csv, 'Export Weight CSV');
}

export function parseBackupPayload(raw: string): BackupPayload {
  const parsed = JSON.parse(raw) as BackupPayload;
  if (!parsed || parsed.app !== 'zenith' || typeof parsed.records !== 'object') {
    throw new Error('Invalid backup payload');
  }
  return parsed;
}

export async function restoreFromBackup(payload: BackupPayload, wipeMissing = false): Promise<RestoreResult> {
  const entries = Object.entries(payload.records);
  const toSet = entries
    .filter(([, value]) => typeof value === 'string')
    .map(([key, value]) => [key, value as string] as [string, string]);

  if (wipeMissing) {
    const currentKeys = await AsyncStorage.getAllKeys();
    const keep = new Set(entries.map(([key]) => key));
    const toRemove = currentKeys.filter((key) => !keep.has(key));
    if (toRemove.length) {
      await AsyncStorage.multiRemove(toRemove);
    }
    if (toSet.length) await AsyncStorage.multiSet(toSet);
    return { restored: toSet.length, removed: toRemove.length };
  }

  if (toSet.length) await AsyncStorage.multiSet(toSet);
  return { restored: toSet.length, removed: 0 };
}
