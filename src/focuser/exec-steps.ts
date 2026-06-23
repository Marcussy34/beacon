import type { FocusCommand, ExecStep } from './types';

// Targets the Terminal.app tab whose tty matches argv[1] and brings it to the front.
// The tty is passed as a run-argument (osascript ... <tty>), never interpolated into the script.
export const TERMINAL_FOCUS_APPLESCRIPT = `on run argv
  set targetTty to item 1 of argv
  tell application "Terminal"
    activate
    repeat with w in windows
      repeat with t in tabs of w
        if tty of t is targetTty then
          set selected of t to true
          set index of w to 1
          return "ok"
        end if
      end repeat
    end repeat
  end tell
  return "not-found"
end run`;

export function toExecSteps(cmd: FocusCommand): ExecStep[] {
  switch (cmd.kind) {
    case 'terminal-app':
      return [{ program: 'osascript', args: ['-e', TERMINAL_FOCUS_APPLESCRIPT, cmd.tty] }];
    case 'editor':
      // Open the repo folder in the editor AND activate it via `open` (always at /usr/bin/open).
      // We deliberately do NOT use the `code`/`cursor` CLI: it is frequently not installed on PATH
      // (and a Finder-launched .app has a minimal PATH anyway). `open -b <bundleId> <folder>` focuses
      // the existing window for that folder if one is open, else opens it — and brings the app forward.
      return [{ program: 'open', args: ['-b', cmd.bundleId, cmd.gitRoot] }];
    case 'reveal':
      return [{ program: 'open', args: ['-R', cmd.path] }];
    case 'copy-path':
      return [{ program: 'pbcopy', args: [], stdin: cmd.path }];
  }
}
