export type RunLifecycleState = 'idle' | 'ready' | 'tracking' | 'paused' | 'ended' | 'saved' | 'discarded';

const ALLOWED_TRANSITIONS: Record<RunLifecycleState, RunLifecycleState[]> = {
  idle: ['ready'],
  ready: ['tracking', 'discarded'],
  tracking: ['paused', 'ended'],
  // Ending from paused is valid for deliberate stop flows.
  paused: ['tracking', 'ended'],
  ended: ['saved', 'discarded'],
  saved: [],
  discarded: [],
};

export function canTransition(from: RunLifecycleState, to: RunLifecycleState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function transitionOrThrow(from: RunLifecycleState, to: RunLifecycleState): RunLifecycleState {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid run state transition: ${from} -> ${to}`);
  }
  return to;
}
