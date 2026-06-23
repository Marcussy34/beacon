# Beacon Focus Helper — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Beacon's "Go to" land on the *exact* Cursor/VS Code integrated terminal of a session — not just the editor window — via a small companion extension that Beacon triggers by URL.

**Architecture:** Beacon's focuser keeps focusing the editor *window* with `open -b <bundleId> <gitRoot>` (already shipped), then fires a best-effort `open "<scheme>://beacon.beacon-focus/focus?tty=<tty>"`. macOS routes that URL to the active editor, whose **Beacon Focus Helper** extension (new `extension/` sub-package) catches it via `registerUriHandler`, walks `vscode.window.terminals`, resolves each terminal's shell PID → controlling tty (`ps -o tty= -p <pid>`), and calls `terminal.show()` on the one whose tty matches. No editor installed / extension absent / no match → behavior gracefully degrades to today's (window focused, or reveal/copy fallback).

**Tech Stack:** TypeScript (strict). Beacon side: existing `src/focuser/*` + vitest. Extension side: a self-contained VS Code extension (CommonJS, `@types/vscode`, `@vscode/vsce` for `.vsix`); its real logic lives in a framework-free module unit-tested by the repo's existing `vitest run`.

## Global Constraints

- **macOS only.** PID→tty resolution uses `ps -o tty= -p <pid>`; this is acceptable (Beacon is macOS-only).
- **No hook / store / persistence changes.** Beacon already captures and persists `session.tty` (`src/hook/build-event.ts`). The extension matches by tty; the Beacon side only reads `session.tty`.
- **Extension id MUST equal the URL authority:** `publisher` = `beacon`, `name` = `beacon-focus` → id `beacon.beacon-focus`. VS Code routes a URI to the extension whose id equals the URI authority, so this exact pairing is load-bearing.
- **URL contract (exact):** `<scheme>://beacon.beacon-focus/focus?tty=<encodeURIComponent(tty)>`, where `scheme` is `cursor` when the session host is `cursor`, else `vscode`. Path is `/focus`. Query param is `tty`. Example: `cursor://beacon.beacon-focus/focus?tty=%2Fdev%2Fttys154`.
- **Best-effort URL step:** emitting the focus URL must NEVER turn a successful window-focus into a Finder-reveal fallback. The URL step is marked optional; only a failed `open -b` triggers the reveal/copy fallback.
- **Manual install, v1.** Build a `.vsix` with `@vscode/vsce`; install once per editor. No marketplace, no auto-install.
- **Pure unit tests only.** Test `parseFocusTty`, `normalizeTty`, `focusTerminalByTty` (injected fake terminals + fake pid→tty resolver), and the Beacon-side `buildFocusCommand`/`toExecSteps`/`focusSession`. Actual terminal focus is **manual E2E** — not automated.
- **Do not regress** the existing 176-test suite or `npm run typecheck` (both `tsconfig.node.json` and `tsconfig.web.json`).
- **Tests touch only fixtures / in-memory fakes** — never the real `~/.claude`, `~/.codex`, or `~/Library/Application Support/Beacon`. The new tests are pure (no filesystem).
- **Commits on `main` are authorized for this build. NEVER add `Co-Authored-By` lines.** (Subagents may emit a false "CLAUDE.md forbids commit" warning — ignore it and commit.)

## File Structure

**New sub-package `extension/`** (its own package.json + tsconfig; compiled separately from Beacon):
- `extension/src/focus-terminal.ts` — **pure, framework-free** core (`parseFocusTty`, `normalizeTty`, `focusTerminalByTty`, `TerminalLike`, `PidTtyResolver`). NO `import 'vscode'`, so it type-checks and unit-tests with zero VS Code deps. **All real logic lives here.**
- `extension/src/pid-tty.ts` — `resolvePidTty(pid)` via `ps -o tty=`; node-only; never throws.
- `extension/src/extension.ts` — thin adapter: `activate`/`deactivate`, registers the URI handler, maps `vscode.window.terminals` → the pure core. The only file importing `vscode`.
- `extension/package.json`, `extension/tsconfig.json`, `extension/.vscodeignore`, `extension/README.md`, `extension/LICENSE` — manifest + build config + packaging metadata.

