import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { NEON_THEME } from '../../constants/neonTheme';

import Badge from './Badge';
import GlassCard from './GlassCard';
import ProgressBar from './ProgressBar';

function softHaptic() {
  if (process.env.EXPO_OS === 'ios') {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
}

export default function HeroCard(props: {
  name: string;
  handle: string;
  email?: string;
  avatarLabel: string;
  badges: { label: string; tone?: 'neutral' | 'muted' | 'accent' | 'success' | 'warning' | 'danger' }[];
  xpLine: string;
  xpProgress: number;
  xpColor?: string;
  onPressXp?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <GlassCard style={styles.card}>
      <View style={styles.topRow}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{props.avatarLabel}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.name} numberOfLines={1}>
            {props.name}
          </Text>
          <Text style={styles.handle} numberOfLines={1}>
            {props.handle}
          </Text>
          {props.email ? (
            <Text style={styles.email} numberOfLines={1}>
              {props.email}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.badgesRow}>
        {props.badges.map((b, idx) => (
          <Badge key={`${b.label}_${idx}`} label={b.label} tone={b.tone} />
        ))}
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => {
          softHaptic();
          props.onPressXp?.();
        }}
        style={({ pressed }) => [styles.xpArea, pressed && styles.pressed]}
      >
        <Text style={styles.xpLine} numberOfLines={2}>
          {props.xpLine}
        </Text>
        <ProgressBar progress={props.xpProgress} color={props.xpColor || '#00D9FF'} height={7} />
      </Pressable>

      {props.children ? <View style={{ marginTop: 12 }}>{props.children}</View> : null}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: NEON_THEME.spacing[16],
    borderColor: NEON_THEME.color.strokeSubtle,
    backgroundColor: NEON_THEME.color.surface0,
    shadowOpacity: 0.22,
    elevation: 5,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 70,
    height: 70,
    borderRadius: NEON_THEME.radius.small,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(14,210,244,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(14,210,244,0.56)',
  },
  avatarText: { color: NEON_THEME.color.textPrimary, fontWeight: '900', fontSize: 26 },
  name: { color: NEON_THEME.color.textPrimary, fontSize: 26, fontWeight: '900' },
  handle: { color: NEON_THEME.color.neonCyan, fontWeight: '800', marginTop: 2 },
  email: { color: NEON_THEME.color.textSecondary, fontWeight: '700', fontSize: 12, marginTop: 4 },
  badgesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  xpArea: { marginTop: 12 },
  xpLine: { color: NEON_THEME.color.textSecondary, fontWeight: '800', marginBottom: 10, lineHeight: 18 },
  pressed: { opacity: 0.96, transform: [{ scale: 0.997 }] },
});
