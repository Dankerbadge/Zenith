import React from 'react';
import { ActionSheetIOS, Alert, Platform } from 'react-native';

export type MoreActionItem = {
  label: string;
  destructive?: boolean;
  onPress: () => void;
  hidden?: boolean;
};

export function openMoreActionsMenu(items: MoreActionItem[], title: string = 'Actions') {
  const visible = items.filter((item) => !item.hidden);
  if (!visible.length) return;

  if (Platform.OS === 'ios') {
    const labels = visible.map((item) => item.label);
    const options = [...labels, 'Cancel'];
    const destructiveIndex = visible.findIndex((item) => Boolean(item.destructive));
    const cancelButtonIndex = options.length - 1;

    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        options,
        cancelButtonIndex,
        destructiveButtonIndex: destructiveIndex >= 0 ? destructiveIndex : undefined,
      },
      (index) => {
        if (index === cancelButtonIndex || index < 0 || index >= visible.length) return;
        visible[index].onPress();
      }
    );
    return;
  }

  Alert.alert(
    title,
    undefined,
    [
      ...visible.map((item) => ({
        text: item.label,
        style: item.destructive ? ('destructive' as const) : ('default' as const),
        onPress: item.onPress,
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ],
    { cancelable: true }
  );
}

export default function MoreActionsMenu() {
  return null;
}
