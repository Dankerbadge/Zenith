import React from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import { neonColorFor, type NeonSemantic } from '../../constants/neonTheme';
import GlassCard from './GlassCard';

export default function NeonCard(props: {
  semantic: NeonSemantic;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  onLongPress?: () => void;
}) {
  return (
    <GlassCard
      style={props.style}
      highlightColor={neonColorFor(props.semantic)}
      onPress={props.onPress}
      onLongPress={props.onLongPress}
      autoHighlight={false}
    >
      {props.children}
    </GlassCard>
  );
}