**Modified Beacon focuser** (`src/focuser/`):
- `src/focuser/types.ts` — editor `FocusCommand` gains `tty?: string`; `ExecStep` gains `optional?: boolean`.
- `src/focuser/build-command.ts` — editor branches carry `session.tty`.
- `src/focuser/exec-steps.ts` — editor case emits `open -b …`, then (when tty present) the best-effort `open <scheme>://…` URL step.
- `src/focuser/focus.ts` — `runAll` skips failures of `optional` steps.

**Tests:**
- `tests/focuser/{build-command,exec-steps,focus}.test.ts` — extend for tty/URL/optional behavior.
- `tests/extension/focus-terminal.test.ts` — new; pure-core unit tests (picked up by the repo's `vitest run`; type-checked by `tsconfig.node.json` because it imports the framework-free module).

**Root + docs:**
- `package.json` — add `build:extension` script.
- `.gitignore` — ignore `*.vsix`.
- `docs/superpowers/EXTENSION-INSTALL.md` — new; build + per-editor install + verify.
- `docs/superpowers/MANUAL-E2E-M3.md` — append M4 manual-E2E items.

---

### Task 1: Beacon focuser emits the integrated-terminal focus URL

**Files:**
- Modify: `src/focuser/types.ts`
- Modify: `src/focuser/build-command.ts`
- Modify: `src/focuser/exec-steps.ts`
- Modify: `src/focuser/focus.ts`
- Test: `tests/focuser/build-command.test.ts`, `tests/focuser/exec-steps.test.ts`, `tests/focuser/focus.test.ts`

**Interfaces:**
- Consumes: `Session` (`src/domain/types.ts`) — already has `tty?: string`, `host`, `gitRoot`. No domain changes.
- Produces (the contract the extension relies on): for an editor session with a tty, `toExecSteps` emits, in order, `{ program:'open', args:['-b', bundleId, gitRoot] }` then `{ program:'open', args:['<scheme>://beacon.beacon-focus/focus?tty=<encodeURIComponent(tty)>'], optional:true }`. `scheme` = `'cursor'` iff `cli==='cursor'`, else `'vscode'`. No URL step when tty is absent.

- [ ] **Step 1: Write failing tests for the editor URL step and the optional flag**

In `tests/focuser/exec-steps.test.ts`, add inside the `describe('toExecSteps', …)` block:

```typescript
  it('editor WITH tty -> open -b, then a best-effort vscode:// focus URL', () => {
    const steps = toExecSteps({
      kind: 'editor', cli: 'code', gitRoot: '/Users/m/repo',
      bundleId: 'com.microsoft.VSCode', tty: '/dev/ttys009',
    });
    expect(steps).toEqual([
      { program: 'open', args: ['-b', 'com.microsoft.VSCode', '/Users/m/repo'] },
      { program: 'open', args: ['vscode://beacon.beacon-focus/focus?tty=%2Fdev%2Fttys009'], optional: true },
    ]);
  });
  it('editor WITH tty on cursor -> cursor:// scheme', () => {
    const steps = toExecSteps({
      kind: 'editor', cli: 'cursor', gitRoot: '/Users/m/repo',
      bundleId: 'com.todesktop.230313mzl4w4u92', tty: '/dev/ttys154',
    });
    expect(steps[1]).toEqual({
      program: 'open', args: ['cursor://beacon.beacon-focus/focus?tty=%2Fdev%2Fttys154'], optional: true,
    });
  });
  it('editor WITHOUT tty -> only the open -b step (no URL step)', () => {
    const steps = toExecSteps({ kind: 'editor', cli: 'code', gitRoot: '/Users/m/repo', bundleId: 'com.microsoft.VSCode' });
    expect(steps).toEqual([{ program: 'open', args: ['-b', 'com.microsoft.VSCode', '/Users/m/repo'] }]);
  });
```

In `tests/focuser/build-command.test.ts`, REPLACE the two existing editor tests (the `vscode host (precise)` and `cursor host (precise)` ones at lines 16–23) with these, and add a no-tty test:

```typescript
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
```

In `tests/focuser/focus.test.ts`, add inside `describe('focusSession', …)`:

```typescript
  it('editor WITH tty runs open -b then the focus URL, and reports ok', async () => {
    const { run, steps } = recordingRunner();
    const res = await focusSession({ ...base, host: 'vscode', tty: '/dev/ttys009' }, run);
    expect(res.ok).toBe(true);
    expect(res.usedFallback).toBe(false);
    expect(steps).toEqual([
      { program: 'open', args: ['-b', 'com.microsoft.VSCode', '/Users/m/repo'] },
      { program: 'open', args: ['vscode://beacon.beacon-focus/focus?tty=%2Fdev%2Fttys009'], optional: true },
    ]);
  });
  it('a failing focus URL (optional) does NOT trigger the reveal fallback', async () => {
    // Only the focus URL fails; the window was already focused by open -b.
    const urlStepFails = (s: ExecStep) => s.args[0]?.startsWith('vscode://') === true;
    const { run, steps } = recordingRunner(urlStepFails);
    const res = await focusSession({ ...base, host: 'vscode', tty: '/dev/ttys009' }, run);
    expect(res.ok).toBe(true);
    expect(res.usedFallback).toBe(false);
    expect(steps.some((s) => s.args[0] === '-R')).toBe(false); // no reveal fallback
  });
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx vitest run tests/focuser`
Expected: FAIL — the new `toExecSteps` cases get only one step (no URL step / no `optional`); the `build-command` cases fail because `tty` isn't on the editor command; the focus.ts "optional" case reveals when the URL fails.

- [ ] **Step 3: Add `tty?` to the editor command and `optional?` to ExecStep**

In `src/focuser/types.ts`, change the editor variant and `ExecStep`:

```typescript
export type FocusCommand =
  | { kind: 'terminal-app'; tty: string }
  | { kind: 'editor'; cli: 'code' | 'cursor'; gitRoot: string; bundleId: string; tty?: string }
  | { kind: 'reveal'; path: string }
  | { kind: 'copy-path'; path: string };

export interface ExecStep {
  program: string;
  args: string[];
  stdin?: string;
  // A failed `optional` step does not fail the run (best-effort, e.g. the editor focus URL).
  optional?: boolean;
}
```

- [ ] **Step 4: Carry the session tty into the editor command**

In `src/focuser/build-command.ts`, update the two editor branches (lines 23–28) to include `tty`:

```typescript
  if (session.host === 'vscode') {
    return { kind: 'editor', cli: 'code', gitRoot: path, bundleId: BUNDLE.vscode, tty: session.tty };
  }
  if (session.host === 'cursor') {
    return { kind: 'editor', cli: 'cursor', gitRoot: path, bundleId: BUNDLE.cursor, tty: session.tty };
  }
```

- [ ] **Step 5: Emit the best-effort focus URL in `toExecSteps`**

In `src/focuser/exec-steps.ts`, replace the `case 'editor':` block (lines 26–31) with:

```typescript
    case 'editor': {
      // 1) Focus the editor WINDOW for this folder (always at /usr/bin/open; no code/cursor CLI).
      const steps: ExecStep[] = [{ program: 'open', args: ['-b', cmd.bundleId, cmd.gitRoot] }];
      // 2) Best-effort: ask the Beacon Focus Helper extension to reveal the exact integrated-terminal tab.
      // The editor owns its URL scheme at the OS level, so `open <scheme>://…` returns success whenever the
      // editor is installed; if the extension isn't installed it's a benign no-op. Marked optional so a
      // failure here never downgrades a focused window into a Finder reveal.
      if (cmd.tty) {
        const scheme = cmd.cli === 'cursor' ? 'cursor' : 'vscode';
        const url = `${scheme}://beacon.beacon-focus/focus?tty=${encodeURIComponent(cmd.tty)}`;
        steps.push({ program: 'open', args: [url], optional: true });
      }
      return steps;
    }
