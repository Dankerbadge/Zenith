import { useFocusEffect } from '@react-navigation/native'; import { router } from 'expo-router'; import React, { useCallback, useMemo, useRef, useState } from 'react'; import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../components/ui/GlassCard';
import { useAuth } from '../context/authcontext';
import {
  appendGarminEventLog,
  buildGarminFeatureSplit,
  consumeGarminOutboundMessage,
  consumePendingGarminWorkout,
  clearGarminLinkCode,
  generateGarminLinkCode,
  getGarminAvailability,
  getGarminCompanionState,
  getGarminEntitlementCache,
  getGarminEventLog,
  getGarminLinkCode,
  getGarminOutboundQueue,
  getPendingGarminWorkouts,
  importGarminWorkoutSummaryLocal,
  refreshGarminEntitlementFromSubscription,
  resetGarminCompanionState,
  setGarminLinkCode,
  setGarminCompanionState,
  stageGarminHelloMessage,
} from '../../utils/garminCompanionService';
import {
  confirmGarminLink,
  fetchGarminEntitlementFromBackend,
  getGarminBackendReadiness,
  requestGarminLinkToken,
  upsertGarminWorkoutSummaryWithRetry,
} from '../../utils/garminBackendService';
import { APP_CONFIG } from '../../utils/appConfig';
import {
  getGarminNativeConnectionState,
  hasGarminNativeBridge,
  requestGarminNativeEntitlementRefresh,
  sendGarminNativeMessage,
  startGarminNativeListening,
  stopGarminNativeListening,
  subscribeGarminNativeErrors,
  subscribeGarminNativeMessages,
  subscribeGarminNativeStateUpdates,
  type GarminNativeConnectionState,
} from '../../utils/garminNativeBridge';

function formatAge(ts: string | null) {
  if (!ts) return '—';
  const ms = Date.now() - new Date(ts).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  return `${Math.floor(ms / 1000)}s ago`;
}

function formatExpiry(ts: string | null) {
  if (!ts) return 'No expiry';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return 'No expiry';
  return d.toLocaleString();
}

const AUTO_SYNC_MIN_INTERVAL_MS = 90_000;

export default function GarminCompanionScreen() {
  return <GarminCompanionScreenInner />;
}

