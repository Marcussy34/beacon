# Beacon — M2a: Focuser — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the "Go to" Focuser — given a `Session`, bring the correct terminal/editor window to the front (Terminal.app by exact tty; VS Code / Cursor by `--reuse-window` + bundle-id activation), with safe degraded fallbacks (reveal-in-Finder / copy-path) and a guarantee it never throws.

**Architecture:** Three pure, fully-unit-tested layers plus one thin IO layer. `buildFocusCommand(session)` decides WHAT to do (a `FocusCommand` union). `toExecSteps(cmd)` maps that to concrete `ExecStep`s (program + argv, never string-interpolated). `focusSession(session, run)` executes the steps through an injected `Runner`, applying a degraded fallback if an editor focus fails, and never throwing. `systemRunner` is the real `execFile`/`pbcopy` runner, exercised by a manual smoke checklist.

**Tech Stack:** TypeScript (strict, ESM), Node 20+, Vitest, npm. macOS `osascript` / `open` / `pbcopy` / `code` / `cursor` CLIs.

## Global Constraints

- Platform: **macOS only** (Darwin).
- Language: **TypeScript strict**, **ESM**. No `any` except narrowing untrusted input.
- Package manager: **npm**. Node **20+**.
- **NEVER shell-interpolate** any session/payload field. All external commands are `{ program, args[] }` argv vectors; dynamic values (paths, tty) are passed as discrete argv items. For AppleScript, dynamic values are passed as `osascript` run-arguments (`on run argv`), never concatenated into the script text.
- The Focuser **must never throw** — runner errors are caught and turned into a `FocusResult` with `ok: false`.
- "Go to" precision honors `session.gotoPrecision`: `degraded` (remote / tty-unknown / host-unknown) never attempts exact-window focus.
- Bundle ids used for activation must match M1's detection (`src/hook/build-event.ts`): VS Code `com.microsoft.VSCode`, Cursor `com.todesktop.230313mzl4w4u92` (confirmed/extended in the M3 E2E).

---

## Context from M1 (already built, do not redefine)

- `src/domain/types.ts` exports `Session` with fields: `host: 'terminal'|'vscode'|'cursor'|'unknown'`, `tty?: string`, `gitRoot: string`, `remote: 'none'|'tmux'|'ssh'|'vscode-remote'`, `gotoPrecision: 'precise'|'degraded'`, plus `repoName`, `repoPath`, etc.
- Project is on `main`, 16 commits, 61 tests green. Per-task commits are authorized on `main`.
- Do NOT touch anything under `.superpowers/` except your report file.

---

## File Structure (M2a)

```
beacon/
  src/focuser/
    types.ts          # FocusCommand | ExecStep | FocusResult | Runner
    build-command.ts  # buildFocusCommand(session): FocusCommand   (pure)
    exec-steps.ts     # toExecSteps(cmd): ExecStep[] + TERMINAL_FOCUS_APPLESCRIPT (pure)
    focus.ts          # focusSession(session, run) + focusMessage + systemRunner
  tests/focuser/
    build-command.test.ts
    exec-steps.test.ts
    focus.test.ts
```

---

### Task 1: Focuser types + `buildFocusCommand`

**Files:**
- Create: `src/focuser/types.ts`, `src/focuser/build-command.ts`
- Test: `tests/focuser/build-command.test.ts`

**Interfaces:**
- Consumes: `Session` from `../domain/types`.
- Produces:
  - `type FocusCommand = { kind:'terminal-app'; tty:string } | { kind:'editor'; cli:'code'|'cursor'; gitRoot:string; bundleId:string } | { kind:'reveal'; path:string } | { kind:'copy-path'; path:string }`
  - `interface ExecStep { program: string; args: string[]; stdin?: string }`
  - `interface FocusResult { ok: boolean; command: FocusCommand; usedFallback: boolean; message: string }`
  - `type Runner = (step: ExecStep) => Promise<{ ok: boolean }>`
  - `buildFocusCommand(session: Session): FocusCommand`

