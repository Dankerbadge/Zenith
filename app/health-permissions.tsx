import React, { useCallback, useMemo, useState } from 'react';
import { Alert, AppState, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { router } from 'expo-router';
import {
  HEALTH_TODAY_SIGNAL_TYPES,
  getHealthkitLastRequestInfo,
  getTodaySignalsAuthorizationState,
  isHealthKitAvailable,
  requestReadOnlyHealthPermissions,
  resetHealthkitLocalState,
  runHealthkitProofOfLifeDiagnostic,
  type HealthkitProofOfLifeResult,
} from '../utils/healthService';
import {
  getHealthConnectPermissionStatus,
  isHealthConnectAvailable,
  openHealthConnectSettings,
  requestHealthConnectPermissions,
} from '../utils/healthConnectService';
import { APP_CONFIG } from '../utils/appConfig';
import {
  getLastSuccessfulHealthSyncAt,
  getWearableImportPreferences,
  importWearableDailySignals,
  setWearableImportPreferences,
  type WearableImportSnapshot,
} from '../utils/wearableImportService';
import { detectWorkoutDuplicates, resolveWorkoutDuplicate } from '../utils/wearableDuplicateService';
import Chip from '../components/ui/Chip';

type BannerTone = 'info' | 'warning';
type BannerState = { message: string; tone: BannerTone; actionLabel?: string; onAction?: () => void } | null;

function authCodeLabel(code: number) {
  if (code === 2) return 'authorized';
  if (code === 1) return 'denied';
  return 'notDetermined';
}

export default function HealthPermissionsScreen() {
  const supportsHealthData = Platform.OS === 'ios' || Platform.OS === 'android';
  const garminEnabled = APP_CONFIG.FEATURES.GARMIN_CONNECT_ENABLED;

  const [connecting, setConnecting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [authState, setAuthState] = useState<'unavailable' | 'notDetermined' | 'denied' | 'authorized'>('notDetermined');
  const [authDetail, setAuthDetail] = useState<{ requestedAt?: string | null; lastResult?: string | null; error?: string; note?: string } | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [lastImport, setLastImport] = useState<WearableImportSnapshot | null>(null);
  const [banner, setBanner] = useState<BannerState>(null);
  const [lastReqInfo, setLastReqInfo] = useState<{ requestedAt: string | null; lastResult: string | null }>({ requestedAt: null, lastResult: null });
  const [proof, setProof] = useState<HealthkitProofOfLifeResult | null>(null);
  const [proofRunning, setProofRunning] = useState(false);
  const [connectProofRunning, setConnectProofRunning] = useState(false);

  const [prefs, setPrefs] = useState({
    connected: false,
    autoSync: true,
    importSteps: true,
    importActiveEnergy: true,
    importSleep: true,
    importRestingHeartRate: true,
  });

  const platformLabel = useMemo(() => (Platform.OS === 'ios' ? 'Apple Health' : 'Health data'), []);
  const connectButtonLabel = useMemo(() => (Platform.OS === 'ios' ? 'Connect Apple Health' : 'Connect Health Connect'), []);
  const healthOpenLabel = useMemo(() => (Platform.OS === 'ios' ? 'Open Health' : 'Open Health Connect'), []);

  const refreshState = useCallback(async () => {
    const current = await getWearableImportPreferences();
    const [auth, last, reqInfo] = await Promise.all([
      Platform.OS === 'ios'
        ? getTodaySignalsAuthorizationState({
            required: {
              steps: current.importSteps,
              activeEnergy: current.importActiveEnergy,
              sleep: current.importSleep,
              restingHeartRate: current.importRestingHeartRate,
            },
          })
        : (async () => {
            const availability = await isHealthConnectAvailable();
            if (!availability.available) return { state: 'unavailable', detail: { note: 'Health Connect unavailable' } } as any;
            const status = await getHealthConnectPermissionStatus();
            return {
              state: status === 'granted' ? 'authorized' : status === 'partial' ? 'denied' : 'notDetermined',
              detail: { note: `Health Connect permission: ${status}` },
            } as any;
          })(),
      getLastSuccessfulHealthSyncAt(),
      Platform.OS === 'ios' ? getHealthkitLastRequestInfo() : Promise.resolve({ requestedAt: null, lastResult: null }),
    ]);

    setPrefs({
      connected: current.connected,
      autoSync: current.autoSync,
      importSteps: current.importSteps,
      importActiveEnergy: current.importActiveEnergy,
      importSleep: current.importSleep,
      importRestingHeartRate: current.importRestingHeartRate,
    });
    setAuthState(auth.state);
    setAuthDetail(auth.detail || null);
    setLastSyncedAt(last);
    setLastReqInfo(reqInfo);

    // Do not auto-mark "connected". Proof-of-life must decide connected state.
  }, []);

  React.useEffect(() => {
    void refreshState();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refreshState();
      }
    });
    return () => sub.remove();
  }, [refreshState]);

  const updatePrefs = async (next: Partial<typeof prefs>) => {
    const merged = { ...prefs, ...next };
    setPrefs(merged);
    await setWearableImportPreferences(merged);
  };

  const openSettings = async () => {
    try {
      await Linking.openSettings();
      setBanner({
        tone: 'info',
        message: 'Enable access: Health app → Profile → Apps → Zenith → turn on permissions (or Settings → Health → Data Access & Devices → Zenith).',
      });
    } catch {
      setBanner({
        tone: 'warning',
        message: 'Unable to open Settings automatically. Open Settings and enable Apple Health access for Zenith.',
      });
    }
  };

  const openHealthApp = async () => {
    if (Platform.OS === 'android') {
      await openHealthConnectSettings();
      return;
    }
    try {
      await Linking.openURL('x-apple-health://');
    } catch {
      await openSettings();
    }
  };

  const resetLocal = async () => {
    Alert.alert('Reset Health link state?', 'This resets Zenith’s local “requested/granted” markers. It will not change Apple Health permissions by itself.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: () =>
          void (async () => {
            await resetHealthkitLocalState();
            await setWearableImportPreferences({ connected: false });
            await refreshState();
            setBanner({ tone: 'info', message: 'Reset complete. Tap “Connect Apple Health” again.' });
          })(),
      },
    ]);
  };

  const runDiagnostic = async () => {
    if (!supportsHealthData) return;
    if (proofRunning) return;
    setProofRunning(true);
    try {
      const result = await runHealthkitProofOfLifeDiagnostic();
      setProof(result);

      if (result.summary === 'connected') {
        setBanner({
          tone: 'info',
          message: '✅ Connected: authorization + write + read verified. (Writes a 20s diagnostic workout to Apple Health to prove connection.)',
        });
      } else if (result.summary === 'not_available') {
        setBanner({
          tone: 'warning',
          message: `Health not available. Use a real iPhone (not simulator/Expo Go). ${result.availability.error ? `(${result.availability.error})` : ''}`,
          actionLabel: 'Open Settings',
          onAction: () => void openSettings(),
        });
      } else if (result.summary === 'not_authorized') {
        const missingTypes = [...result.denied.read, ...result.denied.write, ...result.notDetermined.read, ...result.notDetermined.write].slice(0, 6);
        setBanner({
          tone: 'warning',
          message: `Not authorized for required types (${missingTypes.join(', ') || 'unknown'}). Enable access in Health → Apps → Zenith.`,
          actionLabel: 'Open Health Settings',
          onAction: () => void openHealthApp(),
        });
      } else if (result.summary === 'authorized_but_partial') {
        const missingTypes = [...result.denied.read, ...result.denied.write, ...result.notDetermined.read, ...result.notDetermined.write].slice(0, 8);
        setBanner({
          tone: 'warning',
          message: `Partial permissions. Missing: ${missingTypes.join(', ') || 'unknown'}. Enable in Health → Apps → Zenith.`,
          actionLabel: 'Open Health Settings',
          onAction: () => void openHealthApp(),
        });
      } else if (result.summary === 'authorized_write_failed') {
        setBanner({
          tone: 'warning',
          message: `Authorized, but write failed. ${result.writeTest.error || ''}`.trim(),
          actionLabel: 'Open Health Settings',
          onAction: () => void openHealthApp(),
        });
      } else if (result.summary === 'authorized_read_failed') {
        setBanner({
          tone: 'warning',
          message: `Authorized, wrote diagnostic workout, but read-back failed. ${result.readTest.error || ''}`.trim(),
          actionLabel: 'Open Health Settings',
          onAction: () => void openHealthApp(),
        });
      }
    } finally {
      setProofRunning(false);
      await refreshState();
    }
  };

  const forceDiagnostic = async () => {
    if (!supportsHealthData) return;
    if (proofRunning) return;
    setProofRunning(true);
    try {
      const result = await runHealthkitProofOfLifeDiagnostic({ force: true });
      setProof(result);
      if (result.summary === 'connected') {
        setBanner({
          tone: 'info',
          message: '✅ Connected: authorization + write + read verified. (Writes a 20s diagnostic workout to Apple Health to prove connection.)',
        });
      } else {
        setBanner({ tone: 'warning', message: 'Diagnostic re-run completed. Review status details below.' });
      }
    } finally {
      setProofRunning(false);
      await refreshState();
    }
  };

  const connect = async () => {
    if (!supportsHealthData) {
      setBanner({ tone: 'warning', message: 'Health data import is not available on this platform in this build.' });
      return;
    }

    setConnecting(true);
    try {
      if (Platform.OS === 'android') {
        const availability = await isHealthConnectAvailable();
        if (!availability.available) {
          setBanner({
            tone: 'warning',
            message: availability.needsInstall
              ? 'Health Connect is not installed or needs an update.'
              : 'Health Connect is unavailable on this device.',
            actionLabel: 'Open Health Connect',
            onAction: () => void openHealthConnectSettings(),
          });
          return;
        }

        const granted = await requestHealthConnectPermissions();
        if (granted === 'denied') {
          setBanner({
            tone: 'warning',
            message: 'Health Connect permission was not granted.',
            actionLabel: 'Open Health Connect',
            onAction: () => void openHealthConnectSettings(),
          });
          return;
        }
        await setWearableImportPreferences({ connected: true });
        setBanner({ tone: 'info', message: '✅ Health Connect connected. Syncing now…' });
        setImporting(true);
        try {
          const result = await importWearableDailySignals();
          setLastImport(result);
          await refreshState();
        } finally {
          setImporting(false);
        }
        return;
      }

      const availability = await isHealthKitAvailable();
      if (!availability.available) {
        setBanner({
          tone: 'warning',
          message:
            `Apple Health is unavailable in this runtime. ` +
            `Use a real iPhone with the TestFlight build (not a simulator / Expo Go). ` +
            (availability.error ? `(${availability.error})` : ''),
          actionLabel: 'Open Settings',
          onAction: () => void openSettings(),
        });
        await refreshState();
        return;
      }

      const granted = await requestReadOnlyHealthPermissions({
        steps: prefs.importSteps,
        activeEnergy: prefs.importActiveEnergy,
        sleep: prefs.importSleep,
        restingHeartRate: prefs.importRestingHeartRate,
      });
      await refreshState();

      if (!granted) {
        const reqInfo = await getHealthkitLastRequestInfo();
        const last = reqInfo.lastResult ? String(reqInfo.lastResult).slice(0, 140) : '';
        setBanner({
          tone: 'warning',
          message:
            'Apple Health permission was not granted. If you previously tapped “Don’t Allow”, iOS will not show the prompt again. Enable access manually in Health.' +
            (last ? ` (Last result: ${last})` : ''),
          actionLabel: 'Open Health',
          onAction: () => void openHealthApp(),
        });
        return;
      }

      // At this point iOS has granted access. Mark the wearable import link as connected so
      // auto-sync (including phone-tracked steps) runs without requiring another "proof" gate.
      // Proof-of-life is still used to verify workout write/read features, but steps are read-only.
      await setWearableImportPreferences({ connected: true });

      // Proof-of-life (explicit, user-initiated): read-only by default so iPhone-only users can connect
      // without granting workout write access.
      setConnectProofRunning(true);
      try {
        const result = await runHealthkitProofOfLifeDiagnostic({ force: true, readOnly: true });
        setProof(result);
        if (!result.connected) {
          if (result.summary === 'not_available') {
            setBanner({
              tone: 'warning',
              message: `Health not available. Use a real iPhone (not simulator/Expo Go). ${result.availability.error ? `(${result.availability.error})` : ''}`,
              actionLabel: 'Open Settings',
              onAction: () => void openSettings(),
            });
          } else if (result.summary === 'not_authorized') {
            setBanner({
              tone: 'warning',
              message: 'Not authorized for required Health types. Enable access in Health → Profile → Apps → Zenith.',
              actionLabel: 'Open Health',
              onAction: () => void openHealthApp(),
            });
          } else if (result.summary === 'authorized_but_partial') {
            const missingTypes = [...result.denied.read, ...result.denied.write, ...result.notDetermined.read, ...result.notDetermined.write].slice(0, 8);
            setBanner({
              tone: 'warning',
              message: `Partial permissions. Missing: ${missingTypes.join(', ') || 'unknown'}. Enable in Health → Profile → Apps → Zenith.`,
              actionLabel: 'Open Health',
              onAction: () => void openHealthApp(),
            });
          } else if (result.summary === 'authorized_write_failed') {
            setBanner({
              tone: 'warning',
              message: `Authorized, but workout write failed. ${result.writeTest.error || ''}`.trim(),
              actionLabel: 'Open Health',
              onAction: () => void openHealthApp(),
            });
          } else if (result.summary === 'authorized_read_failed') {
            setBanner({
              tone: 'warning',
              message: `Authorized, wrote diagnostic workout, but read-back failed. ${result.readTest.error || ''}`.trim(),
              actionLabel: 'Open Health',
              onAction: () => void openHealthApp(),
            });
          }
        } else {
          setBanner({
            tone: 'info',
            message: '✅ Connected: authorization + read verified. (Read-only mode. You can run the full workout export diagnostic anytime.)',
          });
        }
      } finally {
        setConnectProofRunning(false);
      }

      setImporting(true);
      try {
        const result = await importWearableDailySignals();
        setLastImport(result);
        await refreshState();
	        if (!result.imported && result.reason) {
	          setBanner({
	            tone: 'warning',
	            message: result.reason,
	            actionLabel: 'Open Health',
	            onAction: () => void openHealthApp(),
	          });
	        }
      } finally {
        setImporting(false);
      }
    } finally {
      setConnecting(false);
    }
  };

  const importToday = async () => {
    if (!supportsHealthData) {
      setBanner({ tone: 'warning', message: 'Health data import is not available on this platform in this build.' });
      return;
    }

    if (Platform.OS === 'ios') {
      const auth = await getTodaySignalsAuthorizationState({
        required: {
          steps: prefs.importSteps,
          activeEnergy: prefs.importActiveEnergy,
          sleep: prefs.importSleep,
          restingHeartRate: prefs.importRestingHeartRate,
        },
      });
      if (auth.state !== 'authorized') {
        setBanner({
          tone: 'warning',
          message: 'Apple Health access is off. Enable it in Settings > Health > Data Access & Devices > Zenith.',
          actionLabel: 'Open Health',
          onAction: () => void openHealthApp(),
        });
        return;
      }
    } else {
      const status = await getHealthConnectPermissionStatus();
      if (status === 'denied') {
        setBanner({
          tone: 'warning',
          message: 'Health Connect access is off.',
          actionLabel: 'Open Health Connect',
          onAction: () => void openHealthConnectSettings(),
        });
        return;
      }
    }

    setImporting(true);
    try {
      const result = await importWearableDailySignals();
      setLastImport(result);
      if (!result.imported && result.reason) {
        setBanner({ tone: 'warning', message: result.reason });
        return;
      }

      const duplicates = await detectWorkoutDuplicates(result.date);
      if (duplicates.length > 0) {
        const top = duplicates[0];
        Alert.alert(
          'Possible duplicate detected',
          `Imported "${top.importedLabel}" may overlap with "${top.existingLabel}" (${top.reason}).`,
          [
            { text: 'Keep both', style: 'cancel' },
            {
              text: 'Merge (prefer Zenith log)',
              onPress: () => {
                void resolveWorkoutDuplicate(result.date, {
                  importedWorkoutId: top.importedWorkoutId,
                  resolution: 'merge',
                });
              },
            },
          ]
        );
      }
    } finally {
      setImporting(false);
      await refreshState();
    }
  };

  const stateLabel = useMemo(() => {
    if (!supportsHealthData) return 'unsupported';
    return authState;
  }, [authState, supportsHealthData]);

  const lastSyncLabel = useMemo(() => {
    if (!lastSyncedAt) return '—';
    const date = new Date(lastSyncedAt);
    if (!Number.isFinite(date.getTime())) return '—';
    try {
      return date.toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch {
      return lastSyncedAt;
    }
  }, [lastSyncedAt]);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>← Back</Text>
          </Pressable>
          <Text style={styles.title}>Wearables</Text>
          <View style={styles.platformBadge}>
            <Text style={styles.platformBadgeText}>{platformLabel}</Text>
          </View>
        </View>

        <Text style={styles.subtitle}>Connect once. Zenith pulls key health context and keeps your manual logs in control.</Text>

        {banner ? (
          <View style={[styles.banner, banner.tone === 'warning' ? styles.bannerWarning : styles.bannerInfo]}>
            <Text style={styles.bannerText}>{banner.message}</Text>
            {banner.actionLabel && banner.onAction ? (
              <Pressable style={styles.bannerAction} onPress={banner.onAction}>
                <Text style={styles.bannerActionText}>{banner.actionLabel}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {!supportsHealthData ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Health bridge unavailable in this runtime</Text>
            <Text style={styles.cardLine}>On iOS, use a native build (not Expo Go/simulator) to connect Apple Health.</Text>
            <Text style={styles.cardLine}>On Android, install a build with Health Connect support and reopen this screen.</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>What Zenith Reads</Text>
          {HEALTH_TODAY_SIGNAL_TYPES.map((row) => (
            <Text key={row.key} style={styles.cardLine}>
              • {row.label}
            </Text>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Import Options</Text>
          <View style={styles.row}>
            <Chip label='Steps' active={prefs.importSteps} onPress={() => void updatePrefs({ importSteps: !prefs.importSteps })} />
            <Chip label='Active Energy' active={prefs.importActiveEnergy} onPress={() => void updatePrefs({ importActiveEnergy: !prefs.importActiveEnergy })} />
            <Chip label='Sleep' active={prefs.importSleep} onPress={() => void updatePrefs({ importSleep: !prefs.importSleep })} />
            <Chip label='Resting HR' active={prefs.importRestingHeartRate} onPress={() => void updatePrefs({ importRestingHeartRate: !prefs.importRestingHeartRate })} />
          </View>
          <Text style={styles.cardLine}>Only selected signals are imported.</Text>
        </View>

	        <View style={styles.card}>
	          <Text style={styles.cardTitle}>Sync Policy</Text>
	          <View style={styles.row}>
	            <Chip
	              label={stateLabel === 'authorized' && prefs.connected ? 'Auto Sync On Open' : 'Auto Sync (connect first)'}
	              active={prefs.autoSync && prefs.connected && stateLabel === 'authorized'}
	              onPress={() => void updatePrefs({ autoSync: !prefs.autoSync })}
	            />
	          </View>
	          <Text style={styles.cardLine}>
	            {stateLabel === 'authorized'
	              ? 'No background loops. Sync runs on app open/focus and manual import.'
	              : 'Enable Apple Health access to allow auto sync.'}
	          </Text>
	        </View>

	        <View style={styles.card}>
	          <Text style={styles.cardTitle}>Status</Text>
	          <Text style={styles.cardLine}>
	            Access: {stateLabel === 'authorized' ? 'On' : stateLabel === 'denied' ? 'Off' : stateLabel === 'notDetermined' ? 'Not connected' : 'Unavailable'}
	          </Text>
	          <Text style={styles.cardLine}>Last synced: {stateLabel === 'authorized' ? lastSyncLabel : '—'}</Text>
	          <Text style={styles.cardLine}>
	            Connected (Import): {prefs.connected ? '✅ Connected' : '❌ Not connected'}
	          </Text>
          <Text style={styles.cardLine}>
            Workout export (Proof of Life):{' '}
            {proof?.requested?.write?.length
              ? proof?.connected
                ? '✅ Verified (write+read)'
                : '❌ Not verified (write+read)'
              : proof?.connected
                ? '✅ Verified (read-only)'
                : '❌ Not verified'}
          </Text>
	          {proof ? (
	            <>
              <Text style={styles.cardLine}>Proof status: {proof.summary}</Text>
              <Text style={styles.cardLine}>Proof checked: {proof.checkedAt.slice(0, 19).replace('T', ' ')}</Text>
              {proof.writeTest.ok ? (
                <>
                  <Text style={styles.cardLine}>
                    Diagnostic workout: {proof.writeTest.workoutId ? proof.writeTest.workoutId.slice(0, 8) : 'saved'} (id)
                  </Text>
                  <Text style={styles.cardLine}>
                    Note: This writes a 20s diagnostic workout to Apple Health to prove write + read access. Delete it in Health → Workouts if you want.
                  </Text>
                </>
              ) : null}
              {proof.rateLimit?.limited ? (
                <Text style={styles.cardLine}>
                  Rate limited until: {proof.rateLimit.nextAllowedAt ? proof.rateLimit.nextAllowedAt.slice(0, 19).replace('T', ' ') : '—'}
                </Text>
              ) : null}
	              <Text style={styles.cardLine}>
	                Note: iOS does not expose reliable read-permission status. Use Import/Last Import results to verify reads.
	              </Text>
	              <Text style={styles.cardLine}>Auth (write):</Text>
	              {Object.entries(proof.status.write).slice(0, 6).map(([k, v]) => (
	                <Text key={`w_${k}`} style={styles.cardLine}>
	                  • {k}: {authCodeLabel(v)}
	                </Text>
	              ))}
              <Text style={styles.cardLine}>
                Read-back matches: id {proof.readTest.matchedByWorkoutId}, diag {proof.readTest.matchedByDiagnosticId}, flag{' '}
                {proof.readTest.matchedByDiagnosticFlag}
              </Text>
              {!proof.connected && proof.summary === 'authorized_write_failed' ? (
                <Text style={styles.cardLine}>Write error: {proof.writeTest.error || 'unknown'}</Text>
              ) : null}
              {!proof.connected && proof.summary === 'authorized_read_failed' ? (
                <Text style={styles.cardLine}>Read error: {proof.readTest.error || 'unknown'}</Text>
              ) : null}
            </>
          ) : null}
          <Text style={styles.cardLine}>Last request: {lastReqInfo.requestedAt ? lastReqInfo.requestedAt.slice(0, 19).replace('T', ' ') : '—'}</Text>
          <Text style={styles.cardLine}>Last result: {lastReqInfo.lastResult || '—'}</Text>
          {authDetail?.error ? (
            <View style={[styles.banner, styles.bannerWarning, { marginTop: 10 }]}>
              <Text style={styles.bannerText}>
                {String(authDetail.error || '').toLowerCase().includes('native module')
                  ? `${platformLabel} bridge is not active in this runtime. Use a native build, then reconnect.`
                  : `Health status error: ${authDetail.error}`}
              </Text>
              <Pressable style={styles.bannerAction} onPress={() => void openHealthApp()}>
                <Text style={styles.bannerActionText}>{healthOpenLabel}</Text>
              </Pressable>
            </View>
          ) : null}
          {stateLabel === 'authorized' ? (
            <View style={styles.row}>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>Auto Sync on open</Text>
              </View>
            </View>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>How It Is Used</Text>
          <Text style={styles.cardLine}>• Fills missing daily signals only</Text>
          <Text style={styles.cardLine}>• Improves confidence of metrics</Text>
          <Text style={styles.cardLine}>• Never replaces your explicit Zenith logs</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Data Priority</Text>
          <Text style={styles.cardLine}>Zenith logs {'>'} wearable imports for overlapping fields.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Garmin Connect IQ Companion</Text>
          <Text style={styles.cardLine}>
            Watch recording + companion sync is managed separately from Apple Health import.
            {!garminEnabled ? ' This build is in setup mode, but diagnostics are available.' : ''}
          </Text>
          <Pressable style={styles.secondaryBtn} onPress={() => router.push('/wearables/garmin' as any)}>
            <Text style={styles.secondaryBtnText}>Open Garmin Companion</Text>
          </Pressable>
        </View>

        {supportsHealthData ? (
          stateLabel === 'denied' ? (
            <>
              <Pressable style={styles.primaryBtn} onPress={() => void openHealthApp()}>
                <Text style={styles.primaryBtnText}>Open Health Settings</Text>
              </Pressable>
              <View style={styles.row}>
                <Pressable style={styles.secondaryBtn} onPress={() => void openSettings()}>
                  <Text style={styles.secondaryBtnText}>Open Settings</Text>
                </Pressable>
              </View>
              <Pressable style={styles.dangerBtn} onPress={() => void resetLocal()}>
                <Text style={styles.dangerText}>Reset local Health link state</Text>
              </Pressable>
            </>
          ) : (
            <>
              <View style={styles.actionStack}>
	              <Pressable
                  accessibilityRole="button"
                  pressRetentionOffset={{ top: 0, bottom: 0, left: 0, right: 0 }}
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    connecting && styles.primaryBtnDisabled,
                    pressed && styles.btnPressed,
                  ]}
                  onPress={connect}
                  disabled={connecting}
                >
	                <Text style={styles.primaryBtnText}>{connecting ? 'Connecting...' : connectButtonLabel}</Text>
	              </Pressable>
                <Pressable
                  accessibilityRole="button"
                  pressRetentionOffset={{ top: 0, bottom: 0, left: 0, right: 0 }}
                  style={({ pressed }) => [
                    styles.secondaryBtn,
                    proofRunning && styles.primaryBtnDisabled,
                    pressed && styles.btnPressed,
                  ]}
                  onPress={() => void runDiagnostic()}
                  disabled={proofRunning || connectProofRunning || connecting || importing}
                >
                  <Text style={styles.secondaryBtnText}>{proofRunning ? 'Running diagnostic…' : 'Run Diagnostic'}</Text>
                </Pressable>
                {proof?.rateLimit?.limited ? (
                  <Pressable
                    accessibilityRole="button"
                    pressRetentionOffset={{ top: 0, bottom: 0, left: 0, right: 0 }}
                    style={({ pressed }) => [
                      styles.secondaryBtn,
                      proofRunning && styles.primaryBtnDisabled,
                      pressed && styles.btnPressed,
                    ]}
                    onPress={() => void forceDiagnostic()}
                    disabled={proofRunning || connectProofRunning || connecting || importing}
                  >
                    <Text style={styles.secondaryBtnText}>{proofRunning ? 'Running diagnostic…' : 'Force Diagnostic (writes again)'}</Text>
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.inlineRow}>
                <Pressable style={styles.ghostBtn} onPress={() => void openHealthApp()} disabled={connecting || importing}>
                  <Text style={styles.ghostText}>{healthOpenLabel}</Text>
                </Pressable>
                <Pressable style={styles.ghostBtn} onPress={() => void openSettings()} disabled={connecting || importing}>
                  <Text style={styles.ghostText}>Open Settings</Text>
                </Pressable>
              </View>
              <Pressable style={styles.dangerBtn} onPress={() => void resetLocal()} disabled={connecting || importing}>
                <Text style={styles.dangerText}>Reset local Health link state</Text>
              </Pressable>
            </>
          )
        ) : null}

        <Pressable style={styles.secondaryBtn} onPress={() => router.back()}>
          <Text style={styles.secondaryBtnText}>Continue Without Wearable</Text>
        </Pressable>

        <Pressable
          style={[styles.secondaryBtn, (importing || !supportsHealthData) && styles.primaryBtnDisabled]}
          onPress={importToday}
          disabled={importing || !supportsHealthData}
        >
          <Text style={styles.secondaryBtnText}>{importing ? 'Importing...' : "Import Today's Signals"}</Text>
        </Pressable>

        {lastImport ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Last Import</Text>
            <Text style={styles.cardLine}>Status: {lastImport.imported ? 'Imported' : 'Not imported'}</Text>
            <Text style={styles.cardLine}>Steps: {lastImport.steps}</Text>
            <Text style={styles.cardLine}>Active energy: {lastImport.activeEnergy} kcal</Text>
            <Text style={styles.cardLine}>Sleep: {lastImport.sleepMinutes} min</Text>
            <Text style={styles.cardLine}>Resting HR: {lastImport.restingHeartRate || 0} bpm</Text>
          </View>
        ) : null}

        <Text style={styles.footnote}>Auto sync runs on open/foreground only when access is enabled and the last sync is stale.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  content: { padding: 16, paddingBottom: 48 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  backBtn: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.08)' },
  backText: { color: '#FFF', fontWeight: '700' },
  title: { color: '#FFF', fontSize: 24, fontWeight: '800' },
  platformBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(0,217,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(0,217,255,0.4)',
  },
  platformBadgeText: { color: '#DDF8FF', fontSize: 11, fontWeight: '800' },
  subtitle: { color: '#A8A8A8', marginBottom: 14, lineHeight: 20 },

  banner: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
  },
  bannerWarning: { borderColor: 'rgba(255,170,0,0.35)', backgroundColor: 'rgba(255,170,0,0.10)' },
  bannerInfo: { borderColor: 'rgba(0,217,255,0.35)', backgroundColor: 'rgba(0,217,255,0.10)' },
  bannerText: { color: '#F1F1F1', fontWeight: '700', lineHeight: 18 },
  bannerAction: { marginTop: 10, alignSelf: 'flex-start' },
  bannerActionText: { color: '#00D9FF', fontWeight: '900' },

  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    padding: 14,
    marginBottom: 10,
  },
  cardTitle: { color: '#FFF', fontSize: 15, fontWeight: '800', marginBottom: 8 },
  cardLine: { color: '#CFCFCF', marginBottom: 4 },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(0,255,136,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(0,255,136,0.3)',
  },
  badgeText: { color: '#BFFFE3', fontWeight: '900', fontSize: 11 },
  actionStack: { marginTop: 10, gap: 16 },
  primaryBtn: {
    borderRadius: 12,
    backgroundColor: '#00D9FF',
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnText: { color: '#00141A', fontWeight: '900' },
  secondaryBtn: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryBtnText: { color: '#E6E6E6', fontWeight: '700' },
  btnPressed: { opacity: 0.92, transform: [{ scale: 0.985 }] },
  inlineRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  ghostBtn: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  ghostText: { color: '#DDF8FF', fontWeight: '800' },
  dangerBtn: {
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,68,102,0.35)',
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: 'rgba(255,68,102,0.08)',
  },
  dangerText: { color: '#FFB1B1', fontWeight: '800' },
  footnote: { color: '#8B8B8B', fontSize: 12, marginTop: 14, lineHeight: 18 },
});