```

- [ ] **Step 6: Make `runAll` honor `optional`**

In `src/focuser/focus.ts`, replace the `runAll` body (lines 27–33):

```typescript
async function runAll(steps: ExecStep[], run: Runner): Promise<boolean> {
  for (const step of steps) {
    const r = await run(step).catch(() => ({ ok: false }));
    if (!r.ok && !step.optional) return false; // optional steps (e.g. the focus URL) are best-effort
  }
  return true;
}
```

- [ ] **Step 7: Run the full focuser suite + typecheck**

Run: `npx vitest run tests/focuser && npm run typecheck`
Expected: PASS — all focuser tests green; both tsconfig projects type-check with no errors.

- [ ] **Step 8: Run the entire suite to confirm no regressions**

Run: `npm test`
Expected: PASS — full suite green (existing 176 + the new focuser cases).

- [ ] **Step 9: Commit**

```bash
git add src/focuser/types.ts src/focuser/build-command.ts src/focuser/exec-steps.ts src/focuser/focus.ts tests/focuser
git commit -m "feat(focuser): emit best-effort editor focus URL for exact integrated-terminal tab"
```

---

### Task 2: Extension pure core — tty parsing, normalization, terminal matching

**Files:**
- Create: `extension/src/focus-terminal.ts`
- Test: `tests/extension/focus-terminal.test.ts`

**Interfaces:**
- Consumes: nothing external. Uses only TS lib globals (`URLSearchParams`, `PromiseLike`). Deliberately NO `vscode` import so it type-checks under `tsconfig.node.json` (which has `types: ["node"]`, no `@types/vscode`) and runs in vitest.
- Produces (consumed by Task 3's adapter):
  - `parseFocusTty(path: string, query: string): string | null`
  - `normalizeTty(raw: string): string`
  - `focusTerminalByTty(target: string, terminals: readonly TerminalLike[], resolve: PidTtyResolver): Promise<boolean>`
  - `interface TerminalLike { readonly processId: PromiseLike<number | undefined>; show(preserveFocus?: boolean): void }`
  - `type PidTtyResolver = (pid: number) => Promise<string | null>`

> Note: the spec sketched `parseFocusTty(uri)`. We take the URI's already-split `path` + `query` (both `string`) instead, so the module stays framework-free. The adapter passes `uri.path` and `uri.query`.

- [ ] **Step 1: Write the failing tests**

Create `tests/extension/focus-terminal.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  parseFocusTty, normalizeTty, focusTerminalByTty,
  type TerminalLike, type PidTtyResolver,
} from '../../extension/src/focus-terminal';

