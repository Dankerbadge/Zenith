import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { NEON_THEME } from '../../constants/neonTheme';

export default function SectionHeader({
  title,
  onViewMore,
  actionLabel,
}: {
  title: string;
  onViewMore?: () => void;
  actionLabel?: string;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.title}>{title}</Text>
      {onViewMore ? (
        <Pressable onPress={onViewMore}>
          <Text style={styles.more}>{actionLabel || 'View more'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    marginTop: NEON_THEME.spacing[24],
    marginBottom: NEON_THEME.spacing[12],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: NEON_THEME.color.textSecondary,
    ...NEON_THEME.typography.sectionLabel,
    textTransform: 'uppercase',
  },
  more: {
    color: NEON_THEME.color.neonCyan,
    fontSize: 12,
    fontWeight: '800',
  },
});
