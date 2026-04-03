import { useFocusEffect } from '@react-navigation/native'; import { Redirect, router } from 'expo-router'; import React, { useCallback, useState } from 'react'; import { Alert, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../components/ui/GlassCard';
import SectionHeader from '../../components/ui/SectionHeader';
import { APP_CONFIG } from '../../utils/appConfig';
import {
  createClub,
  joinClubByInviteToken,
  listDiscoverableClubs,
  listMyClubs,
  requestToJoinClub,
  type ClubRecord,
  type ClubVisibilityMode,
} from '../../utils/clubsService';
import { useAuth } from '../context/authcontext';

type ClubRow = Awaited<ReturnType<typeof listMyClubs>>[number];

export default function ClubsScreen() {
  const { supabaseUserId } = useAuth();
  const socialEnabled = APP_CONFIG.FEATURES.SOCIAL_FEATURES_ENABLED || APP_CONFIG.RUNTIME.OVERRIDES.SOCIAL_FEATURES_ENABLED;
  const [rows, setRows] = useState<ClubRow[]>([]);
  const [discoverable, setDiscoverable] = useState<ClubRecord[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<ClubVisibilityMode>('private_invite_only');
  const [inviteToken, setInviteToken] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!supabaseUserId) {
      setRows([]);
      setDiscoverable([]);
      return;
    }
    const [next, clubs] = await Promise.all([listMyClubs(supabaseUserId), listDiscoverableClubs(supabaseUserId)]);
    setRows(next);
    setDiscoverable(clubs);
  }, [supabaseUserId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const create = async () => {
    if (!supabaseUserId) {
      Alert.alert('Sign in required', 'Sign in to create clubs.');
      return;
    }
    if (!name.trim()) {
      Alert.alert('Name required', 'Give your club a name first.');
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      const club = await createClub({
        creatorUserId: supabaseUserId,
        name: name.trim(),
        description: description.trim(),
        visibilityMode: visibility,
      });
      setName('');
      setDescription('');
      await load();
      router.push(`/clubs/${club.clubId}` as any);
    } catch (error: any) {
      Alert.alert('Create failed', String(error?.message || 'Cloud sync is required to create clubs.'));
    } finally {
      setSaving(false);
    }
  };

  const joinByToken = async () => {
    if (!supabaseUserId) {
      Alert.alert('Sign in required', 'Sign in to join clubs.');
      return;
    }
    const result = await joinClubByInviteToken({ userId: supabaseUserId, inviteToken });
    if (!result.ok) {
      Alert.alert('Join failed', result.reason);
      return;
    }
    setInviteToken('');
    await load();
    if (result.clubId) router.push(`/clubs/${result.clubId}` as any);
  };

  const requestJoin = async (clubId: string) => {
    if (!supabaseUserId) {
      Alert.alert('Sign in required', 'Sign in to request club access.');
      return;
    }
    const result = await requestToJoinClub({ userId: supabaseUserId, clubId });
    if (!result.ok) {
      Alert.alert('Join request', result.reason);
      return;
    }
    Alert.alert('Join request', result.reason);
    await load();
  };

  if (!socialEnabled) {
    return <Redirect href='/(tabs)/profile' />;
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScrollBeginDrag={Keyboard.dismiss}
      >
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.back}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Clubs</Text>
          <View style={{ width: 40 }} />
        </View>

        <SectionHeader title='CREATE CLUB' />
        <GlassCard>
          {!supabaseUserId ? <Text style={styles.empty}>Sign in to create or join clubs.</Text> : null}
          <Text style={styles.label}>Name</Text>
          <TextInput value={name} onChangeText={setName} style={styles.input} placeholder='Morning Accountability' placeholderTextColor='#777' />
          <Text style={styles.label}>Description</Text>
          <TextInput value={description} onChangeText={setDescription} style={[styles.input, styles.notes]} placeholder='Small group that trains daily.' placeholderTextColor='#777' multiline />
          <Text style={styles.label}>Visibility</Text>
          <View style={styles.row}>
            {(['private_invite_only', 'request_to_join', 'public_discoverable'] as const).map((mode) => (
              <Pressable key={mode} style={[styles.chip, visibility === mode && styles.chipActive]} onPress={() => setVisibility(mode)}>
                <Text style={[styles.chipText, visibility === mode && styles.chipTextActive]}>{mode.replace(/_/g, ' ')}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable style={[styles.createBtn, saving && styles.disabled]} onPress={() => void create()} disabled={saving}>
            <Text style={styles.createText}>{saving ? 'Creating...' : 'Create Club'}</Text>
          </Pressable>
        </GlassCard>

        <SectionHeader title='MY CLUBS' />
        <GlassCard>
          {rows.length ? (
            rows.map((row) => (
              <Pressable key={row.club.clubId} style={styles.clubRow} onPress={() => router.push(`/clubs/${row.club.clubId}` as any)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.clubName}>{row.club.name}</Text>
                  <Text style={styles.clubMeta}>{row.membership.role} • {row.club.visibilityMode.replace(/_/g, ' ')}</Text>
                </View>
                <Text style={styles.openText}>Open</Text>
              </Pressable>
            ))
          ) : (
            <Text style={styles.empty}>No clubs yet.</Text>
          )}
        </GlassCard>

        <SectionHeader title='JOIN VIA INVITE LINK' />
        <GlassCard>
          <Text style={styles.label}>Invite token</Text>
          <TextInput
            value={inviteToken}
            onChangeText={setInviteToken}
            style={styles.input}
            placeholder='Paste token'
            placeholderTextColor='#777'
            autoCapitalize='none'
          />
          <Pressable style={styles.createBtn} onPress={() => void joinByToken()}>
            <Text style={styles.createText}>Join Club</Text>
          </Pressable>
        </GlassCard>

        <SectionHeader title='DISCOVER CLUBS' />
        <GlassCard>
          {discoverable.length ? (
            discoverable.map((club) => (
              <View key={club.clubId} style={styles.clubRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.clubName}>{club.name}</Text>
                  <Text style={styles.clubMeta}>{club.visibilityMode.replace(/_/g, ' ')}</Text>
                </View>
                <Pressable style={styles.joinBtn} onPress={() => void requestJoin(club.clubId)}>
                  <Text style={styles.joinText}>{club.visibilityMode === 'public_discoverable' ? 'Join' : 'Request'}</Text>
                </Pressable>
              </View>
            ))
          ) : (
            <Text style={styles.empty}>No clubs to discover right now.</Text>
          )}
        </GlassCard>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  content: { padding: 16, paddingBottom: 30 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { color: '#7EDCFF', fontWeight: '700' },
  title: { color: '#FFF', fontWeight: '900', fontSize: 22 },
  label: { color: '#B4CBD1', marginTop: 8, marginBottom: 6, fontWeight: '700', fontSize: 12 },
  input: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#333',
    backgroundColor: '#121212',
    color: '#F3F3F3',
    paddingHorizontal: 12,
    fontWeight: '600',
  },
  notes: { minHeight: 76, paddingTop: 10, textAlignVertical: 'top' as const },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: '#3B3B3B',
    borderRadius: 999,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    backgroundColor: '#181818',
  },
  chipActive: { borderColor: '#00D9FF', backgroundColor: 'rgba(0,217,255,0.12)' },
  chipText: { color: '#C7C7C7', fontWeight: '700', fontSize: 12 },
  chipTextActive: { color: '#EAFBFF' },
  createBtn: {
    marginTop: 12,
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: '#00D9FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  createText: { color: '#01222B', fontWeight: '900' },
  disabled: { opacity: 0.6 },
  clubRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  clubName: { color: '#FFF', fontWeight: '800' },
  clubMeta: { color: '#9BB1B9', marginTop: 2, fontSize: 12 },
  openText: { color: '#98E5FF', fontWeight: '700' },
  joinBtn: {
    minHeight: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#00D9FF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  joinText: { color: '#A5ECFF', fontWeight: '800', fontSize: 12 },
  empty: { color: '#9BB1B9', fontWeight: '600' },
});
