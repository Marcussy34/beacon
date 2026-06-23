import { describe, it, expect } from 'vitest';
import { SessionStore } from '../../src/domain/store';
import type { BeaconEvent, BeaconEventName } from '../../src/domain/types';

const ev = (kind: BeaconEventName, ts: number, key = 'k1'): BeaconEvent => ({
  kind, tool: 'claude', key, cwd: '/r', gitRoot: '/r', repoName: 'r',
  host: 'terminal', remote: 'none', gotoPrecision: 'precise',
  claudeSessionId: key, ts,
});

describe('SessionStore', () => {
  it('creates a session on first event and transitions it', () => {
    const s = new SessionStore();
    s.upsertFromEvent(ev('session-start', 1));
    const after = s.upsertFromEvent(ev('needs-you', 2));
    expect(after.state).toBe('waiting');
    expect(s.all()).toHaveLength(1);
  });
  it('attentionCount counts unseen attention sessions', () => {
    const s = new SessionStore();
    s.upsertFromEvent(ev('needs-you', 1, 'a'));
    s.upsertFromEvent(ev('working', 1, 'b'));
    expect(s.attentionCount()).toBe(1);
  });
  it('markSeen clears attention and the badge', () => {
    const s = new SessionStore();
    s.upsertFromEvent(ev('needs-you', 1, 'a'));
    s.markSeen('a');
    expect(s.get('a')!.seen).toBe(true);
    expect(s.get('a')!.attention).toBe('none');
    expect(s.attentionCount()).toBe(0);
  });
  const CLOSED = 60 * 60 * 1000;
  const DEAD = 3 * 60 * 60 * 1000;

  it('sweepStale removes closed past the closed ttl, keeps recent closed', () => {
    const s = new SessionStore();
    s.upsertFromEvent(ev('session-end', 0, 'oldClosed'));
    s.upsertFromEvent(ev('session-end', CLOSED, 'recentClosed'));
    expect(s.sweepStale(CLOSED + 1, CLOSED, DEAD)).toBe(true);
    expect(s.get('oldClosed')).toBeUndefined();
    expect(s.get('recentClosed')).toBeDefined();
  });

  it('sweepStale removes working/started silent past the dead ttl', () => {
    const s = new SessionStore();
    s.upsertFromEvent(ev('working', 0, 'deadWorking'));
    s.upsertFromEvent(ev('working', DEAD, 'liveWorking'));
    expect(s.sweepStale(DEAD + 1, CLOSED, DEAD)).toBe(true);
    expect(s.get('deadWorking')).toBeUndefined();
    expect(s.get('liveWorking')).toBeDefined();
  });

  it('sweepStale never evicts unseen needs-you or unseen done, however old', () => {
    const s = new SessionStore();
    s.upsertFromEvent(ev('needs-you', 0, 'needs'));
    s.upsertFromEvent(ev('turn-done', 0, 'done'));
    expect(s.sweepStale(DEAD * 1000, CLOSED, DEAD)).toBe(false);
    expect(s.get('needs')).toBeDefined();
    expect(s.get('done')).toBeDefined();
  });

  it('sweepStale evicts an acknowledged (seen) done session past the dead ttl', () => {
    const s = new SessionStore();
    s.upsertFromEvent(ev('turn-done', 0, 'doneSeen'));
    s.markSeen('doneSeen'); // attention -> none, seen true; state stays 'done', lastEventAt stays 0
    expect(s.sweepStale(DEAD + 1, CLOSED, DEAD)).toBe(true);
    expect(s.get('doneSeen')).toBeUndefined();
  });

  it('dismiss removes a session and reports whether one was removed', () => {
    const s = new SessionStore();
    s.upsertFromEvent(ev('working', 1, 'a'));
    expect(s.dismiss('a')).toBe(true);
    expect(s.get('a')).toBeUndefined();
    expect(s.dismiss('missing')).toBe(false);
  });
  it('round-trips through toJSON/fromJSON', () => {
    const s = new SessionStore();
    s.upsertFromEvent(ev('needs-you', 7, 'a'));
    const restored = SessionStore.fromJSON(s.toJSON());
    expect(restored.get('a')!.attention).toBe('needs-you');
    expect(restored.attentionCount()).toBe(1);
  });
});
