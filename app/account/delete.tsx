import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { router } from 'expo-router';
import { APP_CONFIG } from '../../utils/appConfig';
import { deleteAccount } from '../../utils/accountDeletion';
import { useAuth } from '../context/authcontext';

type DeleteStage = 'idle' | 'checking' | 'deleting_server' | 'wiping_local' | 'finalizing' | 'done';

function isConfirmed(value: string) {
  return value.trim().toUpperCase() === 'DELETE';
}

async function checkInternetReachable(timeoutMs = 3500): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(APP_CONFIG.TERMS_URL, {
      method: 'HEAD',
      signal: controller.signal,
      cache: 'no-store',
    } as any);
    return Boolean(res && res.ok);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export default function DeleteAccountScreen() {
  const { user, hasSupabaseSession, hardResetToLoggedOut } = useAuth();
  const [typed, setTyped] = useState('');
  const [stage, setStage] = useState<DeleteStage>('checking');
  const [isOnline, setIsOnline] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successDetail, setSuccessDetail] = useState<string | null>(null);

  const confirmed = useMemo(() => isConfirmed(typed), [typed]);
  const isConnectedAccount = Boolean(hasSupabaseSession);
  const canDeleteServerNow = isConnectedAccount && isOnline;

  const refreshOnline = useCallback(async () => {
    setStage('checking');
    const ok = await checkInternetReachable();
    setIsOnline(ok);
    setStage('idle');
  }, []);

  useEffect(() => {
    void refreshOnline();
  }, [refreshOnline]);

  const runLocalWipe = useCallback(
    async (detail: string) => {
      setError(null);
      setStage('wiping_local');
      try {
        await deleteAccount({ kind: 'local_only' }, { emailForSecureWipe: user?.email || null });
      } catch {
        // Local wipe must not block completion; if it fails, we still hard-reset auth state.
      }
      setStage('finalizing');
      await hardResetToLoggedOut();
      setSuccessDetail(detail);
      setStage('done');
    },
    [hardResetToLoggedOut, user?.email]
  );

  const runConnectedFullDelete = useCallback(async () => {
    if (!confirmed) return;
    if (!canDeleteServerNow) return;
    setError(null);
    setStage('deleting_server');
    try {
      await deleteAccount({ kind: 'connected_full' }, { emailForSecureWipe: user?.email || null });
      setStage('finalizing');
      await hardResetToLoggedOut();
      setSuccessDetail('Your Zenith account and local data have been permanently removed.');
      setStage('done');
    } catch {
      setStage('idle');
      setError('We could not delete your server account right now. Check your connection and try again.');
    }
  }, [canDeleteServerNow, confirmed, hardResetToLoggedOut, user?.email]);

  const title = stage === 'done' ? 'Account deleted' : 'Delete account';

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.container}>
        <Text style={styles.title}>{title}</Text>

        {stage !== 'done' ? (
          <>
            <Text style={styles.body}>
              This permanently deletes your Zenith account and removes your data from this device. This cannot be undone.
            </Text>
            <Text style={styles.body}>
              If your account is connected, we also delete your server account and associated data.
            </Text>

            {isConnectedAccount ? (
              !isOnline ? (
                <Text style={styles.notice}>
                  You are currently offline. You can remove local data now, but deleting the server account requires an internet connection.
                </Text>
              ) : (
                <Text style={styles.notice}>Your server account will be deleted immediately.</Text>
              )
            ) : (
              <Text style={styles.notice}>This deletes all data stored on this device.</Text>
            )}

            <View style={styles.field}>
              <TextInput
                value={typed}
                onChangeText={setTyped}
                placeholder='Type DELETE to confirm'
                placeholderTextColor='#6F6F6F'
                autoCapitalize='characters'
                autoCorrect={false}
                style={styles.input}
                editable={stage === 'idle'}
              />
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            {stage !== 'idle' ? (
              <View style={styles.progressRow}>
                <ActivityIndicator />
                <Text style={styles.progressText}>
                  {stage === 'checking'
                    ? 'Checking connection...'
                    : stage === 'deleting_server'
                    ? 'Deleting server account...'
                    : stage === 'wiping_local'
                    ? 'Removing local data...'
                    : stage === 'finalizing'
                    ? 'Finalizing...'
                    : ''}
                </Text>
              </View>
            ) : null}

            <View style={styles.actions}>
              {!isConnectedAccount ? (
                <>
                  <Pressable
                    style={[styles.dangerButton, !confirmed && styles.disabled]}
                    disabled={!confirmed || stage !== 'idle'}
                    onPress={() =>
                      Alert.alert('Delete permanently?', 'This cannot be undone.', [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Delete permanently',
                          style: 'destructive',
                          onPress: () => void runLocalWipe('Your Zenith account and local data have been permanently removed.'),
                        },
                      ])
                    }
                  >
                    <Text style={styles.dangerText}>Delete permanently</Text>
                  </Pressable>
                  <Pressable style={styles.secondaryButton} disabled={stage !== 'idle'} onPress={() => router.back()}>
                    <Text style={styles.secondaryText}>Cancel</Text>
                  </Pressable>
                </>
              ) : isOnline ? (
                <>
                  <Pressable
                    style={[styles.dangerButton, (!confirmed || !canDeleteServerNow) && styles.disabled]}
                    disabled={!confirmed || !canDeleteServerNow || stage !== 'idle'}
                    onPress={() =>
                      Alert.alert('Delete account permanently?', 'This cannot be undone.', [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Delete permanently',
                          style: 'destructive',
                          onPress: () => void runConnectedFullDelete(),
                        },
                      ])
                    }
                  >
                    <Text style={styles.dangerText}>Delete account permanently</Text>
                  </Pressable>

                  {error ? (
                    <Pressable
                      style={[styles.dangerButton, !confirmed && styles.disabled]}
                      disabled={!confirmed || stage !== 'idle'}
                      onPress={() =>
                        Alert.alert('Delete local data only?', 'Your server account will still exist.', [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Delete local data only',
                            style: 'destructive',
                            onPress: () =>
                              void runLocalWipe(
                                'Local data removed. Your server account still exists. Reconnect and sign in to delete your account.'
                              ),
                          },
                        ])
                      }
                    >
                      <Text style={styles.dangerText}>Delete local data only</Text>
                    </Pressable>
                  ) : null}

                  <Pressable style={styles.secondaryButton} disabled={stage !== 'idle'} onPress={() => router.back()}>
                    <Text style={styles.secondaryText}>Cancel</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Pressable style={[styles.dangerButton, styles.disabled]} disabled>
                    <Text style={styles.dangerText}>Delete account permanently (requires internet)</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.dangerButton, !confirmed && styles.disabled]}
                    disabled={!confirmed || stage !== 'idle'}
                    onPress={() =>
                      Alert.alert('Delete local data only?', 'Your server account will still exist.', [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Delete local data only',
                          style: 'destructive',
                          onPress: () =>
                            void runLocalWipe(
                              'Local data removed. Your server account still exists. Reconnect and sign in to delete your account.'
                            ),
                        },
                      ])
                    }
                  >
                    <Text style={styles.dangerText}>Delete local data only</Text>
                  </Pressable>
                  <Pressable style={styles.secondaryButton} disabled={stage !== 'idle'} onPress={() => router.back()}>
                    <Text style={styles.secondaryText}>Cancel</Text>
                  </Pressable>
                </>
              )}

              <Pressable style={styles.linkButton} onPress={() => void refreshOnline()} disabled={stage !== 'idle'}>
                <Text style={styles.linkText}>Refresh connection</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.body}>{successDetail || 'Your Zenith account and local data have been permanently removed.'}</Text>
            <Pressable
              style={styles.primaryButton}
              onPress={() => {
                router.replace('/onboarding' as any);
              }}
            >
              <Text style={styles.primaryText}>Return to start</Text>
            </Pressable>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#070707' },
  container: { padding: 18, gap: 12 },
  title: { color: '#FFF', fontSize: 24, fontWeight: '900' },
  body: { color: '#B9B9B9', lineHeight: 20 },
  notice: { color: '#D8F4FF', lineHeight: 20 },
  field: { marginTop: 6 },
  input: {
    backgroundColor: '#151515',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#FFF',
    fontWeight: '800',
  },
  error: { color: '#FF6B6B', fontWeight: '800' },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  progressText: { color: '#BDBDBD', fontWeight: '700' },
  actions: { gap: 10, marginTop: 8 },
  disabled: { opacity: 0.5 },
  dangerButton: {
    backgroundColor: '#241011',
    borderWidth: 1,
    borderColor: '#FF6B6B55',
    borderRadius: 14,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  dangerText: { color: '#FFD2D2', fontWeight: '900' },
  secondaryButton: {
    backgroundColor: '#202020',
    borderRadius: 14,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { color: '#FFF', fontWeight: '800' },
  linkButton: { alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 6 },
  linkText: { color: '#7EDCFF', fontWeight: '800' },
  primaryButton: {
    backgroundColor: '#1E2B2F',
    borderRadius: 14,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  primaryText: { color: '#D8F4FF', fontWeight: '900' },
});
