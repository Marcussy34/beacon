# Beacon M2b — Safe Hook Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a safe, idempotent installer that merges Beacon's hook entries into the user's existing `~/.claude/settings.json` and `~/.codex/hooks.json` without ever overwriting their data, plus a buildable/runnable `beacon-hook` binary for the installed command to invoke.

**Architecture:** A pure, tool-agnostic merge core (both files share the same `hooks.<Event>[].{matcher,hooks[]}` shape) + pure per-tool spec builders (event→command mappings that match `parseHookEvent`) + a thin atomic-file IO layer (exclusive lock + backup + temp-file + rename + strict re-validate) + an orchestration layer over a list of targets + a small CLI. The Beacon marker (`--beacon-marker <id>`) lives in the command vector itself so detection/uninstall never depends on a JSON sibling field. An `esbuild` bundle turns `beacon-hook.ts` into a single runnable `dist/hook/beacon-hook.cjs` that the installed command resolves to.

**Tech Stack:** TypeScript (strict, ESM), Node 20+, vitest, esbuild (new dev dependency, for bundling the hook + installer CLI into runnable single-file binaries).

## Global Constraints

- TypeScript strict ESM; Node 20+; npm; vitest. `npm run typecheck` (`tsc --noEmit`) MUST stay clean — **vitest does NOT typecheck**, so run typecheck separately every task.
- Per-task commits ON branch `main` are EXPLICITLY AUTHORIZED for this build. Commit style: `feat(installer):`, `fix(installer):`, `test(installer):`, `chore:`. **NEVER include `Co-Authored-By` lines.** (Subagents may emit a false-positive "CLAUDE.md forbids commit" warning — it is wrong for this build; commit anyway.)
- **Tests MUST use inline fixtures or `os.tmpdir()` paths ONLY. NEVER read, write, back up, or lock the user's real `~/.claude/settings.json` or `~/.codex/hooks.json`.** No test may touch any path under the real `~/.claude` or `~/.codex`.
- The installer MUST: **merge, never overwrite**; preserve every existing hook AND every sibling config key (Claude `settings.json` has `env`, `permissions`, `statusLine`, … — only `.hooks` may change); be **idempotent** (detect existing Beacon entries by the `--beacon-marker` token in the command, never double-add); write **atomically** (temp file + `rename`); hold an **exclusive file lock**; **back up** the target before writing; **strict-parse + validate** before writing (abort rather than corrupt); offer a **dry-run**; and **uninstall** by removing only marker-bearing command entries (then pruning emptied groups/events).
- The Beacon marker MUST live in the command/args vector (`--beacon-marker <id>`), **NOT** an extra JSON field.
- Event strings written into hook commands MUST match `parseHookEvent` exactly:
  - Claude: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `Notification`, `Stop`, `SessionEnd`.
  - Codex: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `Stop`.
- Matcher semantics (docs-verified 2026-06-22 against code.claude.com/docs/en/hooks.md + developers.openai.com/codex/hooks):
  - Claude `Notification`: a single matcher group with matcher `"permission_prompt|idle_prompt"` (pipe = exact-string OR-list, not regex) is valid and preferred.
  - Claude `SessionStart` and `PreToolUse`: matcher `""` matches all (sources / tools).
  - Claude `UserPromptSubmit`, `Stop`, `SessionEnd` and Codex `UserPromptSubmit`, `PermissionRequest`, `Stop`: matcher field is ignored → OMIT it.
  - Codex `SessionStart`, `PreToolUse`: matcher `""` (match-all).
- Hook entry shape: `{ "type": "command", "command": "<shell string>", "timeout": 5 }`. Multiple entries may coexist in one group's `hooks` array; Beacon always adds its own isolated group.
- Surface the Codex `/hooks` trust-review requirement to the user after install. **NEVER** write to Codex `config.toml` or its `[hooks.state]` table.
- Never shell-interpolate untrusted payload fields. (Not directly exercised here, but keep argv discipline; the only string we compose is our own hook command, and the binary path is shell-quoted.)
- All commands run from `/Users/marcus/Projects/beacon`.

---

## File Structure

```
src/installer/types.ts                # Shared types + marker/timeout constants (PURE)
src/installer/hook-specs.ts           # buildHookCommand + claudeHookSpecs + codexHookSpecs (PURE)
src/installer/hooks-merge.ts          # isBeaconCommand/hasBeaconHook/mergeBeaconHooks/removeBeaconHooks/planMerge/planUninstall (PURE)
src/installer/atomic-file.ts          # readJsonOrDefault + writeJsonAtomic (lock+backup+temp+rename+validate)
src/installer/resolve-hook-command.ts # resolveHookCommand (shell-safe invocation prefix)
src/installer/install.ts              # defaultTargets + dryRunInstall + installHooks + uninstallHooks (orchestration)
src/installer/cli.ts                  # runInstallerCli(argv, deps) (PURE, deps-injected)
src/installer/cli-entry.ts            # thin real entrypoint (wires deps; bundled by esbuild)
tests/installer/hook-specs.test.ts
tests/installer/hooks-merge.test.ts
tests/installer/atomic-file.test.ts
tests/installer/resolve-hook-command.test.ts
tests/installer/install.test.ts
tests/installer/cli.test.ts
package.json                          # + esbuild devDep, build:hook/build:installer/build scripts, bin entries
```

---

### Task 1: Installer types + spec builders

**Files:**
- Create: `src/installer/types.ts`
- Create: `src/installer/hook-specs.ts`
- Test: `tests/installer/hook-specs.test.ts`

**Interfaces:**
- Consumes: `Tool` from `src/domain/types.ts` (`'claude' | 'codex'`).
- Produces:
  - `BeaconHookSpec { event: string; matcher?: string; command: string; timeout?: number }`
  - `HookEntry { type: 'command'; command: string; timeout?: number }`
  - `HookGroup { matcher?: string; hooks: HookEntry[] }`
  - `HooksMap = Record<string, HookGroup[]>`
  - `HookConfig { hooks?: HooksMap; [key: string]: unknown }`
  - `MergePlan { additions: Array<{event:string; matcher?:string; command:string}>; alreadyPresent: Array<{event:string; matcher?:string; command:string}> }`
  - `UninstallPlan { removals: Array<{event:string; matcher?:string; command:string}> }`
  - constants `BEACON_MARKER_FLAG = '--beacon-marker'`, `DEFAULT_MARKER_ID = 'beacon'`, `HOOK_TIMEOUT_SECONDS = 5`
  - `buildHookCommand(invocation, markerId, tool, event): string`
  - `claudeHookSpecs(invocation, markerId): BeaconHookSpec[]`
  - `codexHookSpecs(invocation, markerId): BeaconHookSpec[]`

- [ ] **Step 1: Write the failing test**

