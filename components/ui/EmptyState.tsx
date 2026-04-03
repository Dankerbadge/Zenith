import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export default function EmptyState(props: {
  title: string;
  body?: string;
  icon?: string;
  primaryAction?: { label: string; onPress: () => void; disabled?: boolean };
  secondaryAction?: { label: string; onPress: () => void; disabled?: boolean };
}) {
  return (
    <View style={styles.wrap}>
      {props.icon ? <Text style={styles.icon}>{props.icon}</Text> : null}
      <Text style={styles.title}>{props.title}</Text>
      {props.body ? <Text style={styles.body}>{props.body}</Text> : null}

      {props.primaryAction ? (
        <Pressable
          style={[styles.primaryBtn, props.primaryAction.disabled && styles.disabled]}
          onPress={props.primaryAction.onPress}
          disabled={props.primaryAction.disabled}
        >
          <Text style={styles.primaryText}>{props.primaryAction.label}</Text>
        </Pressable>
      ) : null}

      {props.secondaryAction ? (
        <Pressable
          style={[styles.secondaryBtn, props.secondaryAction.disabled && styles.disabled]}
          onPress={props.secondaryAction.onPress}
          disabled={props.secondaryAction.disabled}
        >
          <Text style={styles.secondaryText}>{props.secondaryAction.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: 12, alignItems: 'center' },
  icon: { fontSize: 22, marginBottom: 8 },
  title: { color: '#FFFFFF', fontWeight: '900', textAlign: 'center' },
  body: { color: '#9BB9C2', marginTop: 6, fontWeight: '700', textAlign: 'center' },
  primaryBtn: {
    marginTop: 12,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: '#00D9FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: '#001018', fontWeight: '900' },
  secondaryBtn: {
    marginTop: 10,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: 'rgba(20,20,20,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { color: '#D7F2FA', fontWeight: '900' },
  disabled: { opacity: 0.55 },
});

