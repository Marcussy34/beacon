import { describe, it, expect } from 'vitest';
import { focusSession, systemRunner, focusExecPath } from '../../src/focuser/focus';
import type { Session } from '../../src/domain/types';
import type { ExecStep, Runner } from '../../src/focuser/types';

const base: Session = {
  id: 'k', tempId: 'k', tool: 'claude', repoPath: '/Users/m/repo', gitRoot: '/Users/m/repo',
  repoName: 'repo', host: 'vscode', remote: 'none', gotoPrecision: 'precise',
  state: 'done', attention: 'done', seen: false, startedAt: 1, lastEventAt: 2,
};

function recordingRunner(failProgram?: string): { run: Runner; steps: ExecStep[] } {
  const steps: ExecStep[] = [];
  const run: Runner = async (step) => { steps.push(step); return { ok: step.program !== failProgram }; };
  return { run, steps };
}

describe('focusSession', () => {
  it('runs all steps and reports ok on success (editor)', async () => {
    const { run, steps } = recordingRunner();
    const res = await focusSession(base, run);
    expect(res.ok).toBe(true);
    expect(res.usedFallback).toBe(false);
    expect(steps.map((s) => s.program)).toEqual(['code', 'open']);
  });

  it('terminal host uses osascript', async () => {
    const { run, steps } = recordingRunner();
    const res = await focusSession({ ...base, host: 'terminal', tty: '/dev/ttys003' }, run);
    expect(res.ok).toBe(true);
    expect(steps[0]!.program).toBe('osascript');
  });

  it('falls back to reveal when the editor CLI fails (local)', async () => {
    const { run, steps } = recordingRunner('code'); // `code` not installed
    const res = await focusSession(base, run);
    expect(res.ok).toBe(false);
    expect(res.usedFallback).toBe(true);
    expect(res.command.kind).toBe('reveal');
    expect(steps.some((s) => s.program === 'open' && s.args[0] === '-R')).toBe(true);
  });

  it('falls back to copy-path when editor fails on a remote session', async () => {
    const { run } = recordingRunner('code');
    const res = await focusSession({ ...base, remote: 'ssh' }, run);
    expect(res.usedFallback).toBe(true);
    expect(res.command.kind).toBe('copy-path');
  });

  it('never throws even if the runner rejects', async () => {
    const run: Runner = async () => { throw new Error('boom'); };
    const res = await focusSession(base, run);
    expect(res.ok).toBe(false);
  });
});

describe('systemRunner', () => {
  it('resolves { ok: false } for a non-existent program (never throws)', async () => {
    const res = await systemRunner({ program: 'beacon-no-such-binary-xyz', args: [] });
    expect(res.ok).toBe(false);
  });
  it('resolves { ok: true } for a trivially successful command', async () => {
    const res = await systemRunner({ program: 'true', args: [] });
    expect(res.ok).toBe(true);
  });
});

describe('focusExecPath', () => {
  it('puts system bins first, then Homebrew/local, then inherited', () => {
    expect(focusExecPath('/usr/bin:/bin')).toBe('/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin');
  });
  it('handles an undefined/empty PATH', () => {
    expect(focusExecPath(undefined)).toBe('/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin');
    expect(focusExecPath('')).toBe('/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin');
  });
  it('does not duplicate dirs already present', () => {
    expect(focusExecPath('/opt/homebrew/bin:/usr/bin')).toBe('/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin');
  });
  it('appends additional inherited dirs after the system + Homebrew/local bins', () => {
    expect(focusExecPath('/Users/m/.local/bin:/usr/bin')).toBe(
      '/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin:/Users/m/.local/bin',
    );
  });
  it('orders /usr/bin ahead of /opt/homebrew/bin so Apple tools are not shadowed', () => {
    const parts = focusExecPath('/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin').split(':');
    expect(parts.indexOf('/usr/bin')).toBeLessThan(parts.indexOf('/opt/homebrew/bin'));
  });
});