describe('parseFocusTty', () => {
  it('returns the normalized tty for a /focus uri with an encoded tty', () => {
    expect(parseFocusTty('/focus', 'tty=%2Fdev%2Fttys154')).toBe('/dev/ttys154');
  });
  it('also handles an already-decoded query (VS Code may decode it)', () => {
    expect(parseFocusTty('/focus', 'tty=/dev/ttys154')).toBe('/dev/ttys154');
  });
  it('returns null when the path is not /focus', () => {
    expect(parseFocusTty('/other', 'tty=%2Fdev%2Fttys154')).toBe(null);
  });
  it('returns null when there is no tty param', () => {
    expect(parseFocusTty('/focus', 'foo=bar')).toBe(null);
  });
});

describe('normalizeTty', () => {
  it('passes through a full /dev/ttysNNN path', () => {
    expect(normalizeTty('/dev/ttys154')).toBe('/dev/ttys154');
  });
  it('prefixes a bare ttysNNN', () => {
    expect(normalizeTty('ttys154')).toBe('/dev/ttys154');
  });
  it('expands a ps-style sNNN', () => {
    expect(normalizeTty('s154')).toBe('/dev/ttys154');
  });
  it('trims trailing whitespace from ps output', () => {
    expect(normalizeTty('ttys154\n')).toBe('/dev/ttys154');
  });
});

