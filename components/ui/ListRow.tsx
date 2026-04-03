import React, { type ReactNode, useMemo } from 'react';
import { Pressable, StyleSheet, Switch, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { IconSymbol } from './icon-symbol';
import { STATS_HIGHLIGHT_GLOSS, statsHighlightBorder, statsHighlightRail, statsHighlightWash } from './statsHighlight';
import { NEON_THEME } from '../../constants/neonTheme';

function softHaptic() {
  if (process.env.EXPO_OS === 'ios') {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
}

function dangerHaptic() {
  if (process.env.EXPO_OS === 'ios') {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }
}

export default function ListRow(props: {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  value?: string;
  onPress?: () => void;
  right?: ReactNode;
  showChevron?: boolean;
  isLast?: boolean;
  tone?: 'default' | 'danger';
  highlightColor?: string;
  style?: StyleProp<ViewStyle>;
  switchValue?: boolean;
  onToggle?: (next: boolean) => void;
}) {
  const pressable = Boolean(props.onPress);
  const isSwitch = typeof props.switchValue === 'boolean' && typeof props.onToggle === 'function';
  const tone = props.tone || 'default';

  const row = (
    <View style={[styles.row, props.highlightColor ? { borderColor: statsHighlightBorder(props.highlightColor), borderWidth: 1 } : null, props.style]}>
      {props.highlightColor ? (
        <>
          <LinearGradient
            pointerEvents="none"
            colors={statsHighlightWash(props.highlightColor)}
            start={{ x: 0.1, y: 0.0 }}
            end={{ x: 0.9, y: 1.0 }}
            style={StyleSheet.absoluteFillObject}
          />
          <LinearGradient
            pointerEvents="none"
            colors={STATS_HIGHLIGHT_GLOSS}
            start={{ x: 0.5, y: 0.0 }}
            end={{ x: 0.5, y: 1.0 }}
            style={StyleSheet.absoluteFillObject}
          />
          <LinearGradient
            pointerEvents="none"
            colors={statsHighlightRail(props.highlightColor)}
            start={{ x: 0.5, y: 0.0 }}
            end={{ x: 0.5, y: 1.0 }}
            style={styles.leftRail}
          />
        </>
      ) : null}
      <View style={styles.left}>
        {props.icon ? <View style={styles.icon}>{props.icon}</View> : null}
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, tone === 'danger' && styles.dangerText]} numberOfLines={1}>
            {props.title}
          </Text>
          {props.subtitle ? (
            <Text style={styles.subtitle} numberOfLines={2}>
              {props.subtitle}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.right}>
        {props.value ? (
          <Text style={[styles.value, tone === 'danger' && styles.dangerText]} numberOfLines={1}>
            {props.value}
          </Text>
        ) : null}
        {props.right
          ? props.right
          : isSwitch
          ? (
            <Switch
              value={Boolean(props.switchValue)}
              onValueChange={(next) => {
                softHaptic();
                props.onToggle?.(next);
              }}
            />
          )
          : props.showChevron !== false && pressable
          ? (
            <IconSymbol name="chevron.right" size={18} color={tone === 'danger' ? '#FCA5A5' : 'rgba(255,255,255,0.55)'} />
          )
          : null}
      </View>
    </View>
  );

  const dividerStyle = useMemo(
    () => [styles.divider, props.isLast && styles.dividerHidden, tone === 'danger' && styles.dividerDanger],
    [props.isLast, tone]
  );

  if (!pressable) {
    return (
      <View>
        {row}
        <View style={dividerStyle} />
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        if (tone === 'danger') dangerHaptic();
        else softHaptic();
        props.onPress?.();
      }}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      {row}
      <View style={dividerStyle} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 54,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    overflow: 'hidden',
  },
  left: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: {
    width: 30,
    height: 30,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: NEON_THEME.color.strokeSubtle,
  },
  title: { color: NEON_THEME.color.textPrimary, fontWeight: '900' },
  subtitle: { marginTop: 3, color: NEON_THEME.color.textSecondary, fontWeight: '700', fontSize: 12 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  value: { color: NEON_THEME.color.textSecondary, fontWeight: '800' },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginLeft: 16 },
  dividerDanger: { backgroundColor: 'rgba(248,113,113,0.20)' },
  dividerHidden: { opacity: 0 },
  pressed: { opacity: 0.96, transform: [{ scale: 0.997 }] },
  dangerText: { color: '#FCA5A5' },
  leftRail: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    opacity: 0.95,
  },
});
