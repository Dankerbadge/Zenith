import * as Linking from 'expo-linking';
import { Redirect, router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Keyboard, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../components/ui/GlassCard';
import SectionHeader from '../../components/ui/SectionHeader';
import { APP_CONFIG } from '../../utils/appConfig';
import { useAuth } from '../context/authcontext';
import {
  connectViaInviteToken,
  getFriendInviteLinkData,
  resolveFriendInviteToken,
  rotateFriendInviteLink,
  setFriendInviteEnabled,
} from '../../utils/friendsService';

function extractToken(value: string) {
  const raw = value.trim();
  if (!raw) return '';
  if (!raw.includes('://') && !raw.includes('token=')) return raw;
  try {
    const parsed = Linking.parse(raw);
    const token = parsed.queryParams?.token;
    return typeof token === 'string' ? token : '';
  } catch {
    const match = raw.match(/[?&]token=([^&]+)/i);
    return match?.[1] || '';
  }
}

export default function FriendInviteScreen() {
  const socialEnabled = APP_CONFIG.FEATURES.SOCIAL_FEATURES_ENABLED || APP_CONFIG.RUNTIME.OVERRIDES.SOCIAL_FEATURES_ENABLED;
  const { supabaseUserId } = useAuth();
  const viewerUserId = supabaseUserId || null;

  const [token, setToken] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [pasteValue, setPasteValue] = useState('');

  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'none' | 'rotate' | 'toggle' | 'connect' | 'share'>('none');

  const load = useCallback(async () => {
    if (!viewerUserId) return;
    setLoading(true);
    try {
      const res = await getFriendInviteLinkData(viewerUserId);
      setToken(res.token);
      setEnabled(res.enabled);
      setExpiresAt(res.expiresAtUtc);
      setLoadError(null);
    } catch (err: any) {
      setToken(null);
      setEnabled(true);
      setExpiresAt(null);
      setLoadError(String(err?.message || 'Failed to load invite link settings.'));
    } finally {
      setLoading(false);
    }
  }, [viewerUserId]);

  useEffect(() => {
    void load();
  }, [load]);

  const link = useMemo(() => (token ? `zenith://friends/invite?token=${token}` : ''), [token]);
  const canShareLink = Boolean(link);

  const copyLink = async () => {
    if (!link) {
      Alert.alert('Invite unavailable', 'No invite link is available yet. Retry loading and try again.');
      return;
    }
    setBusyAction('share');
    setActionError(null);
    try {
      await Share.share({ message: link });
    } catch (err: any) {
      setActionError(String(err?.message || 'Could not share invite link.'));
    } finally {
      setBusyAction('none');
    }
  };

  const shareLink = async () => {
    if (!link) {
      Alert.alert('Invite unavailable', 'No invite link is available yet. Retry loading and try again.');
      return;
    }
    setBusyAction('share');
    setActionError(null);
    try {
      await Share.share({ message: `Add me on Zenith: ${link}` });
    } catch (err: any) {
      setActionError(String(err?.message || 'Could not share invite link.'));
    } finally {
      setBusyAction('none');
    }
  };

  const rotate = async () => {
    if (!viewerUserId || busyAction !== 'none') return;
    setBusyAction('rotate');
    setActionError(null);
    try {
      await rotateFriendInviteLink(viewerUserId);
      await load();
      Alert.alert('Updated', 'Invite link rotated. Old links are now invalid.');
    } catch (err: any) {
      setActionError(String(err?.message || 'Failed to rotate invite link.'));
      Alert.alert('Rotate failed', 'Could not rotate invite link. Please try again.');
    } finally {
      setBusyAction('none');
    }
  };

  const toggle = async () => {
    if (!viewerUserId || busyAction !== 'none') return;
    setBusyAction('toggle');
    setActionError(null);
    const nextEnabled = !enabled;
    try {
      await setFriendInviteEnabled(viewerUserId, nextEnabled);
      setEnabled(nextEnabled);
      await load();
    } catch (err: any) {
      setActionError(String(err?.message || 'Failed to update invite setting.'));
      Alert.alert('Update failed', 'Could not update invite status. Please retry.');
      await load();
    } finally {
      setBusyAction('none');
    }
  };

  const connect = async () => {
    const parsedToken = extractToken(pasteValue);
    if (!parsedToken) {
      Alert.alert('Missing token', 'Paste a valid invite link or token.');
      return;
    }
    if (!viewerUserId || busyAction !== 'none') return;

    setBusyAction('connect');
    setActionError(null);
    try {
      const preview = await resolveFriendInviteToken({ viewerUserId, token: parsedToken });
      if (!preview.ok || !preview.inviter) {
        const reason = preview.reason || 'Invite unavailable.';
        setActionError(reason);
        Alert.alert('Invite unavailable', reason);
        return;
      }
      setBusyAction('none');

      Alert.alert('Connect', `Send a friend request to ${preview.inviter.displayName}?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send request',
          onPress: () =>
            void (async () => {
              setBusyAction('connect');
              try {
                const res = await connectViaInviteToken({ viewerUserId, token: parsedToken });
                if (!res.ok) {
                  const reason = res.reason || 'Could not connect via invite.';
                  setActionError(reason);
                  Alert.alert('Could not connect', reason);
                  return;
                }
                setPasteValue('');
                Alert.alert('Request sent', 'Invite link connection request sent.');
              } catch (err: any) {
                setActionError(String(err?.message || 'Could not connect via invite.'));
                Alert.alert('Connection failed', 'Invite request failed. Please retry.');
              } finally {
                setBusyAction('none');
              }
            })(),
        },
      ]);
      return;
    } catch (err: any) {
      setActionError(String(err?.message || 'Could not validate invite token.'));
      Alert.alert('Connect failed', 'Could not validate invite link. Please retry.');
    } finally {
      setBusyAction('none');
    }
  };

  if (!socialEnabled) {
    return <Redirect href='/(tabs)/profile' />;
  }

  if (!viewerUserId) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.meta}>Sign in to use invites.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps='handled'
        keyboardDismissMode='on-drag'
        onScrollBeginDrag={Keyboard.dismiss}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.back}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Friend Invite Link</Text>
          <View style={{ width: 44 }} />
        </View>

        {loadError ? (
          <GlassCard>
            <Text style={styles.meta}>Failed to load invite settings.</Text>
            <Text style={styles.errorText}>{loadError}</Text>
            <Pressable style={styles.retryBtn} onPress={() => void load()} disabled={loading}>
              <Text style={styles.retryText}>{loading ? 'Retrying…' : 'Retry'}</Text>
            </Pressable>
          </GlassCard>
        ) : null}

        {actionError ? (
          <GlassCard>
            <Text style={styles.errorText}>{actionError}</Text>
            <Text style={styles.meta}>If this keeps happening, retry after checking your connection.</Text>
          </GlassCard>
        ) : null}

        <SectionHeader title='YOUR LINK' />
        <GlassCard>
          <Text style={styles.meta}>Status: {enabled ? 'Enabled' : 'Disabled'}</Text>
          <Text style={styles.meta}>Expires: {expiresAt || 'n/a'}</Text>
          <Text selectable style={styles.linkText}>{link || (loading ? 'Loading invite link…' : 'No invite token available.')}</Text>
          <View style={styles.actionsRow}>
            <Pressable style={[styles.primaryBtn, (!canShareLink || busyAction !== 'none') && styles.primaryBtnDisabled]} disabled={!canShareLink || busyAction !== 'none'} onPress={() => void copyLink()}>
              <Text style={[styles.primaryText, (!canShareLink || busyAction !== 'none') && styles.primaryTextDisabled]}>{busyAction === 'share' ? 'Working…' : 'Copy'}</Text>
            </Pressable>
            <Pressable style={[styles.primaryBtn, (!canShareLink || busyAction !== 'none') && styles.primaryBtnDisabled]} disabled={!canShareLink || busyAction !== 'none'} onPress={() => void shareLink()}>
              <Text style={[styles.primaryText, (!canShareLink || busyAction !== 'none') && styles.primaryTextDisabled]}>{busyAction === 'share' ? 'Working…' : 'Share'}</Text>
            </Pressable>
          </View>
          <View style={styles.actionsRow}>
            <Pressable style={[styles.ghostBtn, busyAction !== 'none' && styles.ghostBtnDisabled]} onPress={() => void rotate()} disabled={busyAction !== 'none'}>
              <Text style={[styles.ghostText, busyAction !== 'none' && styles.ghostTextDisabled]}>{busyAction === 'rotate' ? 'Rotating…' : 'Rotate Token'}</Text>
            </Pressable>
            <Pressable style={[styles.ghostBtn, busyAction !== 'none' && styles.ghostBtnDisabled]} onPress={() => void toggle()} disabled={busyAction !== 'none'}>
              <Text style={[styles.ghostText, busyAction !== 'none' && styles.ghostTextDisabled]}>{busyAction === 'toggle' ? 'Updating…' : enabled ? 'Disable Link' : 'Enable Link'}</Text>
            </Pressable>
          </View>
        </GlassCard>

        <SectionHeader title='CONNECT FROM A LINK' />
        <GlassCard>
          <TextInput
            value={pasteValue}
            onChangeText={setPasteValue}
            placeholder='Paste token or full invite link'
            placeholderTextColor='#7E8E93'
            autoCapitalize='none'
            autoCorrect={false}
            style={styles.input}
          />
          <Pressable style={[styles.primaryWideBtn, (!pasteValue.trim() || busyAction !== 'none') && styles.primaryBtnDisabled]} onPress={() => void connect()} disabled={!pasteValue.trim() || busyAction !== 'none'}>
            <Text style={[styles.primaryText, (!pasteValue.trim() || busyAction !== 'none') && styles.primaryTextDisabled]}>{busyAction === 'connect' ? 'Checking…' : 'Send Friend Request'}</Text>
          </Pressable>
        </GlassCard>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  content: { padding: 16, paddingBottom: 24 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { minHeight: 44, minWidth: 60, justifyContent: 'center' },
  back: { color: '#7EDCFF', fontWeight: '700' },
  title: { color: '#FFFFFF', fontWeight: '900', fontSize: 20 },
  meta: { color: '#9AB3BB', fontWeight: '700', marginBottom: 6 },
  errorText: { color: '#FFB7C2', fontWeight: '700', marginBottom: 6 },
  linkText: { color: '#D7F1FB', fontWeight: '700', fontSize: 12 },
  actionsRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  primaryBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    backgroundColor: '#00D9FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnDisabled: { backgroundColor: '#1D2B2F' },
  primaryWideBtn: {
    marginTop: 10,
    minHeight: 42,
    borderRadius: 10,
    backgroundColor: '#00D9FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: '#01212A', fontWeight: '900' },
  primaryTextDisabled: { color: '#88A0A8' },
  ghostBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#3A3A3A',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#131313',
  },
  ghostBtnDisabled: { backgroundColor: '#161D20', borderColor: '#263237' },
  ghostText: { color: '#D4D4D4', fontWeight: '700' },
  ghostTextDisabled: { color: '#7F939A' },
  input: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#333',
    backgroundColor: '#131313',
    color: '#E8E8E8',
    paddingHorizontal: 12,
    fontWeight: '600',
  },
  retryBtn: {
    marginTop: 10,
    minHeight: 40,
    minWidth: 100,
    borderRadius: 10,
    alignSelf: 'flex-start',
    backgroundColor: '#00D9FF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  retryText: { color: '#01212A', fontWeight: '900' },
});
