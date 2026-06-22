import { describe, it, expect } from 'vitest';
import { detectHost, detectRemote, buildRawEvent } from '../../src/hook/build-event';

describe('detectHost', () => {
  it('Terminal.app by bundle id', () => {
    expect(detectHost({ __CFBundleIdentifier: 'com.apple.Terminal' })).toBe('terminal');
  });
  it('Terminal.app by TERM_PROGRAM', () => {
    expect(detectHost({ TERM_PROGRAM: 'Apple_Terminal' })).toBe('terminal');
  });
  it('VS Code by bundle id', () => {
    expect(detectHost({ __CFBundleIdentifier: 'com.microsoft.VSCode', TERM_PROGRAM: 'vscode' })).toBe('vscode');
  });
  it('Cursor by known todesktop bundle id', () => {
    expect(detectHost({ __CFBundleIdentifier: 'com.todesktop.230313mzl4w4u92', TERM_PROGRAM: 'vscode' })).toBe('cursor');
  });
  it('falls back to vscode for the vscode TERM_PROGRAM family with unknown bundle', () => {
    expect(detectHost({ TERM_PROGRAM: 'vscode', __CFBundleIdentifier: 'com.unknown.fork' })).toBe('vscode');
  });
  it('unknown otherwise', () => {
    expect(detectHost({})).toBe('unknown');
  });
});

describe('detectRemote', () => {
  it('ssh', () => expect(detectRemote({ SSH_CONNECTION: '1.2.3.4 22 5.6.7.8 22' })).toBe('ssh'));
  it('tmux', () => expect(detectRemote({ TMUX: '/tmp/tmux-501/default,123,0' })).toBe('tmux'));
  it('vscode-remote', () => expect(detectRemote({ VSCODE_IPC_HOOK_CLI: '/x', REMOTE_CONTAINERS: 'true' })).toBe('vscode-remote'));
  it('ssh via SSH_TTY', () => expect(detectRemote({ SSH_TTY: '/dev/ttys001' })).toBe('ssh'));
  it('tmux via STY (screen)', () => expect(detectRemote({ STY: '12345.pts-0.host' })).toBe('tmux'));
  it('not vscode-remote when only one of the two required vars is set', () => {
    expect(detectRemote({ VSCODE_IPC_HOOK_CLI: '/x' })).toBe('none');
    expect(detectRemote({ REMOTE_CONTAINERS: 'true' })).toBe('none');
  });
  it('none', () => expect(detectRemote({})).toBe('none'));
});

describe('buildRawEvent', () => {
  it('prefers the stdin cwd/session_id and includes resolved fields', () => {
    const e = buildRawEvent({
      tool: 'claude', event: 'Stop',
      env: { __CFBundleIdentifier: 'com.apple.Terminal', TERM_SESSION_ID: 'T1' },
      stdin: { session_id: 'sid', cwd: '/Users/m/repo' },
      cwd: '/fallback', gitRoot: '/Users/m/repo', tty: '/dev/ttys003', ts: 99,
    });
    expect(e).toMatchObject({
      tool: 'claude', event: 'Stop', sessionId: 'sid', cwd: '/Users/m/repo',
      gitRoot: '/Users/m/repo', host: 'terminal', termSessionId: 'T1',
      tty: '/dev/ttys003', remote: 'none', ts: 99,
    });
  });
  it('uses the fallback cwd when stdin lacks one', () => {
    const e = buildRawEvent({ tool: 'codex', event: 'PermissionRequest', env: {}, stdin: {}, cwd: '/cwd', ts: 1 });
    expect(e.cwd).toBe('/cwd');
    expect(e.sessionId).toBeUndefined();
  });
});
