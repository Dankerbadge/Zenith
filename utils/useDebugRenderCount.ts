import { useEffect, useRef } from 'react';
import { DEBUG_KEYBOARD_JITTER, kbjLog } from './debugKeyboardJitter';

export function useDebugRenderCount(tag: string) {
  const countRef = useRef(0);
  countRef.current += 1;

  if (DEBUG_KEYBOARD_JITTER) {
    kbjLog(tag, `render#${countRef.current}`);
  }

  useEffect(() => {
    if (!DEBUG_KEYBOARD_JITTER) return;
    kbjLog(tag, 'mounted');
    return () => kbjLog(tag, 'unmounted');
  }, [tag]);
}

