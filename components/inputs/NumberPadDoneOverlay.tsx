import React, { useEffect, useState } from 'react';
import { Keyboard, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { getNumberPadDismissHandler, setNumberPadAccessoryActive, subscribeNumberPadAccessory } from '../../utils/numberPadAccessory';

export default function NumberPadDoneOverlay() {
  const [active, setActive] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => subscribeNumberPadAccessory(setActive), []);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;

    const onShow = (e: any) => {
      const h = Number(e?.endCoordinates?.height) || 0;
      setKeyboardHeight(h);
    };
    const onHide = () => setKeyboardHeight(0);

    const showSub = Keyboard.addListener('keyboardDidShow', onShow);
    const hideSub = Keyboard.addListener('keyboardDidHide', onHide);
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  if (Platform.OS !== 'ios') return null;
  // Show only when a numeric-pad style input has explicitly opted-in via `NumberPadTextInput`.
  // A full-screen Modal blocks interaction behind it; keeping this gated prevents breaking scroll/search UX.
  if (!active) return null;
  if (keyboardHeight <= 0) return null;

  // Place the bar at the top edge of the keyboard. Using the raw keyboard height avoids
  // burying the button behind the keyboard on devices with a home indicator.
  const bottomOffset = Math.max(0, keyboardHeight);

  return (
    <Modal
      visible
      transparent
      animationType="none"
      presentationStyle="overFullScreen"
      onRequestClose={() => {}}
    >
      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        <View style={[styles.bar, { bottom: bottomOffset }]}>
          <Pressable
            onPress={() => {
              const handler = getNumberPadDismissHandler();
              if (handler) {
                try {
                  handler();
                } catch {
                  Keyboard.dismiss();
                }
              } else {
                Keyboard.dismiss();
              }
              if (active) setNumberPadAccessoryActive(false);
            }}
            style={styles.doneBtn}
            hitSlop={10}
          >
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    paddingVertical: 10,
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
  doneText: { color: '#FFFFFF', fontWeight: '800' },
});
