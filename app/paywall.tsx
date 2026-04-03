import { router } from 'expo-router'; import React from 'react'; import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LinearGradient } from 'expo-linear-gradient';
import { isStorePurchasingEnabled } from '../utils/monetizationService';

export default function PaywallScreen() {
  const storeEnabled = isStorePurchasingEnabled();

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.kicker}>Optional Upgrade</Text>
        <Text style={styles.title}>Choose your Zenith tier</Text>
        <Text style={styles.subtitle}>Core logging stays free. Upgrade anytime for premium analytics and advanced packs.</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Free</Text>
          <Text style={styles.cardPrice}>$0</Text>
          <Text style={styles.cardLine}>• Workout, food, water, weight, rest logging</Text>
          <Text style={styles.cardLine}>• Winning days and streak tracking</Text>
          <Text style={styles.cardLine}>• Core stats and account settings</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Zenith Pro</Text>
          <Text style={styles.cardPrice}>Premium</Text>
          <Text style={styles.cardLine}>• Advanced analytics and insights</Text>
          <Text style={styles.cardLine}>• Pack unlocks and deeper training tools</Text>
          <Text style={styles.cardLine}>• Priority updates and expanded features</Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={styles.freeButton} onPress={() => router.replace('/(tabs)' as any)}>
          <Text style={styles.freeButtonText}>Continue Free</Text>
        </Pressable>
        <Pressable
          style={styles.proButton}
          disabled={false}
          onPress={() => router.replace('/store' as any)}
        >
          <LinearGradient colors={['#00D9FF', '#8A2BE2']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.proGradient}>
            <Text style={styles.proButtonText}>{storeEnabled ? 'See Pro Plans' : 'Open Store'}</Text>
          </LinearGradient>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0A0A0A' },
  content: { padding: 20, paddingBottom: 140 },
  kicker: { color: '#7CD9FF', fontWeight: '700', marginBottom: 8 },
  title: { color: '#FFF', fontSize: 32, fontWeight: '900', marginBottom: 10 },
  subtitle: { color: '#9A9A9A', fontSize: 15, lineHeight: 22, marginBottom: 18 },
  card: {
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  cardTitle: { color: '#FFF', fontSize: 18, fontWeight: '800' },
  cardPrice: { color: '#00D9FF', fontWeight: '800', marginTop: 4, marginBottom: 10 },
  cardLine: { color: '#CFCFCF', marginBottom: 6, fontWeight: '600' },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: 'rgba(10,10,10,0.98)',
    borderTopWidth: 1,
    borderTopColor: '#222',
    gap: 10,
  },
  freeButton: {
    backgroundColor: '#232323',
    borderRadius: 14,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  freeButtonText: { color: '#FFF', fontWeight: '800' },
  proButton: { borderRadius: 14, overflow: 'hidden' },
  proGradient: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  proButtonText: { color: '#FFF', fontWeight: '900' },
});
