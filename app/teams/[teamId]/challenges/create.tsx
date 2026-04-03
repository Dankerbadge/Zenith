import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../../../components/ui/GlassCard';
import { useAuth } from '../../../context/authcontext';
import { socialApi } from '../../../../utils/supabaseClient';

export default function TeamChallengeCreateWizard() {
  const params = useLocalSearchParams<{ teamId?: string }>();
  const teamId = String(params.teamId || '').trim();
  const { supabaseUserId } = useAuth();
  const viewerUserId = supabaseUserId || '';
  const [title, setTitle] = useState('Team Push');
  const [challengeType, setChallengeType] = useState<'workouts' | 'distance_mi' | 'xp'>('workouts');
  const [target, setTarget] = useState('5');
  const [days, setDays] = useState('7');
  const [saving, setSaving] = useState(false);

  const onCreate = async () => {
    if (!viewerUserId || !teamId) return;
    const targetNum = Math.max(1, Math.round(Number(target || 0)));
    const dayNum = Math.max(1, Math.min(90, Math.round(Number(days || 7))));
    const start = new Date();
    const end = new Date(Date.now() + dayNum * 24 * 60 * 60 * 1000);
    setSaving(true);
    try {
      const row = await socialApi.createTeamChallenge({
        teamId,
        creatorUserId: viewerUserId,
        title: title.trim() || 'Team challenge',
        challengeType,
        targetValue: targetNum,
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
        rules: {
          target: { value: targetNum },
          constraints: { challengeType },
        },
      });
      router.replace(`/teams/${teamId}/challenges/${row.id}` as any);
    } catch (err: any) {
      Alert.alert('Create failed', String(err?.message || 'Unable to create challenge.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Create Team Challenge</Text>
          <View style={{ width: 60 }} />
        </View>
        <GlassCard>
          <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Challenge title" placeholderTextColor="#7E8E93" />
          <Text style={styles.label}>Challenge type</Text>
          <View style={styles.row}>
            {(['workouts', 'distance_mi', 'xp'] as const).map((type) => (
              <Pressable key={type} style={[styles.chip, challengeType === type && styles.chipOn]} onPress={() => setChallengeType(type)}>
                <Text style={[styles.chipText, challengeType === type && styles.chipTextOn]}>{type.replace('_', ' ')}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.row}>
            <TextInput style={[styles.input, styles.inline]} value={target} onChangeText={setTarget} placeholder="Target" placeholderTextColor="#7E8E93" keyboardType="decimal-pad" />
            <TextInput style={[styles.input, styles.inline]} value={days} onChangeText={setDays} placeholder="Days" placeholderTextColor="#7E8E93" keyboardType="number-pad" />
          </View>
          <Pressable style={[styles.primary, saving && styles.disabled]} onPress={() => void onCreate()} disabled={saving}>
            <Text style={styles.primaryText}>{saving ? 'Creating…' : 'Create challenge'}</Text>
          </Pressable>
        </GlassCard>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  content: { padding: 16, paddingBottom: 32 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { minHeight: 44, minWidth: 60, justifyContent: 'center' },
  backText: { color: '#8FDBFF', fontWeight: '800' },
  title: { color: '#FFFFFF', fontWeight: '900', fontSize: 20 },
  input: { minHeight: 42, borderRadius: 12, borderWidth: 1, borderColor: '#2A2A2A', backgroundColor: '#111111', color: '#EAF8FD', paddingHorizontal: 12, marginTop: 8, fontWeight: '700' },
  label: { marginTop: 12, color: '#8FA6AE', fontWeight: '800', fontSize: 12 },
  row: { marginTop: 8, flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { minHeight: 34, borderRadius: 999, borderWidth: 1, borderColor: '#2A2A2A', backgroundColor: '#111111', paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  chipOn: { borderColor: 'rgba(0,217,255,0.34)', backgroundColor: 'rgba(0,217,255,0.14)' },
  chipText: { color: '#D5D5D5', fontWeight: '800', fontSize: 12 },
  chipTextOn: { color: '#BFF3FF' },
  inline: { flex: 1, marginTop: 0 },
  primary: { marginTop: 14, minHeight: 44, borderRadius: 12, backgroundColor: '#00D9FF', alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#01212A', fontWeight: '900' },
  disabled: { opacity: 0.55 },
});