- [ ] **Step 1: Write the failing test**

```ts
// tests/focuser/build-command.test.ts
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
  it('vscode host (precise) -> editor code + VS Code bundle', () => {
    expect(buildFocusCommand({ ...base, host: 'vscode', tty: undefined }))
      .toEqual({ kind: 'editor', cli: 'code', gitRoot: '/Users/m/repo', bundleId: 'com.microsoft.VSCode' });
  });
  it('cursor host (precise) -> editor cursor + Cursor bundle', () => {
    expect(buildFocusCommand({ ...base, host: 'cursor', tty: undefined }))
      .toEqual({ kind: 'editor', cli: 'cursor', gitRoot: '/Users/m/repo', bundleId: 'com.todesktop.230313mzl4w4u92' });
  });
  it('degraded + local (remote none) -> reveal in Finder', () => {
    expect(buildFocusCommand({ ...base, gotoPrecision: 'degraded' }))
      .toEqual({ kind: 'reveal', path: '/Users/m/repo' });
  });
  it('degraded + remote -> copy-path', () => {
    expect(buildFocusCommand({ ...base, gotoPrecision: 'degraded', remote: 'ssh' }))
      .toEqual({ kind: 'copy-path', path: '/Users/m/repo' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/focuser/build-command.test.ts`
Expected: FAIL — cannot resolve `build-command`.

- [ ] **Step 3: Create `src/focuser/types.ts`**

```ts
export type FocusCommand =
  | { kind: 'terminal-app'; tty: string }
  | { kind: 'editor'; cli: 'code' | 'cursor'; gitRoot: string; bundleId: string }
  | { kind: 'reveal'; path: string }
  | { kind: 'copy-path'; path: string };

export interface ExecStep {
  program: string;
  args: string[];
  stdin?: string;
}

export interface FocusResult {
  ok: boolean;
  command: FocusCommand;
  usedFallback: boolean;
  message: string;
}

export type Runner = (step: ExecStep) => Promise<{ ok: boolean }>;
```

- [ ] **Step 4: Create `src/focuser/build-command.ts`**

```ts
import type { Session } from '../domain/types';
import type { FocusCommand } from './types';

// Activation bundle ids — must match host detection in src/hook/build-event.ts.
const BUNDLE = {
  vscode: 'com.microsoft.VSCode',
  cursor: 'com.todesktop.230313mzl4w4u92',
} as const;

export function buildFocusCommand(session: Session): FocusCommand {
  const path = session.gitRoot;

  // Degraded: can't focus the exact window. Reveal locally; copy path if remote.
  if (session.gotoPrecision === 'degraded') {
    return session.remote === 'none'
      ? { kind: 'reveal', path }
      : { kind: 'copy-path', path };
  }

  if (session.host === 'terminal' && session.tty) {
    return { kind: 'terminal-app', tty: session.tty };
  }
  if (session.host === 'vscode') {
    return { kind: 'editor', cli: 'code', gitRoot: path, bundleId: BUNDLE.vscode };
  }
  if (session.host === 'cursor') {
    return { kind: 'editor', cli: 'cursor', gitRoot: path, bundleId: BUNDLE.cursor };
  }
  // Defensive: a precise session should always match above; reveal locally otherwise.
  return { kind: 'reveal', path };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/focuser/build-command.test.ts`
Expected: PASS.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: clean (exit 0). (Vitest does NOT typecheck — run tsc explicitly.)

- [ ] **Step 7: Commit**

```bash
git add src/focuser/types.ts src/focuser/build-command.ts tests/focuser/build-command.test.ts
git commit -m "feat(focuser): focus-command decision logic"
```

---

### Task 2: `toExecSteps` + Terminal AppleScript

**Files:**
- Create: `src/focuser/exec-steps.ts`
- Test: `tests/focuser/exec-steps.test.ts`

