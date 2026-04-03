import { LinearGradient } from 'expo-linear-gradient';
import React, { useId } from 'react';
import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { STATS_HIGHLIGHT_GLOSS, statsHighlightBorder, statsHighlightRail, statsHighlightWash } from './statsHighlight';
import { NEON_THEME } from '../../constants/neonTheme';

type Gradient2 = readonly [string, string];
const AUTO_COLORS = ['#00D9FF', '#4E5BFF', '#A855F7', '#34D399', '#FFB000', '#FF6A00', '#60A5FA'] as const;

function hashString(input: string) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export default function ActionCard({
  emoji,
  label,
  subtitle,
  meta,
  colors,
  tintColor,
  onPress,
  onLongPress,
  style,
}: {
  emoji: string;
  label: string;
  subtitle?: string;
  meta?: string;
  colors?: Gradient2;
  tintColor?: string;
  onPress: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const id = useId();
  const auto = AUTO_COLORS[hashString(id) % AUTO_COLORS.length];
  const wash = tintColor || auto;
  const content = (
    <View style={styles.row}>
      <Text style={styles.emoji}>{emoji}</Text>
      <View style={styles.textCol}>
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
        {meta ? (
          <Text style={styles.meta} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
    </View>
  );

  return (
    <Pressable
      accessibilityRole="button"
      pressRetentionOffset={{ top: 0, bottom: 0, left: 0, right: 0 }}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [style, pressed && styles.pressed]}
    >
      {colors ? (
        <LinearGradient colors={colors} style={[styles.card, styles.cardBorder]}>
          {content}
        </LinearGradient>
      ) : (
        <View
          style={[
            styles.card,
            styles.cardBorder,
            tintColor ? { backgroundColor: tintColor } : null,
            { borderColor: statsHighlightBorder(wash) },
          ]}
        >
          <LinearGradient
            pointerEvents="none"
            colors={statsHighlightWash(wash)}
            start={{ x: 0.1, y: 0.0 }}
            end={{ x: 0.9, y: 1.0 }}
            style={StyleSheet.absoluteFillObject}
          />
          <LinearGradient
            pointerEvents="none"
            colors={STATS_HIGHLIGHT_GLOSS}
            start={{ x: 0.5, y: 0.0 }}
            end={{ x: 0.5, y: 1.0 }}
            style={StyleSheet.absoluteFillObject}
          />
          <LinearGradient
            pointerEvents="none"
            colors={statsHighlightRail(wash)}
            start={{ x: 0.5, y: 0.0 }}
            end={{ x: 0.5, y: 1.0 }}
            style={styles.leftRail}
          />
          {content}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: NEON_THEME.radius.small,
    height: 72,
    padding: NEON_THEME.spacing[12],
    justifyContent: 'center',
    backgroundColor: NEON_THEME.color.surface0,
  },
  cardBorder: {
    borderWidth: 1,
    borderColor: NEON_THEME.color.strokeSubtle,
  },
  leftRail: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    opacity: 0.95,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  textCol: { flex: 1, justifyContent: 'center' },
  emoji: { fontSize: 22 },
  label: { color: NEON_THEME.color.textPrimary, fontWeight: '900', fontSize: 14 },
  subtitle: { color: NEON_THEME.color.textSecondary, fontWeight: '800', fontSize: 12, marginTop: 2 },
  meta: { color: NEON_THEME.color.textSecondary, fontWeight: '700', fontSize: 11, marginTop: 1 },
  pressed: { opacity: 0.95, transform: [{ scale: 0.99 }] },
});
