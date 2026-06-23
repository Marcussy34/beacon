import { execFile } from 'node:child_process';
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
    if (!r.ok && !step.optional) return false; // optional steps (e.g. the focus URL) are best-effort
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

// A Finder-launched .app inherits a minimal PATH (no /opt/homebrew/bin, /usr/local/bin), so
// execFile('code'|'cursor') can't find the editor CLI. Order: system bins FIRST so Apple's
// osascript/open/pbcopy always win over any Homebrew/local shadow; then the Homebrew/local bins
// (where code/cursor live, absent from /usr/bin); then whatever PATH the process inherited.
// Deduped, first occurrence wins.
export function focusExecPath(currentPath: string | undefined): string {
  const system = ['/usr/bin', '/bin'];
  const prepend = ['/opt/homebrew/bin', '/usr/local/bin'];
  const existing = (currentPath ?? '').split(':').filter(Boolean);
  const ordered = [...system, ...prepend, ...existing];
  const seen = new Set<string>();
  return ordered.filter((p) => (seen.has(p) ? false : (seen.add(p), true))).join(':');
}

// Real runner: runs the step via execFile, writing stdin if present.
// Never throws — resolves { ok:false } on any error or non-zero exit. 5s timeout.
export const systemRunner: Runner = (step: ExecStep) =>
  new Promise((resolve) => {
    const child = execFile(
      step.program,
      step.args,
      { timeout: 5000, env: { ...process.env, PATH: focusExecPath(process.env['PATH']) } },
      (err) => { resolve({ ok: !err }); },
    );
    if (step.stdin !== undefined) {
      // execFile opens stdin as a pipe by default, so it is non-null here.
      child.stdin!.end(step.stdin, 'utf8');
    }
  });
