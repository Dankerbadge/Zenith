import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import Screen from '../../components/ui/Screen';
import GlassCard from '../../components/ui/GlassCard';
import Badge from '../../components/ui/Badge';
import { getUserProfile, setStorageItem, USER_PROFILE_KEY, type UserProfile } from '../../utils/storageUtils';
import { useAuth } from '../context/authcontext';
import { formatHandle, isUsernameValid, normalizeUsername } from '../../utils/username';
import { computeRecommendedTargets, type RecommendationGoal } from '../../utils/nutritionRecommendations';
import { isSupabaseConfigured, supabase } from '../../utils/supabaseClient';

const GOAL_OPTIONS: Array<{ id: RecommendationGoal; label: string }> = [
  { id: 'GAIN_FAT', label: 'Gain Fat' },
  { id: 'GAIN_MUSCLE', label: 'Gain Muscle' },
  { id: 'MAINTAIN', label: 'Maintain' },
  { id: 'LOSE_FAT', label: 'Lose Fat' },
];

const ACTIVITY_OPTIONS = [
  { id: 'sedentary', label: 'Sedentary' },
  { id: 'light', label: 'Light' },
  { id: 'moderate', label: 'Moderate' },
  { id: 'very', label: 'Very' },
  { id: 'extra', label: 'Extra' },
] as const;

function toNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function deriveHeightCm(profile: UserProfile): number | undefined {
  const explicit = toNumber(profile.heightCm);
  if (explicit && explicit > 0) return explicit;
  const heightIn = toNumber(profile.height);
  if (heightIn && heightIn > 0) return Number((heightIn * 2.54).toFixed(1));
  return undefined;
}

function deriveWeightKg(profile: UserProfile): number | undefined {
  const explicit = toNumber(profile.weightKg);
  if (explicit && explicit > 0) return explicit;
  const lbs = toNumber(profile.currentWeight || profile.startWeight);
  if (lbs && lbs > 0) return Number((lbs * 0.45359237).toFixed(2));
  return undefined;
}

function deriveGoals(profile: UserProfile): RecommendationGoal[] {
  if (Array.isArray(profile.onboardingGoals) && profile.onboardingGoals.length > 0) {
    return profile.onboardingGoals.filter(
      (goal): goal is RecommendationGoal =>
        goal === 'GAIN_FAT' || goal === 'GAIN_MUSCLE' || goal === 'MAINTAIN' || goal === 'LOSE_FAT'
    );
  }
  const legacy = String(profile.goal || '').toLowerCase();
  if (legacy === 'cut') return ['LOSE_FAT'];
  if (legacy === 'gain_fat') return ['GAIN_FAT'];
  if (legacy === 'gain_muscle' || legacy === 'bulk') return ['GAIN_MUSCLE'];
  if (legacy === 'maintain') return ['MAINTAIN'];
  return ['MAINTAIN'];
}