**Interfaces:**
- Consumes: `FocusCommand`, `ExecStep` (Task 1).
- Produces:
  - `const TERMINAL_FOCUS_APPLESCRIPT: string`
  - `toExecSteps(cmd: FocusCommand): ExecStep[]`

- [ ] **Step 1: Write the failing test**

```ts
// tests/focuser/exec-steps.test.ts
import { describe, it, expect } from 'vitest';
import { toExecSteps, TERMINAL_FOCUS_APPLESCRIPT } from '../../src/focuser/exec-steps';

describe('toExecSteps', () => {
  it('terminal-app -> osascript with the script and the tty as a run-arg (no interpolation)', () => {
    const steps = toExecSteps({ kind: 'terminal-app', tty: '/dev/ttys003' });
    expect(steps).toEqual([
      { program: 'osascript', args: ['-e', TERMINAL_FOCUS_APPLESCRIPT, '/dev/ttys003'] },
    ]);
  });
  it('editor -> reuse-window then activate by bundle id', () => {
    const steps = toExecSteps({ kind: 'editor', cli: 'code', gitRoot: '/Users/m/repo', bundleId: 'com.microsoft.VSCode' });
    expect(steps).toEqual([
      { program: 'code', args: ['--reuse-window', '/Users/m/repo'] },
      { program: 'open', args: ['-b', 'com.microsoft.VSCode'] },
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/focuser/exec-steps.test.ts`
Expected: FAIL — cannot resolve `exec-steps`.

- [ ] **Step 3: Create `src/focuser/exec-steps.ts`**

```ts
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
          set frontmost of w to true
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
      return [
        { program: cmd.cli, args: ['--reuse-window', cmd.gitRoot] },
        { program: 'open', args: ['-b', cmd.bundleId] },
      ];
    case 'reveal':
      return [{ program: 'open', args: ['-R', cmd.path] }];
    case 'copy-path':
      return [{ program: 'pbcopy', args: [], stdin: cmd.path }];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/focuser/exec-steps.test.ts`
Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: clean (exit 0).

- [ ] **Step 6: Commit**

```bash
git add src/focuser/exec-steps.ts tests/focuser/exec-steps.test.ts
git commit -m "feat(focuser): map focus commands to argv exec steps"
```

---

### Task 3: `focusSession` dispatcher + fallback (injected runner)

**Files:**
- Create: `src/focuser/focus.ts` (the `systemRunner` real IO is added in Task 4; this task adds `focusSession` + `focusMessage` only)
- Test: `tests/focuser/focus.test.ts`

**Interfaces:**
- Consumes: `Session` (domain), `FocusCommand`/`ExecStep`/`FocusResult`/`Runner` (Task 1), `buildFocusCommand` (Task 1), `toExecSteps` (Task 2).
- Produces:
  - `focusMessage(cmd: FocusCommand): string`
  - `focusSession(session: Session, run: Runner): Promise<FocusResult>` — runs the steps; if an `editor` focus fails, falls back to reveal (local) / copy-path (remote); never throws.

- [ ] **Step 1: Write the failing test**

```ts
// tests/focuser/focus.test.ts
import { describe, it, expect } from 'vitest';
import { focusSession } from '../../src/focuser/focus';
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/focuser/focus.test.ts`
Expected: FAIL — cannot resolve `focus`.

- [ ] **Step 3: Create `src/focuser/focus.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/focuser/focus.test.ts`
Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: clean (exit 0).

- [ ] **Step 6: Commit**

```bash
git add src/focuser/focus.ts tests/focuser/focus.test.ts
git commit -m "feat(focuser): focusSession dispatcher with degraded fallback"
```

---

### Task 4: Real `systemRunner` + manual smoke

**Files:**
- Modify: `src/focuser/focus.ts` (append `systemRunner`)
- Test: `tests/focuser/focus.test.ts` (append one runner-contract test)