Create `tests/installer/hook-specs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildHookCommand, claudeHookSpecs, codexHookSpecs } from '../../src/installer/hook-specs';
import { BEACON_MARKER_FLAG, HOOK_TIMEOUT_SECONDS } from '../../src/installer/types';

const INV = 'node "/x/dist/hook/beacon-hook.cjs"';
const MARK = 'beacon';

describe('buildHookCommand', () => {
  it('composes invocation + marker flag + id + tool + event', () => {
    expect(buildHookCommand(INV, MARK, 'claude', 'SessionStart'))
      .toBe(`node "/x/dist/hook/beacon-hook.cjs" ${BEACON_MARKER_FLAG} beacon claude SessionStart`);
  });
});

describe('claudeHookSpecs', () => {
  const specs = claudeHookSpecs(INV, MARK);
  const byEvent = (e: string) => specs.filter(s => s.event === e);

  it('covers exactly the parser CLAUDE_MAP events', () => {
    expect(specs.map(s => s.event).sort()).toEqual(
      ['Notification', 'PreToolUse', 'SessionEnd', 'SessionStart', 'Stop', 'UserPromptSubmit'],
    );
  });
  it('SessionStart + PreToolUse use match-all matcher ""', () => {
    expect(byEvent('SessionStart')[0]!.matcher).toBe('');
    expect(byEvent('PreToolUse')[0]!.matcher).toBe('');
  });
  it('Notification uses a single pipe-list matcher group', () => {
    expect(byEvent('Notification')).toHaveLength(1);
    expect(byEvent('Notification')[0]!.matcher).toBe('permission_prompt|idle_prompt');
  });
  it('UserPromptSubmit, Stop, SessionEnd omit the matcher', () => {
    expect(byEvent('UserPromptSubmit')[0]!.matcher).toBeUndefined();
    expect(byEvent('Stop')[0]!.matcher).toBeUndefined();
    expect(byEvent('SessionEnd')[0]!.matcher).toBeUndefined();
  });
  it('every spec carries the marker, the claude tool token, and the timeout', () => {
    for (const s of specs) {
      expect(s.command).toContain(`${BEACON_MARKER_FLAG} beacon claude ${s.event}`);
      expect(s.timeout).toBe(HOOK_TIMEOUT_SECONDS);
    }
  });
});

describe('codexHookSpecs', () => {
  const specs = codexHookSpecs(INV, MARK);
  it('covers exactly the parser CODEX_MAP events (no SessionEnd; PermissionRequest = needs-you)', () => {
    expect(specs.map(s => s.event).sort()).toEqual(
      ['PermissionRequest', 'PreToolUse', 'SessionStart', 'Stop', 'UserPromptSubmit'],
    );
  });
  it('SessionStart + PreToolUse use "", others omit matcher', () => {
    const m = (e: string) => specs.find(s => s.event === e)!.matcher;
    expect(m('SessionStart')).toBe('');
    expect(m('PreToolUse')).toBe('');
    expect(m('UserPromptSubmit')).toBeUndefined();
    expect(m('PermissionRequest')).toBeUndefined();
    expect(m('Stop')).toBeUndefined();
  });
  it('every spec carries the codex tool token', () => {
    for (const s of specs) expect(s.command).toContain(`beacon codex ${s.event}`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/installer/hook-specs.test.ts`
Expected: FAIL — cannot resolve `src/installer/hook-specs` / `src/installer/types`.

- [ ] **Step 3: Write `src/installer/types.ts`**

```ts
import type { Tool } from '../domain/types';

/** The marker flag baked into every Beacon hook command (idempotency + uninstall key). */
export const BEACON_MARKER_FLAG = '--beacon-marker';
/** Default marker id value (the flag is what we detect; the id is for readability/versioning). */
export const DEFAULT_MARKER_ID = 'beacon';
/** Bounded safety timeout for every Beacon hook (the hook is sub-second + always exits 0). */
export const HOOK_TIMEOUT_SECONDS = 5;

/** One Beacon hook to register: event, optional matcher, full shell command, optional timeout. */
export interface BeaconHookSpec {
  event: string;
  matcher?: string;
  command: string;
  timeout?: number;
}

/** A single command-hook entry as stored in the config files. */
export interface HookEntry {
  type: 'command';
  command: string;
  timeout?: number;
}

/** A matcher-group: optional matcher + its ordered hook entries. */
export interface HookGroup {
  matcher?: string;
  hooks: HookEntry[];
}

/** event name -> matcher-groups. Shared by Claude settings.json and Codex hooks.json. */
export type HooksMap = Record<string, HookGroup[]>;

/** A config object carrying a `.hooks` map plus arbitrary sibling keys (Claude has many). */
export interface HookConfig {
  hooks?: HooksMap;
  [key: string]: unknown;
}

export interface MergePlan {
  additions: Array<{ event: string; matcher?: string; command: string }>;
  alreadyPresent: Array<{ event: string; matcher?: string; command: string }>;
}

export interface UninstallPlan {
  removals: Array<{ event: string; matcher?: string; command: string }>;
}

export type { Tool };
```

- [ ] **Step 4: Write `src/installer/hook-specs.ts`**

