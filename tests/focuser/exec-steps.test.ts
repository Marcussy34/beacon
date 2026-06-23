import { describe, it, expect } from 'vitest';
import { toExecSteps, TERMINAL_FOCUS_APPLESCRIPT } from '../../src/focuser/exec-steps';

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
