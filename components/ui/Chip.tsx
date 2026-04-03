import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { NEON_THEME } from '../../constants/neonTheme';

export default function Chip({
  label,
  active,
  disabled,
  onPress,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled), selected: Boolean(active) }}
      pressRetentionOffset={{ top: 0, bottom: 0, left: 0, right: 0 }}
      disabled={Boolean(disabled)}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, active && styles.active, disabled && styles.disabled, pressed && !disabled && styles.pressed]}
    >
      <Text style={[styles.text, active && styles.activeText, disabled && styles.disabledText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 34,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: NEON_THEME.radius.pill,
    borderWidth: 1,
    borderColor: NEON_THEME.color.strokeSubtle,
    backgroundColor: NEON_THEME.color.surface1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  active: {
    borderColor: 'rgba(14,210,244,0.56)',
    backgroundColor: 'rgba(14,210,244,0.18)',
    shadowColor: NEON_THEME.color.neonCyan,
    shadowOpacity: 0.30,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 3,
  },
  disabled: {
    borderColor: '#2F2F2F',
    backgroundColor: '#121212',
    opacity: 0.7,
  },
  text: { color: NEON_THEME.color.textSecondary, fontWeight: '700', fontSize: 12 },
  activeText: { color: NEON_THEME.color.textPrimary },
  disabledText: { color: '#8C8C8C' },
  pressed: { opacity: 0.92, transform: [{ scale: 0.99 }] },
});
