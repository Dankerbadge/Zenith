import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

export function SkeletonBlock(props: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.block, props.style]} />;
}

export function SkeletonLine(props: { width?: ViewStyle['width']; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.line, props.width != null ? { width: props.width } : null, props.style]} />;
}

const styles = StyleSheet.create({
  block: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
  },
  line: {
    height: 12,
    borderRadius: 8,
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
});
