type Listener<T> = (payload: T) => void;

type EventMap = {
  postDeleted: { postId: string };
  commentDeleted: { commentId: string; postId?: string | null };
  postCreated: { postId: string };
};

const listeners: { [K in keyof EventMap]: Set<Listener<EventMap[K]>> } = {
  postDeleted: new Set(),
  commentDeleted: new Set(),
  postCreated: new Set(),
};

export function emitSocialEvent<K extends keyof EventMap>(event: K, payload: EventMap[K]) {
  listeners[event].forEach((listener) => {
    try {
      listener(payload);
    } catch {
      // Ignore subscriber exceptions.
    }
  });
}

export function onSocialEvent<K extends keyof EventMap>(event: K, listener: Listener<EventMap[K]>) {
  listeners[event].add(listener);
  return () => {
    listeners[event].delete(listener);
  };
}
