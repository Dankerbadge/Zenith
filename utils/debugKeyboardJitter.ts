import { Keyboard } from 'react-native';

const startMs = Date.now();

export const DEBUG_KEYBOARD_JITTER =
  __DEV__ && (process.env.EXPO_PUBLIC_DEBUG_KEYBOARD_JITTER === '1' || process.env.EXPO_PUBLIC_DEBUG_KEYBOARD_JITTER === 'true');

export function kbjShouldLog() {
  return DEBUG_KEYBOARD_JITTER;
}

const MAX_LINES = 800;
let lines: string[] = [];
const listeners = new Set<(line: string) => void>();

function ms() {
  return String(Date.now() - startMs).padStart(6, '0');
}

export function kbjLog(tag: string, message: string, data?: Record<string, any>) {
  if (!DEBUG_KEYBOARD_JITTER) return;
  try {
    const payload = data ? ` ${JSON.stringify(data)}` : '';
    const line = `[KBJ +${ms()}ms] ${tag} ${message}${payload}`;
    lines = [...lines.slice(-(MAX_LINES - 1)), line];
    listeners.forEach((fn) => {
      try {
        fn(line);
      } catch {
        // ignore
      }
    });
    // eslint-disable-next-line no-console
    console.log(line);
  } catch {
    // eslint-disable-next-line no-console
    console.log(`[KBJ +${ms()}ms] ${tag} ${message}`);
  }
}

export function kbjGetLines() {
  return lines.slice();
}

export function kbjClear() {
  lines = [];
  kbjLog('KBJ', 'cleared');
}

export function kbjSubscribe(listener: (line: string) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function installKeyboardEventLogging(tag: string): void | (() => void) {
  if (!DEBUG_KEYBOARD_JITTER) return;

  const subs = [
    Keyboard.addListener('keyboardWillShow', (e: any) =>
      kbjLog(tag, 'keyboardWillShow', { h: e?.endCoordinates?.height, dur: e?.duration, easing: e?.easing })
    ),
    Keyboard.addListener('keyboardDidShow', (e: any) =>
      kbjLog(tag, 'keyboardDidShow', { h: e?.endCoordinates?.height, dur: e?.duration, easing: e?.easing })
    ),
    Keyboard.addListener('keyboardWillHide', (e: any) => kbjLog(tag, 'keyboardWillHide', { dur: e?.duration, easing: e?.easing })),
    Keyboard.addListener('keyboardDidHide', () => kbjLog(tag, 'keyboardDidHide')),
  ];

  kbjLog(tag, 'keyboardLogInstalled');
  return () => {
    subs.forEach((s) => s.remove());
    kbjLog(tag, 'keyboardLogRemoved');
  };
}