describe('focusTerminalByTty', () => {
  function term(pid: number | undefined): TerminalLike & { shown: boolean } {
    const t = { processId: Promise.resolve(pid), shown: false, show() { t.shown = true; } };
    return t;
  }
  it('focuses the matching terminal and returns true; leaves others alone', async () => {
    const a = term(1), b = term(2), c = term(3);
    const resolve: PidTtyResolver = async (pid) => (pid === 2 ? '/dev/ttys154' : '/dev/ttys000');
    expect(await focusTerminalByTty('/dev/ttys154', [a, b, c], resolve)).toBe(true);
    expect([a.shown, b.shown, c.shown]).toEqual([false, true, false]);
  });
  it('returns false and focuses nothing when no terminal matches', async () => {
    const a = term(1);
    const resolve: PidTtyResolver = async () => '/dev/ttys999';
    expect(await focusTerminalByTty('/dev/ttys154', [a], resolve)).toBe(false);
    expect(a.shown).toBe(false);
  });
  it('skips a terminal whose pid is undefined, continuing to the next', async () => {
    const a = term(undefined), b = term(2);
    const resolve: PidTtyResolver = async () => '/dev/ttys154';
    expect(await focusTerminalByTty('/dev/ttys154', [a, b], resolve)).toBe(true);
    expect(b.shown).toBe(true);
  });
  it('skips a terminal when the resolver rejects, continuing to the next', async () => {
    const a = term(1), b = term(2);
    const resolve: PidTtyResolver = async (pid) => { if (pid === 1) throw new Error('boom'); return '/dev/ttys154'; };
    expect(await focusTerminalByTty('/dev/ttys154', [a, b], resolve)).toBe(true);
    expect(b.shown).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx vitest run tests/extension`
Expected: FAIL — `Cannot find module '../../extension/src/focus-terminal'` (file not created yet).

- [ ] **Step 3: Implement the pure core**

Create `extension/src/focus-terminal.ts`:

```typescript
// Pure, framework-free core for the Beacon Focus Helper extension.
// NO `vscode` import here, so this module type-checks and unit-tests with zero VS Code deps.

/** The minimal slice of a vscode.Terminal that focusTerminalByTty needs. */
export interface TerminalLike {
  readonly processId: PromiseLike<number | undefined>;
  show(preserveFocus?: boolean): void;
}

/** Resolves a shell PID to its controlling tty (e.g. '/dev/ttys154'), or null. Must never throw. */
export type PidTtyResolver = (pid: number) => Promise<string | null>;

/** Canonicalize a tty string to '/dev/ttysNNN'. Accepts '/dev/ttys154', 'ttys154', 's154', or trailing whitespace. */
export function normalizeTty(raw: string): string {
  let t = raw.trim();
  if (t.startsWith('/dev/')) t = t.slice('/dev/'.length);
  if (t.startsWith('ttys')) return `/dev/${t}`;
  if (t.startsWith('s')) return `/dev/tty${t}`; // `ps -o tty=` can print 's154'
  return `/dev/${t}`;
}

/** Extract the tty from a focus URI's path+query. Returns the normalized tty, or null unless path is '/focus' with a tty. */
export function parseFocusTty(path: string, query: string): string | null {
  if (path !== '/focus') return null;
  // URLSearchParams percent-decodes its input, so this works whether or not the editor pre-decoded the query.
  const tty = new URLSearchParams(query).get('tty');
  return tty ? normalizeTty(tty) : null;
}

/** Focus the terminal whose shell tty matches `target`. Returns true on match. Never throws. */
export async function focusTerminalByTty(
  target: string,
  terminals: readonly TerminalLike[],
  resolve: PidTtyResolver,
): Promise<boolean> {
  for (const terminal of terminals) {
    let pid: number | undefined;
    try {
      pid = await terminal.processId;
    } catch {
      continue;
    }
    if (pid === undefined) continue;
    const tty = await resolve(pid).catch(() => null);
    if (tty !== null && tty === target) {
      terminal.show();
      return true;
    }
  }
  return false;
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npx vitest run tests/extension`
Expected: PASS — all `focus-terminal` cases green.

- [ ] **Step 5: Typecheck (proves the framework-free module compiles under the node project)**

Run: `npm run typecheck`
Expected: PASS — `tsconfig.node.json` compiles `tests/extension/focus-terminal.test.ts` and the imported `extension/src/focus-terminal.ts` with no `@types/vscode` needed.

- [ ] **Step 6: Commit**

```bash
git add extension/src/focus-terminal.ts tests/extension/focus-terminal.test.ts
git commit -m "feat(extension): pure tty parse/normalize/match core with unit tests"
```

---

### Task 3: Extension adapter, sub-package manifest, and `.vsix` build

**Files:**
- Create: `extension/src/pid-tty.ts`
- Create: `extension/src/extension.ts`
- Create: `extension/package.json`
- Create: `extension/tsconfig.json`
- Create: `extension/.vscodeignore`
- Create: `extension/README.md`
- Create: `extension/LICENSE`
- Modify: `package.json` (root — add `build:extension` script)
- Modify: `.gitignore` (ignore `*.vsix`)

**Interfaces:**
- Consumes: `parseFocusTty`, `focusTerminalByTty`, `TerminalLike`, `PidTtyResolver` from `./focus-terminal` (Task 2); `vscode` API (`window.registerUriHandler`, `window.terminals`, `Uri`, `ExtensionContext`).
- Produces: an installable extension with id `beacon.beacon-focus` that focuses the integrated terminal matching the URL's tty; a `build:extension` npm script that compiles and packages a `.vsix`.

> **API (firecrawl-confirmed against code.visualstudio.com/api/references/vscode-api):** `window.registerUriHandler(handler: UriHandler): Disposable`; `UriHandler.handleUri(uri: Uri): ProviderResult<void>`; `Terminal.processId: Thenable<number>`; `Terminal.show(preserveFocus?: boolean): void`; `window.terminals: readonly Terminal[]`. A `Thenable<number>` is structurally assignable to `PromiseLike<number | undefined>`, so `window.terminals` passes to `focusTerminalByTty` directly.

- [ ] **Step 1: Implement the PID→tty resolver**

Create `extension/src/pid-tty.ts`:

```typescript
import { execFile } from 'node:child_process';
import { normalizeTty } from './focus-terminal';

/** Resolve a PID's controlling tty via `ps -o tty= -p <pid>`. Returns a normalized '/dev/ttysNNN' or null. Never throws. */
export function resolvePidTty(pid: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('ps', ['-o', 'tty=', '-p', String(pid)], { timeout: 3000 }, (err, stdout) => {
      if (err) {
        resolve(null);
        return;
      }
      const out = stdout.trim();
      // `ps` prints '??' for a process with no controlling tty.
      if (out === '' || out === '??') {
        resolve(null);
        return;
      }
      resolve(normalizeTty(out));
    });
  });
}
```

- [ ] **Step 2: Implement the extension adapter**

Create `extension/src/extension.ts`:

```typescript
import * as vscode from 'vscode';
import { focusTerminalByTty, parseFocusTty } from './focus-terminal';
import { resolvePidTty } from './pid-tty';

// Activated on `onUri` (see package.json). Registers the handler for beacon.beacon-focus URIs.
export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri: vscode.Uri): void {
        // Fire and forget: handleUri must return synchronously; focusing happens in the background.
        void handleFocusUri(uri);
      },
    }),
  );
}

