import type { Session, BeaconEvent, SessionState, Attention } from './types';

export function applyEvent(session: Session, event: BeaconEvent): Session {
  let state: SessionState = session.state;
  let attention: Attention = session.attention;
  let seen = session.seen;

  switch (event.kind) {
    case 'session-start':
      state = 'started';
      break;
    case 'working':
      state = 'working';
      attention = 'none';
      seen = true;
      break;
    case 'needs-you':
      state = 'waiting';
      attention = 'needs-you';
      seen = false;
      break;
    case 'turn-done':
      state = 'done';
      attention = 'done';
      seen = false;
      break;
    case 'session-end':
      state = 'closed';
      attention = 'none';
      seen = true;
      break;
    // Exhaustiveness guard: compile error if a new event kind is added unhandled
    default: {
      const _exhaustive: never = event.kind;
      throw new Error(`Unhandled event kind: ${String(_exhaustive)}`);
    }
  }

  return { ...session, state, attention, seen, lastEventAt: event.ts };
}
