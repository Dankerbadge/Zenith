type Listener = (dateKey: string) => void;

const listeners = new Set<Listener>();

export function emitDailyLogChanged(dateKey: string) {
  const key = String(dateKey || '').trim();
  if (!key) return;
  listeners.forEach((listener) => {
    try {
      listener(key);
    } catch {
      // ignore listener errors
    }
  });
}

export function subscribeDailyLogChanged(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

