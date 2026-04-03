import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { NEON_THEME } from '../../constants/neonTheme';

export type BadgeTone = 'neutral' | 'muted' | 'accent' | 'success' | 'warning' | 'danger';

function toneStyles(tone: BadgeTone) {
  switch (tone) {
    case 'accent':
      return { bg: 'rgba(14,210,244,0.16)', border: 'rgba(14,210,244,0.55)', text: NEON_THEME.color.textPrimary } as const;
    case 'success':
      return { bg: 'rgba(127,249,96,0.16)', border: 'rgba(127,249,96,0.55)', text: NEON_THEME.color.textPrimary } as const;
    case 'warning':
      return { bg: 'rgba(245,168,16,0.16)', border: 'rgba(245,168,16,0.55)', text: NEON_THEME.color.textPrimary } as const;
    case 'danger':
      return { bg: 'rgba(255,77,109,0.14)', border: 'rgba(255,77,109,0.55)', text: NEON_THEME.color.textPrimary } as const;
    case 'muted':
      return { bg: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.12)', text: NEON_THEME.color.textSecondary } as const;
    case 'neutral':
    default:
      return { bg: 'rgba(255,255,255,0.07)', border: 'rgba(255,255,255,0.16)', text: NEON_THEME.color.textPrimary } as const;
  }
}

export default function Badge(props: {
  label: string;
  tone?: BadgeTone;
  style?: StyleProp<ViewStyle>;
}) {
  const tone = props.tone || 'neutral';
  const colors = toneStyles(tone);

  return (
    <View style={[styles.badge, { backgroundColor: colors.bg, borderColor: colors.border }, props.style]}>
      <Text style={[styles.text, { color: colors.text }]} numberOfLines={1}>
        {props.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  text: { fontWeight: '900', fontSize: 11, letterSpacing: 0.2 },
});
