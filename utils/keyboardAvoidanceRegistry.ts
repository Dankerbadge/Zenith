import { Platform } from 'react-native';
import { kbjLog, kbjShouldLog } from './debugKeyboardJitter';

type Registry = {
  kavMounted: number;
  scrollInsetManagers: number;
  warnedKeys: Set<string>;
};

const registry: Registry = {
  kavMounted: 0,
  scrollInsetManagers: 0,
  warnedKeys: new Set(),
};

export function zenithRegisterKav() {
  if (!__DEV__) return;
  registry.kavMounted += 1;
}

export function zenithUnregisterKav() {
  if (!__DEV__) return;
  registry.kavMounted = Math.max(0, registry.kavMounted - 1);
}

export function zenithRegisterScrollInsetManager() {
  if (!__DEV__) return;
  registry.scrollInsetManagers += 1;
}

export function zenithUnregisterScrollInsetManager() {
  if (!__DEV__) return;
  registry.scrollInsetManagers = Math.max(0, registry.scrollInsetManagers - 1);
}

export function warnIfKeyboardAvoidanceConflict(tag: string) {
  if (!__DEV__) return;
  if (Platform.OS !== 'ios') return;

  // We only warn when debug keyboard jitter logging is enabled, to avoid noisy dev consoles.
  if (!kbjShouldLog()) return;

  const key = `kav:${registry.kavMounted}|inset:${registry.scrollInsetManagers}|${tag}`;
  if (registry.warnedKeys.has(key)) return;

  if (registry.kavMounted > 0 && registry.scrollInsetManagers > 0) {
    registry.warnedKeys.add(key);
    kbjLog('KeyboardAvoidanceGuard', 'conflict', {
      tag,
      kavMounted: registry.kavMounted,
      scrollInsetManagers: registry.scrollInsetManagers,
      note: 'KeyboardAvoidingView is mounted while another keyboard inset manager is also active. This combination frequently causes iOS number-pad jitter.',
    });
  }
}

