# Beacon M2c — Codex Rollout Reconcile Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the already-built-but-dormant Codex reconcile helpers (`parseRolloutMeta`/`matchesRollout`/`reconcile`) to a rollout-file watcher so a Codex session that arrived under a temporary key gets stamped with its real `codexSessionId` once its `rollout-*.jsonl` appears — without ever merging two unrelated sessions.

**Architecture:** A pure store method `SessionStore.reconcileCodex(rollout)` finds the first un-reconciled Codex session matching a rollout (by git-root + close start-time, via the existing `matchesRollout`) and replaces it in place under its stable `tempId` map key (only the display `id`/`codexSessionId` change). A thin `rollout-watcher` module (mirroring the collector's durable style) recursively watches `~/.codex/sessions/` for `rollout-*.jsonl` files, reads each one's first `session_meta` line via the existing `parseRolloutMeta`, and hands the `RolloutInfo` to a callback (which M3 wires to `store.reconcileCodex`). An end-to-end integration test proves the temp-id → reconcile path and that mark-seen/badge keep working by `tempId` afterward.

**Tech Stack:** TypeScript (strict, ESM), Node 20+, vitest. No new dependencies.

## Global Constraints

- TypeScript strict ESM; Node 20+; npm; vitest. `npm run typecheck` (`tsc --noEmit`) MUST stay clean — **vitest does NOT typecheck**, so run typecheck separately every task.
- Per-task commits ON branch `main` are EXPLICITLY AUTHORIZED for this build. Commit style: `feat(domain):`, `feat(collector):`, `test(e2e):`, `docs:`. **NEVER include `Co-Authored-By` lines.** (Subagents may emit a false-positive "CLAUDE.md forbids commit" warning — wrong for this build; commit anyway.)
- **Tests MUST use `os.tmpdir()` scratch paths ONLY. NEVER read/watch the user's real `~/.codex/sessions`.**
- **Identity safety (from spec §4.3):** reconcile changes ONLY the display `id` + `codexSessionId`; the store map key is `tempId` and stays stable, so `markSeen`/`attentionCount`/persistence keep working. NEVER merge two unrelated sessions on weak signals — `matchesRollout` already requires `tool==='codex'` AND `!codexSessionId` AND exact `gitRoot` match AND start-time within tolerance (10s). `reconcileCodex` reconciles AT MOST ONE session per rollout (the first match); a second same-repo session reconciles from its OWN rollout file. Reconcile is idempotent: an already-reconciled session no longer matches.
- **id-vs-tempId contract (resolves M2-handoff item 2):** the store is keyed by `tempId` (= `event.key`). `id` is DISPLAY-ONLY (set by `reconcile`). All store lookups (`get`/`markSeen`) use the `tempId`/key. M3 addresses sessions by `tempId`, never by `id`. Document this on `SessionStore`; do NOT add an `id→tempId` index (YAGNI).
- The watcher must be DURABLE: a transient watch/read error must never crash it (mirror the collector's long-lived error handler). The hot path never throws out of the callback.
- All commands run from `/Users/marcus/Projects/beacon`.

## Interfaces consumed (already built — import, do NOT redefine)
- `src/domain/identity.ts`: `parseRolloutMeta(firstLine: string): RolloutInfo | null`, `matchesRollout(session, rollout, tol?=10000): boolean`, `reconcile(session, rollout): Session`.
- `src/domain/types.ts`: `RolloutInfo { codexSessionId: string; gitRoot: string; startedAt: number }`, `Session`, `BeaconEvent`.
- `src/domain/store.ts`: `class SessionStore` (map keyed by `tempId`; has `get`/`all`/`markSeen`/`upsertFromEvent`/`attentionCount`). `src/domain/parser.ts`: `parseHookEvent`. `src/hook/build-event.ts`: `buildRawEvent`.

---

## File Structure

```
src/domain/store.ts             # MODIFY: add reconcileCodex(rollout) + class-level id/tempId doc
src/collector/rollout-watcher.ts # CREATE: readRolloutMeta + scanRolloutDir + startRolloutWatcher
tests/domain/store-reconcile.test.ts   # CREATE: reconcileCodex unit tests
tests/collector/rollout-watcher.test.ts # CREATE: readRolloutMeta + scanRolloutDir unit tests
tests/e2e/codex-reconcile.test.ts       # CREATE: live watch -> reconcile integration test
```

---

### Task 1: `SessionStore.reconcileCodex` + id/tempId contract doc

**Files:**
- Modify: `src/domain/store.ts`
- Test: `tests/domain/store-reconcile.test.ts`

**Interfaces:**
- Consumes: `matchesRollout`, `reconcile` from `./identity`; `RolloutInfo`, `Session` from `./types`.
- Produces: `SessionStore.reconcileCodex(rollout: RolloutInfo): Session | undefined` — reconciles the first matching un-reconciled Codex session in place (key = `tempId`), returns it, or `undefined` if none match.

- [ ] **Step 1: Write the failing test**

Create `tests/domain/store-reconcile.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SessionStore } from '../../src/domain/store';
import { parseHookEvent } from '../../src/domain/parser';
import type { RawHookEvent, RolloutInfo } from '../../src/domain/types';

// A Codex hook event keyed on its ancestor (temp id), no codexSessionId yet.
function codexEvent(over: Partial<RawHookEvent> = {}): RawHookEvent {
  return {
    tool: 'codex', event: 'SessionStart', cwd: '/Users/m/proj', gitRoot: '/Users/m/proj',
    host: 'terminal', remote: 'none', tty: '/dev/ttys009',
    codexAncestorPid: 4242, codexAncestorStartTime: 'StartA', ts: 1_750_000_000_000, ...over,
  };
}
const rollout: RolloutInfo = { codexSessionId: 'uuid-1', gitRoot: '/Users/m/proj', startedAt: 1_750_000_003_000 };

describe('SessionStore.reconcileCodex', () => {
  it('stamps codexSessionId + display id on the matching temp session, keeping the tempId key', () => {
    const store = new SessionStore();
    const s = store.upsertFromEvent(parseHookEvent(codexEvent()));
    const tempId = s.tempId;
    expect(s.codexSessionId).toBeUndefined();

    const r = store.reconcileCodex(rollout);
    expect(r).toBeDefined();
    expect(r!.codexSessionId).toBe('uuid-1');
    expect(r!.id).toBe('codex:uuid-1');
    // still reachable by the ORIGINAL tempId key (reconcile does not change the map key)
    expect(store.get(tempId)!.codexSessionId).toBe('uuid-1');
    expect(store.get(tempId)!.tempId).toBe(tempId);
  });

  it('mark-seen and badge keep working by tempId after reconcile', () => {
    const store = new SessionStore();
    const s = store.upsertFromEvent(parseHookEvent(codexEvent({ event: 'PermissionRequest' })));
    const tempId = s.tempId;
    expect(store.attentionCount()).toBe(1); // needs-you, unseen
    store.reconcileCodex(rollout);
    store.markSeen(tempId);
    expect(store.get(tempId)!.seen).toBe(true);
    expect(store.attentionCount()).toBe(0);
  });

  it('returns undefined when no session matches, and never touches non-matching sessions', () => {
    const store = new SessionStore();
    store.upsertFromEvent(parseHookEvent(codexEvent({ gitRoot: '/other/repo', cwd: '/other/repo' })));
    expect(store.reconcileCodex(rollout)).toBeUndefined();
  });

  it('is idempotent: a second reconcile with the same rollout matches nothing new', () => {
    const store = new SessionStore();
    store.upsertFromEvent(parseHookEvent(codexEvent()));
    expect(store.reconcileCodex(rollout)).toBeDefined();
    expect(store.reconcileCodex(rollout)).toBeUndefined(); // already reconciled -> no re-match
  });

  it('never merges two unrelated same-repo sessions: reconciles only one per rollout', () => {
    const store = new SessionStore();
    const a = store.upsertFromEvent(parseHookEvent(codexEvent({ codexAncestorPid: 1, codexAncestorStartTime: 'A', tty: '/dev/ttys001' })));
    const b = store.upsertFromEvent(parseHookEvent(codexEvent({ codexAncestorPid: 2, codexAncestorStartTime: 'B', tty: '/dev/ttys002' })));
    expect(a.tempId).not.toBe(b.tempId);
    store.reconcileCodex(rollout);
    const reconciledCount = store.all().filter(s => s.codexSessionId === 'uuid-1').length;
    expect(reconciledCount).toBe(1); // exactly one gets the id; the other stays temp
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/store-reconcile.test.ts`
Expected: FAIL — `store.reconcileCodex is not a function`.

- [ ] **Step 3: Implement `reconcileCodex` + the contract doc in `src/domain/store.ts`**

Add the import (merge into the existing import lines at the top):

```ts
import { matchesRollout, reconcile } from './identity';
import type { Session, BeaconEvent, RolloutInfo } from './types';
```

(`store.ts` currently imports `import type { Session, BeaconEvent } from './types';` — extend it to also import `RolloutInfo`, and add the `identity` import.)

Add this class-level doc comment immediately above `export class SessionStore {`:

```ts
/**
 * In-memory session map, keyed by `tempId` (= the event key from identity.eventKey).
 * The `tempId` is stable for a session's whole life; reconcile only updates the DISPLAY `id`
 * (+ codexSessionId). All lookups (get/markSeen) use `tempId`/key — `id` is display-only, so
 * there is intentionally no id->tempId index. M3 addresses sessions by `tempId`.
 */
```

Add this method inside the class (e.g. after `upsertFromEvent`):

```ts
  /**
   * Reconcile a Codex temp session against a rollout's session_meta. Finds the FIRST un-reconciled
   * Codex session matching the rollout (gitRoot + start-time within tolerance, via matchesRollout),
   * stamps its codexSessionId + display id, and stores it under the SAME map key (tempId is stable).
   * Returns the reconciled session, or undefined if nothing matched. Idempotent (an already-reconciled
   * session no longer matches) and never merges: at most one session is reconciled per rollout.
   */
  reconcileCodex(rollout: RolloutInfo): Session | undefined {
    for (const s of this.map.values()) {
      if (matchesRollout(s, rollout)) {
        const reconciled = reconcile(s, rollout);
        this.map.set(s.tempId, reconciled); // map key = tempId, unchanged by reconcile
        return reconciled;
      }
    }
    return undefined;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/store-reconcile.test.ts` → Expected: PASS (all 5).
Run: `npm run typecheck` → Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/domain/store.ts tests/domain/store-reconcile.test.ts
git commit -m "feat(domain): wire Codex rollout reconcile into SessionStore (tempId-stable)"
```

---

### Task 2: Rollout-file watcher (`rollout-watcher.ts`)

**Files:**
- Create: `src/collector/rollout-watcher.ts`
- Test: `tests/collector/rollout-watcher.test.ts`

**Interfaces:**
- Consumes: `parseRolloutMeta` from `../domain/identity`; `RolloutInfo` from `../domain/types`.
- Produces:
  - `readRolloutMeta(path: string): Promise<RolloutInfo | null>` — reads a file's first line, parses session_meta; null if absent/unflushed/non-meta.
  - `scanRolloutDir(dir: string): Promise<RolloutInfo[]>` — recursively finds `rollout-*.jsonl`, parses each session_meta (skips nulls); `[]` if dir missing.
  - `startRolloutWatcher(dir, onRollout, opts?: { initialScan?: boolean }): { close(): void }` — recursive watch + optional initial scan; durable.

- [ ] **Step 1: Write the failing test**

Create `tests/collector/rollout-watcher.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRolloutMeta, scanRolloutDir } from '../../src/collector/rollout-watcher';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'beacon-rollout-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const meta = (id: string, cwd: string) =>
  JSON.stringify({ type: 'session_meta', payload: { id, cwd }, timestamp: '2025-06-22T20:00:00Z' }) + '\n';

describe('readRolloutMeta', () => {
  it('parses the first session_meta line of a rollout file', async () => {
    const p = join(dir, 'rollout-x.jsonl');
    await writeFile(p, meta('uuid-1', '/r') + JSON.stringify({ type: 'event_msg' }) + '\n');
    expect(await readRolloutMeta(p)).toEqual({ codexSessionId: 'uuid-1', gitRoot: '/r', startedAt: Date.parse('2025-06-22T20:00:00Z') });
  });
  it('returns null when the first line is not yet flushed (no newline)', async () => {
    const p = join(dir, 'rollout-partial.jsonl');
    await writeFile(p, '{"type":"session_meta"'); // no newline yet
    expect(await readRolloutMeta(p)).toBeNull();
  });
  it('returns null for a missing file', async () => {
    expect(await readRolloutMeta(join(dir, 'nope.jsonl'))).toBeNull();
  });
  it('returns null for a non-meta first line', async () => {
    const p = join(dir, 'rollout-evt.jsonl');
    await writeFile(p, JSON.stringify({ type: 'event_msg' }) + '\n');
    expect(await readRolloutMeta(p)).toBeNull();
  });
});

describe('scanRolloutDir', () => {
  it('finds rollout files in nested date dirs and ignores non-rollout files', async () => {
    const dateDir = join(dir, '2025', '06', '22');
    await mkdir(dateDir, { recursive: true });
    await writeFile(join(dateDir, 'rollout-a.jsonl'), meta('uuid-a', '/ra'));
    await writeFile(join(dateDir, 'rollout-b.jsonl'), meta('uuid-b', '/rb'));
    await writeFile(join(dateDir, 'notes.txt'), 'ignore me');
    const infos = await scanRolloutDir(dir);
    expect(infos.map(i => i.codexSessionId).sort()).toEqual(['uuid-a', 'uuid-b']);
  });
  it('returns [] for a missing directory', async () => {
    expect(await scanRolloutDir(join(dir, 'absent'))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/collector/rollout-watcher.test.ts`
Expected: FAIL — cannot resolve `src/collector/rollout-watcher`.

- [ ] **Step 3: Write `src/collector/rollout-watcher.ts`**

```ts
import { watch, type FSWatcher } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parseRolloutMeta } from '../domain/identity';
import type { RolloutInfo } from '../domain/types';

const ROLLOUT_RE = /^rollout-.*\.jsonl$/;

/** Read a rollout file's first line and parse its session_meta. Null if absent/unflushed/non-meta. */
export async function readRolloutMeta(path: string): Promise<RolloutInfo | null> {
  let text: string;
  try { text = await readFile(path, 'utf8'); } catch { return null; }
  const nl = text.indexOf('\n');
  if (nl < 0) return null; // first line not fully written yet — a later fs event will retry
  return parseRolloutMeta(text.slice(0, nl));
}

/** Recursively scan a sessions dir for rollout-*.jsonl files and parse each session_meta. */
export async function scanRolloutDir(dir: string): Promise<RolloutInfo[]> {
  let names: string[];
  try { names = (await readdir(dir, { recursive: true })) as string[]; } catch { return []; }
  const out: RolloutInfo[] = [];
  for (const name of names) {
    if (!ROLLOUT_RE.test(basename(name))) continue;
    const info = await readRolloutMeta(join(dir, name));
    if (info) out.push(info);
  }
  return out;
}

export interface RolloutWatcher { close(): void; }

/**
 * Recursively watch a Codex sessions dir for rollout-*.jsonl files; on each, read the first
 * session_meta line and hand the RolloutInfo to onRollout. Runs an initial scan first (unless
 * disabled) so rollouts that already exist at startup reconcile loaded sessions. Durable: a
 * transient watch/read error never crashes it, and onRollout errors are swallowed.
 * NOTE: `dir` must exist (watch() throws on a missing dir) — the caller (M3) ensures ~/.codex/sessions.
 */
export function startRolloutWatcher(
  dir: string,
  onRollout: (info: RolloutInfo) => void,
  opts: { initialScan?: boolean } = {},
): RolloutWatcher {
  const safeEmit = (info: RolloutInfo) => { try { onRollout(info); } catch { /* never crash the watcher */ } };

  if (opts.initialScan !== false) {
    void scanRolloutDir(dir).then((infos) => infos.forEach(safeEmit)).catch(() => {});
  }

  const watcher: FSWatcher = watch(dir, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const rel = filename.toString();
    if (!ROLLOUT_RE.test(basename(rel))) return;
    void readRolloutMeta(join(dir, rel)).then((info) => { if (info) safeEmit(info); }).catch(() => {});
  });
  // Long-lived handler so a transient watch error never crashes the daemon.
  watcher.on('error', () => {});
  return { close: () => watcher.close() };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/collector/rollout-watcher.test.ts` → Expected: PASS (all 6).
Run: `npm run typecheck` → Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/collector/rollout-watcher.ts tests/collector/rollout-watcher.test.ts
git commit -m "feat(collector): durable Codex rollout-file watcher (scan + recursive watch)"
```

---

### Task 3: End-to-end Codex temp-id → reconcile integration test

**Files:**
- Create: `tests/e2e/codex-reconcile.test.ts`

**Interfaces:**
- Consumes: `SessionStore`, `parseHookEvent`, `buildRawEvent`, `startRolloutWatcher`.

This is the M2-handoff's required integration test (M1's e2e was Claude-only): a Codex session created under a temp key gets reconciled when its rollout file appears in the watched tree, and mark-seen/badge keep working by `tempId` afterward.

- [ ] **Step 1: Write the test**

Create `tests/e2e/codex-reconcile.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore } from '../../src/domain/store';
import { parseHookEvent } from '../../src/domain/parser';
import { buildRawEvent } from '../../src/hook/build-event';
import { startRolloutWatcher } from '../../src/collector/rollout-watcher';

async function waitFor(pred: () => boolean, timeoutMs = 3000, stepMs = 20): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  throw new Error('waitFor: condition not met in time');
}

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'beacon-codex-e2e-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('Codex temp-id -> rollout reconcile (end to end)', () => {
  it('reconciles a temp-keyed Codex session when its rollout file appears, then mark-seen works by tempId', async () => {
    const sessionsDir = join(dir, 'sessions');
    const dateDir = join(sessionsDir, '2025', '06', '22');
    await mkdir(dateDir, { recursive: true }); // exists before watch (deterministic)

    const store = new SessionStore();

    // 1) A Codex turn-done event arrives via the hook pipeline -> temp-keyed session, attention=done.
    const raw = buildRawEvent({
      tool: 'codex', event: 'Stop',
      env: { __CFBundleIdentifier: 'com.apple.Terminal', TERM_SESSION_ID: 'T9' },
      stdin: {}, cwd: '/Users/m/proj', gitRoot: '/Users/m/proj', tty: '/dev/ttys009',
      codexAncestorPid: 4242, codexAncestorStartTime: 'StartA', ts: 1_750_000_000_000,
    });
    const session = store.upsertFromEvent(parseHookEvent(raw));
    const tempId = session.tempId;
    expect(session.codexSessionId).toBeUndefined();
    expect(store.attentionCount()).toBe(1); // done + unseen

    // 2) Watcher running; M3 wires the callback to store.reconcileCodex.
    const watcher = startRolloutWatcher(sessionsDir, (info) => { store.reconcileCodex(info); });

    // 3) Codex writes the rollout file (first line = session_meta), start time within tolerance.
    const metaLine = JSON.stringify({
      type: 'session_meta',
      payload: { id: 'uuid-codex-1', cwd: '/Users/m/proj' },
      timestamp: new Date(1_750_000_003_000).toISOString(),
    }) + '\n';
    await writeFile(join(dateDir, 'rollout-2025-06-22T20-00-00-uuid-codex-1.jsonl'), metaLine);

    // 4) Watcher reconciles the temp session in place.
    await waitFor(() => store.get(tempId)?.codexSessionId === 'uuid-codex-1');

    const reconciled = store.get(tempId)!;
    expect(reconciled.codexSessionId).toBe('uuid-codex-1');
    expect(reconciled.id).toBe('codex:uuid-codex-1');
    expect(reconciled.tempId).toBe(tempId); // key unchanged

    // 5) Mark-seen / badge still keyed by tempId after reconcile.
    store.markSeen(tempId);
    expect(store.get(tempId)!.seen).toBe(true);
    expect(store.attentionCount()).toBe(0);

    watcher.close();
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/e2e/codex-reconcile.test.ts` → Expected: PASS.
(If it flakes on `fs.watch` timing, that is the only risk surface — the `waitFor` budget is 3s; the pure watcher logic is already covered deterministically in Task 2. Do NOT weaken the assertions; if it genuinely flakes, report it.)
Run: `npm run typecheck` → Expected: clean.

- [ ] **Step 3: Run the full suite + typecheck (milestone checkpoint)**

Run: `npx vitest run` → Expected: all green (M2b's 124 + the new M2c tests).
Run: `npm run typecheck` → Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/codex-reconcile.test.ts
git commit -m "test(e2e): Codex temp-id -> rollout reconcile, mark-seen by tempId"
```

---

## Post-Plan Notes (for the controller, not steps)

- Final whole-branch review (M2c): `review-package <M2c-base> <HEAD>` → reviewer on sonnet (small, well-specified surface). Focus: reconcile never merges unrelated sessions; tempId-key stability; watcher durability (no uncaught throw, no crash on missing dir at the documented boundary); tests touch only tmpdir.
- M3 wiring (carry forward, NOT this milestone): in the Electron main process, `startRolloutWatcher(join(homedir(), '.codex', 'sessions'), info => store.reconcileCodex(info))`, after `mkdir -p`-ing that dir (watch() throws if absent). Re-persist on reconcile so the stamped id survives restart. `--ephemeral` Codex sessions have no rollout and stay temp (accepted degraded mode).
- This milestone has no new runtime deps and no packaging changes.
