import { router } from 'expo-router'; import React from 'react'; import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../components/ui/GlassCard';
import { APP_CONFIG } from '../../utils/appConfig';

export default function PrivacyPolicyScreen() {
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
          <Text style={styles.title}>Privacy & Data</Text>
          <View style={{ width: 40 }} />
        </View>

        <GlassCard>
          <Text style={styles.section}>What is stored locally</Text>
          <Text style={styles.item}>- Daily logs, run history, goals, and preferences are stored on this device.</Text>
          <Text style={styles.item}>- Community data and moderation records are stored for feature continuity.</Text>
        </GlassCard>

        <View style={{ height: 10 }} />
        <GlassCard>
          <Text style={styles.section}>What may sync</Text>
          <Text style={styles.item}>- Wearable imports (when enabled) pull health signals into your daily logs.</Text>
          <Text style={styles.item}>- Core app usage does not require login until monetization/social phases.</Text>
        </GlassCard>

        <View style={{ height: 10 }} />
        <GlassCard>
          <Text style={styles.section}>AI usage</Text>
          <Text style={styles.item}>- AI Insights are optional and OFF by default.</Text>
          <Text style={styles.item}>- AI uses your existing logs to generate deterministic insight cards.</Text>
          <Text style={styles.item}>- Turning AI off immediately removes AI output surfaces.</Text>
        </GlassCard>

        <View style={{ height: 10 }} />
        <GlassCard>
          <Text style={styles.section}>Your controls</Text>
          <Text style={styles.item}>- Export and restore are available in Account → Data Management.</Text>
          <Text style={styles.item}>- Reset all data is available in Account → Data Management.</Text>
          <Text style={styles.item}>- Social privacy, blocking, muting, and reporting are available in app settings and social surfaces.</Text>
          <View style={styles.linkRow}>
            <Pressable style={styles.linkBtn} onPress={() => void openExternal(APP_CONFIG.PRIVACY_URL, 'privacy policy')}>
              <Text style={styles.linkBtnText}>Full Privacy Policy</Text>
            </Pressable>
            <Pressable style={styles.linkBtn} onPress={() => void openExternal(APP_CONFIG.TERMS_URL, 'terms')}>
              <Text style={styles.linkBtnText}>Terms of Use</Text>
            </Pressable>
          </View>
        </GlassCard>

        <View style={{ height: 14 }} />
        <Pressable style={styles.cta} onPress={() => router.push('/(tabs)/profile' as any)}>
          <Text style={styles.ctaText}>Open Data Management</Text>
        </Pressable>
        <Pressable style={[styles.cta, { marginTop: 10 }]} onPress={() => void openExternal(`mailto:${APP_CONFIG.SUPPORT_EMAIL}`, 'support email')}>
          <Text style={styles.ctaText}>Contact Support</Text>
        </Pressable>
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
  linkRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  linkBtn: {
    flex: 1,
    minHeight: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2F2F2F',
    backgroundColor: '#161616',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  linkBtnText: { color: '#D3EDF6', fontWeight: '800', fontSize: 12 },
  cta: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,217,255,0.45)',
    backgroundColor: '#132129',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: { color: '#D8F5FF', fontWeight: '800' },
});
