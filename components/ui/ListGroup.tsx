import React, { type ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { NEON_THEME } from '../../constants/neonTheme';

export default function ListGroup(props: {
  title?: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: 'default' | 'danger';
}) {
  const tone = props.tone || 'default';
  return (
    <View style={props.style}>
      {props.title ? <Text style={[styles.title, tone === 'danger' && styles.titleDanger]}>{props.title}</Text> : null}
      <View style={[styles.group, tone === 'danger' && styles.groupDanger]}>{props.children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    marginTop: NEON_THEME.spacing[24],
    marginBottom: NEON_THEME.spacing[12],
    color: NEON_THEME.color.textSecondary,
    ...NEON_THEME.typography.sectionLabel,
    textTransform: 'uppercase',
  },
  titleDanger: { color: '#FCA5A5' },
  group: {
    borderRadius: NEON_THEME.radius.card,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: NEON_THEME.color.strokeSubtle,
    backgroundColor: NEON_THEME.color.surface0,
  },
  groupDanger: {
    borderColor: 'rgba(248,113,113,0.28)',
    backgroundColor: 'rgba(248,113,113,0.06)',
  },
});