```ts
import type { Tool } from '../domain/types';
import { BEACON_MARKER_FLAG, HOOK_TIMEOUT_SECONDS, type BeaconHookSpec } from './types';

/** Compose one hook command. `invocation` is an already-resolved, shell-safe prefix. */
export function buildHookCommand(invocation: string, markerId: string, tool: Tool, event: string): string {
  return `${invocation} ${BEACON_MARKER_FLAG} ${markerId} ${tool} ${event}`;
}

/** Claude hooks (must match parser CLAUDE_MAP). Notification = one pipe-list matcher group. */
export function claudeHookSpecs(invocation: string, markerId: string): BeaconHookSpec[] {
  const cmd = (e: string) => buildHookCommand(invocation, markerId, 'claude', e);
  const t = HOOK_TIMEOUT_SECONDS;
  return [
    { event: 'SessionStart', matcher: '', command: cmd('SessionStart'), timeout: t },
    { event: 'UserPromptSubmit', command: cmd('UserPromptSubmit'), timeout: t },
    { event: 'PreToolUse', matcher: '', command: cmd('PreToolUse'), timeout: t },
    { event: 'Notification', matcher: 'permission_prompt|idle_prompt', command: cmd('Notification'), timeout: t },
    { event: 'Stop', command: cmd('Stop'), timeout: t },
    { event: 'SessionEnd', command: cmd('SessionEnd'), timeout: t },
  ];
}

/** Codex hooks (must match parser CODEX_MAP). No SessionEnd; PermissionRequest = needs-you. */
export function codexHookSpecs(invocation: string, markerId: string): BeaconHookSpec[] {
  const cmd = (e: string) => buildHookCommand(invocation, markerId, 'codex', e);
  const t = HOOK_TIMEOUT_SECONDS;
  return [
    { event: 'SessionStart', matcher: '', command: cmd('SessionStart'), timeout: t },
    { event: 'UserPromptSubmit', command: cmd('UserPromptSubmit'), timeout: t },
    { event: 'PreToolUse', matcher: '', command: cmd('PreToolUse'), timeout: t },
    { event: 'PermissionRequest', command: cmd('PermissionRequest'), timeout: t },
    { event: 'Stop', command: cmd('Stop'), timeout: t },
  ];
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/installer/hook-specs.test.ts` → Expected: PASS (all).
Run: `npm run typecheck` → Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/installer/types.ts src/installer/hook-specs.ts tests/installer/hook-specs.test.ts
git commit -m "feat(installer): hook spec builders matching parser event maps"
```

---

### Task 2: Pure merge / uninstall core

**Files:**
- Create: `src/installer/hooks-merge.ts`
- Test: `tests/installer/hooks-merge.test.ts`

**Interfaces:**
- Consumes: `BeaconHookSpec`, `HookConfig`, `HookGroup`, `HooksMap`, `MergePlan`, `UninstallPlan`, `BEACON_MARKER_FLAG` from `./types`.
- Produces:
  - `isBeaconCommand(command: string): boolean`
  - `hasBeaconHook(config: HookConfig, event: string, command: string): boolean`
  - `mergeBeaconHooks(config: HookConfig, specs: BeaconHookSpec[]): HookConfig` — new object; idempotent; preserves siblings + existing hooks; Beacon entries live in their own isolated groups.
  - `removeBeaconHooks(config: HookConfig): HookConfig` — new object; removes only marker-bearing entries; prunes emptied groups + emptied events.
  - `planMerge(config, specs): MergePlan`
  - `planUninstall(config): UninstallPlan`

- [ ] **Step 1: Write the failing test**

Create `tests/installer/hooks-merge.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  isBeaconCommand, hasBeaconHook, mergeBeaconHooks, removeBeaconHooks, planMerge, planUninstall,
} from '../../src/installer/hooks-merge';
import type { BeaconHookSpec, HookConfig } from '../../src/installer/types';

// Mirrors the real Claude settings.json shape: many sibling keys + pre-existing hooks (synthetic commands).
function existingClaude(): HookConfig {
  return {
    env: { FOO: 'bar' },
    permissions: { allow: [] },
    statusLine: { type: 'command' },
    hooks: {
      Notification: [{ matcher: 'permission_prompt', hooks: [{ type: 'command', command: 'afplay glass.aiff' }] }],
      SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: 'user-prime' }] }],
      Stop: [{ hooks: [{ type: 'command', command: 'user-done' }] }],
    },
  };
}

const SPECS: BeaconHookSpec[] = [
  { event: 'SessionStart', matcher: '', command: 'bh --beacon-marker beacon claude SessionStart', timeout: 5 },
  { event: 'Notification', matcher: 'permission_prompt|idle_prompt', command: 'bh --beacon-marker beacon claude Notification', timeout: 5 },
  { event: 'Stop', command: 'bh --beacon-marker beacon claude Stop', timeout: 5 },
  { event: 'UserPromptSubmit', command: 'bh --beacon-marker beacon claude UserPromptSubmit', timeout: 5 },
];

describe('isBeaconCommand', () => {
  it('detects the marker flag', () => {
    expect(isBeaconCommand('bh --beacon-marker beacon claude Stop')).toBe(true);
    expect(isBeaconCommand('user-done')).toBe(false);
  });
});

describe('mergeBeaconHooks', () => {
  it('does not mutate the input config', () => {
    const input = existingClaude();
    const snapshot = JSON.parse(JSON.stringify(input));
    mergeBeaconHooks(input, SPECS);
    expect(input).toEqual(snapshot);
  });

  it('preserves all sibling keys and existing hooks', () => {
    const merged = mergeBeaconHooks(existingClaude(), SPECS);
    expect(merged.env).toEqual({ FOO: 'bar' });
    expect(merged.permissions).toEqual({ allow: [] });
    expect(merged.statusLine).toEqual({ type: 'command' });
    // user's Notification group still present, untouched
    expect(merged.hooks!.Notification).toContainEqual(
      { matcher: 'permission_prompt', hooks: [{ type: 'command', command: 'afplay glass.aiff' }] },
    );
  });

  it('adds Beacon entries as their own isolated groups', () => {
    const merged = mergeBeaconHooks(existingClaude(), SPECS);
    // SessionStart now has the user group + a Beacon group
    expect(merged.hooks!.SessionStart).toHaveLength(2);
    const beaconGroup = merged.hooks!.SessionStart.find(g =>
      g.hooks.some(h => h.command.includes('--beacon-marker')));
    expect(beaconGroup).toEqual({
      matcher: '',
      hooks: [{ type: 'command', command: 'bh --beacon-marker beacon claude SessionStart', timeout: 5 }],
    });
    // brand-new event created for UserPromptSubmit
    expect(merged.hooks!.UserPromptSubmit).toHaveLength(1);
  });

  it('omits the matcher field when the spec omits it', () => {
    const merged = mergeBeaconHooks(existingClaude(), SPECS);
    const ups = merged.hooks!.UserPromptSubmit[0]!;
    expect('matcher' in ups).toBe(false);
  });

  it('is idempotent: re-merging changes nothing', () => {
    const once = mergeBeaconHooks(existingClaude(), SPECS);
    const twice = mergeBeaconHooks(once, SPECS);
    expect(twice).toEqual(once);
  });
});

describe('removeBeaconHooks round-trips merge', () => {
  it('restores exactly the original hooks (and siblings)', () => {
    const original = existingClaude();
    const merged = mergeBeaconHooks(original, SPECS);
    const restored = removeBeaconHooks(merged);
    expect(restored).toEqual(original);
  });

  it('prunes emptied Beacon-only events entirely', () => {
    const merged = mergeBeaconHooks(existingClaude(), SPECS);
    const restored = removeBeaconHooks(merged);
    expect(restored.hooks!.UserPromptSubmit).toBeUndefined();
  });

  it('leaves a config with no Beacon hooks untouched', () => {
    const plain = existingClaude();
    expect(removeBeaconHooks(plain)).toEqual(plain);
  });
});

