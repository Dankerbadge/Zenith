import { router } from 'expo-router'; import React from 'react'; import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../components/ui/GlassCard';
import { APP_CONFIG } from '../../utils/appConfig';

export default function ComplianceScreen() {
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
          <Text style={styles.title}>Compliance</Text>
          <View style={{ width: 40 }} />
        </View>

        <GlassCard>
          <Text style={styles.section}>Data rights</Text>
          <Text style={styles.item}>- Export/restore/reset controls are available in Account → Data Management.</Text>
          <Text style={styles.item}>- Core data remains local-first unless user enables connected features.</Text>
        </GlassCard>

        <View style={{ height: 10 }} />
        <GlassCard>
          <Text style={styles.section}>Safety and moderation</Text>
          <Text style={styles.item}>- Report flows are available in Community, Messages, and Clubs.</Text>
          <Text style={styles.item}>- Block/mute enforcement applies across discovery, feed, and messaging.</Text>
          <Text style={styles.item}>- Anti-spam limits are active for requests, invites, messages, and reports.</Text>
        </GlassCard>

        <View style={{ height: 10 }} />
        <GlassCard>
          <Text style={styles.section}>AI disclosure</Text>
          <Text style={styles.item}>- AI Insights are optional and OFF by default.</Text>
          <Text style={styles.item}>- AI output is data-grounded, explainable, and non-blocking.</Text>
        </GlassCard>

        <View style={{ height: 10 }} />
        <GlassCard>
          <Text style={styles.section}>Wearable companion disclosure</Text>
          <Text style={styles.item}>- Garmin watch recording stays free on-device in the current plan.</Text>
          <Text style={styles.item}>- Premium watch insights unlock only via mobile entitlement sync.</Text>
          <Text style={styles.item}>- Watch UI must not show pricing or direct purchase prompts.</Text>
          {garminEnabled ? (
            <Pressable style={[styles.linkButton, { marginTop: 6 }]} onPress={() => router.push('/wearables/garmin' as any)}>
              <Text style={styles.linkButtonText}>Open Garmin Companion</Text>
            </Pressable>
          ) : (
            <Text style={[styles.item, { marginTop: 6 }]}>- Garmin companion is not enabled for this version.</Text>
          )}
        </GlassCard>

        <View style={{ height: 10 }} />
        <GlassCard>
          <Text style={styles.section}>Release readiness reminders</Text>
          <Text style={styles.item}>- Confirm final privacy policy URL, terms URL, and support contact before App Store submission.</Text>
          <Text style={styles.item}>- Confirm permission copy for location, camera, notifications, and health data.</Text>
          <View style={styles.linkRow}>
            <Pressable style={styles.linkButton} onPress={() => void openExternal(APP_CONFIG.PRIVACY_URL, 'privacy policy')}>
              <Text style={styles.linkButtonText}>Open Privacy URL</Text>
            </Pressable>
            <Pressable style={styles.linkButton} onPress={() => void openExternal(APP_CONFIG.TERMS_URL, 'terms')}>
              <Text style={styles.linkButtonText}>Open Terms URL</Text>
            </Pressable>
          </View>
          <Pressable
            style={[styles.linkButton, { marginTop: 10 }]}
            onPress={() => void openExternal(`mailto:${APP_CONFIG.SUPPORT_EMAIL}`, 'support email')}
          >
            <Text style={styles.linkButtonText}>Contact Support</Text>
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
  linkRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  linkButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2F2F2F',
    backgroundColor: '#161616',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  linkButtonText: { color: '#D3EDF6', fontWeight: '800', fontSize: 12 },
});
