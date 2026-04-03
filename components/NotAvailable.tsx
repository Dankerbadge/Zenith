import React from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

export default function NotAvailable(props: { title?: string; message?: string; ctaLabel?: string }) {
  const title = props.title || 'Not available';
  const message = props.message || 'This screen is not available in this version of Zenith.';
  const ctaLabel = props.ctaLabel || 'Go to Home';

  const handleBack = () => {
    const canGoBackFn = (router as any)?.canGoBack;
    try {
      if (typeof canGoBackFn === 'function') {
        if (canGoBackFn()) {
          router.back();
          return;
        }
      }
    } catch {
      // ignore and fall through to home
    }
    router.replace('/(tabs)' as any);
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message}>{message}</Text>
        <Pressable style={styles.button} onPress={() => router.replace('/(tabs)' as any)}>
          <Text style={styles.buttonText}>{ctaLabel}</Text>
        </Pressable>
        <Pressable style={[styles.button, styles.secondaryButton]} onPress={handleBack}>
          <Text style={styles.buttonText}>Back</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0A0A0A' },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 22 },
  title: { color: '#FFFFFF', fontSize: 22, fontWeight: '900', marginBottom: 10, textAlign: 'center' },
  message: { color: '#A6A6A6', fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 18, maxWidth: 360 },
  button: {
    backgroundColor: '#202020',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    borderRadius: 14,
    minHeight: 48,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    maxWidth: 320,
  },
  secondaryButton: {
    marginTop: 10,
    backgroundColor: '#151515',
  },
  buttonText: { color: '#FFFFFF', fontWeight: '800' },
});