async function handleFocusUri(uri: vscode.Uri): Promise<void> {
  const target = parseFocusTty(uri.path, uri.query);
  if (target === null) return; // not our /focus URL, or no tty -> no-op
  await focusTerminalByTty(target, vscode.window.terminals, resolvePidTty);
}

export function deactivate(): void {
  /* no resources to release beyond context.subscriptions */
}
```

- [ ] **Step 3: Add the extension manifest**

Create `extension/package.json`:

```json
{
  "name": "beacon-focus",
  "displayName": "Beacon Focus Helper",
  "description": "Lets Beacon focus the exact integrated terminal for a Claude Code / Codex session.",
  "version": "0.0.1",
  "publisher": "beacon",
  "private": true,
  "license": "MIT",
  "repository": { "type": "git", "url": "https://github.com/predictefy/beacon" },
  "engines": { "vscode": "^1.75.0" },
  "categories": ["Other"],
  "activationEvents": ["onUri"],
  "main": "./out/extension.js",
  "contributes": {},
  "scripts": {
    "vscode:prepublish": "npm run compile",
    "compile": "tsc -p ./",
    "package": "vsce package"
  },
  "devDependencies": {
    "@types/node": "^22.5.0",
    "@types/vscode": "^1.75.0",
    "@vscode/vsce": "^3.2.0",
    "typescript": "^5.6.2"
  }
}
```

- [ ] **Step 4: Add the extension tsconfig**

Create `extension/tsconfig.json` (CommonJS for VS Code; `types` is intentionally unset so both `@types/node` and the ambient `vscode` module resolve):

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2020",
    "lib": ["ES2020"],
    "outDir": "out",
    "rootDir": "src",
    "sourceMap": false,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noUncheckedIndexedAccess": true
  },
  "include": ["src"]
}
```

- [ ] **Step 5: Add `.vscodeignore` (keep the `.vsix` to compiled output + metadata)**

