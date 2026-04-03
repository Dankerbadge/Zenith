import { LinearGradient } from 'expo-linear-gradient';
import React, { ReactNode, useId } from 'react';
import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { STATS_HIGHLIGHT_GLOSS, statsHighlightBorder, statsHighlightRail, statsHighlightWash } from './statsHighlight';
import { NEON_THEME } from '../../constants/neonTheme';

const AUTO_HIGHLIGHT_COLORS = ['#00D9FF', '#4E5BFF', '#A855F7', '#34D399', '#FFB000', '#FF6A00', '#60A5FA'] as const;

function hashString(input: string) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export default function GlassCard({
  children,
  onPress,
  onLongPress,
  style,
  highlightColor,
  autoHighlight = true,
}: {
  children: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
  highlightColor?: string;
  autoHighlight?: boolean;
}) {
  const id = useId();
  const explicitColor = typeof highlightColor === 'string' && highlightColor.trim().length > 0 ? highlightColor : null;
  const autoColor = autoHighlight ? AUTO_HIGHLIGHT_COLORS[hashString(id) % AUTO_HIGHLIGHT_COLORS.length] : null;
  const washColor = explicitColor || autoColor;
  const content = (
    <View
      style={[
        styles.card,
        washColor
          ? {
              borderColor: statsHighlightBorder(washColor),
              shadowColor: washColor,
              shadowOpacity: 0.22,
              shadowRadius: 16,
              shadowOffset: { width: 0, height: 10 },
            }
          : null,
        style,
      ]}
    >
      {washColor ? (
        <LinearGradient
          pointerEvents="none"
          colors={statsHighlightWash(washColor)}
          start={{ x: 0.1, y: 0.0 }}
          end={{ x: 0.9, y: 1.0 }}
          style={styles.accentWash}
        />
      ) : null}
      {/* Subtle gloss highlight (matches the newer "modern highlight" treatment). */}
      <LinearGradient
        pointerEvents="none"
        colors={STATS_HIGHLIGHT_GLOSS}
        start={{ x: 0.5, y: 0.0 }}
        end={{ x: 0.5, y: 1.0 }}
        style={StyleSheet.absoluteFill}
      />
      {washColor ? (
        <LinearGradient
          pointerEvents="none"
          colors={statsHighlightRail(washColor)}
          start={{ x: 0.5, y: 0.0 }}
          end={{ x: 0.5, y: 1.0 }}
          style={styles.leftRail}
        />
      ) : null}
      {children}
    </View>
  );

  if (!onPress && !onLongPress) {
    return content;
  }

  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => [pressed && styles.pressed]}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: NEON_THEME.color.surface0,
    borderWidth: 1,
    borderColor: NEON_THEME.color.strokeSubtle,
    borderRadius: NEON_THEME.radius.card,
    padding: NEON_THEME.spacing[16],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.16,
    shadowRadius: 10,
    elevation: 3,
    overflow: 'hidden',
  },
  accentWash: { ...StyleSheet.absoluteFillObject, opacity: 0.9 },
  leftRail: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    opacity: 0.95,
  },
  pressed: { opacity: 0.96, transform: [{ scale: 0.995 }] },
});
