import { describe, it, expect } from 'vitest';
import { badgeText, groupSessions } from '../../src/core/view-model';
import type { Session } from '../../src/domain/types';

const base: Session = {
  id: 'k', tempId: 'k', tool: 'claude', repoPath: '/r', gitRoot: '/r', repoName: 'r',
  host: 'terminal', remote: 'none', gotoPrecision: 'precise',
  state: 'started', attention: 'none', seen: true, startedAt: 1, lastEventAt: 1,
};

describe('badgeText', () => {
  it('is empty for 0, the count for 1-9, 9+ for >=10', () => {
    expect(badgeText(0)).toBe('');
    expect(badgeText(3)).toBe('3');
    expect(badgeText(9)).toBe('9');
    expect(badgeText(12)).toBe('9+');
  });
});

describe('groupSessions', () => {
  it('buckets by attention/state and sorts each by lastEventAt desc', () => {
    const s = (over: Partial<Session>): Session => ({ ...base, ...over });
    const g = groupSessions([
      s({ id: 'a', attention: 'needs-you', state: 'waiting', lastEventAt: 5 }),
      s({ id: 'b', state: 'working', lastEventAt: 9 }),
      s({ id: 'c', attention: 'done', state: 'done', lastEventAt: 2 }),
      s({ id: 'd', state: 'closed', lastEventAt: 1 }),
      s({ id: 'e', state: 'working', lastEventAt: 11 }),
    ]);
    expect(g.needsYou.map(x => x.id)).toEqual(['a']);
    expect(g.working.map(x => x.id)).toEqual(['e', 'b']); // desc by lastEventAt
    expect(g.done.map(x => x.id)).toEqual(['c']);
    expect(g.closed.map(x => x.id)).toEqual(['d']);
  });

  it('closed beats attention: a closed session with needs-you lands in closed, not needsYou', () => {
    const s = (over: Partial<Session>): Session => ({ ...base, ...over });
    const g = groupSessions([
      s({ id: 'x', state: 'closed', attention: 'needs-you', lastEventAt: 3 }),
      s({ id: 'y', state: 'closed', attention: 'done', lastEventAt: 9 }),
    ]);
    expect(g.needsYou).toEqual([]);
    expect(g.done).toEqual([]);
    expect(g.closed.map(x => x.id)).toEqual(['y', 'x']); // both closed, desc by lastEventAt
  });
});