function GarminCompanionScreenInner() {
  const { getSupabaseAccessToken, hasSupabaseSession, supabaseAuthLastError } = useAuth();
  const availability = useMemo(() => getGarminAvailability(), []);
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<Awaited<ReturnType<typeof getGarminCompanionState>> | null>(null);
  const [entitlement, setEntitlement] = useState<Awaited<ReturnType<typeof getGarminEntitlementCache>> | null>(null);
  const [linkCode, setLinkCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [queueSize, setQueueSize] = useState(0);
  const [pendingWorkouts, setPendingWorkouts] = useState(0);
  const [eventLogPreview, setEventLogPreview] = useState<{ at: string; message: string }[]>([]);
  const [nativeState, setNativeState] = useState<GarminNativeConnectionState | null>(null);
  const [syncingQueue, setSyncingQueue] = useState(false);
  const [syncingWorkouts, setSyncingWorkouts] = useState(false);
  const [autoSyncStatus, setAutoSyncStatus] = useState<'idle' | 'syncing' | 'throttled' | 'skipped' | 'done'>('idle');
  const [lastAutoSyncAt, setLastAutoSyncAt] = useState<string | null>(null);
  const [simImportStatus, setSimImportStatus] = useState<string | null>(null);
  const lastAutoSyncEpochRef = useRef(0);
  const autoSyncInFlightRef = useRef(false);

  const backendReadiness = useMemo(() => getGarminBackendReadiness(), []);
  const nativeBridgeAvailable = useMemo(() => hasGarminNativeBridge(), []);
  const split = useMemo(() => buildGarminFeatureSplit(), []);
  const hasLinkCode = Boolean(linkCode?.code);
  const hasWatchInstallId = Boolean(state?.watchAppInstallId);
  const canConfirmLink = hasSupabaseSession && hasWatchInstallId && hasLinkCode;
  const linkChecklist = useMemo(
    () => [
      { label: 'Garmin feature flag enabled', ready: APP_CONFIG.FEATURES.GARMIN_CONNECT_ENABLED },
      { label: 'Backend configured', ready: backendReadiness.configured },
      { label: 'Supabase session active', ready: hasSupabaseSession },
      { label: 'Watch install ID detected', ready: hasWatchInstallId },
      { label: 'Valid link code generated', ready: hasLinkCode },
    ],
    [backendReadiness.configured, hasLinkCode, hasSupabaseSession, hasWatchInstallId]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextState, nextEntitlement, nextLinkCode, queue, pending, events] = await Promise.all([
        getGarminCompanionState(),
        getGarminEntitlementCache(),
        getGarminLinkCode(),
        getGarminOutboundQueue(),
        getPendingGarminWorkouts(),
        getGarminEventLog(),
      ]);
      const nextNativeState = await getGarminNativeConnectionState();
      setState(nextState);
      setEntitlement(nextEntitlement);
      setLinkCode(nextLinkCode);
      setQueueSize(queue.length);
      setPendingWorkouts(pending.length);
      setEventLogPreview(events.slice(-5).reverse());
      setNativeState(nextNativeState);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  useFocusEffect(
    useCallback(() => {
      void startGarminNativeListening();
      const unsubState = subscribeGarminNativeStateUpdates((event) => {
        void appendGarminEventLog(`Native state update: ${event.state || 'unknown'} (${event.reason || 'no reason'})`);
        void load();
      });
      const unsubMessages = subscribeGarminNativeMessages((event) => {
        void appendGarminEventLog(`Native message: ${event.type || event.direction || 'event'} (${event.status || 'ok'})`);
      });
      const unsubErrors = subscribeGarminNativeErrors((event) => {
        void appendGarminEventLog(`Native error: ${event.code || 'unknown'} ${event.message || ''}`.trim());
      });

      return () => {
        unsubState();
        unsubMessages();
        unsubErrors();
        void stopGarminNativeListening();
      };
    }, [load])
  );

  const refreshEntitlement = useCallback(async () => {
    const accessToken = await getSupabaseAccessToken();
    if (accessToken) {
      const remote = await fetchGarminEntitlementFromBackend(accessToken);
      if (remote.ok) {
        await appendGarminEventLog(`Entitlement refreshed from backend (premium=${remote.data.isPremium ? 'yes' : 'no'}).`);
        await load();
        return;
      }
      await appendGarminEventLog(`Backend entitlement refresh failed: ${remote.error}`);
    } else {
      await appendGarminEventLog('No Supabase session token available for backend entitlement sync.');
    }

    const next = await refreshGarminEntitlementFromSubscription();
    await appendGarminEventLog(`Entitlement refreshed from mobile cache fallback (premium=${next.isPremium ? 'yes' : 'no'}).`);
    await load();
  }, [getSupabaseAccessToken, load]);

  const createLinkCode = async () => {
    const accessToken = await getSupabaseAccessToken();
    const watchInstallId = state?.watchAppInstallId;

    if (accessToken && watchInstallId) {
      const remote = await requestGarminLinkToken({
        accessToken,
        watchAppInstallId: watchInstallId,
      });
      if (remote.ok) {
        await setGarminLinkCode(remote.data.linkToken, remote.data.expiresAt);
        await appendGarminEventLog(`Generated backend Garmin link token for ${watchInstallId}.`);
        await load();
        return;
      }
      await appendGarminEventLog(`Backend link token request failed: ${remote.error}`);
    } else if (!watchInstallId) {
      await appendGarminEventLog('Cannot request backend link token yet: missing watch install ID. Stage HELLO first.');
    }

    const code = await generateGarminLinkCode();
    await appendGarminEventLog(`Generated local Garmin link code ${code} (fallback).`);
    await load();
  };

  const confirmLink = async () => {
    const accessToken = await getSupabaseAccessToken();
    const watchInstallId = state?.watchAppInstallId;
    const token = linkCode?.code;

    if (!accessToken) {
      Alert.alert('Supabase auth required', 'Sign in again to confirm Garmin link against backend functions.');
      return;
    }
    if (!watchInstallId) {
      Alert.alert('Missing watch install ID', 'Stage HELLO first to capture a watch install identifier.');
      return;
    }
    if (!token) {
      Alert.alert('Missing link code', 'Generate a link code first.');
      return;
    }

    const result = await confirmGarminLink({
      accessToken,
      watchAppInstallId: watchInstallId,
      linkToken: token,
    });

    if (!result.ok) {
      Alert.alert('Link confirm failed', result.error);
      await appendGarminEventLog(`Backend link confirm failed: ${result.error}`);
      return;
    }

    await setGarminCompanionState({
      linked: result.data.linked,
      watchAppInstallId: result.data.watchAppInstallId,
      linkHandle: result.data.linkHandle,
      lastSyncAt: new Date().toISOString(),
      lastError: null,
      connectionState: 'connected',
    });
    await appendGarminEventLog(`Backend link confirmed for install ${result.data.watchAppInstallId}.`);
    await load();
  };

  const clearLink = async () => {
    await clearGarminLinkCode();
    await appendGarminEventLog('Cleared Garmin link code.');
    await load();
  };

  const stageHello = async () => {
    const currentState = await getGarminCompanionState();
    const currentEntitlement = await getGarminEntitlementCache();
    const watchInstallId = currentState.watchAppInstallId || `watch_install_${Date.now()}`;
    await setGarminCompanionState({
      watchAppInstallId: watchInstallId,
      lastHelloAt: new Date().toISOString(),
      connectionState: availability.state === 'ready' ? 'connecting' : 'bridge_unavailable',
      lastError: availability.state === 'ready' ? null : availability.reason,
    });
    await stageGarminHelloMessage({
      watchAppInstallId: watchInstallId,
      lastKnownEntitlementState: currentEntitlement,
    });
    await appendGarminEventLog('Staged HELLO message for watch reconnect sync.');
    await sendGarminNativeMessage({
      type: 'HELLO',
      watchAppInstallId: watchInstallId,
      protocolVersion: 1,
      sentAt: new Date().toISOString(),
    });
    await load();
  };

  const markConnected = async () => {
    await setGarminCompanionState({
      connectionState: 'connected',
      linked: true,
      linkHandle: state?.linkHandle || `link_${Date.now()}`,
      lastSyncAt: new Date().toISOString(),
      lastError: null,
    });
    await appendGarminEventLog('Connection state set to connected for local diagnostics.');
    await load();
  };

  const clearAll = () => {
    Alert.alert('Reset Garmin companion cache?', 'This clears local queue, link state, cached entitlement, and diagnostics.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await resetGarminCompanionState();
            await appendGarminEventLog('Companion cache reset.');
            await load();
          })();
        },
      },
    ]);
  };

  const pingNativeEntitlement = async () => {
    await requestGarminNativeEntitlementRefresh();
    await appendGarminEventLog('Requested native entitlement refresh signal.');
    await load();
  };

  const simulateGarminImport = async (kind: 'run' | 'lift') => {
    const localSessionId = `garmin_sim_${kind}_${Date.now()}_${Math.round(Math.random() * 10000)}`;
    const start = new Date(Date.now() - 12 * 60 * 1000).toISOString();
    const end = new Date().toISOString();
    const payload =
          kind === 'run'
            ? {
                localSessionId,
                sportType: 'run',
                startTimestamp: start,
                endTimestamp: end,
                elapsedTimeSeconds: 12 * 60,
                distanceMeters: 2800,
                avgHeartRate: null,
                hrAvailable: false,
                calories: 160,
                fitFileSaved: true,
                source: 'garmin_watch' as const,
                deviceModel: 'SIM',
              }
            : {
                localSessionId,
                sportType: 'lift',
                startTimestamp: start,
                endTimestamp: end,
                elapsedTimeSeconds: 18 * 60,
                distanceMeters: null,
                avgHeartRate: null,
                hrAvailable: false,
                calories: 220,
                fitFileSaved: true,
                source: 'garmin_watch' as const,
                deviceModel: 'SIM',
              };

    setSimImportStatus('Importing…');
    const result = await importGarminWorkoutSummaryLocal(payload as any);
    setSimImportStatus(result.ok ? `Imported ${result.kind} (${result.localSessionId}).` : `Import failed: ${result.error}`);
    await load();
  };

  const flushOutboundQueue = useCallback(async (options?: { silent?: boolean }) => {
    const silent = Boolean(options?.silent);
    if (!nativeBridgeAvailable) {
      if (!silent) {
        Alert.alert(
          'Native bridge not active',
          'Use Apple Health sync or FIT/GPX import from this screen while native bridge is unavailable in this runtime.'
        );
      }
      await appendGarminEventLog('Outbound queue flush skipped: native bridge unavailable.');
      return;
    }
    const queued = await getGarminOutboundQueue();
    if (queued.length === 0) {
      if (!silent) {
        await appendGarminEventLog('No outbound Garmin messages to flush.');
      }
      await load();
      return;
    }

    setSyncingQueue(true);
    let sent = 0;
    let failed = 0;
    try {
      for (const message of queued) {
        const ok = await sendGarminNativeMessage({
          type: message.messageType,
          messageId: message.messageId,
          payload: message.payload,
          protocolVersion: message.protocolVersion,
          sentAt: message.sentAt,
          source: message.source,
          watchAppInstallId: message.watchAppInstallId,
          localSessionId: message.localSessionId,
        });

        if (ok) {
          sent += 1;
          await consumeGarminOutboundMessage(message.messageId);
        } else {
          failed += 1;
          await appendGarminEventLog(`Failed to flush outbound message ${message.messageId}.`);
          break;
        }
      }
      await appendGarminEventLog(`Flushed Garmin outbound queue: ${sent} sent, ${failed} failed.`);
    } finally {
      setSyncingQueue(false);
      await load();
    }
  }, [load, nativeBridgeAvailable]);

  const syncPendingWorkoutsNow = useCallback(async (options?: { silent?: boolean }) => {
    const silent = Boolean(options?.silent);
    const accessToken = await getSupabaseAccessToken();
    if (!accessToken) {
      if (!silent) {
        Alert.alert('Supabase auth required', 'Sign in again to upload pending Garmin workouts.');
      }
      await appendGarminEventLog('Pending workout sync skipped: missing Supabase access token.');
      return;
    }

    const pending = await getPendingGarminWorkouts();
    if (pending.length === 0) {
      if (!silent) {
        await appendGarminEventLog('No pending Garmin workouts to upload.');
      }
      await load();
      return;
    }

    setSyncingWorkouts(true);
    let uploaded = 0;
    let failed = 0;
    try {
      for (const summary of pending) {
        const result = await upsertGarminWorkoutSummaryWithRetry(
          { accessToken, summary },
          { attempts: 3, baseDelayMs: 450 }
        );
        if (result.ok) {
          uploaded += 1;
          await consumePendingGarminWorkout(summary.localSessionId);
          continue;
        }
        failed += 1;
        await appendGarminEventLog(`Workout upload failed for ${summary.localSessionId}: ${result.error}`);
      }
      await appendGarminEventLog(`Pending workout sync complete: ${uploaded} uploaded, ${failed} failed.`);
    } finally {
      setSyncingWorkouts(false);
      await load();
    }
  }, [getSupabaseAccessToken, load]);

  const runEndToEndSync = useCallback(async () => {
    await appendGarminEventLog('Starting Garmin end-to-end sync pass.');
    await refreshEntitlement();
    await flushOutboundQueue();
    await syncPendingWorkoutsNow();
    await appendGarminEventLog('Completed Garmin end-to-end sync pass.');
    await load();
  }, [flushOutboundQueue, load, refreshEntitlement, syncPendingWorkoutsNow]);

  const runAutoSyncOnFocus = useCallback(async () => {
    if (!APP_CONFIG.FEATURES.GARMIN_CONNECT_ENABLED) {
      setAutoSyncStatus('skipped');
      return;
    }

    if (autoSyncInFlightRef.current) return;
    const now = Date.now();
    if (now - lastAutoSyncEpochRef.current < AUTO_SYNC_MIN_INTERVAL_MS) {
      setAutoSyncStatus('throttled');
      return;
    }

    if (!backendReadiness.configured && !nativeBridgeAvailable) {
      setAutoSyncStatus('skipped');
      await appendGarminEventLog('Auto-sync skipped: backend not configured and native bridge unavailable.');
      return;
    }

    autoSyncInFlightRef.current = true;
    lastAutoSyncEpochRef.current = now;
    setAutoSyncStatus('syncing');
    try {
      await appendGarminEventLog('Auto-sync on focus started.');
      await refreshEntitlement();
      await flushOutboundQueue({ silent: true });
      await syncPendingWorkoutsNow({ silent: true });
      setLastAutoSyncAt(new Date().toISOString());
      setAutoSyncStatus('done');
      await appendGarminEventLog('Auto-sync on focus completed.');
    } catch (error) {
      setAutoSyncStatus('skipped');
      const message = error instanceof Error ? error.message : 'Unknown auto-sync error';
      await appendGarminEventLog(`Auto-sync on focus failed: ${message}`);
    } finally {
      autoSyncInFlightRef.current = false;
      await load();
    }
  }, [backendReadiness.configured, flushOutboundQueue, load, nativeBridgeAvailable, refreshEntitlement, syncPendingWorkoutsNow]);

  useFocusEffect(
    useCallback(() => {
      void runAutoSyncOnFocus();
    }, [runAutoSyncOnFocus])
  );

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.back}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Garmin Connect IQ</Text>
          <View style={{ width: 40 }} />
        </View>

        <Text style={styles.subtitle}>Free watch recording stays available. Premium watch insights unlock through Zenith mobile subscription entitlement sync.</Text>

        <GlassCard>
          <Text style={styles.section}>Feature availability</Text>
          <View style={styles.row}><Text style={styles.key}>State</Text><Text style={styles.value}>{availability.state}</Text></View>
          <View style={styles.row}><Text style={styles.key}>Reason</Text><Text style={styles.value}>{availability.reason}</Text></View>
          <View style={styles.row}><Text style={styles.key}>Companion bridge</Text><Text style={styles.value}>{availability.companionBridgeEnabled ? 'Enabled' : 'Pending'}</Text></View>
          <View style={styles.row}><Text style={styles.key}>Watch feature flag</Text><Text style={styles.value}>{APP_CONFIG.FEATURES.GARMIN_CONNECT_ENABLED ? 'On' : 'Off'}</Text></View>
        </GlassCard>

        <View style={{ height: 10 }} />
        <GlassCard>
          <Text style={styles.section}>Free vs premium split</Text>
          <Text style={styles.listTitle}>Free on watch</Text>
          {split.freeOnWatch.map((item) => (
            <Text key={item} style={styles.listItem}>• {item}</Text>
          ))}
          <Text style={[styles.listTitle, { marginTop: 10 }]}>Premium via mobile entitlement</Text>
          {split.premiumViaMobileEntitlement.map((item) => (
            <Text key={item} style={styles.listItem}>• {item}</Text>
          ))}
          <Text style={styles.helper}>No watch-side pricing or purchase UI is shown.</Text>
        </GlassCard>

        <View style={{ height: 10 }} />
        <GlassCard>
          <Text style={styles.section}>Companion diagnostics</Text>
          <View style={styles.row}><Text style={styles.key}>Connection</Text><Text style={styles.value}>{state?.connectionState || 'disconnected'}</Text></View>
          <View style={styles.row}><Text style={styles.key}>Supabase session</Text><Text style={styles.value}>{hasSupabaseSession ? 'Ready' : 'Missing'}</Text></View>
          <View style={styles.row}><Text style={styles.key}>Linked</Text><Text style={styles.value}>{state?.linked ? 'Yes' : 'No'}</Text></View>
          <View style={styles.row}><Text style={styles.key}>Watch install</Text><Text style={styles.value}>{state?.watchAppInstallId || '—'}</Text></View>
          <View style={styles.row}><Text style={styles.key}>Last HELLO</Text><Text style={styles.value}>{formatAge(state?.lastHelloAt || null)}</Text></View>
          <View style={styles.row}><Text style={styles.key}>Last sync</Text><Text style={styles.value}>{formatAge(state?.lastSyncAt || null)}</Text></View>
          <View style={styles.row}><Text style={styles.key}>Outbound queue</Text><Text style={styles.value}>{queueSize}</Text></View>
          <View style={styles.row}><Text style={styles.key}>Pending workouts</Text><Text style={styles.value}>{pendingWorkouts}</Text></View>
          <View style={styles.row}><Text style={styles.key}>Auto-sync on focus</Text><Text style={styles.value}>{autoSyncStatus}</Text></View>
          <View style={styles.row}><Text style={styles.key}>Last auto-sync</Text><Text style={styles.value}>{formatAge(lastAutoSyncAt)}</Text></View>
          <View style={styles.row}><Text style={styles.key}>Auto-sync interval</Text><Text style={styles.value}>90s throttle</Text></View>
          <View style={styles.row}><Text style={styles.key}>Native bridge</Text><Text style={styles.value}>{nativeBridgeAvailable ? 'Available' : 'Unavailable'}</Text></View>
          <View style={styles.row}><Text style={styles.key}>Native state</Text><Text style={styles.value}>{nativeState?.state || 'bridge_unavailable'}</Text></View>
          {state?.lastError ? <Text style={styles.errorText}>Last error: {state.lastError}</Text> : null}
          {nativeState?.lastError ? <Text style={styles.errorText}>Native error: {nativeState.lastError}</Text> : null}
          {supabaseAuthLastError ? <Text style={styles.errorText}>Supabase auth: {supabaseAuthLastError}</Text> : null}
        </GlassCard>

        <View style={{ height: 10 }} />
        <GlassCard>
          <Text style={styles.section}>Entitlement cache</Text>
          <View style={styles.row}><Text style={styles.key}>Premium</Text><Text style={styles.value}>{entitlement?.isPremium ? 'Yes' : 'No'}</Text></View>
          <View style={styles.row}><Text style={styles.key}>Source</Text><Text style={styles.value}>{entitlement?.source || 'unknown'}</Text></View>
          <View style={styles.row}><Text style={styles.key}>Expires</Text><Text style={styles.value}>{formatExpiry(entitlement?.expiresAt || null)}</Text></View>
          <Text style={styles.listTitle}>Enabled features</Text>
          {(entitlement?.featuresEnabled || []).map((feature) => (
            <Text key={feature} style={styles.listItem}>• {feature}</Text>
          ))}
        </GlassCard>

        <View style={{ height: 10 }} />
        <GlassCard>
          <Text style={styles.section}>Link readiness checklist</Text>
          {linkChecklist.map((item) => (
            <View key={item.label} style={styles.checkRow}>
              <Text style={styles.key}>{item.label}</Text>
              <Text style={item.ready ? styles.checkReady : styles.checkPending}>{item.ready ? 'Ready' : 'Pending'}</Text>
            </View>
          ))}
          {!canConfirmLink ? (
            <Text style={styles.helper}>
              Confirm link unlocks once backend is configured, you are signed in, watch install ID is staged, and a valid link code exists.
            </Text>
          ) : null}
        </GlassCard>

        <View style={{ height: 10 }} />
        <GlassCard>
          <Text style={styles.section}>Link flow</Text>
          <Text style={styles.helper}>Generate a short-lived link code in mobile, then enter it on watch to bind installation to account.</Text>
          <View style={styles.row}><Text style={styles.key}>Active code</Text><Text style={styles.value}>{linkCode ? linkCode.code : 'None'}</Text></View>
          <View style={styles.row}><Text style={styles.key}>Expires</Text><Text style={styles.value}>{linkCode ? formatExpiry(linkCode.expiresAt) : '—'}</Text></View>
          <View style={styles.buttonRow}>
            <Pressable style={styles.button} onPress={() => void createLinkCode()}>
              <Text style={styles.buttonText}>Generate Link Code</Text>
            </Pressable>
            <Pressable style={styles.button} onPress={() => void clearLink()}>
              <Text style={styles.buttonText}>Clear Code</Text>
            </Pressable>
          </View>
          <Pressable style={[styles.button, !canConfirmLink && styles.disabled]} onPress={() => void confirmLink()} disabled={!canConfirmLink}>
            <Text style={styles.buttonText}>Confirm Link with Backend</Text>
          </Pressable>
        </GlassCard>

        <View style={{ height: 10 }} />
        <GlassCard>
          <Text style={styles.section}>Backend readiness</Text>
          <View style={styles.row}><Text style={styles.key}>Configured</Text><Text style={styles.value}>{backendReadiness.configured ? 'Yes' : 'No'}</Text></View>
          <View style={styles.row}><Text style={styles.key}>Mode</Text><Text style={styles.value}>{backendReadiness.mode}</Text></View>
          <Text style={styles.helper}>Base URL: {backendReadiness.baseUrl || 'Not configured'}</Text>
          <Text style={styles.helper}>
            {backendReadiness.mode === 'supabase_edge'
              ? 'Edge functions: /garmin-entitlement, /garmin-link-token, /garmin-link-confirm, /garmin-workout-upsert'
              : 'REST endpoints: /wearables/garmin/entitlement, /link-token, /link-confirm, /workouts/upsert'}
          </Text>
        </GlassCard>

        <View style={{ height: 10 }} />
        <GlassCard>
          <Text style={styles.section}>Actions</Text>
          <View style={styles.buttonRow}>
            <Pressable style={styles.button} onPress={() => void refreshEntitlement()}>
              <Text style={styles.buttonText}>Refresh Entitlement</Text>
            </Pressable>
            <Pressable style={styles.button} onPress={() => void stageHello()}>
              <Text style={styles.buttonText}>Stage HELLO</Text>
            </Pressable>
          </View>
          <View style={styles.buttonRow}>
            <Pressable style={[styles.button, syncingQueue && styles.disabled]} onPress={() => void flushOutboundQueue()} disabled={syncingQueue}>
              <Text style={styles.buttonText}>{syncingQueue ? 'Flushing Queue…' : 'Flush Outbound Queue'}</Text>
            </Pressable>
            <Pressable style={[styles.button, syncingWorkouts && styles.disabled]} onPress={() => void syncPendingWorkoutsNow()} disabled={syncingWorkouts}>
              <Text style={styles.buttonText}>{syncingWorkouts ? 'Syncing Workouts…' : 'Sync Pending Workouts'}</Text>
            </Pressable>
          </View>
          <View style={styles.buttonRow}>
            <Pressable style={styles.button} onPress={() => void pingNativeEntitlement()}>
              <Text style={styles.buttonText}>Signal Native Refresh</Text>
            </Pressable>
            <Pressable style={styles.button} onPress={() => void markConnected()}>
              <Text style={styles.buttonText}>Mark Connected</Text>
            </Pressable>
          </View>
          <Pressable style={styles.button} onPress={() => void runEndToEndSync()}>
            <Text style={styles.buttonText}>Run Full Sync Pass</Text>
          </Pressable>
          <Pressable style={[styles.button, styles.danger]} onPress={clearAll}>
            <Text style={styles.buttonText}>Reset Cache</Text>
          </Pressable>
          <Pressable style={[styles.button, loading && styles.disabled]} onPress={() => void load()} disabled={loading}>
            <Text style={styles.buttonText}>{loading ? 'Refreshing…' : 'Refresh Diagnostics'}</Text>
          </Pressable>
        </GlassCard>

        {__DEV__ ? (
          <>
            <View style={{ height: 10 }} />
            <GlassCard>
              <Text style={styles.section}>Local import simulator (P0)</Text>
              <Text style={styles.helper}>
                Dev-only. Simulates a Connect IQ watch sending a saved workout summary into Zenith. Imports locally and is idempotent by localSessionId. No Supabase required.
              </Text>
              {simImportStatus ? <Text style={styles.helper}>Status: {simImportStatus}</Text> : null}
              <View style={styles.buttonRow}>
                <Pressable style={styles.button} onPress={() => void simulateGarminImport('run')}>
                  <Text style={styles.buttonText}>Simulate Run Summary</Text>
                </Pressable>
                <Pressable style={styles.button} onPress={() => void simulateGarminImport('lift')}>
                  <Text style={styles.buttonText}>Simulate Lift Summary</Text>
                </Pressable>
              </View>
            </GlassCard>
          </>
        ) : null}

        <View style={{ height: 10 }} />
        <GlassCard>
          <Text style={styles.section}>Recent protocol events</Text>
          {eventLogPreview.length === 0 ? <Text style={styles.helper}>No events yet.</Text> : null}
          {eventLogPreview.map((event) => (
            <View key={`${event.at}_${event.message}`} style={styles.eventRow}>
              <Text style={styles.eventTime}>{new Date(event.at).toLocaleTimeString()}</Text>
              <Text style={styles.eventText}>{event.message}</Text>
            </View>
          ))}
        </GlassCard>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  content: { padding: 16, paddingBottom: 40 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  back: { color: '#7EDCFF', fontWeight: '700' },
  title: { color: '#FFF', fontWeight: '800', fontSize: 20 },
  subtitle: { color: '#A4A4A4', marginBottom: 10, lineHeight: 20 },
  section: { color: '#FFF', fontWeight: '800', marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginBottom: 5 },
  checkRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginBottom: 7, alignItems: 'center' },
  key: { color: '#A3B6BE', fontWeight: '700', flex: 1 },
  value: { color: '#E7F4FA', fontWeight: '700', flex: 1.2, textAlign: 'right' },
  checkReady: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(116,231,182,0.45)',
    backgroundColor: 'rgba(116,231,182,0.14)',
    color: '#D2F4E5',
    paddingHorizontal: 10,
    paddingVertical: 3,
    fontSize: 11,
    fontWeight: '800',
  },
  checkPending: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,193,113,0.45)',
    backgroundColor: 'rgba(255,193,113,0.12)',
    color: '#FFE4C1',
    paddingHorizontal: 10,
    paddingVertical: 3,
    fontSize: 11,
    fontWeight: '800',
  },
  listTitle: { color: '#DDEAF0', fontWeight: '700', marginTop: 4, marginBottom: 5 },
  listItem: { color: '#C8D5DB', marginBottom: 4, lineHeight: 18 },
  helper: { color: '#9FB1B8', fontSize: 12, lineHeight: 18, marginTop: 4 },
  errorText: { color: '#FFBABA', marginTop: 6, fontWeight: '700' },
  buttonRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  button: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    backgroundColor: '#141414',
    borderRadius: 10,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  danger: { borderColor: '#5A2A2A', backgroundColor: '#231010' },
  disabled: { opacity: 0.6 },
  buttonText: { color: '#D7EEF7', fontWeight: '800', fontSize: 12, textAlign: 'center' },
  eventRow: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    paddingTop: 8,
    marginTop: 8,
    gap: 4,
  },
  eventTime: { color: '#90A4AD', fontSize: 11, fontWeight: '700' },
  eventText: { color: '#D2DFE5', fontSize: 12, lineHeight: 17 },
});
