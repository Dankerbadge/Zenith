import { router } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../components/ui/GlassCard';
import { APP_CONFIG } from '../../utils/appConfig';
import { captureException } from '../../utils/crashReporter';
import {
  clearCloudStateSyncQueue,
  flushCloudStateSyncQueue,
  getCloudStateSyncDiagnostics,
  restoreCloudStateIfLocalMissing,
  type CloudStateSyncDiagnostics,
} from '../../utils/cloudStateSync';
import {
  clearRunCommandAck,
  clearActiveRunSnapshot,
  consumeRunCommand,
  getActiveRunSnapshot,
  getQueuedRunCommands,
  getRunCommandAck,
  type RunSnapshot,
} from '../../utils/runControlSync';
import {
  clearActiveLiftSnapshot,
  clearLiftCommandAck,
  consumeLiftCommand,
  getActiveLiftSnapshot,
  getLiftCommandAck,
  getQueuedLiftCommands,
  type LiftSnapshot,
} from '../../utils/liftControlSync';
import { getFinalizeInboxSummary, reemitFinalizeInbox, requestWatchFinalizeResend, requestWatchRoutePreview } from '../../utils/watchFinalizeInbox';

type DiagnosticState = {
  cloud: CloudStateSyncDiagnostics | null;
  runSnapshot: RunSnapshot | null;
  liftSnapshot: LiftSnapshot | null;
  runQueueSize: number;
  liftQueueSize: number;
  runPendingAck: number;
  liftPendingAck: number;
  finalizeInboxRows: any[];
  finalizeInboxError: string | null;
};

const DEFAULT_STATE: DiagnosticState = {
  cloud: null,
  runSnapshot: null,
  liftSnapshot: null,
  runQueueSize: 0,
  liftQueueSize: 0,
  runPendingAck: 0,
  liftPendingAck: 0,
  finalizeInboxRows: [],
  finalizeInboxError: null,
};

function formatAge(ts?: string) {
  if (!ts) return '—';
  const ms = Date.now() - new Date(ts).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  return `${Math.floor(ms / 1000)}s ago`;
}

