import { describe, it, expect } from 'vitest';
import { toExecSteps, TERMINAL_FOCUS_APPLESCRIPT, EDITOR_FOCUS_SETTLE_MS } from '../../src/focuser/exec-steps';

describe('toExecSteps', () => {
  it('terminal-app -> osascript with the script and the tty as a run-arg (no interpolation)', () => {
    const steps = toExecSteps({ kind: 'terminal-app', tty: '/dev/ttys003' });
    expect(steps).toEqual([
      { program: 'osascript', args: ['-e', TERMINAL_FOCUS_APPLESCRIPT, '/dev/ttys003'] },
    ]);
  });
  it('editor -> open the repo folder in the app by bundle id (no code/cursor CLI)', () => {
    const steps = toExecSteps({ kind: 'editor', cli: 'code', gitRoot: '/Users/m/repo', bundleId: 'com.microsoft.VSCode' });
    expect(steps).toEqual([
      { program: 'open', args: ['-b', 'com.microsoft.VSCode', '/Users/m/repo'] },
    ]);
  });
  it('editor WITH tty -> open -b, then the focus URL fired twice (immediate + after a settle delay)', () => {
    const steps = toExecSteps({
      kind: 'editor', cli: 'code', gitRoot: '/Users/m/repo',
      bundleId: 'com.microsoft.VSCode', tty: '/dev/ttys009',
    });
    const url = 'vscode://beacon.beacon-focus/focus?tty=%2Fdev%2Fttys009';
    expect(steps).toEqual([
      { program: 'open', args: ['-b', 'com.microsoft.VSCode', '/Users/m/repo'] },
      // Immediate: instant focus when the right window is already frontmost.
      { program: 'open', args: [url], optional: true },
      // Delayed: catches the multi-window race where `open -b` is still switching windows.
      { program: 'open', args: [url], optional: true, delayMs: EDITOR_FOCUS_SETTLE_MS },
    ]);
  });
  it('editor WITH tty on cursor -> cursor:// scheme on both URL fires', () => {
    const steps = toExecSteps({
      kind: 'editor', cli: 'cursor', gitRoot: '/Users/m/repo',
      bundleId: 'com.todesktop.230313mzl4w4u92', tty: '/dev/ttys154',
    });
    const url = 'cursor://beacon.beacon-focus/focus?tty=%2Fdev%2Fttys154';
    expect(steps[1]).toEqual({ program: 'open', args: [url], optional: true });
    expect(steps[2]).toEqual({ program: 'open', args: [url], optional: true, delayMs: EDITOR_FOCUS_SETTLE_MS });
  });
  it('editor WITHOUT tty -> only the open -b step (no URL step)', () => {
    const steps = toExecSteps({ kind: 'editor', cli: 'code', gitRoot: '/Users/m/repo', bundleId: 'com.microsoft.VSCode' });
    expect(steps).toEqual([{ program: 'open', args: ['-b', 'com.microsoft.VSCode', '/Users/m/repo'] }]);
  });
  it('reveal -> open -R path', () => {
    expect(toExecSteps({ kind: 'reveal', path: '/Users/m/repo' }))
      .toEqual([{ program: 'open', args: ['-R', '/Users/m/repo'] }]);
  });
  it('copy-path -> pbcopy with path on stdin', () => {
    expect(toExecSteps({ kind: 'copy-path', path: '/Users/m/repo' }))
      .toEqual([{ program: 'pbcopy', args: [], stdin: '/Users/m/repo' }]);
  });
  it('the AppleScript reads its target from run-args, not interpolation', () => {
    expect(TERMINAL_FOCUS_APPLESCRIPT).toContain('on run argv');
    expect(TERMINAL_FOCUS_APPLESCRIPT).toContain('item 1 of argv');
  });
});
