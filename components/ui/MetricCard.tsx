import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import GlassCard from './GlassCard';
import { NEON_THEME } from '../../constants/neonTheme';

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

function hexToRgba(hex: string, alpha: number) {
  const raw = hex.replace('#', '').trim();
  if (raw.length !== 6) return `rgba(255,255,255,${alpha})`;
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  if (![r, g, b].every(Number.isFinite)) return `rgba(255,255,255,${alpha})`;
  return `rgba(${r},${g},${b},${alpha})`;
}

export default function MetricCard({
  label,
  value,
  hint,
  progress,
  color = '#FFFFFF',
  icon,
  onPress,
  onLongPress,
}: {
  label: string;
  value: string;
  hint?: string;
  progress?: number;
  color?: string;
  icon?: 'local-fire-department' | 'water-drop' | 'fitness-center' | 'timer';
  onPress?: () => void;
  onLongPress?: () => void;
}) {
  const progress01 = typeof progress === 'number' ? clamp01(progress) : undefined;
  const complete = typeof progress01 === 'number' && progress01 >= 1;

  const backgroundTint = hexToRgba(color, complete ? 0.14 : 0.1);
  const labelColor = NEON_THEME.color.textSecondary;
  const hintColor = NEON_THEME.color.textSecondary;
  const content = (
    <GlassCard
      highlightColor={color}
      style={[
        styles.card,
        {
          backgroundColor: backgroundTint,
          borderColor: complete ? hexToRgba(color, 0.38) : 'rgba(255,255,255,0.10)',
        },
        complete
          ? {
              shadowColor: color,
              shadowOpacity: 0.28,
              shadowRadius: 14,
              shadowOffset: { width: 0, height: 6 },
              elevation: 5,
            }
          : null,
      ]}
    >
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          {icon ? <MaterialIcons name={icon} size={18} color={color} /> : null}
          <Text style={[styles.label, { color: labelColor }]}>{label}</Text>
        </View>
        {complete ? (
          <View style={styles.completePill}>
            <Text style={styles.completeText}>Complete</Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.value, { color, textShadowColor: hexToRgba(color, 0.35) }]}>{value}</Text>
      {hint ? <Text style={[styles.hint, { color: hintColor }]}>{hint}</Text> : null}
      {typeof progress === 'number' ? (
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${(progress01 || 0) * 100}%`, backgroundColor: color }]} />
        </View>
      ) : null}
    </GlassCard>
  );

  if (!onPress && !onLongPress) return content;

  return (
    <Pressable
      accessibilityRole="button"
      pressRetentionOffset={{ top: 0, bottom: 0, left: 0, right: 0 }}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontWeight: '800', fontSize: 12, letterSpacing: 0.4 },
  completePill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  completeText: { color: '#EAFBFF', fontWeight: '900', fontSize: 11, letterSpacing: 0.2 },
  value: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: '900',
    marginTop: 2,
    textShadowColor: 'rgba(255,255,255,0.10)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  hint: { marginTop: 4, fontWeight: '700', fontSize: 12 },
  track: {
    marginTop: 10,
    height: 8,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  fill: { height: 8, borderRadius: 999 },
  pressed: { opacity: 0.96, transform: [{ scale: 0.995 }] },
});
