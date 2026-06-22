import { describe, it, expect } from 'vitest';
import { buildHookCommand, claudeHookSpecs, codexHookSpecs } from '../../src/installer/hook-specs';
import { BEACON_MARKER_FLAG, HOOK_TIMEOUT_SECONDS } from '../../src/installer/types';

const INV = 'node "/x/dist/hook/beacon-hook.cjs"';
const MARK = 'beacon';

describe('buildHookCommand', () => {
  it('composes invocation + marker flag + id + tool + event', () => {
    expect(buildHookCommand(INV, MARK, 'claude', 'SessionStart'))
      .toBe(`node "/x/dist/hook/beacon-hook.cjs" ${BEACON_MARKER_FLAG} beacon claude SessionStart`);
  });
});

describe('claudeHookSpecs', () => {
  const specs = claudeHookSpecs(INV, MARK);
  const byEvent = (e: string) => specs.filter(s => s.event === e);

  it('covers exactly the parser CLAUDE_MAP events', () => {
    expect(specs.map(s => s.event).sort()).toEqual(
      ['Notification', 'PreToolUse', 'SessionEnd', 'SessionStart', 'Stop', 'UserPromptSubmit'],
    );
  });
  it('SessionStart + PreToolUse use match-all matcher ""', () => {
    expect(byEvent('SessionStart')[0]!.matcher).toBe('');
    expect(byEvent('PreToolUse')[0]!.matcher).toBe('');
  });
  it('Notification uses a single pipe-list matcher group', () => {
    expect(byEvent('Notification')).toHaveLength(1);
    expect(byEvent('Notification')[0]!.matcher).toBe('permission_prompt|idle_prompt');
  });
  it('UserPromptSubmit, Stop, SessionEnd omit the matcher', () => {
    expect(byEvent('UserPromptSubmit')[0]!.matcher).toBeUndefined();
    expect(byEvent('Stop')[0]!.matcher).toBeUndefined();
    expect(byEvent('SessionEnd')[0]!.matcher).toBeUndefined();
  });
  it('every spec carries the marker, the claude tool token, and the timeout', () => {
    for (const s of specs) {
      expect(s.command).toContain(`${BEACON_MARKER_FLAG} beacon claude ${s.event}`);
      expect(s.timeout).toBe(HOOK_TIMEOUT_SECONDS);
    }
  });
});

describe('codexHookSpecs', () => {
  const specs = codexHookSpecs(INV, MARK);
  it('covers exactly the parser CODEX_MAP events (no SessionEnd; PermissionRequest = needs-you)', () => {
    expect(specs.map(s => s.event).sort()).toEqual(
      ['PermissionRequest', 'PreToolUse', 'SessionStart', 'Stop', 'UserPromptSubmit'],
    );
  });
  it('SessionStart + PreToolUse use "", others omit matcher', () => {
    const m = (e: string) => specs.find(s => s.event === e)!.matcher;
    expect(m('SessionStart')).toBe('');
    expect(m('PreToolUse')).toBe('');
    expect(m('UserPromptSubmit')).toBeUndefined();
    expect(m('PermissionRequest')).toBeUndefined();
    expect(m('Stop')).toBeUndefined();
  });
  it('every spec carries the codex tool token', () => {
    for (const s of specs) expect(s.command).toContain(`beacon codex ${s.event}`);
  });
});