export default function ManageProfileScreen() {
  const { profile: cloudProfile, profileReady, hasSupabaseSession, setUsername } = useAuth();
  const cloudHandle = useMemo(() => formatHandle(cloudProfile?.username), [cloudProfile?.username]);

  const [name, setName] = useState('Athlete');
  const [email, setEmail] = useState('');
  const [sexAtBirth, setSexAtBirth] = useState<'male' | 'female' | 'unknown'>('unknown');
  const [birthdate, setBirthdate] = useState('');
  const [heightCm, setHeightCm] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [activityLevel, setActivityLevel] = useState<'sedentary' | 'light' | 'moderate' | 'very' | 'extra'>('moderate');
  const [goals, setGoals] = useState<RecommendationGoal[]>(['MAINTAIN']);
  const [saving, setSaving] = useState(false);
  const [handleInput, setHandleInput] = useState('');
  const [handleSaving, setHandleSaving] = useState(false);
  const [handleStatus, setHandleStatus] = useState<'idle' | 'checking' | 'same' | 'available' | 'taken' | 'invalid' | 'cooldown' | 'no_session'>('idle');
  const [handleCooldownUntil, setHandleCooldownUntil] = useState<string | null>(null);

  const load = useCallback(async () => {
    const p = await getUserProfile();
    setName(String((p as any)?.firstName || 'Athlete'));
    setEmail(String((p as any)?.email || ''));
    setSexAtBirth((String(p.sexAtBirth || p.sex || 'unknown').toLowerCase() as any) === 'male' ? 'male' : (String(p.sexAtBirth || p.sex || 'unknown').toLowerCase() as any) === 'female' ? 'female' : 'unknown');
    setBirthdate(String(p.birthdate || '').slice(0, 10));
    const loadedHeightCm = deriveHeightCm(p);
    const loadedWeightKg = deriveWeightKg(p);
    setHeightCm(loadedHeightCm ? String(loadedHeightCm) : '');
    setWeightKg(loadedWeightKg ? String(loadedWeightKg) : '');
    setActivityLevel(
      String(p.activityLevel || 'moderate') === 'sedentary'
        ? 'sedentary'
        : String(p.activityLevel || 'moderate') === 'light'
        ? 'light'
        : String(p.activityLevel || 'moderate') === 'very' || String(p.activityLevel || 'moderate') === 'active'
        ? 'very'
        : String(p.activityLevel || 'moderate') === 'extra' || String(p.activityLevel || 'moderate') === 'very_active'
        ? 'extra'
        : 'moderate'
    );
    setGoals(deriveGoals(p));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setHandleInput(String(cloudProfile?.username || ''));
    setHandleStatus('idle');
    setHandleCooldownUntil(null);
  }, [cloudProfile?.username]);

  useEffect(() => {
    const normalized = normalizeUsername(handleInput);
    const current = normalizeUsername(cloudProfile?.username || '');
    if (!normalized) {
      setHandleStatus('idle');
      setHandleCooldownUntil(null);
      return;
    }
    if (!isUsernameValid(normalized)) {
      setHandleStatus('invalid');
      setHandleCooldownUntil(null);
      return;
    }
    if (normalized === current) {
      setHandleStatus('same');
      setHandleCooldownUntil(null);
      return;
    }
    if (!isSupabaseConfigured || !hasSupabaseSession) {
      setHandleStatus('no_session');
      setHandleCooldownUntil(null);
      return;
    }

    setHandleStatus('checking');
    setHandleCooldownUntil(null);
    const timer = setTimeout(async () => {
      const { data, error } = await supabase.from('profiles').select('id').eq('username', normalized).limit(1);
      if (error) {
        setHandleStatus('available');
        return;
      }
      setHandleStatus(Array.isArray(data) && data.length > 0 ? 'taken' : 'available');
    }, 300);
    return () => clearTimeout(timer);
  }, [cloudProfile?.username, handleInput, hasSupabaseSession]);

  const targetsPreview = useMemo(() => {
    const h = Number(heightCm);
    const w = Number(weightKg);
    if (!Number.isFinite(h) || h <= 0 || !Number.isFinite(w) || w <= 0) return null;
    return computeRecommendedTargets({
      heightCm: h,
      weightKg: w,
      sexAtBirth,
      birthdate: birthdate || undefined,
      activityLevel,
      onboardingGoals: goals.length > 0 ? goals : ['MAINTAIN'],
    } as UserProfile);
  }, [activityLevel, birthdate, goals, heightCm, sexAtBirth, weightKg]);

  const toggleGoal = useCallback((goal: RecommendationGoal) => {
    setGoals((prev) => {
      if (prev.includes(goal)) {
        const next = prev.filter((g) => g !== goal);
        return next.length > 0 ? next : ['MAINTAIN'];
      }
      return [...prev, goal];
    });
  }, []);

  const updateHandle = useCallback(async () => {
    if (handleSaving) return;
    const normalized = normalizeUsername(handleInput);
    const current = normalizeUsername(cloudProfile?.username || '');
    if (!normalized || normalized === current) return;
    if (!isUsernameValid(normalized)) {
      setHandleStatus('invalid');
      Alert.alert('Invalid username', 'Use 3-20 chars: a-z, 0-9, period, underscore.');
      return;
    }
    if (handleStatus === 'taken') {
      Alert.alert('Username taken', 'Pick a different username.');
      return;
    }
    if (!isSupabaseConfigured || !hasSupabaseSession) {
      setHandleStatus('no_session');
      Alert.alert('Sign in required', 'Sign in to edit your username.');
      return;
    }

    setHandleSaving(true);
    try {
      const res = await setUsername(normalized);
      if (!res.ok) {
        if (res.reason === 'cooldown') {
          setHandleStatus('cooldown');
          setHandleCooldownUntil(res.nextAllowedAt || null);
          Alert.alert(
            'Username cooldown',
            `You can change your username again on ${
              res.nextAllowedAt ? new Date(res.nextAllowedAt).toLocaleDateString() : 'a future date'
            }.`
          );
          return;
        }
        if (res.reason === 'taken') {
          setHandleStatus('taken');
          Alert.alert('Username taken', 'That username is already in use.');
          return;
        }
        if (res.reason === 'invalid') {
          setHandleStatus('invalid');
          Alert.alert('Invalid username', 'Use 3-20 chars: a-z, 0-9, period, underscore.');
          return;
        }
        Alert.alert('Update failed', 'Could not update username right now.');
        return;
      }
      setHandleStatus('same');
      setHandleCooldownUntil(null);
      Alert.alert('Updated', 'Username updated and now searchable in Find Friends.');
    } catch {
      Alert.alert('Update failed', 'Could not update username right now.');
    } finally {
      setHandleSaving(false);
    }
  }, [cloudProfile?.username, handleInput, handleSaving, handleStatus, hasSupabaseSession, setUsername]);

  const save = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const p = await getUserProfile();
      const parsedHeightCm = Number(heightCm);
      const parsedWeightKg = Number(weightKg);
      if (!Number.isFinite(parsedHeightCm) || parsedHeightCm <= 0) {
        Alert.alert('Invalid height', 'Enter a valid height in cm.');
        setSaving(false);
        return;
      }
      if (!Number.isFinite(parsedWeightKg) || parsedWeightKg <= 0) {
        Alert.alert('Invalid weight', 'Enter a valid weight in kg.');
        setSaving(false);
        return;
      }
      const normalizedGoals = goals.length > 0 ? goals : (['MAINTAIN'] as RecommendationGoal[]);
      const legacyGoal = normalizedGoals.includes('LOSE_FAT')
        ? 'cut'
        : normalizedGoals.includes('GAIN_FAT')
        ? 'gain_fat'
        : normalizedGoals.includes('GAIN_MUSCLE')
        ? 'gain_muscle'
        : 'maintain';

      await setStorageItem(USER_PROFILE_KEY, {
        ...p,
        firstName: String(name || 'Athlete').trim() || 'Athlete',
        email: String(email || '').trim(),
        sexAtBirth,
        sex: sexAtBirth === 'unknown' ? null : sexAtBirth,
        birthdate: birthdate || undefined,
        heightCm: Number(parsedHeightCm.toFixed(1)),
        weightKg: Number(parsedWeightKg.toFixed(2)),
        height: Number((parsedHeightCm / 2.54).toFixed(1)),
        currentWeight: Number((parsedWeightKg * 2.2046226218).toFixed(1)),
        activityLevel,
        onboardingGoals: normalizedGoals,
        goal: legacyGoal,
        onboardingCompleted: true,
      });
      Alert.alert('Saved', 'Profile updated.');
      router.back();
    } catch {
      Alert.alert('Save failed', 'Unable to save profile right now.');
    } finally {
      setSaving(false);
    }
  }, [activityLevel, birthdate, email, goals, heightCm, name, saving, sexAtBirth, weightKg]);

  return (
    <Screen aura>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}>
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Manage Profile</Text>
          <View style={{ width: 56 }} />
        </View>

        <GlassCard>
          <Text style={styles.label}>Name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Athlete"
            placeholderTextColor="#777"
            style={styles.input}
            autoCapitalize="words"
            autoCorrect={false}
          />

          <Text style={[styles.label, { marginTop: 14 }]}>Email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="name@domain.com"
            placeholderTextColor="#777"
            style={styles.input}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={[styles.label, { marginTop: 14 }]}>Sex at birth</Text>
          <View style={styles.chipRow}>
            <Pressable onPress={() => setSexAtBirth('male')} style={[styles.chip, sexAtBirth === 'male' && styles.chipActive]}>
              <Text style={[styles.chipText, sexAtBirth === 'male' && styles.chipTextActive]}>Male</Text>
            </Pressable>
            <Pressable onPress={() => setSexAtBirth('female')} style={[styles.chip, sexAtBirth === 'female' && styles.chipActive]}>
              <Text style={[styles.chipText, sexAtBirth === 'female' && styles.chipTextActive]}>Female</Text>
            </Pressable>
            <Pressable onPress={() => setSexAtBirth('unknown')} style={[styles.chip, sexAtBirth === 'unknown' && styles.chipActive]}>
              <Text style={[styles.chipText, sexAtBirth === 'unknown' && styles.chipTextActive]}>Unknown</Text>
            </Pressable>
          </View>

          <Text style={[styles.label, { marginTop: 14 }]}>Birthdate (YYYY-MM-DD)</Text>
          <TextInput
            value={birthdate}
            onChangeText={setBirthdate}
            placeholder="1995-01-01"
            placeholderTextColor="#777"
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={[styles.label, { marginTop: 14 }]}>Height (cm)</Text>
          <TextInput
            value={heightCm}
            onChangeText={setHeightCm}
            placeholder="178"
            placeholderTextColor="#777"
            style={styles.input}
            keyboardType="decimal-pad"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={[styles.label, { marginTop: 14 }]}>Weight (kg)</Text>
          <TextInput
            value={weightKg}
            onChangeText={setWeightKg}
            placeholder="82"
            placeholderTextColor="#777"
            style={styles.input}
            keyboardType="decimal-pad"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={[styles.label, { marginTop: 14 }]}>Activity level</Text>
          <View style={styles.chipRow}>
            {ACTIVITY_OPTIONS.map((option) => (
              <Pressable
                key={option.id}
                onPress={() => setActivityLevel(option.id)}
                style={[styles.chip, activityLevel === option.id && styles.chipActive]}
              >
                <Text style={[styles.chipText, activityLevel === option.id && styles.chipTextActive]}>{option.label}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={[styles.label, { marginTop: 14 }]}>Goals (multi-select)</Text>
          <View style={styles.chipRow}>
            {GOAL_OPTIONS.map((option) => {
              const active = goals.includes(option.id);
              return (
                <Pressable key={option.id} onPress={() => toggleGoal(option.id)} style={[styles.chip, active && styles.chipActive]}>
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {targetsPreview ? (
            <View style={styles.previewBox}>
              <Text style={styles.previewTitle}>Recommended daily targets</Text>
              <Text style={styles.previewLine}>Calories: {Math.round(Number(targetsPreview.caloriesTargetKcal || 0))} kcal</Text>
              <Text style={styles.previewLine}>Protein: {Math.round(Number(targetsPreview.proteinTargetG || 0))} g</Text>
              <Text style={styles.previewLine}>Water: {Math.round(Number(targetsPreview.waterTargetOz || 0))} oz</Text>
              <Text style={styles.previewHint}>Confidence: {targetsPreview.meta.confidence}</Text>
              {targetsPreview.meta.warnings[0] ? <Text style={styles.previewHint}>{targetsPreview.meta.warnings[0]}</Text> : null}
            </View>
          ) : (
            <Text style={styles.helper}>Enter height and weight to preview recommended targets.</Text>
          )}

          <View style={styles.handleRow}>
            <Text style={styles.handleLabel}>Handle</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={styles.handleValue}>{cloudHandle}</Text>
              {profileReady && cloudHandle !== '@unknown' ? <Badge label="Cloud" tone="muted" /> : <Badge label="Local" tone="muted" />}
            </View>
          </View>

          <TextInput
            value={handleInput}
            onChangeText={(v) => {
              setHandleInput(v);
              if (handleStatus === 'cooldown') setHandleCooldownUntil(null);
            }}
            placeholder="username"
            placeholderTextColor="#777"
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.handleStatusText}>
            {handleStatus === 'idle' && 'Set your username for Find Friends.'}
            {handleStatus === 'checking' && 'Checking availability…'}
            {handleStatus === 'same' && 'Current username.'}
            {handleStatus === 'available' && 'Available.'}
            {handleStatus === 'taken' && 'Taken.'}
            {handleStatus === 'invalid' && 'Invalid. Use 3-20 chars: a-z, 0-9, period, underscore.'}
            {handleStatus === 'cooldown' &&
              `Cooldown active until ${
                handleCooldownUntil ? new Date(handleCooldownUntil).toLocaleDateString() : 'a future date'
              }.`}
            {handleStatus === 'no_session' && 'Sign in to edit username.'}
          </Text>
          <Pressable
            onPress={() => void updateHandle()}
            disabled={
              handleSaving ||
              handleStatus === 'idle' ||
              handleStatus === 'checking' ||
              handleStatus === 'taken' ||
              handleStatus === 'invalid' ||
              handleStatus === 'cooldown' ||
              handleStatus === 'same' ||
              handleStatus === 'no_session'
            }
            style={({ pressed }) => [
              styles.secondaryBtn,
              pressed && styles.pressed,
              (handleSaving ||
                handleStatus === 'idle' ||
                handleStatus === 'checking' ||
                handleStatus === 'taken' ||
                handleStatus === 'invalid' ||
                handleStatus === 'cooldown' ||
                handleStatus === 'same' ||
                handleStatus === 'no_session') &&
                styles.disabled,
            ]}
          >
            <Text style={styles.secondaryBtnText}>{handleSaving ? 'Updating...' : 'Update Handle'}</Text>
          </Pressable>

          <Text style={styles.helper}>
            Username changes are limited to one edit every 14 days and must be unique.
          </Text>

          <Pressable onPress={() => void save()} disabled={saving} style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed, saving && styles.disabled]}>
            <Text style={styles.primaryText}>{saving ? 'Saving...' : 'Save'}</Text>
          </Pressable>
        </GlassCard>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 36 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
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
  label: { color: '#EAEAEA', fontWeight: '900' },
  input: {
    marginTop: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: '#0F0F0F',
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: '#FFF',
    fontWeight: '800',
  },
  chipRow: { marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: {
    borderColor: 'rgba(0,217,255,0.60)',
    backgroundColor: 'rgba(0,217,255,0.16)',
  },
  chipText: { color: '#CBD6DB', fontWeight: '800', fontSize: 12 },
  chipTextActive: { color: '#CCF6FF' },
  previewBox: {
    marginTop: 14,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(0,217,255,0.25)',
    backgroundColor: 'rgba(2,18,24,0.7)',
  },
  previewTitle: { color: '#E8FBFF', fontWeight: '900', marginBottom: 6 },
  previewLine: { color: '#AEEFFF', fontWeight: '800', fontSize: 13, marginTop: 2 },
  previewHint: { color: 'rgba(234,255,255,0.65)', fontWeight: '700', fontSize: 11, marginTop: 6 },
  handleRow: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  handleLabel: { color: 'rgba(255,255,255,0.65)', fontWeight: '800' },
  handleValue: { color: '#8FDFFF', fontWeight: '900' },
  handleStatusText: { marginTop: 8, color: 'rgba(255,255,255,0.64)', fontWeight: '700', lineHeight: 18 },
  secondaryBtn: {
    marginTop: 10,
    borderRadius: 14,
    minHeight: 42,
    borderWidth: 1,
    borderColor: 'rgba(0,217,255,0.45)',
    backgroundColor: 'rgba(0,217,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: { color: '#BDF4FF', fontWeight: '900', fontSize: 14 },
  helper: { marginTop: 10, color: 'rgba(255,255,255,0.60)', fontWeight: '700', lineHeight: 18 },
  primaryBtn: {
    marginTop: 16,
    backgroundColor: '#00D9FF',
    borderRadius: 14,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: '#041A22', fontWeight: '900', fontSize: 15 },
  pressed: { opacity: 0.96, transform: [{ scale: 0.995 }] },
  disabled: { opacity: 0.6 },
});
