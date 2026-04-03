import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import Screen from '../../components/ui/Screen';
import ListGroup from '../../components/ui/ListGroup';
import ListRow from '../../components/ui/ListRow';
import GlassCard from '../../components/ui/GlassCard';
import { APP_CONFIG } from '../../utils/appConfig';
import {
  buildBackupPayload,
  parseBackupPayload,
  restoreFromBackup,
  shareActiveRestCsv,
  shareBackupJson,
  shareDailyLogsCsv,
  shareFoodCsv,
  shareWeightCsv,
  shareWorkoutsCsv,
} from '../../utils/dataPortabilityService';
import {
  getUserProfile,
  isUserProfileStorageKey,
  setStorageItem,
  todayKey,
  USER_PROFILE_KEY,
  WEIGHT_LOG_KEY,
  type UserProfile,
} from '../../utils/storageUtils';
import { useAuth } from '../context/authcontext';

function formatUnits(units: unknown) {
  return units === 'kg-ml' ? 'kg / ml' : 'lb / oz';
}

function formatWeekStart(weekStart: unknown) {
  return weekStart === 'sun' ? 'Sunday' : 'Monday';
}

function inferCoachingEnabled(profile: UserProfile) {
  const raw = (profile.preferences || {}) as any;
  return Boolean(raw.aiOverlayEnabled);
}

