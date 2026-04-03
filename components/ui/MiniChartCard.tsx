import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import GlassCard from './GlassCard';
import { NEON_THEME } from '../../constants/neonTheme';

export default function MiniChartCard({
  title,
  values,
  color,
  caption,
  emptyLabel,
  onPress,
}: {
  title: string;
  values: number[];
  color: string;
  caption?: string;
  emptyLabel?: string;
  onPress?: () => void;
}) {
  const max = Math.max(1, ...values);
  const hasSignal = values.some((value) => value > 0);

  const content = (
    <GlassCard style={styles.card} highlightColor={color}>
      <View style={[styles.accentBar, { backgroundColor: color }]} />
      <View style={styles.content}>
        <Text style={styles.title}>{title}</Text>
        {hasSignal ? (
          <View style={styles.row}>
            {values.map((value, index) => {
              const h = Math.max(0.1, value / max);
              return (
                <View key={`${title}-${index}`} style={styles.track}>
                  <View style={[styles.fill, { height: `${h * 100}%`, backgroundColor: color }]} />
                </View>
              );
            })}
          </View>
        ) : (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyLabel}>{emptyLabel || 'Not enough data yet'}</Text>
          </View>
        )}
        {caption ? <Text style={styles.caption}>{caption}</Text> : null}
      </View>
    </GlassCard>
  );

  if (!onPress) return content;
  return <Pressable onPress={onPress}>{content}</Pressable>;
}

const styles = StyleSheet.create({
  card: {
    padding: 0,
    overflow: 'hidden',
    position: 'relative',
    borderColor: 'rgba(255,255,255,0.06)',
  },
  content: { padding: 14 },
  accentBar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, opacity: 0.85 },
  title: { color: NEON_THEME.color.textPrimary, fontWeight: '800', marginBottom: 10, letterSpacing: 0.2 },
  row: { flexDirection: 'row', gap: 6, alignItems: 'flex-end', height: 72 },
  emptyWrap: {
    height: 72,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  emptyLabel: { color: NEON_THEME.color.textSecondary, fontSize: 12, fontWeight: '600' },
  caption: { marginTop: 8, color: NEON_THEME.color.textSecondary, fontSize: 11, fontWeight: '600' },
  track: {
    flex: 1,
    height: '100%',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 6,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  fill: { width: '100%', borderRadius: 6 },
});
