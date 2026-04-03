import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useLocalSearchParams, useRouter } from 'expo-router';
import { EXERCISE_PACKS } from '../../utils/monetizationService';

export default function PackDetailsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const packId = typeof params.id === 'string' ? params.id : '';

  const pack = useMemo(() => EXERCISE_PACKS.find((item) => item.id === packId), [packId]);

  if (!pack) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.card}>
          <Text style={styles.title}>Pack not found</Text>
          <Text style={styles.body}>That pack ID is not in your current catalog. Open Store to refresh available plans and packs.</Text>
          <Pressable onPress={() => router.replace('/store' as any)} style={styles.button}>
            <Text style={styles.buttonText}>Open store</Text>
          </Pressable>
          <Pressable onPress={() => router.back()} style={styles.button}>
            <Text style={styles.buttonText}>Go back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.icon}>{pack.icon}</Text>
        <Text style={styles.title}>{pack.name}</Text>
        <Text style={styles.body}>{pack.description}</Text>

        <View style={styles.featuresCard}>
          <Text style={styles.featuresTitle}>Included features</Text>
          {pack.features.map((feature) => (
            <Text key={feature} style={styles.featureItem}>
              • {feature}
            </Text>
          ))}
        </View>

        <Pressable onPress={() => router.back()} style={styles.button}>
          <Text style={styles.buttonText}>Back to store</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  content: { padding: 20, paddingBottom: 32 },
  card: {
    margin: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#111',
    padding: 16,
  },
  icon: { fontSize: 52, marginBottom: 8, textAlign: 'center' },
  title: { color: '#fff', fontSize: 26, fontWeight: '800', textAlign: 'center' },
  body: { color: '#b9b9b9', textAlign: 'center', marginTop: 8 },
  featuresCard: {
    marginTop: 18,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#121212',
    padding: 14,
  },
  featuresTitle: { color: '#fff', fontWeight: '700', marginBottom: 8 },
  featureItem: { color: '#d3d3d3', marginBottom: 6 },
  button: {
    marginTop: 20,
    borderRadius: 12,
    backgroundColor: '#00D9FF',
    alignItems: 'center',
    paddingVertical: 12,
  },
  buttonText: { color: '#002029', fontWeight: '800' },
});
