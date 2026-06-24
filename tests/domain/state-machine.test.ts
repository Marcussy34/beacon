import { describe, it, expect } from 'vitest';
import { applyEvent } from '../../src/domain/state-machine';
import type { Session, BeaconEvent, BeaconEventName } from '../../src/domain/types';

const session: Session = {
  id: 'k', tempId: 'k', tool: 'claude', repoPath: '/r', gitRoot: '/r', repoName: 'r',
  host: 'terminal', remote: 'none', gotoPrecision: 'precise',
  state: 'started', attention: 'none', seen: true, startedAt: 1, lastEventAt: 1,
};
const ev = (kind: BeaconEventName, ts: number): BeaconEvent => ({
  kind, tool: 'claude', key: 'k', cwd: '/r', gitRoot: '/r', repoName: 'r',
  host: 'terminal', remote: 'none', gotoPrecision: 'precise', ts,
});

describe('applyEvent', () => {
  it('working -> state working, attention cleared, seen true', () => {
    const s = applyEvent(session, ev('working', 2));
    expect(s.state).toBe('working');
    expect(s.attention).toBe('none');
    expect(s.seen).toBe(true);
    expect(s.lastEventAt).toBe(2);
  });
  it('needs-you -> waiting, attention needs-you, seen false', () => {
    const s = applyEvent(session, ev('needs-you', 3));
    expect(s.state).toBe('waiting');
    expect(s.attention).toBe('needs-you');
    expect(s.seen).toBe(false);
    expect(s.lastEventAt).toBe(3);
  });
  it('turn-done -> done, attention done, seen false', () => {
    const s = applyEvent(session, ev('turn-done', 4));
    expect(s.state).toBe('done');
    expect(s.attention).toBe('done');
    expect(s.seen).toBe(false);
    expect(s.lastEventAt).toBe(4);
  });
  it('session-end -> closed, attention cleared, seen true', () => {
    const s = applyEvent({ ...session, attention: 'done', seen: false }, ev('session-end', 5));
    expect(s.state).toBe('closed');
    expect(s.attention).toBe('none');
    expect(s.seen).toBe(true);
    expect(s.lastEventAt).toBe(5);
  });
  it('does not mutate the input session', () => {
    applyEvent(session, ev('needs-you', 9));
    expect(session.state).toBe('started');
  });
  it('sets the summary from an event that carries one', () => {
    const s = applyEvent(session, { ...ev('working', 2), summary: 'topic a' });
    expect(s.summary).toBe('topic a');
  });
  it('keeps the previous summary when the event carries none', () => {
    const withSummary = { ...session, summary: 'topic a' };
    const s = applyEvent(withSummary, ev('turn-done', 3)); // no summary on this event
    expect(s.summary).toBe('topic a');
  });
  it('overwrites the summary when a newer event carries one', () => {
    const withSummary = { ...session, summary: 'topic a' };
    const s = applyEvent(withSummary, { ...ev('working', 4), summary: 'topic b' });
    expect(s.summary).toBe('topic b');
  });
});
