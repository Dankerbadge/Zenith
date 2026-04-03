import React from 'react';
import {
  Platform,
  TextInput,
  type TextInputProps,
} from 'react-native';
import { DEBUG_KEYBOARD_JITTER, kbjLog } from '../../utils/debugKeyboardJitter';
import { useDebugRenderCount } from '../../utils/useDebugRenderCount';
import { warnIfKeyboardAvoidanceConflict } from '../../utils/keyboardAvoidanceRegistry';
import { ZENITH_NUMBERPAD_ACCESSORY_ID } from './ZenithNumberPadAccessory';

type Props = TextInputProps & {
  debugTag?: string;
};

function needsAccessory(keyboardType: TextInputProps['keyboardType']) {
  return keyboardType === 'number-pad' || keyboardType === 'decimal-pad' || keyboardType === 'numeric';
}

type TextInputHandle = React.ElementRef<typeof TextInput>;

const NumberPadTextInput = React.forwardRef<TextInputHandle, Props>(function NumberPadTextInput(props, ref) {
  const debugTag = props.debugTag ? `NumberPadTextInput:${props.debugTag}` : 'NumberPadTextInput';
  useDebugRenderCount(debugTag);

  const showAccessory = Platform.OS === 'ios' && needsAccessory(props.keyboardType);
  const effectiveBlurOnSubmit = props.blurOnSubmit ?? !showAccessory;

  // In production, do not attach extra native event handlers (selection/contentSize/layout)
  // because they force high-frequency events over the bridge on every keystroke and can
  // manifest as perceived "keyboard jitter" on iOS numeric pads.
  const debugEnabled = DEBUG_KEYBOARD_JITTER;

  const onLayout: TextInputProps['onLayout'] = debugEnabled
    ? (e) => {
        props.onLayout?.(e);
        kbjLog(debugTag, 'onLayout', { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height, y: e.nativeEvent.layout.y });
      }
    : props.onLayout;

  const onContentSizeChange: TextInputProps['onContentSizeChange'] = debugEnabled
    ? (e) => {
        props.onContentSizeChange?.(e);
        kbjLog(debugTag, 'onContentSizeChange', { w: e.nativeEvent.contentSize.width, h: e.nativeEvent.contentSize.height });
      }
    : props.onContentSizeChange;

  const onSelectionChange: TextInputProps['onSelectionChange'] = debugEnabled
    ? (e) => {
        props.onSelectionChange?.(e);
        kbjLog(debugTag, 'onSelectionChange', { sel: e.nativeEvent.selection });
      }
    : props.onSelectionChange;

  const onFocus: TextInputProps['onFocus'] =
    debugEnabled || props.onFocus
      ? (e) => {
          props.onFocus?.(e);
          if (debugEnabled) {
            kbjLog(debugTag, 'onFocus');
            warnIfKeyboardAvoidanceConflict(debugTag);
          }
        }
      : undefined;

  const onBlur: TextInputProps['onBlur'] =
    debugEnabled || props.onBlur
      ? (e) => {
          props.onBlur?.(e);
          if (debugEnabled) kbjLog(debugTag, 'onBlur');
        }
      : undefined;

  const onEndEditing: TextInputProps['onEndEditing'] =
    debugEnabled || props.onEndEditing
      ? (e) => {
          props.onEndEditing?.(e);
          if (debugEnabled) kbjLog(debugTag, 'onEndEditing');
        }
      : undefined;

  return (
    <TextInput
      ref={ref}
      {...props}
      inputAccessoryViewID={showAccessory ? ZENITH_NUMBERPAD_ACCESSORY_ID : props.inputAccessoryViewID}
      returnKeyType={props.returnKeyType || 'done'}
      // Numeric pads don't have a "real" submit key; default to not blurring unless explicitly requested.
      blurOnSubmit={effectiveBlurOnSubmit}
      onLayout={onLayout}
      onContentSizeChange={onContentSizeChange}
      onSelectionChange={onSelectionChange}
      onFocus={onFocus}
      onBlur={onBlur}
      onEndEditing={onEndEditing}
    />
  );
});

export default NumberPadTextInput;
