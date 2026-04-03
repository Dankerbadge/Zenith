import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

export default function ModalHeader(props: {
  title: string;
  onBack: () => void;
  backLabel?: string;
  rightLabel?: string;
  onRight?: () => void;
  rightDisabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const backLabel = props.backLabel || 'Back';
  const rightLabel = props.rightLabel || 'Done';

  return (
    <View style={[styles.header, props.style]}>
      <Pressable accessibilityRole="button" onPress={props.onBack} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
        <Text style={styles.actionText}>{backLabel}</Text>
      </Pressable>
      <Text style={styles.title} numberOfLines={1}>
        {props.title}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={props.onRight}
        disabled={props.rightDisabled || !props.onRight}
        style={({ pressed }) => [styles.action, (props.rightDisabled || !props.onRight) && styles.actionDisabled, pressed && styles.pressed]}
      >
        <Text style={[styles.actionText, (props.rightDisabled || !props.onRight) && styles.actionTextDisabled]}>{rightLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  action: { minWidth: 56, minHeight: 44, justifyContent: 'center' },
  actionDisabled: { opacity: 0.55 },
  actionText: { color: '#00D9FF', fontWeight: '800' },
  actionTextDisabled: { color: 'rgba(0,217,255,0.65)' },
  title: { color: '#FFF', fontSize: 22, fontWeight: '900' },
  pressed: { opacity: 0.86, transform: [{ scale: 0.99 }] },
});

