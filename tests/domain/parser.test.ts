import { describe, it, expect } from 'vitest';
import { parseHookEvent } from '../../src/domain/parser';
import type { RawHookEvent } from '../../src/domain/types';

const claude: RawHookEvent = {
  tool: 'claude', event: 'SessionStart', sessionId: 'sid',
  cwd: '/Users/m/repo/sub', gitRoot: '/Users/m/repo',
  host: 'terminal', tty: '/dev/ttys003', remote: 'none', ts: 5,
};

describe('parseHookEvent', () => {
  it('maps Claude SessionStart -> session-start and derives repoName from gitRoot', () => {
    const e = parseHookEvent(claude);
    expect(e.kind).toBe('session-start');
    expect(e.repoName).toBe('repo');
    expect(e.gitRoot).toBe('/Users/m/repo');
    expect(e.key).toBe('claude:sid');
  });
  it('maps Claude Notification -> needs-you, Stop -> turn-done', () => {
    expect(parseHookEvent({ ...claude, event: 'Notification' }).kind).toBe('needs-you');
    expect(parseHookEvent({ ...claude, event: 'Stop' }).kind).toBe('turn-done');
  });
  it('maps Codex PermissionRequest -> needs-you', () => {
    expect(parseHookEvent({ ...claude, tool: 'codex', sessionId: undefined, event: 'PermissionRequest' }).kind).toBe('needs-you');
  });
  it('precise for local terminal with tty', () => {
    expect(parseHookEvent(claude).gotoPrecision).toBe('precise');
  });
  it('degraded when remote is ssh', () => {
    expect(parseHookEvent({ ...claude, remote: 'ssh' }).gotoPrecision).toBe('degraded');
  });
  it('degraded when host unknown', () => {
    expect(parseHookEvent({ ...claude, host: 'unknown' }).gotoPrecision).toBe('degraded');
  });
  it('degraded for terminal host without a tty', () => {
    expect(parseHookEvent({ ...claude, tty: undefined }).gotoPrecision).toBe('degraded');
  });
  it('falls back gitRoot to cwd when gitRoot missing', () => {
    const e = parseHookEvent({ ...claude, gitRoot: undefined });
    expect(e.gitRoot).toBe('/Users/m/repo/sub');
    expect(e.repoName).toBe('sub');
  });
  it('throws on an unmapped event', () => {
    expect(() => parseHookEvent({ ...claude, event: 'Bogus' })).toThrow(/Unmapped/);
  });
  it('derives a truncated summary from a UserPromptSubmit prompt', () => {
    const e = parseHookEvent({ ...claude, event: 'UserPromptSubmit', prompt: 'fix the failing build now please' });
    expect(e.summary).toBe('fix the failing build now…');
  });
  it('leaves summary undefined when the event has no prompt', () => {
    expect(parseHookEvent({ ...claude, event: 'Stop' }).summary).toBeUndefined();
  });
});
