import React from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { neonColorFor, type NeonSemantic, NEON_THEME } from '../../constants/neonTheme';

export default function NeonButton(props: {
  label: string;
  semantic?: NeonSemantic;
  variant?: 'primary' | 'secondary' | 'ghost';
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const semantic = props.semantic || 'readiness';
  const accent = neonColorFor(semantic);
  const variant = props.variant || 'secondary';

  return (
    <Pressable
      accessibilityRole="button"
      disabled={Boolean(props.disabled)}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' ? { backgroundColor: `${accent}33`, borderColor: `${accent}99` } : null,
        variant === 'secondary' ? { backgroundColor: `${accent}1F`, borderColor: `${accent}88` } : null,
        variant === 'ghost' ? { backgroundColor: 'transparent', borderColor: NEON_THEME.color.strokeStrong } : null,
        props.disabled && styles.disabled,
        pressed && styles.pressed,
        props.style,
      ]}
    >
      <Text style={[styles.text, { color: variant === 'ghost' ? NEON_THEME.color.textPrimary : accent }]}>{props.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontSize: 14,
    fontWeight: '900',
    textShadowColor: 'rgba(255,255,255,0.08)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.92, transform: [{ scale: 0.99 }] },
});