describe('planMerge / planUninstall', () => {
  it('planMerge reports additions vs alreadyPresent', () => {
    const fresh = planMerge(existingClaude(), SPECS);
    expect(fresh.additions).toHaveLength(SPECS.length);
    expect(fresh.alreadyPresent).toHaveLength(0);

    const merged = mergeBeaconHooks(existingClaude(), SPECS);
    const again = planMerge(merged, SPECS);
    expect(again.additions).toHaveLength(0);
    expect(again.alreadyPresent).toHaveLength(SPECS.length);
  });

  it('planUninstall lists every marker-bearing entry', () => {
    const merged = mergeBeaconHooks(existingClaude(), SPECS);
    const plan = planUninstall(merged);
    expect(plan.removals).toHaveLength(SPECS.length);
    expect(plan.removals.every(r => r.command.includes('--beacon-marker'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/installer/hooks-merge.test.ts`
Expected: FAIL — cannot resolve `src/installer/hooks-merge`.

- [ ] **Step 3: Write `src/installer/hooks-merge.ts`**

```ts
import {
  BEACON_MARKER_FLAG, type BeaconHookSpec, type HookConfig, type HookGroup, type MergePlan, type UninstallPlan,
} from './types';

/** A command belongs to Beacon iff it carries the marker flag. */
export function isBeaconCommand(command: string): boolean {
  return command.includes(BEACON_MARKER_FLAG);
}

/** True if the config already has a Beacon hook with this exact command under `event`. */
export function hasBeaconHook(config: HookConfig, event: string, command: string): boolean {
  const groups = config.hooks?.[event];
  if (!groups) return false;
  return groups.some(g => (g.hooks ?? []).some(h => h.command === command));
}

/** Deep clone a plain JSON config (configs are pure JSON). */
function clone(config: HookConfig): HookConfig {
  return JSON.parse(JSON.stringify(config ?? {}));
}

/** Merge Beacon specs into a config. New object; idempotent; preserves siblings + existing hooks. */
export function mergeBeaconHooks(config: HookConfig, specs: BeaconHookSpec[]): HookConfig {
  const next = clone(config);
  const hooks = (next.hooks ??= {});
  for (const spec of specs) {
    if (hasBeaconHook(next, spec.event, spec.command)) continue; // idempotent
    const arr = (hooks[spec.event] ??= []);
    const entry = spec.timeout != null
      ? { type: 'command' as const, command: spec.command, timeout: spec.timeout }
      : { type: 'command' as const, command: spec.command };
    const group: HookGroup = { hooks: [entry] };
    if (spec.matcher !== undefined) group.matcher = spec.matcher; // own isolated group
    arr.push(group);
  }
  return next;
}

/** Remove only marker-bearing entries; prune emptied groups + emptied events. New object. */
export function removeBeaconHooks(config: HookConfig): HookConfig {
  const next = clone(config);
  const hooks = next.hooks;
  if (!hooks) return next;
  for (const event of Object.keys(hooks)) {
    const pruned: HookGroup[] = [];
    for (const g of hooks[event]!) {
      const kept = (g.hooks ?? []).filter(h => !isBeaconCommand(h.command));
      if (kept.length > 0) pruned.push({ ...g, hooks: kept });
    }
    if (pruned.length > 0) hooks[event] = pruned;
    else delete hooks[event];
  }
  return next;
}

export function planMerge(config: HookConfig, specs: BeaconHookSpec[]): MergePlan {
  const additions: MergePlan['additions'] = [];
  const alreadyPresent: MergePlan['alreadyPresent'] = [];
  for (const spec of specs) {
    const entry = { event: spec.event, matcher: spec.matcher, command: spec.command };
    (hasBeaconHook(config, spec.event, spec.command) ? alreadyPresent : additions).push(entry);
  }
  return { additions, alreadyPresent };
}

export function planUninstall(config: HookConfig): UninstallPlan {
  const removals: UninstallPlan['removals'] = [];
  const hooks = config.hooks ?? {};
  for (const event of Object.keys(hooks)) {
    for (const g of hooks[event]!) {
      for (const h of g.hooks ?? []) {
        if (isBeaconCommand(h.command)) removals.push({ event, matcher: g.matcher, command: h.command });
      }
    }
  }
  return { removals };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/installer/hooks-merge.test.ts` → Expected: PASS (all).
Run: `npm run typecheck` → Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/installer/hooks-merge.ts tests/installer/hooks-merge.test.ts
git commit -m "feat(installer): pure idempotent hook merge + marker-based uninstall"
```

---

### Task 3: Atomic file IO (lock + backup + temp + rename + strict validate)

**Files:**
- Create: `src/installer/atomic-file.ts`
- Test: `tests/installer/atomic-file.test.ts`

**Interfaces:**
- Produces:
  - `readJsonOrDefault<T>(path: string, fallback: T): T` — missing/empty file → fallback; malformed JSON → throws a clear error (never silently overwrite).
  - `writeJsonAtomic(path: string, obj: unknown, opts?: { now?: number; backup?: boolean }): { backupPath?: string }` — exclusive lock (`<path>.beacon-lock`), optional backup (`<path>.beacon-backup-<now>`), temp file + `rename`, strict re-serialize/parse, `0o600` perms, lock released + tmp/lock cleaned in `finally`.

- [ ] **Step 1: Write the failing test**

Create `tests/installer/atomic-file.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, openSync, closeSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJsonOrDefault, writeJsonAtomic } from '../../src/installer/atomic-file';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'beacon-atomic-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('readJsonOrDefault', () => {
  it('returns the fallback when the file is missing', () => {
    expect(readJsonOrDefault(join(dir, 'nope.json'), { hooks: {} })).toEqual({ hooks: {} });
  });
  it('returns the fallback when the file is empty/whitespace', () => {
    const p = join(dir, 'empty.json'); writeFileSync(p, '   \n');
    expect(readJsonOrDefault(p, { a: 1 })).toEqual({ a: 1 });
  });
  it('parses valid JSON', () => {
    const p = join(dir, 'ok.json'); writeFileSync(p, '{"x":42}');
    expect(readJsonOrDefault(p, {})).toEqual({ x: 42 });
  });
  it('throws (does NOT return fallback) on malformed JSON', () => {
    const p = join(dir, 'bad.json'); writeFileSync(p, '{not json');
    expect(() => readJsonOrDefault(p, {})).toThrow(/not valid JSON/i);
  });
});

describe('writeJsonAtomic', () => {
  it('writes pretty JSON with a trailing newline and re-reads equal', () => {
    const p = join(dir, 'out.json');
    writeJsonAtomic(p, { hooks: { Stop: [] } });
    const text = readFileSync(p, 'utf8');
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toEqual({ hooks: { Stop: [] } });
  });
  it('backs up an existing file to .beacon-backup-<now>', () => {
    const p = join(dir, 'cfg.json'); writeFileSync(p, '{"old":true}');
    const { backupPath } = writeJsonAtomic(p, { new: true }, { now: 123 });
    expect(backupPath).toBe(`${p}.beacon-backup-123`);
    expect(JSON.parse(readFileSync(backupPath!, 'utf8'))).toEqual({ old: true });
    expect(JSON.parse(readFileSync(p, 'utf8'))).toEqual({ new: true });
  });
  it('does not back up when the file does not yet exist', () => {
    const p = join(dir, 'fresh.json');
    const { backupPath } = writeJsonAtomic(p, { a: 1 });
    expect(backupPath).toBeUndefined();
  });
  it('writes with 0600 permissions', () => {
    const p = join(dir, 'perm.json');
    writeJsonAtomic(p, { a: 1 });
    expect(statSync(p).mode & 0o777).toBe(0o600);
  });
  it('aborts when a lock is already held', () => {
    const p = join(dir, 'locked.json');
    const fd = openSync(`${p}.beacon-lock`, 'wx'); // pre-hold the lock
    try {
      expect(() => writeJsonAtomic(p, { a: 1 })).toThrow(/in progress/i);
    } finally { closeSync(fd); }
  });
  it('leaves no .beacon-tmp / .beacon-lock residue after success', () => {
    const p = join(dir, 'clean.json');
    writeJsonAtomic(p, { a: 1 });
    const leftovers = readdirSync(dir).filter(f => f.includes('.beacon-tmp') || f.includes('.beacon-lock'));
    expect(leftovers).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/installer/atomic-file.test.ts`
Expected: FAIL — cannot resolve `src/installer/atomic-file`.

- [ ] **Step 3: Write `src/installer/atomic-file.ts`**

```ts
import { closeSync, copyFileSync, existsSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';

/** Read+parse JSON. Missing/empty file → fallback. Malformed JSON → throw (never silently overwrite). */
export function readJsonOrDefault<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  const text = readFileSync(path, 'utf8');
  if (text.trim() === '') return fallback;
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new Error(
      `Refusing to proceed: ${path} is not valid JSON (${(e as Error).message}). ` +
      `Fix or remove it; Beacon will not overwrite a file it cannot parse.`,
    );
  }
}

export interface WriteOptions { now?: number; backup?: boolean; }

/**
 * Atomically write `obj` as pretty JSON:
 * exclusive lock → backup (unless disabled) → temp file (0600) → rename over target.
 * Strict-serializes+parses before touching disk. Lock + temp cleaned in `finally`.
 */
export function writeJsonAtomic(path: string, obj: unknown, opts: WriteOptions = {}): { backupPath?: string } {
  const json = JSON.stringify(obj, null, 2) + '\n';
  JSON.parse(json); // strict validate what we are about to write

  const lockPath = `${path}.beacon-lock`;
  let lockFd: number;
  try {
    lockFd = openSync(lockPath, 'wx'); // exclusive-create; throws if already held
  } catch {
    throw new Error(
      `Another Beacon install is in progress (lock exists: ${lockPath}). ` +
      `If this lock is stale, remove it and retry.`,
    );
  }

  const tmpPath = `${path}.beacon-tmp-${process.pid}`;
  try {
    let backupPath: string | undefined;
    if (opts.backup !== false && existsSync(path)) {
      backupPath = `${path}.beacon-backup-${opts.now ?? Date.now()}`;
      copyFileSync(path, backupPath);
    }
    writeFileSync(tmpPath, json, { encoding: 'utf8', mode: 0o600 });
    renameSync(tmpPath, path); // atomic on the same filesystem
    return { backupPath };
  } finally {
    try { if (existsSync(tmpPath)) unlinkSync(tmpPath); } catch { /* best-effort */ }
    closeSync(lockFd);
    try { unlinkSync(lockPath); } catch { /* best-effort */ }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/installer/atomic-file.test.ts` → Expected: PASS (all).
Run: `npm run typecheck` → Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/installer/atomic-file.ts tests/installer/atomic-file.test.ts
git commit -m "feat(installer): atomic JSON writer with lock, backup, strict validation"
```

---

### Task 4: Hook-command resolver + esbuild build + bin entries

**Files:**
- Create: `src/installer/resolve-hook-command.ts`
- Test: `tests/installer/resolve-hook-command.test.ts`
- Modify: `package.json` (add `esbuild` devDependency, `build:hook`/`build:installer`/`build` scripts, `bin` entries)

**Interfaces:**
- Produces:
  - `resolveHookCommand(opts?: { rootDir?: string; nodeBin?: string }): string` — returns a shell-safe invocation prefix `<nodeBin> "<rootDir>/dist/hook/beacon-hook.cjs"`. `nodeBin` defaults to `'node'`; `rootDir` defaults to the package root (best-effort from `import.meta.url`).
- Note for M3: packaging may switch the prefix to the bundled binary via `ELECTRON_RUN_AS_NODE`; this resolver is the single place to change.

- [ ] **Step 1: Write the failing test**

Create `tests/installer/resolve-hook-command.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveHookCommand } from '../../src/installer/resolve-hook-command';

describe('resolveHookCommand', () => {
  it('builds "<node> \"<root>/dist/hook/beacon-hook.cjs\"" with explicit opts', () => {
    expect(resolveHookCommand({ rootDir: '/x', nodeBin: 'node' }))
      .toBe('node "/x/dist/hook/beacon-hook.cjs"');
  });
  it('defaults nodeBin to "node"', () => {
    expect(resolveHookCommand({ rootDir: '/x' }).startsWith('node ')).toBe(true);
  });
  it('shell-quotes a rootDir containing spaces', () => {
    expect(resolveHookCommand({ rootDir: '/a b' }))
      .toContain('"/a b/dist/hook/beacon-hook.cjs"');
  });
  it('escapes embedded quotes/backslashes in the path', () => {
    const out = resolveHookCommand({ rootDir: '/a"b' });
    expect(out).toContain('\\"'); // the embedded quote is backslash-escaped
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/installer/resolve-hook-command.test.ts`
Expected: FAIL — cannot resolve `src/installer/resolve-hook-command`.

- [ ] **Step 3: Write `src/installer/resolve-hook-command.ts`**

```ts
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Double-quote a path for embedding in a POSIX shell command string. */
function shellQuote(p: string): string {
  return `"${p.replace(/(["\\$`])/g, '\\$1')}"`;
}

export interface ResolveOptions {
  /** Install/repo root that contains `dist/`. Defaults to the package root. */
  rootDir?: string;
  /** Node binary to invoke (resolved from the CLI's PATH at hook time). Defaults to 'node'. */
  nodeBin?: string;
}

/**
 * Resolve the shell-safe invocation prefix for the built beacon-hook.
 * Dev/runnable default: `node "<root>/dist/hook/beacon-hook.cjs"`.
 * (M3 packaging is the single place to switch to the bundled binary.)
 */
export function resolveHookCommand(opts: ResolveOptions = {}): string {
  const root = opts.rootDir ?? defaultRoot();
  const node = opts.nodeBin ?? 'node';
  return `${node} ${shellQuote(join(root, 'dist', 'hook', 'beacon-hook.cjs'))}`;
}

/** Best-effort package root: this file sits at <root>/src/installer/, so go up two levels. */
function defaultRoot(): string {
  const here = fileURLToPath(new URL('.', import.meta.url)); // .../src/installer/
  return join(here, '..', '..');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/installer/resolve-hook-command.test.ts` → Expected: PASS.
Run: `npm run typecheck` → Expected: clean.

- [ ] **Step 5: Add esbuild, build scripts, and bin entries to `package.json`**

Run: `npm install --save-dev esbuild@^0.24.0`

Then edit `package.json` so it contains these (merge into existing `scripts`; add `bin` as a sibling of `scripts`):

```json
  "bin": {
    "beacon-hook": "dist/hook/beacon-hook.cjs",
    "beacon-install": "dist/installer/cli.cjs"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "build:hook": "esbuild src/hook/beacon-hook.ts --bundle --platform=node --target=node20 --format=cjs --outfile=dist/hook/beacon-hook.cjs",
    "build:installer": "esbuild src/installer/cli-entry.ts --bundle --platform=node --target=node20 --format=cjs --outfile=dist/installer/cli.cjs",
    "build": "npm run build:hook && npm run build:installer"
  }
```

(Keep any other existing scripts. `build:installer` depends on `cli-entry.ts` which is created in Task 6 — that is fine; it is only invoked then. No `--banner` is needed: esbuild automatically preserves the `#!/usr/bin/env node` shebang that begins each entry file — `beacon-hook.ts` already has one, and `cli-entry.ts` adds one in Task 6.)

Add `dist/` to `.gitignore` if not already present:

Run: `grep -qxF 'dist/' .gitignore || printf 'dist/\n' >> .gitignore`

- [ ] **Step 6: Verify the hook actually builds and runs (exit 0, never blocks)**

Run:
```bash
npm run build:hook
test -f dist/hook/beacon-hook.cjs && echo "BUILT"
printf '{}' | node dist/hook/beacon-hook.cjs --beacon-marker beacon claude SessionStart; echo "exit=$?"
```
Expected: prints `BUILT`, then `exit=0` (collector not running → socket error is swallowed; the hook always exits 0 and does not hang).

- [ ] **Step 7: Commit**

```bash
git add src/installer/resolve-hook-command.ts tests/installer/resolve-hook-command.test.ts package.json package-lock.json .gitignore
git commit -m "feat(installer): hook-command resolver + esbuild build + bin entries"
```

---

### Task 5: Install / uninstall / dry-run orchestration

**Files:**
- Create: `src/installer/install.ts`
- Test: `tests/installer/install.test.ts`

**Interfaces:**
- Consumes: `claudeHookSpecs`/`codexHookSpecs` (Task 1), `mergeBeaconHooks`/`planMerge`/`planUninstall`/`removeBeaconHooks` (Task 2), `readJsonOrDefault`/`writeJsonAtomic` (Task 3), `resolveHookCommand` (Task 4), `DEFAULT_MARKER_ID`/`HookConfig`/`MergePlan` (Task 1), `Tool`.
- Produces:
  - `InstallTarget { tool: Tool; path: string; specs: BeaconHookSpec[] }`
  - `defaultTargets(invocation?, markerId?): InstallTarget[]` — Claude `~/.claude/settings.json` + Codex `~/.codex/hooks.json`.
  - `CODEX_TRUST_REVIEW_MESSAGE: string`
  - `dryRunInstall(targets): Array<{ tool: Tool; path: string; merge: MergePlan }>`
  - `installHooks(targets, opts?: { now?: number }): { results: Array<{ tool: Tool; path: string; added: number; backupPath?: string }>; trustMessage: string }`
  - `uninstallHooks(targets, opts?: { now?: number }): Array<{ tool: Tool; path: string; removed: number; backupPath?: string }>`

- [ ] **Step 1: Write the failing test**

Create `tests/installer/install.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InstallTarget } from '../../src/installer/install';
import { dryRunInstall, installHooks, uninstallHooks, defaultTargets, CODEX_TRUST_REVIEW_MESSAGE } from '../../src/installer/install';
import { claudeHookSpecs, codexHookSpecs } from '../../src/installer/hook-specs';

let dir: string;
let claudePath: string;
let codexPath: string;
const INV = 'node "/x/dist/hook/beacon-hook.cjs"';

function targets(): InstallTarget[] {
  return [
    { tool: 'claude', path: claudePath, specs: claudeHookSpecs(INV, 'beacon') },
    { tool: 'codex', path: codexPath, specs: codexHookSpecs(INV, 'beacon') },
  ];
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'beacon-install-'));
  claudePath = join(dir, 'settings.json');
  codexPath = join(dir, 'hooks.json');
  // Pre-existing user content (must survive).
  writeFileSync(claudePath, JSON.stringify({
    env: { A: '1' },
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'user-done' }] }] },
  }));
  writeFileSync(codexPath, JSON.stringify({
    hooks: { SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: 'user-codex' }] }] },
  }));
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('defaultTargets', () => {
  it('targets the two real dotfiles with the right specs', () => {
    const ts = defaultTargets(INV, 'beacon');
    expect(ts.map(t => t.tool)).toEqual(['claude', 'codex']);
    expect(ts[0]!.path.endsWith('/.claude/settings.json')).toBe(true);
    expect(ts[1]!.path.endsWith('/.codex/hooks.json')).toBe(true);
    expect(ts[0]!.specs.length).toBe(6);
    expect(ts[1]!.specs.length).toBe(5);
  });
});

describe('dryRunInstall', () => {
  it('reports planned additions and mutates nothing', () => {
    const before = readFileSync(claudePath, 'utf8');
    const plans = dryRunInstall(targets());
    expect(plans.find(p => p.tool === 'claude')!.merge.additions).toHaveLength(6);
    expect(plans.find(p => p.tool === 'codex')!.merge.additions).toHaveLength(5);
    expect(readFileSync(claudePath, 'utf8')).toBe(before); // unchanged
    expect(existsSync(`${claudePath}.beacon-backup-`)).toBe(false);
  });
});

describe('installHooks', () => {
  it('merges Beacon hooks, preserves user hooks, backs up, returns trust message', () => {
    const { results, trustMessage } = installHooks(targets(), { now: 1 });
    expect(trustMessage).toBe(CODEX_TRUST_REVIEW_MESSAGE);

    const claude = JSON.parse(readFileSync(claudePath, 'utf8'));
    expect(claude.env).toEqual({ A: '1' });                       // sibling preserved
    expect(JSON.stringify(claude)).toContain('--beacon-marker');  // beacon installed
    expect(JSON.stringify(claude)).toContain('user-done');        // user hook preserved

    expect(results.find(r => r.tool === 'claude')!.added).toBe(6);
    expect(results.find(r => r.tool === 'claude')!.backupPath).toBe(`${claudePath}.beacon-backup-1`);
    expect(existsSync(`${claudePath}.beacon-backup-1`)).toBe(true);
  });

  it('is idempotent: a second install adds nothing and writes nothing', () => {
    installHooks(targets(), { now: 1 });
    const afterFirst = readFileSync(claudePath, 'utf8');
    const { results } = installHooks(targets(), { now: 2 });
    expect(results.find(r => r.tool === 'claude')!.added).toBe(0);
    expect(readFileSync(claudePath, 'utf8')).toBe(afterFirst);            // unchanged
    expect(existsSync(`${claudePath}.beacon-backup-2`)).toBe(false);      // no second backup
  });

  it('handles a missing target file by creating it from scratch', () => {
    rmSync(codexPath);
    installHooks(targets(), { now: 1 });
    const codex = JSON.parse(readFileSync(codexPath, 'utf8'));
    expect(JSON.stringify(codex)).toContain('--beacon-marker');
  });
});

describe('uninstallHooks', () => {
  it('removes only Beacon hooks and restores the original user config', () => {
    const originalClaude = readFileSync(claudePath, 'utf8');
    const originalCodex = readFileSync(codexPath, 'utf8');

    installHooks(targets(), { now: 1 });
    const results = uninstallHooks(targets(), { now: 2 });

    expect(results.find(r => r.tool === 'claude')!.removed).toBe(6);
    expect(results.find(r => r.tool === 'codex')!.removed).toBe(5);
    // Beacon gone; user hooks intact (compare parsed structure to the originals).
    expect(JSON.parse(readFileSync(claudePath, 'utf8'))).toEqual(JSON.parse(originalClaude));
    expect(JSON.parse(readFileSync(codexPath, 'utf8'))).toEqual(JSON.parse(originalCodex));
  });

  it('is a no-op when nothing is installed', () => {
    const results = uninstallHooks(targets());
    expect(results.every(r => r.removed === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/installer/install.test.ts`
Expected: FAIL — cannot resolve `src/installer/install`.

- [ ] **Step 3: Write `src/installer/install.ts`**

```ts
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Tool } from '../domain/types';
import { claudeHookSpecs, codexHookSpecs } from './hook-specs';
import { mergeBeaconHooks, planMerge, planUninstall, removeBeaconHooks } from './hooks-merge';
import { readJsonOrDefault, writeJsonAtomic } from './atomic-file';
import { resolveHookCommand } from './resolve-hook-command';
import { DEFAULT_MARKER_ID, type BeaconHookSpec, type HookConfig, type MergePlan } from './types';

export interface InstallTarget {
  tool: Tool;
  path: string;
  specs: BeaconHookSpec[];
}

/** The two real dotfile targets. `invocation`/`markerId` are injectable for tests. */
export function defaultTargets(invocation = resolveHookCommand(), markerId = DEFAULT_MARKER_ID): InstallTarget[] {
  return [
    { tool: 'claude', path: join(homedir(), '.claude', 'settings.json'), specs: claudeHookSpecs(invocation, markerId) },
    { tool: 'codex', path: join(homedir(), '.codex', 'hooks.json'), specs: codexHookSpecs(invocation, markerId) },
  ];
}

export const CODEX_TRUST_REVIEW_MESSAGE =
  'Codex: run `/hooks` inside the Codex CLI to review and trust the newly added Beacon hooks ' +
  '(they will not fire until trusted).';

export interface TargetPlan { tool: Tool; path: string; merge: MergePlan; }
export function dryRunInstall(targets: InstallTarget[]): TargetPlan[] {
  return targets.map(t => ({
    tool: t.tool,
    path: t.path,
    merge: planMerge(readJsonOrDefault<HookConfig>(t.path, {}), t.specs),
  }));
}

export interface InstallResult { tool: Tool; path: string; added: number; backupPath?: string; }
export function installHooks(targets: InstallTarget[], opts: { now?: number } = {}): {
  results: InstallResult[]; trustMessage: string;
} {
  const results: InstallResult[] = [];
  for (const t of targets) {
    const current = readJsonOrDefault<HookConfig>(t.path, {});
    const plan = planMerge(current, t.specs);
    if (plan.additions.length === 0) { results.push({ tool: t.tool, path: t.path, added: 0 }); continue; }
    const { backupPath } = writeJsonAtomic(t.path, mergeBeaconHooks(current, t.specs), { now: opts.now });
    results.push({ tool: t.tool, path: t.path, added: plan.additions.length, backupPath });
  }
  return { results, trustMessage: CODEX_TRUST_REVIEW_MESSAGE };
}

export interface UninstallResult { tool: Tool; path: string; removed: number; backupPath?: string; }
export function uninstallHooks(targets: InstallTarget[], opts: { now?: number } = {}): UninstallResult[] {
  const results: UninstallResult[] = [];
  for (const t of targets) {
    const current = readJsonOrDefault<HookConfig>(t.path, {});
    const plan = planUninstall(current);
    if (plan.removals.length === 0) { results.push({ tool: t.tool, path: t.path, removed: 0 }); continue; }
    const { backupPath } = writeJsonAtomic(t.path, removeBeaconHooks(current), { now: opts.now });
    results.push({ tool: t.tool, path: t.path, removed: plan.removals.length, backupPath });
  }
  return results;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/installer/install.test.ts` → Expected: PASS (all).
Run: `npm run typecheck` → Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/installer/install.ts tests/installer/install.test.ts
git commit -m "feat(installer): install/uninstall/dry-run orchestration over targets"
```

---

### Task 6: Installer CLI

**Files:**
- Create: `src/installer/cli.ts`
- Create: `src/installer/cli-entry.ts`
- Test: `tests/installer/cli.test.ts`

**Interfaces:**
- Consumes: `dryRunInstall`/`installHooks`/`uninstallHooks`/`defaultTargets`/`CODEX_TRUST_REVIEW_MESSAGE`/`InstallTarget` (Task 5).
- Produces:
  - `CliDeps { targets: InstallTarget[]; dryRun: (t)=>TargetPlan[]; install: (t)=>{results: InstallResult[]; trustMessage: string}; uninstall: (t)=>UninstallResult[]; log: (s: string) => void }` (explicit function-type signatures, not `typeof`)
  - `runInstallerCli(argv: string[], deps: CliDeps): number` — pure dispatcher (`--dry-run` / `--uninstall` / default install); returns exit code; all IO via injected deps.
  - `cli-entry.ts` — thin real entrypoint (wires real deps, calls `runInstallerCli`, `process.exit`); bundled by `build:installer`.

- [ ] **Step 1: Write the failing test**

Create `tests/installer/cli.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { runInstallerCli, type CliDeps } from '../../src/installer/cli';
import { CODEX_TRUST_REVIEW_MESSAGE } from '../../src/installer/install';

function makeDeps(overrides: Partial<CliDeps> = {}): { deps: CliDeps; calls: string[]; logs: string[] } {
  const calls: string[] = [];
  const logs: string[] = [];
  const deps: CliDeps = {
    targets: [],
    dryRun: ((_t) => { calls.push('dryRun'); return [{ tool: 'claude', path: '/c', merge: { additions: [{ event: 'Stop', command: 'x' }], alreadyPresent: [] } }]; }) as CliDeps['dryRun'],
    install: ((_t) => { calls.push('install'); return { results: [{ tool: 'claude', path: '/c', added: 6, backupPath: '/c.bak' }], trustMessage: CODEX_TRUST_REVIEW_MESSAGE }; }) as CliDeps['install'],
    uninstall: ((_t) => { calls.push('uninstall'); return [{ tool: 'claude', path: '/c', removed: 6 }]; }) as CliDeps['uninstall'],
    log: (s) => logs.push(s),
    ...overrides,
  };
  return { deps, calls, logs };
}

describe('runInstallerCli', () => {
  it('default (no flags) installs and prints the Codex trust message', () => {
    const { deps, calls, logs } = makeDeps();
    expect(runInstallerCli([], deps)).toBe(0);
    expect(calls).toEqual(['install']);
    expect(logs.join('\n')).toContain(CODEX_TRUST_REVIEW_MESSAGE);
    expect(logs.join('\n')).toContain('added 6');
  });

  it('--dry-run plans only, never installs or uninstalls', () => {
    const { deps, calls, logs } = makeDeps();
    expect(runInstallerCli(['--dry-run'], deps)).toBe(0);
    expect(calls).toEqual(['dryRun']);
    expect(logs.join('\n')).toContain('to add');
  });

  it('--uninstall removes only, never installs', () => {
    const { deps, calls } = makeDeps();
    expect(runInstallerCli(['--uninstall'], deps)).toBe(0);
    expect(calls).toEqual(['uninstall']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/installer/cli.test.ts`
Expected: FAIL — cannot resolve `src/installer/cli`.

- [ ] **Step 3: Write `src/installer/cli.ts`**

```ts
import type { InstallTarget, TargetPlan, InstallResult, UninstallResult } from './install';

// Explicit function-type signatures (NOT `typeof installHooks`): a type-only import
// has no value binding, so `typeof` on it would fail typecheck.
export interface CliDeps {
  targets: InstallTarget[];
  dryRun: (targets: InstallTarget[]) => TargetPlan[];
  install: (targets: InstallTarget[]) => { results: InstallResult[]; trustMessage: string };
  uninstall: (targets: InstallTarget[]) => UninstallResult[];
  log: (s: string) => void;
}

/** Pure CLI dispatcher. All IO goes through injected deps; returns the process exit code. */
export function runInstallerCli(argv: string[], deps: CliDeps): number {
  if (argv.includes('--uninstall')) {
    for (const r of deps.uninstall(deps.targets)) {
      deps.log(`[${r.tool}] removed ${r.removed} Beacon hook(s) from ${r.path}` +
        (r.backupPath ? ` (backup: ${r.backupPath})` : ''));
    }
    return 0;
  }
  if (argv.includes('--dry-run')) {
    for (const p of deps.dryRun(deps.targets)) {
      deps.log(`[${p.tool}] ${p.path}: ${p.merge.additions.length} to add, ` +
        `${p.merge.alreadyPresent.length} already present`);
      for (const a of p.merge.additions) deps.log(`   + ${a.event}${a.matcher ? ` [${a.matcher}]` : ''}`);
    }
    return 0;
  }
  const { results, trustMessage } = deps.install(deps.targets);
  for (const r of results) {
    deps.log(`[${r.tool}] added ${r.added} Beacon hook(s) to ${r.path}` +
      (r.backupPath ? ` (backup: ${r.backupPath})` : ''));
  }
  deps.log(trustMessage);
  return 0;
}
```

- [ ] **Step 4: Write `src/installer/cli-entry.ts`** (thin real entrypoint, bundled by esbuild — not unit-tested)

```ts
#!/usr/bin/env node
import { runInstallerCli } from './cli';
import { defaultTargets, dryRunInstall, installHooks, uninstallHooks } from './install';

const code = runInstallerCli(process.argv.slice(2), {
  targets: defaultTargets(),
  dryRun: dryRunInstall,
  install: installHooks,
  uninstall: uninstallHooks,
  log: (s) => console.log(s),
});
process.exit(code);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/installer/cli.test.ts` → Expected: PASS (all).
Run: `npm run typecheck` → Expected: clean.

- [ ] **Step 6: Verify the installer CLI builds and dry-runs against a scratch HOME (NEVER the real dotfiles)**

Run:
```bash
npm run build:installer
test -f dist/installer/cli.cjs && echo "BUILT"
SCRATCH="$(mktemp -d)"; mkdir -p "$SCRATCH/.claude" "$SCRATCH/.codex"
HOME="$SCRATCH" node dist/installer/cli.cjs --dry-run; echo "exit=$?"
rm -rf "$SCRATCH"
```
Expected: prints `BUILT`, a dry-run plan listing additions for `[claude]` and `[codex]`, then `exit=0`. (Using a scratch `HOME` guarantees the real `~/.claude`/`~/.codex` are untouched.)

- [ ] **Step 7: Commit**

```bash
git add src/installer/cli.ts src/installer/cli-entry.ts tests/installer/cli.test.ts
git commit -m "feat(installer): beacon-install CLI (dry-run / install / uninstall)"
```

---

## Post-Plan Notes (for the controller, not steps)

- After Task 6: run the FULL suite (`npx vitest run`) + `npm run typecheck` for the milestone checkpoint; expect the M2a baseline (79) + the new installer tests, all green.
- Final whole-branch review (M2b): `review-package <5b79c3a> <HEAD>` → reviewer (sonnet for this mechanical/well-specified surface; escalate to opus only if the merge/IO logic raises concurrency or data-loss doubts). Focus the reviewer on: never-overwrite + sibling preservation, idempotency, atomic+lock+backup correctness, marker-only uninstall, event strings matching the parser maps, and the **tests-never-touch-real-dotfiles** constraint.
- The Codex independent-verification pass (per ~/.claude/CLAUDE.md): consider a `codex:codex-rescue` review of the merge/atomic-file logic before declaring M2b done — data-loss risk in a file merger is exactly the "non-trivial" surface that warrants it.
- This task set also closes the M3-deferred "package.json bin for beacon-hook" item (Task 4).
