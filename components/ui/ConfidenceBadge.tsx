import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export type ConfidenceTier = 'HIGH' | 'MEDIUM' | 'LOW';

function tierColor(tier: ConfidenceTier) {
  switch (tier) {
    case 'HIGH':
      return { bg: 'rgba(0,255,136,0.14)', border: 'rgba(0,255,136,0.30)', text: '#00FF88' };
    case 'MEDIUM':
      return { bg: 'rgba(255,209,93,0.14)', border: 'rgba(255,209,93,0.30)', text: '#FFD15D' };
    case 'LOW':
    default:
      return { bg: 'rgba(255,79,106,0.12)', border: 'rgba(255,79,106,0.26)', text: '#FF4F6A' };
  }
}

export default function ConfidenceBadge(props: { tier: ConfidenceTier; label?: string }) {
  const c = tierColor(props.tier);
  return (
    <View style={[styles.badge, { backgroundColor: c.bg, borderColor: c.border }]}>
      <Text style={[styles.text, { color: c.text }]}>{props.label || props.tier}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignSelf: 'flex-start',
  },
  text: {
    fontWeight: '900',
    fontSize: 11,
    letterSpacing: 0.3,
  },
});

