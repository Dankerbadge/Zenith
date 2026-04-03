import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { NEON_THEME } from '../../constants/neonTheme';

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export default function ProgressBar(props: {
  progress: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
  height?: number;
  animate?: boolean;
}) {
  const height = props.height ?? 6;
  const color = props.color ?? NEON_THEME.color.neonCyan;
  const progress = clamp01(Number(props.progress) || 0);
  const animate = props.animate !== false;

  const anim = useRef(new Animated.Value(animate ? 0 : progress)).current;

  useEffect(() => {
    if (!animate) return;
    Animated.timing(anim, {
      toValue: progress,
      duration: 520,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [animate, anim, progress]);

  useEffect(() => {
    if (animate) return;
    anim.setValue(progress);
  }, [animate, anim, progress]);

  const fillStyle = useMemo(
    () => ({
      width: anim.interpolate({
        inputRange: [0, 1],
        outputRange: ['0%', '100%'],
      }),
      backgroundColor: color,
      height,
      shadowColor: color,
      shadowOpacity: 0.36,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 0 },
      elevation: 2,
    }),
    [anim, color, height]
  );

  return (
    <View style={[styles.track, { height, borderRadius: height / 2 }, props.style]}>
      <Animated.View style={[styles.fill, fillStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  fill: {
    borderRadius: 999,
  },
});