export default function ControlDiagnosticsScreen() {
  const watchControlsEnabled = APP_CONFIG.FEATURES.APPLE_WATCH_ENABLED;
  const [state, setState] = useState<DiagnosticState>(DEFAULT_STATE);
  const [refreshing, setRefreshing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [syncingCloud, setSyncingCloud] = useState(false);
  const [reemitFinalizes, setReemitFinalizes] = useState(false);
  const [exportingInbox, setExportingInbox] = useState(false);
  const [inboxActionBusyId, setInboxActionBusyId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [cloud, runSnapshot, liftSnapshot, runQueue, liftQueue, finalizeInbox] = await Promise.all([
        getCloudStateSyncDiagnostics(),
        getActiveRunSnapshot(),
        getActiveLiftSnapshot(),
        getQueuedRunCommands(),
        getQueuedLiftCommands(),
        getFinalizeInboxSummary(),
      ]);

      const [runAcks, liftAcks] = await Promise.all([
        Promise.all(runQueue.map((row) => getRunCommandAck(row.clientCommandId))),
        Promise.all(liftQueue.map((row) => getLiftCommandAck(row.clientCommandId))),
      ]);

      const finalizeInboxRows = finalizeInbox.ok ? finalizeInbox.rows : [];
      const finalizeInboxError = finalizeInbox.ok ? null : finalizeInbox.message || null;

      setState({
        cloud,
        runSnapshot,
        liftSnapshot,
        runQueueSize: runQueue.length,
        liftQueueSize: liftQueue.length,
        runPendingAck: runAcks.filter(Boolean).length,
        liftPendingAck: liftAcks.filter(Boolean).length,
        finalizeInboxRows,
        finalizeInboxError,
      });
      setLoadError(null);
    } catch (err: any) {
      setLoadError(String(err?.message || 'Unable to load diagnostics.'));
      void captureException(err, { feature: 'control_diagnostics', op: 'load' });
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const clearAll = async () => {
    if (!watchControlsEnabled) return;
    setClearing(true);
    try {
      const [runQueue, liftQueue] = await Promise.all([getQueuedRunCommands(), getQueuedLiftCommands()]);
      await Promise.all(runQueue.map((row) => consumeRunCommand(row.clientCommandId)));
      await Promise.all(liftQueue.map((row) => consumeLiftCommand(row.clientCommandId)));
      await Promise.all(runQueue.map((row) => clearRunCommandAck(row.clientCommandId)));
      await Promise.all(liftQueue.map((row) => clearLiftCommandAck(row.clientCommandId)));
      await Promise.all([clearActiveRunSnapshot(), clearActiveLiftSnapshot()]);
      await load();
      Alert.alert('Cleared', 'Control queues and active snapshots were cleared.');
    } catch (err: any) {
      Alert.alert('Clear failed', String(err?.message || 'Unable to clear diagnostics state.'));
      void captureException(err, { feature: 'control_diagnostics', op: 'clear_all' });
    } finally {
      setClearing(false);
    }
  };

  const forceCloudSync = async () => {
    setSyncingCloud(true);
    try {
      const flushed = await flushCloudStateSyncQueue('manual');
      const restored = await restoreCloudStateIfLocalMissing();
      await load();
      Alert.alert(
        'Cloud sync',
        `Flush: ${flushed.skipped ? 'skipped' : `flushed ${flushed.flushed}`}\nRestore: ${
          restored.skipped ? `skipped (${restored.reason})` : `restored ${restored.restored}`
        }`
      );
    } catch (err: any) {
      Alert.alert('Cloud sync failed', String(err?.message || 'Unable to run cloud sync.'));
      void captureException(err, { feature: 'control_diagnostics', op: 'force_cloud_sync' });
    } finally {
      setSyncingCloud(false);
    }
  };

  const clearCloudQueue = async () => {
    try {
      await clearCloudStateSyncQueue();
      await load();
      Alert.alert('Cloud sync', 'Queued cloud writes were cleared.');
    } catch (err: any) {
      Alert.alert('Clear queue failed', String(err?.message || 'Unable to clear cloud queue.'));
      void captureException(err, { feature: 'control_diagnostics', op: 'clear_cloud_queue' });
    }
  };

  const reemitInbox = async () => {
    if (reemitFinalizes) return;
    setReemitFinalizes(true);
    try {
      const res = await reemitFinalizeInbox();
      await load();
      if (!res.ok) {
        Alert.alert('Re-emit failed', res.message || 'Unable to re-emit finalizes from the inbox.');
        return;
      }
      Alert.alert('Re-emitted', `Finalize inbox re-emitted.\nTotal: ${String(res.result?.total ?? '—')}\nEmitted: ${String(res.result?.emitted ?? '—')}\nQueued: ${String(res.result?.queued ?? '—')}`);
    } catch (err: any) {
      Alert.alert('Re-emit failed', String(err?.message || 'Unable to re-emit finalizes.'));
      void captureException(err, { feature: 'control_diagnostics', op: 'reemit_finalize_inbox' });
    } finally {
      setReemitFinalizes(false);
    }
  };

  const exportFinalizeInbox = async () => {
    if (exportingInbox) return;
    setExportingInbox(true);
    try {
      const dir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
      if (!dir) throw new Error('No writable directory available.');
      const uri = `${dir}zenith_finalize_inbox_${Date.now()}.json`;
      const contents = JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          rows: state.finalizeInboxRows,
        },
        null,
        2
      );
      await FileSystem.writeAsStringAsync(uri, contents, { encoding: FileSystem.EncodingType.UTF8 });
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert('Exported', `Saved finalize inbox JSON to:\n${uri}`);
        return;
      }
      await Sharing.shareAsync(uri, { UTI: 'public.json', mimeType: 'application/json' });
    } catch (err: any) {
      Alert.alert('Export failed', String(err?.message || 'Unable to export inbox JSON.'));
      void captureException(err, { feature: 'control_diagnostics', op: 'export_finalize_inbox' });
    } finally {
      setExportingInbox(false);
    }
  };

  const requestRouteAgain = async (row: any) => {
    const sessionId = String(row?.sessionId || '').trim();
    const finalizeId = String(row?.finalizeId || '').trim();
    if (!sessionId || !finalizeId) {
      Alert.alert('Request failed', 'Missing sessionId/finalizeId for this row.');
      return;
    }
    const busyId = `${finalizeId}_route`;
    if (inboxActionBusyId) return;
    setInboxActionBusyId(busyId);
    try {
      const res = await requestWatchRoutePreview({ sessionId, finalizeId });
      if (!res.ok) {
        Alert.alert('Request failed', res.message || 'Unable to request route preview from watch.');
        return;
      }
      Alert.alert('Requested', 'Requested route preview resend from Apple Watch.');
    } catch (err: any) {
      Alert.alert('Request failed', String(err?.message || 'Unable to request route preview.'));
      void captureException(err, { feature: 'control_diagnostics', op: 'request_route_preview' });
    } finally {
      setInboxActionBusyId(null);
    }
  };

  const resendFinalize = async (row: any) => {
    const sessionId = String(row?.sessionId || '').trim();
    const finalizeId = String(row?.finalizeId || '').trim();
    if (!sessionId || !finalizeId) {
      Alert.alert('Resend failed', 'Missing sessionId/finalizeId for this row.');
      return;
    }
    const busyId = `${finalizeId}_finalize`;
    if (inboxActionBusyId) return;
    setInboxActionBusyId(busyId);
    try {
      const res = await requestWatchFinalizeResend({ sessionId, finalizeId });
      if (!res.ok) {
        Alert.alert('Resend failed', res.message || 'Unable to request finalize resend from watch.');
        return;
      }
      Alert.alert('Requested', 'Requested FINALIZE resend from Apple Watch.');
    } catch (err: any) {
      Alert.alert('Resend failed', String(err?.message || 'Unable to request finalize resend.'));
      void captureException(err, { feature: 'control_diagnostics', op: 'request_finalize_resend' });
    } finally {
      setInboxActionBusyId(null);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.back}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Control Diagnostics</Text>
          <View style={{ width: 40 }} />
        </View>

        {!watchControlsEnabled ? (
          <GlassCard>
            <Text style={styles.section}>Unavailable</Text>
            <Text style={styles.item}>Apple Watch controls are not enabled for this version.</Text>
          </GlassCard>
        ) : null}
        {loadError ? (
          <GlassCard>
            <Text style={styles.errorTitle}>Diagnostics load failed</Text>
            <Text style={styles.errorText}>{loadError}</Text>
            <Pressable style={styles.button} onPress={() => void load()} disabled={refreshing}>
              <Text style={styles.buttonText}>{refreshing ? 'Refreshing…' : 'Retry'}</Text>
            </Pressable>
          </GlassCard>
        ) : null}

        <GlassCard>
          <Text style={styles.section}>Cloud Sync</Text>
          <Text style={styles.item}>Enabled: {state.cloud?.enabled ? 'yes' : 'no'}</Text>
          <Text style={styles.item}>Queued writes: {state.cloud?.queueSize ?? 0}</Text>
          <Text style={styles.item}>Last flush: {formatAge(state.cloud?.lastFlushAt || undefined)}</Text>
          <Text style={styles.item}>Last result: {state.cloud?.lastResult?.reason || '—'}</Text>
          <Pressable style={styles.button} onPress={() => void forceCloudSync()} disabled={syncingCloud}>
            <Text style={styles.buttonText}>{syncingCloud ? 'Syncing…' : 'Force Cloud Sync'}</Text>
          </Pressable>
          <Pressable style={[styles.button, styles.danger]} onPress={() => void clearCloudQueue()}>
            <Text style={styles.buttonText}>Clear Cloud Queue</Text>
          </Pressable>
        </GlassCard>

        {watchControlsEnabled ? (
          <>
            <View style={{ height: 10 }} />
            <GlassCard>
              <Text style={styles.section}>Run Control</Text>
              <Text style={styles.item}>State: {state.runSnapshot?.state || 'none'}</Text>
              <Text style={styles.item}>Session: {state.runSnapshot?.sessionId || '—'}</Text>
              <Text style={styles.item}>Seq: {state.runSnapshot?.seq ?? 0}</Text>
              <Text style={styles.item}>Last update: {formatAge(state.runSnapshot?.lastUpdatedAtWatch)}</Text>
              <Text style={styles.item}>Queued commands: {state.runQueueSize}</Text>
              <Text style={styles.item}>Queue ACKs present: {state.runPendingAck}</Text>
            </GlassCard>

            <View style={{ height: 10 }} />
            <GlassCard>
              <Text style={styles.section}>Lift Control</Text>
              <Text style={styles.item}>State: {state.liftSnapshot?.state || 'none'}</Text>
              <Text style={styles.item}>Session: {state.liftSnapshot?.sessionId || '—'}</Text>
              <Text style={styles.item}>Seq: {state.liftSnapshot?.seq ?? 0}</Text>
              <Text style={styles.item}>Last update: {formatAge(state.liftSnapshot?.lastUpdatedAtWatch)}</Text>
              <Text style={styles.item}>Queued commands: {state.liftQueueSize}</Text>
              <Text style={styles.item}>Queue ACKs present: {state.liftPendingAck}</Text>
            </GlassCard>

            <View style={{ height: 10 }} />
	            <GlassCard>
	              <Text style={styles.section}>Watch Finalize Inbox</Text>
	              {state.finalizeInboxError ? (
	                <Text style={styles.item}>Inbox unavailable: {state.finalizeInboxError}</Text>
              ) : (
                <>
                  <Text style={styles.item}>Items: {state.finalizeInboxRows.length}</Text>
                  <Text style={styles.item}>
                    Needs route preview: {state.finalizeInboxRows.filter((r) => r?.needsRoutePreview === true).length}
                  </Text>
                  <Text style={styles.item}>
                    Oldest: {state.finalizeInboxRows.length ? formatAge(state.finalizeInboxRows[state.finalizeInboxRows.length - 1]?.storedAt) : '—'}
                  </Text>
	                  <Text style={styles.item}>
	                    Newest: {state.finalizeInboxRows.length ? formatAge(state.finalizeInboxRows[0]?.storedAt) : '—'}
	                  </Text>
	                  {state.finalizeInboxRows.slice(0, 10).map((row, idx) => {
	                    const key = `${String(row?.finalizeId || row?.sessionId || idx)}`;
	                    const busy = inboxActionBusyId?.startsWith(String(row?.finalizeId || '')) === true;
	                    return (
	                      <View key={key} style={styles.inboxRowCard}>
	                        <Text style={styles.item}>
	                          {String(row?.kind || 'run')} · {row?.needsRoutePreview ? 'route missing' : 'ok'} · {String(row?.sessionId || '—')}
	                        </Text>
	                        <Text style={styles.item}>
	                          finalizeId: {String(row?.finalizeId || '—')} · stored {formatAge(row?.storedAt)}
	                        </Text>
	                        <Text style={styles.item}>
	                          route: {String(row?.routeStatus || '—')} · points {Number(row?.routePointCount || 0)}
	                        </Text>
	                        <View style={styles.inboxRowButtons}>
	                          {row?.needsRoutePreview ? (
	                            <Pressable
	                              style={[styles.smallButton, busy && styles.smallButtonDisabled]}
	                              disabled={busy}
	                              onPress={() => void requestRouteAgain(row)}
	                            >
	                              <Text style={styles.buttonText}>Request Route</Text>
	                            </Pressable>
	                          ) : null}
	                          <Pressable
	                            style={[styles.smallButton, busy && styles.smallButtonDisabled]}
	                            disabled={busy}
	                            onPress={() => void resendFinalize(row)}
	                          >
	                            <Text style={styles.buttonText}>Resend FINALIZE</Text>
	                          </Pressable>
	                        </View>
	                      </View>
	                    );
	                  })}
	                </>
	              )}
	              <Pressable style={styles.button} onPress={() => void reemitInbox()} disabled={reemitFinalizes}>
	                <Text style={styles.buttonText}>{reemitFinalizes ? 'Re-emitting…' : 'Re-emit Inbox Finalizes'}</Text>
	              </Pressable>
	              <Pressable style={styles.button} onPress={() => void exportFinalizeInbox()} disabled={exportingInbox}>
	                <Text style={styles.buttonText}>{exportingInbox ? 'Exporting…' : 'Export Inbox JSON'}</Text>
	              </Pressable>
	              <Text style={styles.item}>
	                This inbox is stored durably on the phone for explicit watch finalize ACKs. Items that need route preview indicate the phone is missing preview points.
	              </Text>
	            </GlassCard>

            <View style={{ height: 10 }} />
            <GlassCard>
              <Text style={styles.section}>Actions</Text>
              <Pressable style={styles.button} onPress={() => void load()} disabled={refreshing}>
                <Text style={styles.buttonText}>{refreshing ? 'Refreshing…' : 'Refresh Diagnostics'}</Text>
              </Pressable>
              <Pressable style={[styles.button, styles.danger]} onPress={() => void clearAll()} disabled={clearing}>
                <Text style={styles.buttonText}>{clearing ? 'Clearing…' : 'Clear Queues + Snapshots'}</Text>
              </Pressable>
            </GlassCard>
          </>
        ) : null}
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
  section: { color: '#FFF', fontWeight: '800', marginBottom: 8 },
  errorTitle: { color: '#FFD7D7', fontWeight: '900', marginBottom: 6 },
  errorText: { color: '#FFB7B7', fontWeight: '700', marginBottom: 6 },
  item: { color: '#D0D0D0', fontWeight: '600', marginBottom: 6 },
  button: {
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2F2F2F',
    backgroundColor: '#161616',
    paddingVertical: 10,
    alignItems: 'center',
  },
  danger: {
    borderColor: '#5A2A2A',
    backgroundColor: '#2A1212',
  },
  inboxRowCard: {
    marginTop: 10,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#262626',
    backgroundColor: '#101010',
  },
  inboxRowButtons: { flexDirection: 'row', gap: 8, marginTop: 6 },
  smallButton: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2F2F2F',
    backgroundColor: '#161616',
    paddingVertical: 8,
    alignItems: 'center',
  },
  smallButtonDisabled: { opacity: 0.55 },
  buttonText: { color: '#D3EDF6', fontWeight: '800' },
});
