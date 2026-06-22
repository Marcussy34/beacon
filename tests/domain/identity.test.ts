import { describe, it, expect } from 'vitest';
import { eventKey, parseRolloutMeta, matchesRollout, reconcile } from '../../src/domain/identity';
import type { RawHookEvent, Session } from '../../src/domain/types';

const baseRaw: RawHookEvent = {
  tool: 'codex', event: 'SessionStart', cwd: '/Users/m/p', gitRoot: '/Users/m/p',
  host: 'terminal', remote: 'none', ts: 1000,
};

describe('eventKey', () => {
  it('keys Claude on session_id', () => {
    expect(eventKey({ ...baseRaw, tool: 'claude', sessionId: 'abc' })).toBe('claude:abc');
  });
  it('keys Codex on ancestor pid + start + gitRoot + tty', () => {
    const k = eventKey({ ...baseRaw, codexAncestorPid: 42, codexAncestorStartTime: 'T1', tty: '/dev/ttys003' });
    expect(k).toBe('codex:42:T1:/Users/m/p:/dev/ttys003');
  });
  it('is stable for two events from the same codex ancestor', () => {
    const a = eventKey({ ...baseRaw, event: 'Stop', codexAncestorPid: 7, codexAncestorStartTime: 'X', tty: '/dev/ttys1' });
    const b = eventKey({ ...baseRaw, event: 'PermissionRequest', codexAncestorPid: 7, codexAncestorStartTime: 'X', tty: '/dev/ttys1' });
    expect(a).toBe(b);
  });
  it('differs for a different codex ancestor in the same repo', () => {
    const a = eventKey({ ...baseRaw, codexAncestorPid: 7, codexAncestorStartTime: 'X', tty: '/dev/ttys1' });
    const b = eventKey({ ...baseRaw, codexAncestorPid: 9, codexAncestorStartTime: 'Y', tty: '/dev/ttys2' });
    expect(a).not.toBe(b);
  });
});

describe('codex rollout reconcile', () => {
  const meta = JSON.stringify({ type: 'session_meta', payload: { id: 'uuid-1', cwd: '/Users/m/p' }, timestamp: '2025-06-22T20:00:00Z' });
  const session: Session = {
    id: 'codex:7:X:/Users/m/p:/dev/ttys1', tempId: 'codex:7:X:/Users/m/p:/dev/ttys1',
    tool: 'codex', repoPath: '/Users/m/p', gitRoot: '/Users/m/p', repoName: 'p',
    host: 'terminal', remote: 'none', gotoPrecision: 'precise',
    state: 'started', attention: 'none', seen: true,
    startedAt: 1750622400000, lastEventAt: 1750622400000,
  };

  it('parses session_meta into RolloutInfo', () => {
    const info = parseRolloutMeta(meta);
    expect(info).toEqual({ codexSessionId: 'uuid-1', gitRoot: '/Users/m/p', startedAt: 1750622400000 });
  });
  it('returns null for non-meta lines', () => {
    expect(parseRolloutMeta(JSON.stringify({ type: 'event_msg' }))).toBeNull();
  });
  it('matches a rollout by gitRoot + close start time', () => {
    const info = parseRolloutMeta(meta)!;
    expect(matchesRollout(session, info)).toBe(true);
  });
  it('does not match a different gitRoot', () => {
    const info = parseRolloutMeta(meta)!;
    expect(matchesRollout(session, { ...info, gitRoot: '/other' })).toBe(false);
  });
  it('does not re-match an already-reconciled session', () => {
    const info = parseRolloutMeta(meta)!;
    expect(matchesRollout({ ...session, codexSessionId: 'uuid-0' }, info)).toBe(false);
  });
  it('reconcile stamps codexSessionId and stable id', () => {
    const info = parseRolloutMeta(meta)!;
    const r = reconcile(session, info);
    expect(r.codexSessionId).toBe('uuid-1');
    expect(r.id).toBe('codex:uuid-1');
  });
});
