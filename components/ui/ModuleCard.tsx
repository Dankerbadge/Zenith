import React, { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { NEON_THEME } from '../../constants/neonTheme';

import GlassCard from './GlassCard';

export type ModuleCardVariant = 'standard' | 'hero' | 'list';

export default function ModuleCard(props: {
  title: string;
  subtitle?: string;
  rightAction?: { label: string; onPress: () => void; disabled?: boolean };
  children: ReactNode;
  variant?: ModuleCardVariant;
}) {
  const variant: ModuleCardVariant = props.variant || 'standard';
  const titleStyle = variant === 'hero' ? styles.titleHero : styles.title;

  return (
    <GlassCard style={styles.card}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={titleStyle}>{props.title}</Text>
          {props.subtitle ? <Text style={styles.subtitle}>{props.subtitle}</Text> : null}
        </View>
        {props.rightAction ? (
          <Pressable
            onPress={props.rightAction.onPress}
            disabled={props.rightAction.disabled}
            style={({ pressed }) => [styles.rightBtn, props.rightAction?.disabled && styles.rightBtnDisabled, pressed && styles.rightBtnPressed]}
          >
            <Text style={styles.rightText}>{props.rightAction.label}</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={variant === 'list' ? styles.bodyList : styles.body}>{props.children}</View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: { padding: NEON_THEME.spacing[16] },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  title: { color: NEON_THEME.color.textPrimary, ...NEON_THEME.typography.cardTitle, letterSpacing: 0.2 },
  titleHero: { color: NEON_THEME.color.textPrimary, ...NEON_THEME.typography.cardTitle, fontSize: 18, lineHeight: 22 },
  subtitle: { color: NEON_THEME.color.textSecondary, marginTop: 6, fontWeight: '700' },
  rightBtn: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: NEON_THEME.radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(14,210,244,0.56)',
    backgroundColor: 'rgba(14,210,244,0.18)',
    shadowColor: NEON_THEME.color.neonCyan,
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    alignItems: 'center',
    justifyContent: 'center',
  },
  rightBtnDisabled: { opacity: 0.55 },
  rightBtnPressed: { opacity: 0.92, transform: [{ scale: 0.99 }] },
  rightText: { color: NEON_THEME.color.textPrimary, fontWeight: '900', fontSize: 12 },
  body: { marginTop: 10 },
  bodyList: { marginTop: 10, gap: 10 },
});
