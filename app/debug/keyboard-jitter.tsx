import React, { useEffect, useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Switch, Text, View, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import NumberPadTextInput from '../../components/inputs/NumberPadTextInput';
import { installKeyboardEventLogging, kbjClear, kbjGetLines, kbjLog, kbjSubscribe } from '../../utils/debugKeyboardJitter';
import { useDebugRenderCount } from '../../utils/useDebugRenderCount';

export default function DebugKeyboardJitterScreen() {
  useDebugRenderCount('DebugKeyboardJitterScreen');

  const [useKav, setUseKav] = useState(true);
  const [useScroll, setUseScroll] = useState(true);
  const [controlled, setControlled] = useState(true);
  const [autoFocus, setAutoFocus] = useState(false);
  const [logText, setLogText] = useState(() => kbjGetLines().join('\n'));

  const [value, setValue] = useState('');
  const [uncontrolledSeed, setUncontrolledSeed] = useState(() => String(Date.now()));

  useEffect(() => installKeyboardEventLogging('DebugKeyboardJitterScreen'), []);
  useEffect(() => {
    const unsub = kbjSubscribe(() => {
      // Keep updates cheap: only materialize the whole buffer when a new line arrives.
      setLogText(kbjGetLines().join('\n'));
    });
    setLogText(kbjGetLines().join('\n'));
    return () => unsub();
  }, []);

  const content = useMemo(() => {
    const inputProps: any = {
      debugTag: 'debug-numberpad',
      style: styles.input,
      placeholder: '25',
      placeholderTextColor: '#666',
      keyboardType: 'number-pad',
      autoFocus,
      onFocus: () => kbjLog('DebugKeyboardJitterScreen', 'inputFocus'),
      onBlur: () => kbjLog('DebugKeyboardJitterScreen', 'inputBlur'),
    };

    if (controlled) {
      inputProps.value = value;
      inputProps.onChangeText = setValue;
    } else {
      // Uncontrolled isolation mode: the input owns its internal state.
      inputProps.defaultValue = '';
      inputProps.key = `uncontrolled-${uncontrolledSeed}`;
      inputProps.onChangeText = (t: string) => kbjLog('DebugKeyboardJitterScreen', 'uncontrolledChange', { len: t.length });
    }

    return (
      <View style={styles.stack}>
        <Text style={styles.h1}>Keyboard Jitter Repro</Text>
        <Text style={styles.p}>Toggle one switch at a time and reproduce typing jitter on iOS number pad.</Text>

        <View style={styles.row}><Text style={styles.label}>Use KeyboardAvoidingView</Text><Switch value={useKav} onValueChange={setUseKav} /></View>
        <View style={styles.row}><Text style={styles.label}>Use ScrollView</Text><Switch value={useScroll} onValueChange={setUseScroll} /></View>
        <View style={styles.row}><Text style={styles.label}>Controlled input (value prop)</Text><Switch value={controlled} onValueChange={(v) => { setControlled(v); setUncontrolledSeed(String(Date.now())); }} /></View>
        <View style={styles.row}><Text style={styles.label}>autoFocus</Text><Switch value={autoFocus} onValueChange={setAutoFocus} /></View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Number Pad</Text>
          <NumberPadTextInput {...inputProps} />
          {controlled ? <Text style={styles.mono}>{`value=${value}`}</Text> : <Text style={styles.mono}>uncontrolled</Text>}
        </View>

        <View style={styles.card}>
          <View style={styles.logHeader}>
            <Text style={styles.cardTitle}>KBJ Logs (copy/paste)</Text>
            <Text
              style={styles.logAction}
              onPress={() => {
                kbjClear();
                setLogText(kbjGetLines().join('\n'));
              }}
            >
              Clear
            </Text>
          </View>
          <ScrollView style={styles.logBox} contentContainerStyle={{ paddingBottom: 6 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.logText} selectable>
              {logText || '(no logs yet)'}
            </Text>
          </ScrollView>
        </View>

        <Text style={styles.p}>Expected: no repeated focus/blur, no rapid re-renders, no keyboard show/hide loop.</Text>
      </View>
    );
  }, [autoFocus, controlled, logText, uncontrolledSeed, useKav, useScroll, value]);

  const body = useScroll ? (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
    >
      {content}
    </ScrollView>
  ) : (
    <View style={[styles.scrollContent, { flex: 1 }]}>{content}</View>
  );

  const wrapped = useKav ? (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {body}
    </KeyboardAvoidingView>
  ) : (
    body
  );

  return <SafeAreaView style={styles.screen}>{wrapped}</SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0A0A0A' },
  scrollContent: { flexGrow: 1, justifyContent: 'center', padding: 16 },
  stack: { gap: 12 },
  h1: { color: '#FFF', fontSize: 22, fontWeight: '900' },
  p: { color: '#A8A8A8', fontWeight: '600' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { color: '#EAEAEA', fontWeight: '700' },
  card: { borderWidth: 1, borderColor: '#222', backgroundColor: '#121212', borderRadius: 14, padding: 12, gap: 10 },
  cardTitle: { color: '#FFF', fontWeight: '900' },
  input: { backgroundColor: '#0E0E0E', borderWidth: 1, borderColor: '#2A2A2A', borderRadius: 12, color: '#FFF', paddingHorizontal: 12, paddingVertical: 11 },
  mono: { color: '#7EDCFF', fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }), fontSize: 12 },
  logHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  logAction: { color: '#00D9FF', fontWeight: '900' },
  logBox: { maxHeight: 220, borderRadius: 12, borderWidth: 1, borderColor: '#2A2A2A', backgroundColor: '#0B0B0B', paddingHorizontal: 10, paddingVertical: 8 },
  logText: { color: '#D7D7D7', fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }), fontSize: 11, lineHeight: 15 },
});
