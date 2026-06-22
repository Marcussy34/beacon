import type { Session } from '../domain/types';
import type { FocusCommand, FocusResult, Runner, ExecStep } from './types';
import { buildFocusCommand } from './build-command';
import { toExecSteps } from './exec-steps';

// Past-tense phrasing for success / fallback-result messages.
export function focusMessage(cmd: FocusCommand): string {
  switch (cmd.kind) {
    case 'terminal-app': return 'Focused the Terminal tab';
    case 'editor': return `Focused the ${cmd.cli === 'cursor' ? 'Cursor' : 'VS Code'} window`;
    case 'reveal': return `Revealed ${cmd.path} in Finder`;
    case 'copy-path': return `Copied ${cmd.path} to the clipboard`;
  }
}

// Infinitive phrasing for "Couldn't ..." failure messages (avoids "Couldn't copied ...").
function focusAction(cmd: FocusCommand): string {
  switch (cmd.kind) {
    case 'terminal-app': return 'focus the Terminal tab';
    case 'editor': return `focus the ${cmd.cli === 'cursor' ? 'Cursor' : 'VS Code'} window`;
    case 'reveal': return `reveal ${cmd.path} in Finder`;
    case 'copy-path': return `copy ${cmd.path} to the clipboard`;
  }
}

async function runAll(steps: ExecStep[], run: Runner): Promise<boolean> {
  for (const step of steps) {
    const r = await run(step).catch(() => ({ ok: false }));
    if (!r.ok) return false;
  }
  return true;
}

export async function focusSession(session: Session, run: Runner): Promise<FocusResult> {
  try {
    const cmd = buildFocusCommand(session);
    const ok = await runAll(toExecSteps(cmd), run);
    if (ok) return { ok: true, command: cmd, usedFallback: false, message: focusMessage(cmd) };

    // An editor focus failed (e.g. the CLI isn't installed) -> degraded fallback.
    if (cmd.kind === 'editor') {
      const fb: FocusCommand = session.remote === 'none'
        ? { kind: 'reveal', path: cmd.gitRoot }
        : { kind: 'copy-path', path: cmd.gitRoot };
      const fbOk = await runAll(toExecSteps(fb), run);
      const message = fbOk
        ? `Couldn't focus the editor — ${focusMessage(fb)}`
        : `Couldn't focus the editor, and the fallback also failed`;
      return { ok: false, command: fb, usedFallback: true, message };
    }
    return { ok: false, command: cmd, usedFallback: false, message: `Couldn't ${focusAction(cmd)}` };
  } catch {
    // Defensive: buildFocusCommand/toExecSteps are pure and shouldn't throw,
    // but focusSession must NEVER throw per the Focuser contract.
    return {
      ok: false,
      command: { kind: 'copy-path', path: session.gitRoot },
      usedFallback: false,
      message: 'Could not focus this session (internal error).',
    };
  }
}
