import { router } from 'expo-router'; import React, { useEffect, useState } from 'react'; import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Chip from '../../components/ui/Chip';
import GlassCard from '../../components/ui/GlassCard';
import { getUserProfile, setStorageItem, USER_PROFILE_KEY } from '../../utils/storageUtils';
import { getCurrencySnapshot, hasNoExcusesUnlock } from '../../utils/effortCurrencyService';
import { getIdentityLockEligibility } from '../../utils/behavioralCore';
import { APP_CONFIG } from '../../utils/appConfig';

export default function PreferencesScreen() {
  const socialEnabled = APP_CONFIG.FEATURES.SOCIAL_FEATURES_ENABLED || APP_CONFIG.RUNTIME.OVERRIDES.SOCIAL_FEATURES_ENABLED;
  const [units, setUnits] = useState<'lb-oz' | 'kg-ml'>('lb-oz');
  const [weekStart, setWeekStart] = useState<'sun' | 'mon'>('mon');
  const [aiOverlayEnabled, setAiOverlayEnabled] = useState(false);
  const [aiInsightFrequency, setAiInsightFrequency] = useState<'minimal' | 'standard'>('minimal');
  const [aiNeverDuringActivity, setAiNeverDuringActivity] = useState(true);
  const [strictDeterminismEnabled, setStrictDeterminismEnabled] = useState(true);
  const [identityLockEnabled, setIdentityLockEnabled] = useState(false);
  const [noExcusesEnabled, setNoExcusesEnabled] = useState(false);
  const [injuryModeEnabled, setInjuryModeEnabled] = useState(false);
  const [illnessModeEnabled, setIllnessModeEnabled] = useState(false);
  const [noExcusesUnlocked, setNoExcusesUnlocked] = useState(false);
  const [currencyBalance, setCurrencyBalance] = useState(0);
  const [identityLockEligibility, setIdentityLockEligibility] = useState<{
    eligible: boolean;
    reason: string;
  } | null>(null);

  useEffect(() => {
    const load = async () => {
      const profile = await getUserProfile();
      const prefs = (profile.preferences || {}) as { units?: string; weekStart?: string; aiOverlayEnabled?: boolean; aiInsightFrequency?: string; aiNeverDuringActivity?: boolean };
      const behaviorModes = ((profile as any).behaviorState?.modes || {}) as {
        strictDeterminismEnabled?: boolean;
        identityLockEnabled?: boolean;
        noExcusesEnabled?: boolean;
        injuryModeEnabled?: boolean;
        illnessModeEnabled?: boolean;
      };
      setUnits(prefs.units === 'kg-ml' ? 'kg-ml' : 'lb-oz');
      setWeekStart(prefs.weekStart === 'sun' ? 'sun' : 'mon');
      setAiOverlayEnabled(Boolean(prefs.aiOverlayEnabled));
      setAiInsightFrequency(prefs.aiInsightFrequency === 'standard' ? 'standard' : 'minimal');
      setAiNeverDuringActivity(prefs.aiNeverDuringActivity !== false);
      setStrictDeterminismEnabled(true);
      setIdentityLockEnabled(behaviorModes.identityLockEnabled === true);
      setNoExcusesEnabled(behaviorModes.noExcusesEnabled === true);
      setInjuryModeEnabled(behaviorModes.injuryModeEnabled === true);
      setIllnessModeEnabled(behaviorModes.illnessModeEnabled === true);
      const [unlocked, currency] = await Promise.all([hasNoExcusesUnlock(), getCurrencySnapshot()]);
      setNoExcusesUnlocked(unlocked);
      setCurrencyBalance(currency.balance);
      const lockEligibility = await getIdentityLockEligibility();
      setIdentityLockEligibility({ eligible: lockEligibility.eligible, reason: lockEligibility.reason });
    };
    void load();
  }, []);

  const save = async () => {
    const noExcusesFinal = noExcusesEnabled && noExcusesUnlocked && !injuryModeEnabled && !illnessModeEnabled;
    const identityLockFinal = identityLockEnabled && Boolean(identityLockEligibility?.eligible);
    const profile = await getUserProfile();
      await setStorageItem(USER_PROFILE_KEY, {
        ...profile,
        preferences: {
          ...(profile.preferences || {}),
          units,
          weekStart,
          aiOverlayEnabled,
          aiInsightFrequency,
          aiNeverDuringActivity,
        },
        behaviorState: {
          ...((profile as any).behaviorState || {}),
          modes: {
            ...((profile as any).behaviorState?.modes || {}),
            strictDeterminismEnabled: true,
            identityLockEnabled: identityLockFinal,
            noExcusesEnabled: noExcusesFinal,
            injuryModeEnabled,
            illnessModeEnabled,
          },
        },
      });
    if (identityLockEnabled && !identityLockFinal) {
      Alert.alert('Identity lock not enabled', identityLockEligibility?.reason || 'Requirements not met yet.');
    }
    if (noExcusesEnabled && !noExcusesFinal) {
      Alert.alert(
        'No Excuses adjusted',
        injuryModeEnabled || illnessModeEnabled
          ? 'No Excuses is disabled while Injury or Illness mode is active.'
          : 'Unlock No Excuses with Effort Currency first.'
      );
    }
    Alert.alert('Saved', 'Preferences updated.');
    router.back();
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}><Text style={styles.back}>Back</Text></Pressable>
          <Text style={styles.title}>Preferences</Text>
          <View style={{ width: 40 }} />
        </View>

        <GlassCard>
          <Text style={styles.label}>Units</Text>
          <View style={styles.row}>
            <Chip label='lb / oz' active={units === 'lb-oz'} onPress={() => setUnits('lb-oz')} />
            <Chip label='kg / ml' active={units === 'kg-ml'} onPress={() => setUnits('kg-ml')} />
          </View>

          <Text style={styles.label}>Week starts on</Text>
          <View style={styles.row}>
            <Chip label='Monday' active={weekStart === 'mon'} onPress={() => setWeekStart('mon')} />
            <Chip label='Sunday' active={weekStart === 'sun'} onPress={() => setWeekStart('sun')} />
          </View>

          <Text style={styles.label}>AI Insights (Optional)</Text>
          <View style={styles.row}>
            <Chip label='Off' active={!aiOverlayEnabled} onPress={() => setAiOverlayEnabled(false)} />
            <Chip label='On' active={aiOverlayEnabled} onPress={() => setAiOverlayEnabled(true)} />
          </View>
          {aiOverlayEnabled ? (
            <>
              <Text style={styles.label}>Insight frequency</Text>
              <View style={styles.row}>
                <Chip label='Minimal' active={aiInsightFrequency === 'minimal'} onPress={() => setAiInsightFrequency('minimal')} />
                <Chip label='Standard' active={aiInsightFrequency === 'standard'} onPress={() => setAiInsightFrequency('standard')} />
              </View>
              <Text style={styles.label}>Never during activity</Text>
              <View style={styles.row}>
                <Chip label='On (required)' active={aiNeverDuringActivity} onPress={() => setAiNeverDuringActivity(true)} />
              </View>
            </>
          ) : null}

          <Text style={styles.label}>Deterministic Discipline Core</Text>
          <View style={styles.row}>
            <Chip label='On (required)' active={strictDeterminismEnabled} onPress={() => setStrictDeterminismEnabled(true)} />
          </View>
          <Text style={styles.label}>Identity Lock-In</Text>
          <View style={styles.row}>
            <Chip label='Off' active={!identityLockEnabled} onPress={() => setIdentityLockEnabled(false)} />
            <Chip label='On' active={identityLockEnabled} onPress={() => setIdentityLockEnabled(true)} />
          </View>
          {!identityLockEligibility?.eligible ? (
            <Text style={styles.helperText}>{identityLockEligibility?.reason || 'Complete baseline consistency to unlock lock-in.'}</Text>
          ) : (
            <Text style={styles.helperText}>Eligible: lock-in raises standards and consequences.</Text>
          )}
          <Text style={styles.label}>No Excuses Mode</Text>
          <View style={styles.row}>
            <Chip label='Off' active={!noExcusesEnabled} onPress={() => setNoExcusesEnabled(false)} />
            <Chip
              label='On'
              active={noExcusesEnabled}
              onPress={() => {
                if (noExcusesUnlocked) {
                  setNoExcusesEnabled(true);
                  return;
                }
                Alert.alert('Zenith Pro required', 'Upgrade to enable No Excuses mode.', [
                  { text: 'Not now', style: 'cancel' },
                  { text: 'Open Store', onPress: () => router.push('/store' as any) },
                ]);
              }}
            />
          </View>
          {!noExcusesUnlocked ? (
            <Text style={styles.helperText}>Zenith Pro required for No Excuses mode. Balance: {currencyBalance.toFixed(2)}</Text>
          ) : null}
          {injuryModeEnabled || illnessModeEnabled ? (
            <Text style={styles.helperText}>Capacity override active: No Excuses will be forced off on save.</Text>
          ) : null}
          <Text style={styles.label}>Capacity Override</Text>
          <View style={styles.row}>
            <Chip label='Injury' active={injuryModeEnabled} onPress={() => setInjuryModeEnabled((v) => !v)} />
            <Chip label='Illness' active={illnessModeEnabled} onPress={() => setIllnessModeEnabled((v) => !v)} />
          </View>

          {socialEnabled ? (
            <Pressable style={styles.secondaryButton} onPress={() => router.push('/account/social-privacy' as any)}>
              <Text style={styles.secondaryButtonText}>Open Social Privacy</Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.secondaryButton} onPress={() => router.push('/notification-settings' as any)}>
            <Text style={styles.secondaryButtonText}>Open Notification Settings</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => router.push('/weekly-recap' as any)}>
            <Text style={styles.secondaryButtonText}>Open Weekly Recap</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => router.push('/account/workout-loadouts' as any)}>
            <Text style={styles.secondaryButtonText}>Open Workout Loadouts</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => router.push('/account/behavior-core' as any)}>
            <Text style={styles.secondaryButtonText}>Open Behavior Core</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => router.push('/account/effort-currency' as any)}>
            <Text style={styles.secondaryButtonText}>Open Effort Currency</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => router.push('/account/privacy-policy' as any)}>
            <Text style={styles.secondaryButtonText}>Open Privacy & Data</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => router.push('/account/compliance' as any)}>
            <Text style={styles.secondaryButtonText}>Open Compliance</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => router.push('/store' as any)}>
            <Text style={styles.secondaryButtonText}>Open Subscription Store</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => router.push('/account/release-readiness' as any)}>
            <Text style={styles.secondaryButtonText}>Open Release Checklist</Text>
          </Pressable>
          <Pressable style={styles.button} onPress={save}><Text style={styles.buttonText}>Save Preferences</Text></Pressable>
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
  label: { color: '#E2E2E2', fontWeight: '700', marginTop: 4, marginBottom: 8 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  helperText: { color: '#9BB9C2', fontWeight: '600', marginTop: 6, fontSize: 12 },
  secondaryButton: {
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3A3A3A',
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#151515',
  },
  secondaryButtonText: { color: '#D3EDF6', fontWeight: '800', fontSize: 14 },
  button: { marginTop: 12, backgroundColor: '#00D9FF', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  buttonText: { color: '#041A22', fontWeight: '900', fontSize: 15 },
});
