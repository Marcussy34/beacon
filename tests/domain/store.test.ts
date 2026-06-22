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
  it('evictStale removes closed sessions past the ttl only', () => {
    const s = new SessionStore();
    s.upsertFromEvent(ev('session-end', 1000, 'old'));
    s.upsertFromEvent(ev('needs-you', 1000, 'live'));
    s.evictStale(1000 + 60_000, 30_000);
    expect(s.get('old')).toBeUndefined();
    expect(s.get('live')).toBeDefined();
  });
  it('round-trips through toJSON/fromJSON', () => {
    const s = new SessionStore();
    s.upsertFromEvent(ev('needs-you', 7, 'a'));
    const restored = SessionStore.fromJSON(s.toJSON());
    expect(restored.get('a')!.attention).toBe('needs-you');
    expect(restored.attentionCount()).toBe(1);
  });
});
