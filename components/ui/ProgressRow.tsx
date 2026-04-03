import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import ProgressBar from './ProgressBar';
import { NEON_THEME } from '../../constants/neonTheme';

function softHaptic() {
  if (process.env.EXPO_OS === 'ios') {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
}

export default function ProgressRow(props: {
  title: string;
  value: string;
  progress: number;
  color?: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const row = (
    <View style={[styles.row, props.style]}>
      <View style={styles.top}>
        <Text style={styles.title} numberOfLines={1}>
          {props.title}
        </Text>
        <Text style={styles.value} numberOfLines={1}>
          {props.value}
        </Text>
      </View>
      <ProgressBar progress={props.progress} color={props.color} height={7} />
    </View>
  );

  if (!props.onPress) return row;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        softHaptic();
        props.onPress?.();
      }}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      {row}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: NEON_THEME.spacing[12] },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 },
  title: { color: NEON_THEME.color.textPrimary, fontWeight: '900' },
  value: { color: NEON_THEME.color.textSecondary, fontWeight: '800' },
  pressed: { opacity: 0.96, transform: [{ scale: 0.997 }] },
});
