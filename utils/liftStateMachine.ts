export type LiftLifecycleState =
  | 'idle'
  | 'ready'
  | 'recording'
  | 'paused'
  | 'endingConfirm'
  | 'ended'
  | 'saved'
  | 'discarded';

const ALLOWED_TRANSITIONS: Record<LiftLifecycleState, LiftLifecycleState[]> = {
  idle: ['ready'],
  ready: ['recording', 'discarded'],
  recording: ['paused', 'endingConfirm'],
  paused: ['recording', 'endingConfirm'],
  endingConfirm: ['recording', 'paused', 'ended'],
  ended: ['saved', 'discarded'],
  saved: [],
  discarded: [],
};

export function canLiftTransition(from: LiftLifecycleState, to: LiftLifecycleState) {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function liftTransitionOrThrow(from: LiftLifecycleState, to: LiftLifecycleState): LiftLifecycleState {
  if (!canLiftTransition(from, to)) {
    throw new Error(`Invalid lift state transition: ${from} -> ${to}`);
  }
  return to;
}