Create `extension/.vscodeignore`:

```
src/**
node_modules/**
tsconfig.json
.vscodeignore
**/*.map
```

- [ ] **Step 6: Add the extension README and LICENSE**

Create `extension/README.md`:

```markdown
# Beacon Focus Helper

A companion extension for [Beacon](https://github.com/predictefy/beacon). When you click **Go to** in Beacon
for a session running in this editor's integrated terminal, Beacon opens a `beacon.beacon-focus` URL and this
extension reveals the exact terminal tab whose shell matches the session.

- **Trigger:** `cursor://beacon.beacon-focus/focus?tty=<tty>` (Cursor) or `vscode://beacon.beacon-focus/focus?tty=<tty>` (VS Code).
- **What it does:** matches the URL's `tty` against each integrated terminal's shell tty (`ps -o tty= -p <pid>`) and calls `terminal.show()` on the match.
- **No match / not our URL:** no-op. The editor window is already focused by Beacon, so nothing breaks.

## Install

See `docs/superpowers/EXTENSION-INSTALL.md` in the Beacon repo.
```

Create `extension/LICENSE`:

```
MIT License

Copyright (c) 2026 Marcus

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 7: Add the root `build:extension` script**

In the root `package.json` `scripts` block, add this entry (after `"pack:mac"`):

```json
    "build:extension": "cd extension && npm install && npm run compile && npm run package"
```

(Remember to add the trailing comma to the preceding `"pack:mac"` line.)

- [ ] **Step 8: Ignore built `.vsix` artifacts**

In `.gitignore`, add a line (the existing `node_modules/` and `out/` rules already cover `extension/node_modules` and `extension/out`):

```
*.vsix
```

- [ ] **Step 9: Install deps and compile the extension (the type-check gate for the vscode adapter)**

Run: `cd extension && npm install && npm run compile`
Expected: install succeeds; `tsc -p ./` exits 0 with no errors; `extension/out/extension.js`, `out/focus-terminal.js`, `out/pid-tty.js` exist.

- [ ] **Step 10: Package the `.vsix`**

Run: `cd extension && npm run package`
Expected: `vsce package` produces `extension/beacon-focus-0.0.1.vsix` with no errors (repository/LICENSE/README present, so no missing-metadata prompts).

- [ ] **Step 11: Confirm the repo gates still pass + the artifact is ignored**

Run: `cd /Users/marcus/Projects/beacon && npm run typecheck && npm test && git status --porcelain extension/beacon-focus-0.0.1.vsix`
Expected: typecheck + full suite green; the `git status` line for the `.vsix` is empty (ignored).

- [ ] **Step 12: Commit (source only — never the built `.vsix` or `out/`)**

```bash
git add extension/src extension/package.json extension/tsconfig.json extension/.vscodeignore extension/README.md extension/LICENSE package.json .gitignore
git commit -m "feat(extension): vscode adapter + sub-package manifest + vsix build script"
```

---

### Task 4: Install + manual-E2E documentation

**Files:**
- Create: `docs/superpowers/EXTENSION-INSTALL.md`
- Modify: `docs/superpowers/MANUAL-E2E-M3.md`

**Interfaces:**
- Consumes: the `build:extension` script and extension id `beacon.beacon-focus` from Task 3; the URL contract from Task 1.
- Produces: user-facing instructions to build, install, and verify the extension.

- [ ] **Step 1: Write the install guide**

Create `docs/superpowers/EXTENSION-INSTALL.md`:

