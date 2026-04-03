import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import GlassCard from './GlassCard';

function softHaptic() {
  if (process.env.EXPO_OS === 'ios') {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
}

export default function StatTile(props: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  accent?: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const accent = typeof props.accent === 'string' && props.accent ? props.accent : null;
  const content = (
    <GlassCard style={[styles.card, props.style]} highlightColor={accent || undefined}>
      <View style={styles.header}>
        <View style={styles.iconWrap}>
          {typeof props.icon === 'string' ? <Text style={styles.iconText}>{props.icon}</Text> : props.icon}
        </View>
        <Text style={styles.label} numberOfLines={1}>
          {props.label}
        </Text>
      </View>
      <Text style={styles.value} numberOfLines={1}>
        {props.value}
      </Text>
      {props.hint ? (
        <Text style={styles.hint} numberOfLines={1}>
          {props.hint}
        </Text>
      ) : (
        <View style={{ height: 16 }} />
      )}
    </GlassCard>
  );

  if (!props.onPress) return content;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        softHaptic();
        props.onPress?.();
      }}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, minHeight: 92, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconWrap: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  iconText: { fontSize: 14 },
  label: { color: 'rgba(255,255,255,0.65)', fontWeight: '800', fontSize: 12, letterSpacing: 0.4, flex: 1 },
  value: { color: '#FFF', fontWeight: '900', fontSize: 20, marginTop: 6 },
  hint: { color: 'rgba(255,255,255,0.60)', fontWeight: '700', fontSize: 12, marginTop: 2 },
  pressed: { opacity: 0.96, transform: [{ scale: 0.995 }] },
});
