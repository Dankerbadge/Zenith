import { useFocusEffect } from '@react-navigation/native'; import { router } from 'expo-router'; import React, { useCallback, useState } from 'react'; import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Chip from '../../components/ui/Chip';
import GlassCard from '../../components/ui/GlassCard';
import SectionHeader from '../../components/ui/SectionHeader';
import {
  getCommunityView,
  setFriendPrivacy,
  setSocialSettings,
  type CommunityView,
  type FriendRequestPolicy,
  type SocialSettings,
} from '../../utils/friendsService';
import type { Visibility } from '../../utils/canonicalRunningSchema';
import { useAuth } from '../context/authcontext';

export default function SocialPrivacyScreen() {
  const { supabaseUserId } = useAuth();
  const [view, setView] = useState<CommunityView | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    if (!supabaseUserId) {
      setView(null);
      setLoadError(false);
      return;
    }
    try {
      const next = await getCommunityView(supabaseUserId);
      setView(next);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [supabaseUserId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const updatePrivacy = async (patch: { profileVisibility?: Visibility; activityVisibility?: Visibility; allowFriendRequests?: FriendRequestPolicy }) => {
    if (!supabaseUserId) {
      Alert.alert('Sign in required', 'Sign in to update social privacy.');
      return;
    }
    try {
      await setFriendPrivacy(supabaseUserId, patch);
      await load();
    } catch {
      Alert.alert('Update failed', 'Could not update privacy settings. Please try again.');
    }
  };

  const updateSocial = async (
    patch: Partial<Omit<SocialSettings, 'userId' | 'createdAtUtc' | 'updatedAtUtc' | 'schemaVersion'>>
  ) => {
    if (!supabaseUserId) {
      Alert.alert('Sign in required', 'Sign in to update social settings.');
      return;
    }
    try {
      await setSocialSettings(supabaseUserId, patch);
      await load();
    } catch {
      Alert.alert('Update failed', 'Could not update social settings. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}><Text style={styles.back}>Back</Text></Pressable>
          <Text style={styles.title}>Social Privacy</Text>
          <View style={{ width: 40 }} />
        </View>

        {!supabaseUserId ? (
          <Text style={styles.empty}>Sign in to manage social privacy.</Text>
        ) : !view ? (
          loadError ? (
            <View style={{ padding: 16, alignItems: 'center' }}>
              <Text style={styles.empty}>Couldn’t load privacy settings.</Text>
              <Pressable style={styles.retryBtn} onPress={() => void load()}>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : (
            <Text style={styles.empty}>Loading...</Text>
          )
        ) : (
          <>
            <SectionHeader title='PROFILE VISIBILITY' />
            <GlassCard>
              <View style={styles.chipRow}>
                {(['private', 'friends', 'public'] as const).map((value) => (
                  <Chip
                    key={value}
                    label={value}
                    active={view.me.privacy.profileVisibility === value}
                    onPress={() => void updatePrivacy({ profileVisibility: value })}
                  />
                ))}
              </View>
            </GlassCard>

            <SectionHeader title='ACTIVITY VISIBILITY' />
            <GlassCard>
              <View style={styles.chipRow}>
                {(['private', 'friends', 'public'] as const).map((value) => (
                  <Chip
                    key={value}
                    label={value}
                    active={view.me.privacy.activityVisibility === value}
                    onPress={() => void updatePrivacy({ activityVisibility: value })}
                  />
                ))}
              </View>
            </GlassCard>

            <SectionHeader title='FRIEND REQUESTS' />
            <GlassCard>
              <View style={styles.chipRow}>
                {(['everyone', 'friends_of_friends', 'nobody'] as const).map((value) => (
                  <Chip
                    key={value}
                    label={value.replace(/_/g, ' ')}
                    active={view.me.privacy.allowFriendRequests === value}
                    onPress={() => void updatePrivacy({ allowFriendRequests: value })}
                  />
                ))}
              </View>
            </GlassCard>

            <SectionHeader title='DISCOVERY' />
            <GlassCard>
              <Text style={styles.label}>Discoverable by username</Text>
              <View style={styles.chipRow}>
                <Chip label='On' active={view.settings.discoverableByUsername} onPress={() => void updateSocial({ discoverableByUsername: true })} />
                <Chip label='Off' active={!view.settings.discoverableByUsername} onPress={() => void updateSocial({ discoverableByUsername: false })} />
              </View>
            </GlassCard>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  content: { padding: 16, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { color: '#7EDCFF', fontWeight: '700' },
  title: { color: '#FFF', fontWeight: '900', fontSize: 20 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  label: { color: '#B3C8CF', fontWeight: '800', marginBottom: 8 },
  empty: { color: '#95AFB8', fontWeight: '600' },
  retryBtn: {
    marginTop: 10,
    minHeight: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0,217,255,0.30)',
    backgroundColor: 'rgba(0,217,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  retryText: { color: '#BFF3FF', fontWeight: '900' },
});
