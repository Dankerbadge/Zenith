import { router } from 'expo-router'; import React from 'react'; import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../components/ui/GlassCard';
import { APP_CONFIG } from '../../utils/appConfig';
import { isSupabaseConfigured } from '../../utils/supabaseClient';

export default function ReleaseReadinessScreen() {
  const watchControlsEnabled = APP_CONFIG.FEATURES.APPLE_WATCH_ENABLED;
  const garminEnabled = APP_CONFIG.FEATURES.GARMIN_CONNECT_ENABLED;
  const openExternal = async (url: string, label: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('Open manually', `Could not open ${label} automatically.\n\n${url}`);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}><Text style={styles.back}>Back</Text></Pressable>
          <Text style={styles.title}>Release Candidate</Text>
          <View style={{ width: 40 }} />
        </View>

        <GlassCard>
          <Text style={styles.section}>QA gauntlet</Text>
          <Text style={styles.item}>- Run `npm run verify:rc` before manual testing</Text>
          <Text style={styles.item}>- Rapid taps across logging, run start/end, and saves</Text>
          <Text style={styles.item}>- Rotation test on modal, stats, run review, and community</Text>
          <Text style={styles.item}>- Background and resume while run tracking and while paused</Text>
          <Text style={styles.item}>- Offline mode checks for logging, export, and profile edits</Text>
          <Text style={styles.item}>- GPS loss simulation during run session</Text>
          {watchControlsEnabled ? (
            <Pressable style={styles.linkButton} onPress={() => router.push('/account/control-diagnostics' as any)}>
              <Text style={styles.linkButtonText}>Open Control Diagnostics</Text>
            </Pressable>
          ) : null}
        </GlassCard>

        <View style={{ height: 10 }} />
        <GlassCard>
          <Text style={styles.section}>Performance regression</Text>
          <Text style={styles.item}>- Compare startup speed before and after AI and wearables</Text>
          <Text style={styles.item}>- Confirm no background polling loops were introduced</Text>
          <Text style={styles.item}>- Validate app remains smooth on weak network</Text>
        </GlassCard>

        <View style={{ height: 10 }} />
        <GlassCard>
          <Text style={styles.section}>Backend readiness (Supabase)</Text>
          <Text style={styles.item}>- Env configured: {isSupabaseConfigured ? 'Yes' : 'No (set EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY)'}</Text>
          <Text style={styles.item}>- Core app works without Supabase; social sync/auth persistence requires setup.</Text>
          <Text style={styles.item}>- Verify RLS for block/report/mute and request/message rate limits before production sync.</Text>
          <Text style={styles.item}>- See docs/SUPABASE_NEXT_ACTIONS.md for full checklist.</Text>
        </GlassCard>

        <View style={{ height: 10 }} />
        <GlassCard>
          <Text style={styles.section}>Wearable companion status</Text>
          <Text style={styles.item}>- Apple Watch controls: {watchControlsEnabled ? 'Enabled' : 'Not enabled for this version'}</Text>
          <Text style={styles.item}>- Garmin Connect IQ: {garminEnabled ? 'In development (companion diagnostics available)' : 'Not enabled for this version'}</Text>
          <Text style={styles.item}>- Watch surfaces must not show pricing. Premium unlocks happen in mobile app via entitlement sync.</Text>
          {garminEnabled ? (
            <Pressable style={styles.linkButton} onPress={() => router.push('/wearables/garmin' as any)}>
              <Text style={styles.linkButtonText}>Open Garmin Companion</Text>
            </Pressable>
          ) : null}
        </GlassCard>

        <View style={{ height: 10 }} />
        <GlassCard>
          <Text style={styles.section}>Store prep</Text>
          <Text style={styles.item}>- App description, support contact, and policy links</Text>
          <Text style={styles.item}>- Privacy disclosures aligned with in-app behavior</Text>
          <Text style={styles.item}>- Screenshots and metadata for current feature set</Text>
          <View style={styles.linkRow}>
            <Pressable style={styles.linkButton} onPress={() => void openExternal(APP_CONFIG.PRIVACY_URL, 'privacy policy')}>
              <Text style={styles.linkButtonText}>Privacy URL</Text>
            </Pressable>
            <Pressable style={styles.linkButton} onPress={() => void openExternal(APP_CONFIG.TERMS_URL, 'terms')}>
              <Text style={styles.linkButtonText}>Terms URL</Text>
            </Pressable>
          </View>
          <Pressable style={styles.linkButton} onPress={() => void openExternal(`mailto:${APP_CONFIG.SUPPORT_EMAIL}`, 'support email')}>
            <Text style={styles.linkButtonText}>Support Email</Text>
          </Pressable>
          <Pressable style={styles.linkButton} onPress={() => router.push('/account/compliance' as any)}>
            <Text style={styles.linkButtonText}>Open Compliance Status</Text>
          </Pressable>
          <Pressable style={styles.linkButton} onPress={() => router.push('/account/privacy-policy' as any)}>
            <Text style={styles.linkButtonText}>Open Privacy & Data</Text>
          </Pressable>
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
  section: { color: '#FFF', fontWeight: '800', marginBottom: 8 },
  item: { color: '#D0D0D0', fontWeight: '600', marginBottom: 6, lineHeight: 18 },
  linkRow: { flexDirection: 'row', gap: 10, marginTop: 2 },
  linkButton: {
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2F2F2F',
    backgroundColor: '#161616',
    paddingVertical: 10,
    alignItems: 'center',
  },
  linkButtonText: { color: '#D3EDF6', fontWeight: '800' },
});
