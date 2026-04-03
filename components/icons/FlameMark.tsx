import React from 'react';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { StyleSheet, View } from 'react-native';

export default function FlameMark(props: { size?: number; color?: string; style?: any }) {
  const size = Number.isFinite(Number(props.size)) ? Number(props.size) : 18;
  const color = typeof props.color === 'string' && props.color ? props.color : '#FF9F0A';

  return (
    <View style={[styles.wrap, { width: size, height: size }, props.style]}>
      <MaterialCommunityIcons name="fire" size={size} color={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
});