**Interfaces:**
- Consumes: `ExecStep`, `Runner` (Task 1).
- Produces: `systemRunner: Runner` — executes a step via `execFile` (writing `stdin` if present), resolving `{ ok: true }` on success and `{ ok: false }` on any error (never throws, 5s timeout).

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/focuser/focus.test.ts
import { systemRunner } from '../../src/focuser/focus';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/focuser/focus.test.ts`
Expected: FAIL — `systemRunner` is not exported.

- [ ] **Step 3: Append `systemRunner` to `src/focuser/focus.ts`**

```ts
import { execFile } from 'node:child_process';
import type { ExecStep } from './types';

// Real runner: runs the step via execFile, writing stdin if present.
// Never throws — resolves { ok:false } on any error or non-zero exit. 5s timeout.
export const systemRunner: Runner = (step: ExecStep) =>
  new Promise((resolve) => {
    const child = execFile(step.program, step.args, { timeout: 5000 }, (err) => {
      resolve({ ok: !err });
    });
    if (step.stdin !== undefined) {
      child.stdin?.end(step.stdin);
    }
  });
```

(Place the `import` lines at the top of the file alongside the existing imports.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/focuser/focus.test.ts`
Expected: PASS (all focus tests + the two systemRunner tests).

- [ ] **Step 5: Full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: ALL tests pass; typecheck clean.

- [ ] **Step 6: Manual smoke (real focus — run by the human or controller on the Mac)**

Open a folder in VS Code (or Cursor) and note its path, then run a tiny harness:
```bash
npx tsx -e "import('./src/focuser/focus.ts').then(async m => { const r = await m.focusSession({ id:'x',tempId:'x',tool:'claude',repoPath:'<REPO>',gitRoot:'<REPO>',repoName:'repo',host:'vscode',remote:'none',gotoPrecision:'precise',state:'done',attention:'done',seen:false,startedAt:1,lastEventAt:2 }, m.systemRunner); console.log(r); })"
```
Expected: the VS Code window for `<REPO>` comes to the front; logs `{ ok: true, ... }`. (First Terminal.app focus will prompt for macOS Automation permission — that's expected and handled in M3.)

- [ ] **Step 7: Commit**

```bash
git add src/focuser/focus.ts tests/focuser/focus.test.ts
git commit -m "feat(focuser): real systemRunner (execFile) + runner-contract tests"
```

---

## Self-Review (completed by plan author)

**Spec coverage (Focuser, spec §4.6 + §11):**
- Terminal.app tty-exact focus (precise, local) → Tasks 1–2 (`terminal-app` + AppleScript by run-arg). ✓
- VS Code/Cursor `--reuse-window` + activate-by-bundle-id → Tasks 1–2 (`editor`). ✓
- Degraded fallbacks: reveal-in-Finder (local) / copy-path (remote/non-local) → Tasks 1, 3. ✓
- Honors `gotoPrecision` (no exact-focus when degraded) → Task 1. ✓
- Never shell-interpolate (argv vectors; AppleScript via run-args) → Tasks 2 (asserted in tests). ✓
- Never throws (runner errors caught) → Task 3 (asserted). ✓
- Editor-CLI-missing fallback → Task 3 (asserted). ✓
- Automation-permission prompt on first Terminal focus → noted in Task 4 smoke; full handling is M3.

**Placeholder scan:** none — every step has real code/commands.

**Type consistency:** `FocusCommand`/`ExecStep`/`FocusResult`/`Runner` defined once in Task 1 and consumed unchanged; `buildFocusCommand`/`toExecSteps`/`focusSession`/`systemRunner` names are stable across tasks and tests; bundle ids match `src/hook/build-event.ts`.

**Deferred (not in M2a):** the toast/UI for fallbacks (M3); wiring "Go to" to a panel button + IPC (M3); the M3 Automation-permission first-run UX.
