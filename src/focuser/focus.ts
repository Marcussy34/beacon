import type { Session } from '../domain/types';
import type { FocusCommand, FocusResult, Runner } from './types';
import { buildFocusCommand } from './build-command';
import { toExecSteps } from './exec-steps';

export function focusMessage(cmd: FocusCommand): string {
  switch (cmd.kind) {
    case 'terminal-app': return 'focused the Terminal tab';
    case 'editor': return `focused the ${cmd.cli === 'cursor' ? 'Cursor' : 'VS Code'} window`;
    case 'reveal': return `revealed ${cmd.path} in Finder`;
    case 'copy-path': return `copied ${cmd.path} to the clipboard`;
  }
}

async function runAll(steps: ReturnType<typeof toExecSteps>, run: Runner): Promise<boolean> {
  for (const step of steps) {
    const r = await run(step).catch(() => ({ ok: false }));
    if (!r.ok) return false;
  }
  return true;
}

export async function focusSession(session: Session, run: Runner): Promise<FocusResult> {
  const cmd = buildFocusCommand(session);
  const ok = await runAll(toExecSteps(cmd), run);
  if (ok) return { ok: true, command: cmd, usedFallback: false, message: focusMessage(cmd) };

  // An editor focus failed (e.g. the CLI isn't installed) -> degraded fallback.
  if (cmd.kind === 'editor') {
    const fb: FocusCommand = session.remote === 'none'
      ? { kind: 'reveal', path: cmd.gitRoot }
      : { kind: 'copy-path', path: cmd.gitRoot };
    await runAll(toExecSteps(fb), run);
    return { ok: false, command: fb, usedFallback: true, message: `Couldn't focus the editor; ${focusMessage(fb)}` };
  }
  return { ok: false, command: cmd, usedFallback: false, message: `Couldn't ${focusMessage(cmd)}` };
}
