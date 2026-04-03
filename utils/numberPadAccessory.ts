type Listener = (active: boolean) => void;
type DismissHandler = () => void;

let active = false;
let dismissHandler: DismissHandler | null = null;
const listeners = new Set<Listener>();

export function setNumberPadAccessoryActive(next: boolean) {
  const normalized = Boolean(next);
  if (normalized === active) return;
  active = normalized;
  listeners.forEach((listener) => {
    try {
      listener(active);
    } catch {
      // ignore listener errors
    }
  });
}

export function subscribeNumberPadAccessory(listener: Listener) {
  listeners.add(listener);
  // Emit current state immediately for deterministic UI.
  try {
    listener(active);
  } catch {
    // ignore
  }
  return () => {
    listeners.delete(listener);
  };
}

export function isNumberPadAccessoryActive() {
  return active;
}

export function setNumberPadDismissHandler(handler: DismissHandler | null) {
  dismissHandler = handler;
}

export function getNumberPadDismissHandler() {
  return dismissHandler;
}
