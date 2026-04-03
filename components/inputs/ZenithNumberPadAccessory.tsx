import React from 'react';
import { InputAccessoryView, Keyboard, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

// One global accessory avoids per-input nativeID churn, which can cause iOS numeric keyboard
// height/layout thrash (perceived as “keyboard spazzing”) when switching between numeric fields
// or re-rendering during typing.
export const ZENITH_NUMBERPAD_ACCESSORY_ID = 'zenith-numberpad-accessory.v1';

export default function ZenithNumberPadAccessory() {
  if (Platform.OS !== 'ios') return null;

  return (
    <InputAccessoryView nativeID={ZENITH_NUMBERPAD_ACCESSORY_ID}>
      <View style={styles.bar}>
        <Pressable
          onPress={() => {
            // Release responder deterministically (dismiss alone can be flaky in some edge cases).
            try {
              const focused = (TextInput as any)?.State?.currentlyFocusedInput?.() || null;
              if (focused) {
                (TextInput as any)?.State?.blurTextInput?.(focused);
              }
            } catch {
              // Best-effort only.
            }
            Keyboard.dismiss();
          }}
          style={styles.doneBtn}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Done"
        >
          <Text style={styles.doneText}>Done</Text>
        </Pressable>
      </View>
    </InputAccessoryView>
  );
}

const styles = StyleSheet.create({
  bar: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#0E0E0E',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  doneBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#171717',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  doneText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});

