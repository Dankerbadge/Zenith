import { LinearGradient } from 'expo-linear-gradient';
import React, { type ReactNode, useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { NEON_THEME } from '../../constants/neonTheme';

type Gradient2 = readonly [string, string];
type Gradient3 = readonly [string, string, string];

export default function Screen(props: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  edges?: Edge[];
  aura?: boolean;
  auraColors?: Gradient2 | Gradient3;
}) {
  const { height } = useWindowDimensions();

  const auraHeight = useMemo(() => {
    // Keep the aura proportional so it feels consistent across device sizes.
    const h = Math.round(height * 0.32);
    return Math.max(220, Math.min(340, h));
  }, [height]);

  const colors = props.auraColors || ([NEON_THEME.color.bgTopTint, '#071A20', NEON_THEME.color.bg0] as const);

  return (
    <SafeAreaView edges={props.edges} style={[styles.screen, props.style]}>
      <View pointerEvents="none" style={[styles.auraWrap, { height: auraHeight }]}>
        <LinearGradient colors={colors} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFill} />
        <View style={styles.auraFade} />
      </View>
      {props.aura ? (
        <View pointerEvents="none" style={[styles.auraWrap, { height: auraHeight }]}>
          <LinearGradient
            colors={['rgba(14,210,244,0.20)', 'rgba(187,78,242,0.12)']}
            start={{ x: 0.05, y: 0.05 }}
            end={{ x: 0.95, y: 0.9 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.auraFade} />
        </View>
      ) : null}
      <View style={[styles.content, props.contentStyle]}>{props.children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: NEON_THEME.color.bg0 },
  content: { flex: 1 },
  auraWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    overflow: 'hidden',
  },
  auraFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -1,
    height: 120,
    backgroundColor: NEON_THEME.color.bg0,
    opacity: 0.86,
  },
});
