import React, { useEffect, useMemo } from 'react';
import { Platform, ScrollView, StyleSheet, type ScrollViewProps } from 'react-native';
import { zenithRegisterScrollInsetManager, zenithUnregisterScrollInsetManager } from '../../utils/keyboardAvoidanceRegistry';
import { useKeyboardHeight } from '../../hooks/useKeyboardHeight';

function getBasePaddingBottom(style: ScrollViewProps['contentContainerStyle']): number {
  const flat = StyleSheet.flatten(style) as any;
  if (!flat) return 0;
  if (typeof flat.paddingBottom === 'number') return flat.paddingBottom;
  if (typeof flat.paddingVertical === 'number') return flat.paddingVertical;
  if (typeof flat.padding === 'number') return flat.padding;
  return 0;
}

export default function ZenithScrollView(props: ScrollViewProps) {
  const anyProps = props as any;

  // Default to the "keyboard overlays + inset" behavior on iOS.
  const effectiveAutomaticallyAdjustKeyboardInsets =
    Platform.OS === 'ios' ? (anyProps?.automaticallyAdjustKeyboardInsets ?? true) : anyProps?.automaticallyAdjustKeyboardInsets;

  // These are the main "second keyboard inset manager" props that can fight with KeyboardAvoidingView.
  const usesInsetManager = useMemo(() => {
    const contentInsetAdjustmentBehavior = anyProps?.contentInsetAdjustmentBehavior;
    return Boolean(effectiveAutomaticallyAdjustKeyboardInsets) || contentInsetAdjustmentBehavior != null;
  }, [anyProps?.contentInsetAdjustmentBehavior, effectiveAutomaticallyAdjustKeyboardInsets]);

  useEffect(() => {
    if (!usesInsetManager) return;
    zenithRegisterScrollInsetManager();
    return () => zenithUnregisterScrollInsetManager();
  }, [usesInsetManager]);

  const keyboardHeight = useKeyboardHeight({ enabled: Platform.OS === 'android' });
  const basePaddingBottom = getBasePaddingBottom(props.contentContainerStyle);

  const contentContainerStyle =
    Platform.OS === 'android'
      ? [props.contentContainerStyle, { paddingBottom: basePaddingBottom + keyboardHeight }]
      : props.contentContainerStyle;

  return (
    <ScrollView
      {...props}
      automaticallyAdjustKeyboardInsets={effectiveAutomaticallyAdjustKeyboardInsets}
      contentContainerStyle={contentContainerStyle}
    />
  );
}
