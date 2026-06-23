import { describe, it, expect } from 'vitest';
import { buildFocusCommand } from '../../src/focuser/build-command';
import type { Session } from '../../src/domain/types';

const base: Session = {
  id: 'k', tempId: 'k', tool: 'claude', repoPath: '/Users/m/repo', gitRoot: '/Users/m/repo',
  repoName: 'repo', host: 'terminal', tty: '/dev/ttys003', remote: 'none',
  gotoPrecision: 'precise', state: 'waiting', attention: 'needs-you', seen: false,
  startedAt: 1, lastEventAt: 2,
};

describe('buildFocusCommand', () => {
  it('terminal host with tty (precise) -> terminal-app', () => {
    expect(buildFocusCommand(base)).toEqual({ kind: 'terminal-app', tty: '/dev/ttys003' });
  });
  it('vscode host (precise) -> editor code + VS Code bundle + tty', () => {
    expect(buildFocusCommand({ ...base, host: 'vscode', tty: '/dev/ttys154' }))
      .toEqual({ kind: 'editor', cli: 'code', gitRoot: '/Users/m/repo', bundleId: 'com.microsoft.VSCode', tty: '/dev/ttys154' });
  });
  it('cursor host (precise) -> editor cursor + Cursor bundle + tty', () => {
    expect(buildFocusCommand({ ...base, host: 'cursor', tty: '/dev/ttys154' }))
      .toEqual({ kind: 'editor', cli: 'cursor', gitRoot: '/Users/m/repo', bundleId: 'com.todesktop.230313mzl4w4u92', tty: '/dev/ttys154' });
  });
  it('editor host without a tty omits tty', () => {
    const cmd = buildFocusCommand({ ...base, host: 'vscode', tty: undefined });
    expect(cmd).toMatchObject({ kind: 'editor', cli: 'code', gitRoot: '/Users/m/repo', bundleId: 'com.microsoft.VSCode' });
    expect((cmd as { tty?: string }).tty).toBeUndefined();
  });
  it('degraded + local (remote none) -> reveal in Finder', () => {
    expect(buildFocusCommand({ ...base, gotoPrecision: 'degraded' }))
      .toEqual({ kind: 'reveal', path: '/Users/m/repo' });
  });
  it('degraded + remote -> copy-path', () => {
    expect(buildFocusCommand({ ...base, gotoPrecision: 'degraded', remote: 'ssh' }))
      .toEqual({ kind: 'copy-path', path: '/Users/m/repo' });
  });
  it('terminal host without a tty (defensive) -> reveal', () => {
    expect(buildFocusCommand({ ...base, host: 'terminal', tty: undefined }))
      .toEqual({ kind: 'reveal', path: '/Users/m/repo' });
  });
});