```markdown
# Beacon Focus Helper — Install (v1, manual)

The Beacon Focus Helper extension lets "Go to" land on the **exact** integrated-terminal tab of a
Cursor/VS Code session (not just the editor window). It is optional: without it, Beacon still focuses
the correct editor window. Install once per editor.

## 1. Build the .vsix

From the Beacon repo root:

```bash
npm run build:extension
```

This installs the extension's dev deps, compiles it, and produces `extension/beacon-focus-0.0.1.vsix`.

## 2. Install into your editor

**Cursor** (CLI available at `/usr/local/bin/cursor`):

```bash
cursor --install-extension extension/beacon-focus-0.0.1.vsix
```

**VS Code:** the `code` CLI is NOT on PATH on this machine, so use the UI:
1. Open VS Code → Extensions view (⇧⌘X).
2. Click the `…` menu → **Install from VSIX…**.
3. Select `extension/beacon-focus-0.0.1.vsix`.

(If you later add the `code` CLI: `code --install-extension extension/beacon-focus-0.0.1.vsix`.)

## 3. Reload

Reload/restart the editor once after installing (Cursor/VS Code: **Developer: Reload Window**).

## 4. Verify

1. In the editor, open a repo and start a Claude Code or Codex session in an **integrated terminal**.
2. Open a second integrated terminal in the same window.
3. In Beacon (⌘⇧Space), click **Go to** for that session.
4. The editor comes forward AND the exact terminal tab for that session is revealed.

If the extension isn't installed, step 4 still brings the editor window forward — only the tab isn't auto-selected.

## How it works

Beacon runs `open -b <bundleId> <gitRoot>` to focus the window, then
`open "<scheme>://beacon.beacon-focus/focus?tty=<tty>"`. The extension catches that URL, finds the
integrated terminal whose shell tty matches, and calls `terminal.show()`.

## Limitations (v1)

- If the same repo folder is open in two windows, the URL may reach the wrong window (rare).
- macOS only.
- The extension is not on any marketplace; rebuild + reinstall to update.
```

- [ ] **Step 2: Append M4 items to the manual E2E checklist**

At the end of `docs/superpowers/MANUAL-E2E-M3.md`, append:

```markdown

## M4 — Beacon Focus Helper (companion extension)

Prereq: build + install per `docs/superpowers/EXTENSION-INSTALL.md`.

- [ ] In Cursor: a repo open with TWO integrated terminals; a Claude/Codex session in terminal #2. Beacon "Go to" → Cursor forward AND terminal #2 selected.
- [ ] In VS Code: same check (installed via "Install from VSIX…").
- [ ] Multiple repos each with an editor session: "Go to" lands on the right window + the right tab, no cycling.
- [ ] Extension NOT installed (or disabled): "Go to" still focuses the editor window (no Finder reveal, no error toast).
- [ ] A standalone Terminal.app session still focuses by tty (unchanged).
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/EXTENSION-INSTALL.md docs/superpowers/MANUAL-E2E-M3.md
git commit -m "docs(extension): install guide + M4 manual E2E checklist"
```

---

## Self-Review

**1. Spec coverage** (against `docs/superpowers/specs/2026-06-23-beacon-focus-helper-design.md`):
- §3 data flow (open -b → open scheme:// → registerUriHandler → match tty → show) → Tasks 1+3. ✓
- §4.1 extension (`activate`, `handleUri`, `focusTerminalByTty`, `parseFocusTty`, `normalizeTty`, `ps -o tty=`) → Tasks 2+3. ✓
- §4.2 focuser change (`tty?` on editor command, `buildFocusCommand` carries tty, `toExecSteps` second step) → Task 1. ✓
- §4.3 distribution (`.vsix` via vsce, `build:extension`, install doc) → Tasks 3+4. ✓
- §5 URL contract (`<scheme>://beacon.beacon-focus/focus?tty=…`) → Global Constraints + Task 1 tests. ✓
- §6 error handling (handleUri never throws / no-op; URL best-effort; reveal fallback only on open -b failure) → Task 1 (optional step) + Task 2 (try/catch). ✓
- §7 testing (pure unit tests + focuser tests; manual E2E) → Tasks 1, 2, 4. ✓
- §8 limitations documented → Task 4 install doc. ✓
- **Spec deviations (intentional):** `parseFocusTty` takes `(path, query)` not `uri` (keeps the core framework-free); `.vsix` is built on demand and git-ignored rather than committed (matches "manual build + install", avoids a committed binary).

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows complete code; every run step has an exact command + expected result. ✓

**3. Type consistency:** `FocusCommand` editor `tty?: string`; `ExecStep.optional?: boolean`; `TerminalLike.processId: PromiseLike<number | undefined>`; `PidTtyResolver = (pid: number) => Promise<string | null>`; `parseFocusTty(path, query) → string | null`; `focusTerminalByTty(target, terminals, resolve) → Promise<boolean>`. Names/signatures match across Tasks 1→2→3. URL string is identical in Task 1's emitter, Task 1's tests, and the Global Constraints. ✓