export default function ProfileSettings() {
  const { logout, hasSupabaseSession, supabaseUserId } = useAuth();
  const signedIn = Boolean(supabaseUserId) || hasSupabaseSession;

  const garminEnabled = APP_CONFIG.FEATURES.GARMIN_CONNECT_ENABLED;
  const socialEnabled = APP_CONFIG.FEATURES.SOCIAL_FEATURES_ENABLED || APP_CONFIG.RUNTIME.OVERRIDES.SOCIAL_FEATURES_ENABLED;

  const [profile, setProfileState] = useState<UserProfile | null>(null);
  const [coachingEnabled, setCoachingEnabled] = useState(false);

  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreRaw, setRestoreRaw] = useState('');
  const [restoring, setRestoring] = useState(false);

  const [typeConfirmOpen, setTypeConfirmOpen] = useState<null | { title: string; body: string; keyword: string; action: () => Promise<void> }>(null);
  const [typed, setTyped] = useState('');
  const [typeBusy, setTypeBusy] = useState(false);

  const load = useCallback(async () => {
    const p = await getUserProfile();
    setProfileState(p);
    setCoachingEnabled(inferCoachingEnabled(p));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const unitsLabel = useMemo(() => formatUnits((profile as any)?.preferences?.units), [profile]);
  const weekStartLabel = useMemo(() => formatWeekStart((profile as any)?.preferences?.weekStart), [profile]);
  const foodRegionLabel = useMemo(() => {
    const prefs = ((profile as any)?.preferences || {}) as any;
    const country = String(prefs.foodRegionCountry || 'US').toUpperCase();
    const admin = String(prefs.foodRegionAdmin || '').trim();
    if (country === 'US' && admin) return `US · ${admin}`;
    return country || 'US';
  }, [profile]);

  const exportJson = async () => {
    try {
      const shared = await shareBackupJson(await buildBackupPayload());
      Alert.alert(
        shared ? 'Exported' : 'Saved',
        shared
          ? 'Backup JSON prepared. Choose a destination to share or save it.'
          : 'Backup JSON was saved locally, but sharing is not available on this device/runtime.'
      );
    } catch {
      Alert.alert('Export failed', 'Unable to create JSON backup right now.');
    }
  };

  const exportCsv = async (kind: 'daily' | 'workouts' | 'food' | 'rest' | 'weight') => {
    try {
      const shared =
        kind === 'daily'
          ? await shareDailyLogsCsv()
          : kind === 'workouts'
          ? await shareWorkoutsCsv()
          : kind === 'food'
          ? await shareFoodCsv()
          : kind === 'rest'
          ? await shareActiveRestCsv()
          : await shareWeightCsv();

      const label =
        kind === 'daily'
          ? 'Daily logs'
          : kind === 'workouts'
          ? 'Workouts'
          : kind === 'food'
          ? 'Food'
          : kind === 'rest'
          ? 'Active rest'
          : 'Weight';

      Alert.alert(
        shared ? 'Exported' : 'Saved',
        shared ? `${label} CSV prepared. Choose a destination to share or save it.` : `${label} CSV was saved locally, but sharing is not available on this device/runtime.`
      );
    } catch {
      Alert.alert('Export failed', 'Unable to create CSV right now.');
    }
  };

  const restoreData = async () => {
    setRestoring(true);
    try {
      const payload = parseBackupPayload(restoreRaw);
      const result = await restoreFromBackup(payload, false);
      Alert.alert('Restore complete', `Restored ${result.restored} records.`);
      setRestoreOpen(false);
      setRestoreRaw('');
      await load();
    } catch {
      Alert.alert('Invalid backup', 'Paste a valid Zenith backup JSON to restore.');
    } finally {
      setRestoring(false);
    }
  };

  const clearToday = async () => {
    const key = `dailyLog_${todayKey()}`;
    await AsyncStorage.removeItem(key);
    Alert.alert('Done', 'Cleared today log.');
    await load();
  };

  const resetAll = async () => {
    const keys = await AsyncStorage.getAllKeys();
    const targets = keys.filter((k) => k.startsWith('dailyLog_') || isUserProfileStorageKey(k) || k === WEIGHT_LOG_KEY);
    await AsyncStorage.multiRemove(targets);
    Alert.alert('Reset complete', 'Core app data has been reset.');
    await load();
  };

  const toggleCoaching = async (next: boolean) => {
    setCoachingEnabled(next);
    const p = await getUserProfile();
    await setStorageItem(USER_PROFILE_KEY, {
      ...p,
      preferences: {
        ...(p as any).preferences,
        aiOverlayEnabled: next,
      },
    });
    await load();
  };

  const versionLine = `Zenith v${Constants.nativeAppVersion || Constants.expoConfig?.version || '—'}${Constants.nativeBuildVersion ? ` (${Constants.nativeBuildVersion})` : ''}`;

  const openTypeConfirm = (cfg: { title: string; body: string; keyword: string; action: () => Promise<void> }) => {
    setTyped('');
    setTypeConfirmOpen(cfg);
  };

  const runTypeConfirm = async () => {
    if (!typeConfirmOpen) return;
    if (typed.trim().toUpperCase() !== typeConfirmOpen.keyword.toUpperCase()) return;
    if (typeBusy) return;
    setTypeBusy(true);
    try {
      await typeConfirmOpen.action();
      setTypeConfirmOpen(null);
    } finally {
      setTypeBusy(false);
    }
  };

  return (
    <Screen aura>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}>
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Settings</Text>
          <View style={{ width: 56 }} />
        </View>

        <ListGroup title="Account">
          <ListRow icon={<Text style={styles.emoji}>👤</Text>} title="Manage profile" onPress={() => router.push('/account/manage-profile' as any)} />
          <ListRow icon={<Text style={styles.emoji}>💎</Text>} title="Subscription" value={String((profile as any)?.level) === 'pro' ? 'Pro' : 'Amateur'} onPress={() => router.push('/store' as any)} />
          <ListRow icon={<Text style={styles.emoji}>🏅</Text>} title="Ranks & XP" onPress={() => router.push('/account/ranks-xp' as any)} isLast />
        </ListGroup>

        <ListGroup title="Training Preferences">
          <ListRow icon={<Text style={styles.emoji}>⚖️</Text>} title="Units" value={unitsLabel} onPress={() => router.push('/account/preferences' as any)} />
          <ListRow icon={<Text style={styles.emoji}>📅</Text>} title="Week starts on" value={weekStartLabel} onPress={() => router.push('/account/preferences' as any)} />
          <ListRow icon={<Text style={styles.emoji}>🌍</Text>} title="Food region" value={foodRegionLabel} onPress={() => router.push('/account/preferences' as any)} isLast />
        </ListGroup>

        <ListGroup title="Coaching">
          <ListRow icon={<Text style={styles.emoji}>🧠</Text>} title="AI coaching" subtitle="Data-driven insights on your logs" switchValue={coachingEnabled} onToggle={toggleCoaching} showChevron={false} />
          <ListRow icon={<Text style={styles.emoji}>⚙️</Text>} title="Coaching settings" onPress={() => router.push('/account/coaching' as any)} />
          <ListRow icon={<Text style={styles.emoji}>📊</Text>} title="Dashboard preferences" onPress={() => router.push('/account/dashboard-preferences' as any)} isLast />
        </ListGroup>

        <ListGroup title="Integrations">
          <ListRow icon={<Text style={styles.emoji}>⌚</Text>} title="Wearables hub" onPress={() => router.push('/wearables' as any)} />
          <ListRow icon={<Text style={styles.emoji}>🔐</Text>} title="Permissions" onPress={() => router.push('/health-permissions' as any)} />
          <ListRow
            icon={<Text style={styles.emoji}>🛰️</Text>}
            title="Garmin Connect IQ"
            subtitle={garminEnabled ? 'Companion + sync diagnostics' : 'Setup and diagnostics'}
            onPress={() => router.push('/wearables/garmin' as any)}
          />
          <ListRow icon={<Text style={styles.emoji}>✅</Text>} title="Compliance status" onPress={() => router.push('/account/compliance' as any)} isLast />
        </ListGroup>

        <ListGroup title="Data">
          <ListRow icon={<Text style={styles.emoji}>🩺</Text>} title="Diagnostics" subtitle="Control + cloud diagnostics" onPress={() => router.push('/account/control-diagnostics' as any)} />
          <ListRow icon={<Text style={styles.emoji}>⬇️</Text>} title="Export backup (JSON)" onPress={exportJson} />
          <ListRow icon={<Text style={styles.emoji}>🧾</Text>} title="Daily logs (CSV)" onPress={() => void exportCsv('daily')} />
          <ListRow icon={<Text style={styles.emoji}>🏋️</Text>} title="Workouts (CSV)" onPress={() => void exportCsv('workouts')} />
          <ListRow icon={<Text style={styles.emoji}>🍽️</Text>} title="Food (CSV)" onPress={() => void exportCsv('food')} />
          <ListRow icon={<Text style={styles.emoji}>🚶</Text>} title="Active rest (CSV)" onPress={() => void exportCsv('rest')} />
          <ListRow icon={<Text style={styles.emoji}>⚖️</Text>} title="Weight (CSV)" onPress={() => void exportCsv('weight')} />
          <ListRow icon={<Text style={styles.emoji}>♻️</Text>} title="Restore from backup JSON" onPress={() => setRestoreOpen(true)} isLast />
        </ListGroup>

        <ListGroup title="Privacy & Safety">
          <ListRow icon={<Text style={styles.emoji}>🛡️</Text>} title="Privacy policy" onPress={() => router.push('/account/privacy-policy' as any)} />
          {socialEnabled ? <ListRow icon={<Text style={styles.emoji}>👥</Text>} title="Social privacy" onPress={() => router.push('/account/social-privacy' as any)} /> : null}
          <ListRow icon={<Text style={styles.emoji}>🆘</Text>} title="Safety center" onPress={() => router.push('/account/safety' as any)} isLast={!socialEnabled} />
        </ListGroup>

        <ListGroup title="About">
          <ListRow icon={<Text style={styles.emoji}>ℹ️</Text>} title="Version" value={versionLine} showChevron={false} isLast />
        </ListGroup>

        <ListGroup title="Danger Zone" tone="danger">
          <ListRow
            icon={<Text style={styles.emoji}>🧨</Text>}
            title="Clear today"
            subtitle="Removes only today’s log entries"
            tone="danger"
            onPress={() =>
              Alert.alert('Clear today?', 'This removes only today’s log entries.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Clear today', style: 'destructive', onPress: () => void clearToday() },
              ])
            }
          />
          <ListRow
            icon={<Text style={styles.emoji}>💥</Text>}
            title="Reset all data"
            subtitle="Clears goals, logs, and local profile data"
            tone="danger"
            onPress={() =>
              openTypeConfirm({
                title: 'Reset all data',
                body: 'This clears your local data and cannot be undone. Type RESET to confirm.',
                keyword: 'RESET',
                action: resetAll,
              })
            }
          />
          <ListRow icon={<Text style={styles.emoji}>🗑️</Text>} title="Delete account" tone="danger" onPress={() => router.push('/account/delete' as any)} isLast />
        </ListGroup>

        <View style={{ height: 18 }} />

        <GlassCard style={{ paddingVertical: 10 }}>
          {signedIn ? (
            <Pressable onPress={logout} style={({ pressed }) => [styles.logoutBtn, pressed && styles.pressed]}>
              <Text style={styles.logoutText}>Logout</Text>
            </Pressable>
          ) : (
            <Pressable onPress={() => router.push('/auth/login' as any)} style={({ pressed }) => [styles.loginBtn, pressed && styles.pressed]}>
              <Text style={styles.loginText}>Sign in</Text>
            </Pressable>
          )}
        </GlassCard>
        <View style={{ height: 28 }} />
      </ScrollView>

      <Modal visible={restoreOpen} animationType="slide" transparent onRequestClose={() => setRestoreOpen(false)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={Keyboard.dismiss} accessible={false} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Restore Backup</Text>
            <Text style={styles.modalSub}>Paste Zenith backup JSON below.</Text>
            <TextInput
              style={styles.restoreInput}
              multiline
              value={restoreRaw}
              onChangeText={setRestoreRaw}
              placeholder='{"app":"zenith",...}'
              placeholderTextColor="#777"
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.modalGhost} onPress={() => setRestoreOpen(false)}>
                <Text style={styles.modalGhostText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.modalPrimary, restoring && styles.disabled]} onPress={restoreData} disabled={restoring}>
                <Text style={styles.modalPrimaryText}>{restoring ? 'Restoring...' : 'Restore'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={typeConfirmOpen != null} animationType="fade" transparent onRequestClose={() => setTypeConfirmOpen(null)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={Keyboard.dismiss} accessible={false} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{typeConfirmOpen?.title || 'Confirm'}</Text>
            <Text style={styles.modalSub}>{typeConfirmOpen?.body || ''}</Text>
            <TextInput
              value={typed}
              onChangeText={setTyped}
              placeholder={`Type ${typeConfirmOpen?.keyword || ''} to confirm`}
              placeholderTextColor="#777"
              autoCapitalize="characters"
              autoCorrect={false}
              style={styles.typeInput}
              editable={!typeBusy}
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.modalGhost} onPress={() => setTypeConfirmOpen(null)} disabled={typeBusy}>
                <Text style={styles.modalGhostText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.modalDanger,
                  (typed.trim().toUpperCase() !== (typeConfirmOpen?.keyword || '').toUpperCase() || typeBusy) && styles.disabled,
                ]}
                disabled={typed.trim().toUpperCase() !== (typeConfirmOpen?.keyword || '').toUpperCase() || typeBusy}
                onPress={() => void runTypeConfirm()}
              >
                <Text style={styles.modalDangerText}>{typeBusy ? 'Working...' : 'Confirm'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 36 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title: { color: '#FFF', fontSize: 22, fontWeight: '900' },
  backBtn: {
    width: 56,
    minHeight: 40,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: { color: '#D9F6FF', fontWeight: '900' },
  emoji: { fontSize: 14 },

  logoutBtn: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(0,0,0,0.20)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutText: { color: '#EAEAEA', fontWeight: '900', fontSize: 15 },
  loginBtn: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: '#00D9FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loginText: { color: '#041A22', fontWeight: '900', fontSize: 15 },

  pressed: { opacity: 0.96, transform: [{ scale: 0.995 }] },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.66)',
    alignItems: 'center',
    justifyContent: 'flex-end',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: '#121212',
    padding: 16,
  },
  modalTitle: { color: '#FFF', fontWeight: '900', fontSize: 18 },
  modalSub: { color: 'rgba(255,255,255,0.70)', fontWeight: '700', marginTop: 8, lineHeight: 18 },
  restoreInput: {
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: '#0F0F0F',
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: '#FFF',
    fontWeight: '700',
    minHeight: 140,
  },
  typeInput: {
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: '#0F0F0F',
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: '#FFF',
    fontWeight: '900',
  },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  modalGhost: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalGhostText: { color: '#EAEAEA', fontWeight: '900' },
  modalPrimary: { flex: 1, minHeight: 46, borderRadius: 14, backgroundColor: '#00D9FF', alignItems: 'center', justifyContent: 'center' },
  modalPrimaryText: { color: '#041A22', fontWeight: '900' },
  modalDanger: { flex: 1, minHeight: 46, borderRadius: 14, backgroundColor: '#F87171', alignItems: 'center', justifyContent: 'center' },
  modalDangerText: { color: '#1B0A0A', fontWeight: '900' },
  disabled: { opacity: 0.55 },
});
