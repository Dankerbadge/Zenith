import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

type Options = {
  enabled?: boolean;
};

export function useKeyboardHeight(options?: Options) {
  const enabled = options?.enabled ?? true;
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!enabled) return;

    const onShow = (e: any) => {
      const h = Math.max(0, Number(e?.endCoordinates?.height) || 0);
      setHeight(h);
    };
    const onHide = () => setHeight(0);

    if (Platform.OS === 'ios') {
      const changeSub = Keyboard.addListener('keyboardWillChangeFrame', onShow);
      const hideSub = Keyboard.addListener('keyboardWillHide', onHide);
      return () => {
        changeSub.remove();
        hideSub.remove();
      };
    }

    const showSub = Keyboard.addListener('keyboardDidShow', onShow);
    const hideSub = Keyboard.addListener('keyboardDidHide', onHide);
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [enabled]);

  return height;
}

