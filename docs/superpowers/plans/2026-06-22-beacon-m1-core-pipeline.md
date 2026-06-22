# Beacon — M1: Core Event Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the headless core that turns Claude Code / Codex hook events into a correct, persisted in-memory model of all active sessions — events flowing from a `beacon-hook` invocation, over a `0600` Unix socket, through a parser + state machine, into a `SessionStore`.

**Architecture:** Pure-TypeScript domain layer (types, parser, state machine, store, identity/reconcile) with zero IO, fully unit-tested via TDD. A thin Node `net` Unix-socket collector feeds normalized raw events into the store. A small `beacon-hook` binary captures environment + stdin from each hook firing and writes one JSON line to the socket. No Electron in M1 — everything here runs and is tested under plain Node + Vitest.

**Tech Stack:** TypeScript (strict, ESM), Node 20+, Vitest, npm.

## Global Constraints

- Platform: **macOS only** (Darwin). Do not add Windows/Linux branches.
- Language: **TypeScript strict mode**, **ESM** (`"type": "module"`). No `any` except where explicitly narrowing untrusted JSON.
- Package manager: **npm** (repo uses `package-lock.json`).
- Node: **20+**.
- The `beacon-hook` binary must **always exit 0** and never block the CLI (short socket write timeout, fire-and-forget).
- The Collector **must never shell-interpolate** any payload field. (No `child_process` use of payload data in M1 at all.)
- Persistence writes are **atomic** (temp file + rename) with a **single writer**.
- Identity: Claude keys on `session_id`; Codex keys on the resolved long-lived `codex` **ancestor** process (`pid + start-time + git-root + tty/host`). Unknown fields are allowed but **never used alone** to merge sessions.
- Beacon's own hook entries (M2) are marked via the **command/args vector** (`beacon-hook --beacon-marker <id> <event>`), never an extra JSON field.

---

## Milestone Roadmap (context — only M1 is detailed here)

- **M1 (this plan):** core event pipeline, headless + TDD. Deliverable below.
- **M2 (separate plan):** Focuser (AppleScript tty-match for Terminal.app; `code/cursor --reuse-window` + bundle-id activation; degraded fallbacks) + Installer (schema-specific merge into `~/.claude/settings.json` and `~/.codex/hooks.json`; atomic write + lock + backup + dry-run + marker uninstall; Codex `/hooks` trust-review prompt).
- **M3 (separate plan):** Electron main (single-instance, `app.dock.hide()`, hosts the Collector + persistence), Tray + badge, activating all-Spaces `BrowserWindow` panel + global-shortcut manager (⌘⇧Space, conflict UX), React + Tailwind + shadcn/ui panel, contextBridge IPC.

**M1 done = a Vitest suite proving:** a built `RawHookEvent` (from realistic Claude + Codex env/stdin) written to the socket arrives parsed and correctly transitions a session in the store, with attention/seen/badge-count behaving per spec, and snapshots round-trip through atomic JSON.

---

## File Structure (M1)

```
beacon/
  package.json                     # npm project, scripts, deps
  tsconfig.json                    # TS strict ESM
  vitest.config.ts                 # test config
  src/
    domain/
      types.ts                     # all shared types/enums
      identity.ts                  # eventKey() + Codex reconcile helpers
      parser.ts                    # parseHookEvent(): RawHookEvent -> BeaconEvent
      state-machine.ts             # applyEvent(): pure state transition
      store.ts                     # SessionStore + SessionsSnapshot
      persistence.ts               # atomic save/load + debounced writer
    collector/
      socket-server.ts             # startCollector(): 0600 Unix socket
    hook/
      proc.ts                      # pure parsers: tty + ps ancestor rows
      build-event.ts               # detectHost/detectRemote/buildRawEvent (pure)
      beacon-hook.ts               # CLI entry (IO: stdin/git/ps/socket)
  tests/
    smoke.test.ts
    domain/{identity,parser,state-machine,store,persistence}.test.ts
    collector/socket-server.test.ts
    hook/{proc,build-event}.test.ts
    e2e/pipeline.test.ts
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `tests/smoke.test.ts`, `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm test` (Vitest) and `npm run typecheck` commands for all later tasks.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "beacon",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "^22.5.0",
    "typescript": "^5.6.2",
    "vitest": "^2.1.1"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
*.log
.DS_Store
.superpowers/
```

- [ ] **Step 5: Create `tests/smoke.test.ts`**

```ts
import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('arithmetic works', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Install and run**

Run: `npm install && npm test`
Expected: 1 passing test (`smoke`).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore tests/smoke.test.ts
git commit -m "chore: scaffold beacon core (ts + vitest)"
```

---

### Task 2: Domain types + identity key

**Files:**
- Create: `src/domain/types.ts`, `src/domain/identity.ts`
- Test: `tests/domain/identity.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - All shared types (see code) — every later task imports from `types.ts`.
  - `eventKey(raw: RawHookEvent): string`
  - `parseRolloutMeta(firstLine: string): RolloutInfo | null`
  - `matchesRollout(session: Session, rollout: RolloutInfo, toleranceMs?: number): boolean`
  - `reconcile(session: Session, rollout: RolloutInfo): Session`

- [ ] **Step 1: Write the failing test**

```ts
// tests/domain/identity.test.ts
import { describe, it, expect } from 'vitest';
import { eventKey, parseRolloutMeta, matchesRollout, reconcile } from '../../src/domain/identity';
import type { RawHookEvent, Session } from '../../src/domain/types';

const baseRaw: RawHookEvent = {
  tool: 'codex', event: 'SessionStart', cwd: '/Users/m/p', gitRoot: '/Users/m/p',
  host: 'terminal', remote: 'none', ts: 1000,
};

describe('eventKey', () => {
  it('keys Claude on session_id', () => {
    expect(eventKey({ ...baseRaw, tool: 'claude', sessionId: 'abc' })).toBe('claude:abc');
  });
  it('keys Codex on ancestor pid + start + gitRoot + tty', () => {
    const k = eventKey({ ...baseRaw, codexAncestorPid: 42, codexAncestorStartTime: 'T1', tty: '/dev/ttys003' });
    expect(k).toBe('codex:42:T1:/Users/m/p:/dev/ttys003');
  });
  it('is stable for two events from the same codex ancestor', () => {
    const a = eventKey({ ...baseRaw, event: 'Stop', codexAncestorPid: 7, codexAncestorStartTime: 'X', tty: '/dev/ttys1' });
    const b = eventKey({ ...baseRaw, event: 'PermissionRequest', codexAncestorPid: 7, codexAncestorStartTime: 'X', tty: '/dev/ttys1' });
    expect(a).toBe(b);
  });
  it('differs for a different codex ancestor in the same repo', () => {
    const a = eventKey({ ...baseRaw, codexAncestorPid: 7, codexAncestorStartTime: 'X', tty: '/dev/ttys1' });
    const b = eventKey({ ...baseRaw, codexAncestorPid: 9, codexAncestorStartTime: 'Y', tty: '/dev/ttys2' });
    expect(a).not.toBe(b);
  });
});

describe('codex rollout reconcile', () => {
  const meta = JSON.stringify({ type: 'session_meta', payload: { id: 'uuid-1', cwd: '/Users/m/p' }, timestamp: '2026-06-22T20:00:00Z' });
  const session: Session = {
    id: 'codex:7:X:/Users/m/p:/dev/ttys1', tempId: 'codex:7:X:/Users/m/p:/dev/ttys1',
    tool: 'codex', repoPath: '/Users/m/p', gitRoot: '/Users/m/p', repoName: 'p',
    host: 'terminal', remote: 'none', gotoPrecision: 'precise',
    state: 'started', attention: 'none', seen: true,
    startedAt: 1750622400000, lastEventAt: 1750622400000,
  };

  it('parses session_meta into RolloutInfo', () => {
    const info = parseRolloutMeta(meta);
    expect(info).toEqual({ codexSessionId: 'uuid-1', gitRoot: '/Users/m/p', startedAt: 1750622400000 });
  });
  it('returns null for non-meta lines', () => {
    expect(parseRolloutMeta(JSON.stringify({ type: 'event_msg' }))).toBeNull();
  });
  it('matches a rollout by gitRoot + close start time', () => {
    const info = parseRolloutMeta(meta)!;
    expect(matchesRollout(session, info)).toBe(true);
  });
  it('does not match a different gitRoot', () => {
    const info = parseRolloutMeta(meta)!;
    expect(matchesRollout(session, { ...info, gitRoot: '/other' })).toBe(false);
  });
  it('does not re-match an already-reconciled session', () => {
    const info = parseRolloutMeta(meta)!;
    expect(matchesRollout({ ...session, codexSessionId: 'uuid-0' }, info)).toBe(false);
  });
  it('reconcile stamps codexSessionId and stable id', () => {
    const info = parseRolloutMeta(meta)!;
    const r = reconcile(session, info);
    expect(r.codexSessionId).toBe('uuid-1');
    expect(r.id).toBe('codex:uuid-1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/domain/identity.test.ts`
Expected: FAIL — cannot resolve `../../src/domain/identity`.

- [ ] **Step 3: Create `src/domain/types.ts`**

```ts
export type Tool = 'claude' | 'codex';
export type Host = 'terminal' | 'vscode' | 'cursor' | 'unknown';
export type RemoteKind = 'none' | 'tmux' | 'ssh' | 'vscode-remote';
export type GotoPrecision = 'precise' | 'degraded';
export type SessionState = 'started' | 'working' | 'waiting' | 'done' | 'closed';
export type Attention = 'none' | 'needs-you' | 'done';
export type BeaconEventName = 'session-start' | 'working' | 'needs-you' | 'turn-done' | 'session-end';

/** Raw event as written by beacon-hook (untrusted JSON shape). */
export interface RawHookEvent {
  tool: Tool;
  event: string;                  // raw hook_event_name
  sessionId?: string;             // Claude session_id (if present)
  cwd: string;
  gitRoot?: string;
  host: Host;
  termSessionId?: string;
  tty?: string;
  bundleId?: string;
  remote: RemoteKind;
  codexAncestorPid?: number;
  codexAncestorStartTime?: string;
  ts: number;                     // epoch ms
  raw?: unknown;
}

/** Normalized event consumed by the store. */
export interface BeaconEvent {
  kind: BeaconEventName;
  tool: Tool;
  key: string;
  claudeSessionId?: string;
  cwd: string;
  gitRoot: string;
  repoName: string;
  host: Host;
  termSessionId?: string;
  tty?: string;
  remote: RemoteKind;
  gotoPrecision: GotoPrecision;
  ts: number;
}

export interface Session {
  id: string;                     // stable id (claude session_id, reconciled codex id, or temp key)
  tempId: string;
  tool: Tool;
  claudeSessionId?: string;
  codexSessionId?: string;        // set after rollout reconcile
  repoPath: string;
  gitRoot: string;
  repoName: string;
  host: Host;
  termSessionId?: string;
  tty?: string;
  remote: RemoteKind;
  gotoPrecision: GotoPrecision;
  state: SessionState;
  attention: Attention;
  seen: boolean;
  startedAt: number;
  lastEventAt: number;
}

export interface RolloutInfo {
  codexSessionId: string;
  gitRoot: string;
  startedAt: number;
}
```

- [ ] **Step 4: Create `src/domain/identity.ts`**

```ts
import type { RawHookEvent, RolloutInfo, Session } from './types';

export function eventKey(raw: RawHookEvent): string {
  if (raw.tool === 'claude' && raw.sessionId) return `claude:${raw.sessionId}`;
  const root = raw.gitRoot ?? raw.cwd;
  const pid = raw.codexAncestorPid ?? 0;
  const start = raw.codexAncestorStartTime ?? 'unknown';
  const tty = raw.tty ?? 'notty';
  return `codex:${pid}:${start}:${root}:${tty}`;
}

/** Parse the first JSONL line of a Codex rollout file. Returns null unless it is session_meta. */
export function parseRolloutMeta(firstLine: string): RolloutInfo | null {
  let obj: any;
  try { obj = JSON.parse(firstLine); } catch { return null; }
  if (!obj || obj.type !== 'session_meta' || !obj.payload) return null;
  const id = obj.payload.id;
  const cwd = obj.payload.cwd;
  const ts = obj.timestamp ? Date.parse(obj.timestamp) : NaN;
  if (typeof id !== 'string' || typeof cwd !== 'string' || Number.isNaN(ts)) return null;
  return { codexSessionId: id, gitRoot: cwd, startedAt: ts };
}

export function matchesRollout(session: Session, rollout: RolloutInfo, toleranceMs = 10_000): boolean {
  return session.tool === 'codex'
    && !session.codexSessionId
    && session.gitRoot === rollout.gitRoot
    && Math.abs(session.startedAt - rollout.startedAt) <= toleranceMs;
}

/** Stamp the reconciled Codex session id. The store map key (tempId) does not change. */
export function reconcile(session: Session, rollout: RolloutInfo): Session {
  return { ...session, codexSessionId: rollout.codexSessionId, id: `codex:${rollout.codexSessionId}` };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/domain/identity.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add src/domain/types.ts src/domain/identity.ts tests/domain/identity.test.ts
git commit -m "feat(domain): session types + identity key + codex reconcile"
```

---

### Task 3: Hook payload parser

**Files:**
- Create: `src/domain/parser.ts`
- Test: `tests/domain/parser.test.ts`

**Interfaces:**
- Consumes: `RawHookEvent`, `eventKey` (Task 2).
- Produces: `parseHookEvent(raw: RawHookEvent): BeaconEvent` (throws on unmapped event names).

Note: the installer (M2) registers the Claude `Notification` hook **only** for the `permission_prompt` and `idle_prompt` matchers, so any `Notification` reaching the parser is a genuine needs-you signal.

- [ ] **Step 1: Write the failing test**

```ts
// tests/domain/parser.test.ts
import { describe, it, expect } from 'vitest';
import { parseHookEvent } from '../../src/domain/parser';
import type { RawHookEvent } from '../../src/domain/types';

const claude: RawHookEvent = {
  tool: 'claude', event: 'SessionStart', sessionId: 'sid',
  cwd: '/Users/m/repo/sub', gitRoot: '/Users/m/repo',
  host: 'terminal', tty: '/dev/ttys003', remote: 'none', ts: 5,
};

describe('parseHookEvent', () => {
  it('maps Claude SessionStart -> session-start and derives repoName from gitRoot', () => {
    const e = parseHookEvent(claude);
    expect(e.kind).toBe('session-start');
    expect(e.repoName).toBe('repo');
    expect(e.gitRoot).toBe('/Users/m/repo');
    expect(e.key).toBe('claude:sid');
  });
  it('maps Claude Notification -> needs-you, Stop -> turn-done', () => {
    expect(parseHookEvent({ ...claude, event: 'Notification' }).kind).toBe('needs-you');
    expect(parseHookEvent({ ...claude, event: 'Stop' }).kind).toBe('turn-done');
  });
  it('maps Codex PermissionRequest -> needs-you', () => {
    expect(parseHookEvent({ ...claude, tool: 'codex', sessionId: undefined, event: 'PermissionRequest' }).kind).toBe('needs-you');
  });
  it('precise for local terminal with tty', () => {
    expect(parseHookEvent(claude).gotoPrecision).toBe('precise');
  });
  it('degraded when remote is ssh', () => {
    expect(parseHookEvent({ ...claude, remote: 'ssh' }).gotoPrecision).toBe('degraded');
  });
  it('degraded when host unknown', () => {
    expect(parseHookEvent({ ...claude, host: 'unknown' }).gotoPrecision).toBe('degraded');
  });
  it('degraded for terminal host without a tty', () => {
    expect(parseHookEvent({ ...claude, tty: undefined }).gotoPrecision).toBe('degraded');
  });
  it('falls back gitRoot to cwd when gitRoot missing', () => {
    const e = parseHookEvent({ ...claude, gitRoot: undefined });
    expect(e.gitRoot).toBe('/Users/m/repo/sub');
    expect(e.repoName).toBe('sub');
  });
  it('throws on an unmapped event', () => {
    expect(() => parseHookEvent({ ...claude, event: 'Bogus' })).toThrow(/Unmapped/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/domain/parser.test.ts`
Expected: FAIL — cannot resolve `parser`.

- [ ] **Step 3: Create `src/domain/parser.ts`**

```ts
import { basename } from 'node:path';
import type { RawHookEvent, BeaconEvent, BeaconEventName, GotoPrecision } from './types';
import { eventKey } from './identity';

const CLAUDE_MAP: Record<string, BeaconEventName> = {
  SessionStart: 'session-start',
  UserPromptSubmit: 'working',
  PreToolUse: 'working',
  Notification: 'needs-you',     // installer registers only permission_prompt|idle_prompt matchers
  Stop: 'turn-done',
  SessionEnd: 'session-end',
};

const CODEX_MAP: Record<string, BeaconEventName> = {
  SessionStart: 'session-start',
  UserPromptSubmit: 'working',
  PreToolUse: 'working',
  PermissionRequest: 'needs-you',
  Stop: 'turn-done',
};

export function parseHookEvent(raw: RawHookEvent): BeaconEvent {
  const map = raw.tool === 'claude' ? CLAUDE_MAP : CODEX_MAP;
  const kind = map[raw.event];
  if (!kind) throw new Error(`Unmapped ${raw.tool} event: ${raw.event}`);

  const gitRoot = raw.gitRoot && raw.gitRoot.length > 0 ? raw.gitRoot : raw.cwd;
  const degraded =
    raw.remote !== 'none' ||
    raw.host === 'unknown' ||
    (raw.host === 'terminal' && !raw.tty);
  const gotoPrecision: GotoPrecision = degraded ? 'degraded' : 'precise';

  return {
    kind,
    tool: raw.tool,
    key: eventKey(raw),
    claudeSessionId: raw.tool === 'claude' ? raw.sessionId : undefined,
    cwd: raw.cwd,
    gitRoot,
    repoName: basename(gitRoot) || gitRoot,
    host: raw.host,
    termSessionId: raw.termSessionId,
    tty: raw.tty,
    remote: raw.remote,
    gotoPrecision,
    ts: raw.ts,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/domain/parser.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/parser.ts tests/domain/parser.test.ts
git commit -m "feat(domain): normalize hook payloads into BeaconEvent"
```

---

### Task 4: State machine

**Files:**
- Create: `src/domain/state-machine.ts`
- Test: `tests/domain/state-machine.test.ts`

**Interfaces:**
- Consumes: `Session`, `BeaconEvent` (Task 2).
- Produces: `applyEvent(session: Session, event: BeaconEvent): Session` (pure; returns a new Session).

- [ ] **Step 1: Write the failing test**

```ts
// tests/domain/state-machine.test.ts
import { describe, it, expect } from 'vitest';
import { applyEvent } from '../../src/domain/state-machine';
import type { Session, BeaconEvent, BeaconEventName } from '../../src/domain/types';

const session: Session = {
  id: 'k', tempId: 'k', tool: 'claude', repoPath: '/r', gitRoot: '/r', repoName: 'r',
  host: 'terminal', remote: 'none', gotoPrecision: 'precise',
  state: 'started', attention: 'none', seen: true, startedAt: 1, lastEventAt: 1,
};
const ev = (kind: BeaconEventName, ts: number): BeaconEvent => ({
  kind, tool: 'claude', key: 'k', cwd: '/r', gitRoot: '/r', repoName: 'r',
  host: 'terminal', remote: 'none', gotoPrecision: 'precise', ts,
});

describe('applyEvent', () => {
  it('working -> state working, attention cleared, seen true', () => {
    const s = applyEvent(session, ev('working', 2));
    expect(s.state).toBe('working');
    expect(s.attention).toBe('none');
    expect(s.seen).toBe(true);
    expect(s.lastEventAt).toBe(2);
  });
  it('needs-you -> waiting, attention needs-you, seen false', () => {
    const s = applyEvent(session, ev('needs-you', 3));
    expect(s.state).toBe('waiting');
    expect(s.attention).toBe('needs-you');
    expect(s.seen).toBe(false);
  });
  it('turn-done -> done, attention done, seen false', () => {
    const s = applyEvent(session, ev('turn-done', 4));
    expect(s.state).toBe('done');
    expect(s.attention).toBe('done');
    expect(s.seen).toBe(false);
  });
  it('session-end -> closed, attention cleared, seen true', () => {
    const s = applyEvent({ ...session, attention: 'done', seen: false }, ev('session-end', 5));
    expect(s.state).toBe('closed');
    expect(s.attention).toBe('none');
    expect(s.seen).toBe(true);
  });
  it('does not mutate the input session', () => {
    applyEvent(session, ev('needs-you', 9));
    expect(session.state).toBe('started');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/domain/state-machine.test.ts`
Expected: FAIL — cannot resolve `state-machine`.

- [ ] **Step 3: Create `src/domain/state-machine.ts`**

```ts
import type { Session, BeaconEvent, SessionState, Attention } from './types';

export function applyEvent(session: Session, event: BeaconEvent): Session {
  let state: SessionState = session.state;
  let attention: Attention = session.attention;
  let seen = session.seen;

  switch (event.kind) {
    case 'session-start':
      state = 'started';
      break;
    case 'working':
      state = 'working';
      attention = 'none';
      seen = true;
      break;
    case 'needs-you':
      state = 'waiting';
      attention = 'needs-you';
      seen = false;
      break;
    case 'turn-done':
      state = 'done';
      attention = 'done';
      seen = false;
      break;
    case 'session-end':
      state = 'closed';
      attention = 'none';
      seen = true;
      break;
  }

  return { ...session, state, attention, seen, lastEventAt: event.ts };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/domain/state-machine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/state-machine.ts tests/domain/state-machine.test.ts
git commit -m "feat(domain): session state machine"
```

---

### Task 5: Session store

**Files:**
- Create: `src/domain/store.ts`
- Test: `tests/domain/store.test.ts`

**Interfaces:**
- Consumes: `Session`, `BeaconEvent` (Task 2), `applyEvent` (Task 4).
- Produces:
  - `interface SessionsSnapshot { version: 1; sessions: Session[]; }`
  - `class SessionStore` with: `upsertFromEvent(event): Session`, `get(key): Session | undefined`, `all(): Session[]`, `markSeen(key): void`, `clearAll(): void`, `evictStale(now, ttlMs): void`, `attentionCount(): number`, `toJSON(): SessionsSnapshot`, `static fromJSON(snap): SessionStore`.
  - Map is keyed by `event.key` (the stable tempId), which never changes across reconcile.

- [ ] **Step 1: Write the failing test**

```ts
// tests/domain/store.test.ts
import { describe, it, expect } from 'vitest';
import { SessionStore } from '../../src/domain/store';
import type { BeaconEvent, BeaconEventName } from '../../src/domain/types';

const ev = (kind: BeaconEventName, ts: number, key = 'k1'): BeaconEvent => ({
  kind, tool: 'claude', key, cwd: '/r', gitRoot: '/r', repoName: 'r',
  host: 'terminal', remote: 'none', gotoPrecision: 'precise',
  claudeSessionId: key, ts,
});

describe('SessionStore', () => {
  it('creates a session on first event and transitions it', () => {
    const s = new SessionStore();
    s.upsertFromEvent(ev('session-start', 1));
    const after = s.upsertFromEvent(ev('needs-you', 2));
    expect(after.state).toBe('waiting');
    expect(s.all()).toHaveLength(1);
  });
  it('attentionCount counts unseen attention sessions', () => {
    const s = new SessionStore();
    s.upsertFromEvent(ev('needs-you', 1, 'a'));
    s.upsertFromEvent(ev('working', 1, 'b'));
    expect(s.attentionCount()).toBe(1);
  });
  it('markSeen clears attention and the badge', () => {
    const s = new SessionStore();
    s.upsertFromEvent(ev('needs-you', 1, 'a'));
    s.markSeen('a');
    expect(s.get('a')!.seen).toBe(true);
    expect(s.get('a')!.attention).toBe('none');
    expect(s.attentionCount()).toBe(0);
  });
  it('evictStale removes closed sessions past the ttl only', () => {
    const s = new SessionStore();
    s.upsertFromEvent(ev('session-end', 1000, 'old'));
    s.upsertFromEvent(ev('needs-you', 1000, 'live'));
    s.evictStale(1000 + 60_000, 30_000);
    expect(s.get('old')).toBeUndefined();
    expect(s.get('live')).toBeDefined();
  });
  it('round-trips through toJSON/fromJSON', () => {
    const s = new SessionStore();
    s.upsertFromEvent(ev('needs-you', 7, 'a'));
    const restored = SessionStore.fromJSON(s.toJSON());
    expect(restored.get('a')!.attention).toBe('needs-you');
    expect(restored.attentionCount()).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/domain/store.test.ts`
Expected: FAIL — cannot resolve `store`.

- [ ] **Step 3: Create `src/domain/store.ts`**

```ts
import type { Session, BeaconEvent } from './types';
import { applyEvent } from './state-machine';

export interface SessionsSnapshot {
  version: 1;
  sessions: Session[];
}

function newSession(event: BeaconEvent): Session {
  return {
    id: event.key,
    tempId: event.key,
    tool: event.tool,
    claudeSessionId: event.claudeSessionId,
    codexSessionId: undefined,
    repoPath: event.cwd,
    gitRoot: event.gitRoot,
    repoName: event.repoName,
    host: event.host,
    termSessionId: event.termSessionId,
    tty: event.tty,
    remote: event.remote,
    gotoPrecision: event.gotoPrecision,
    state: 'started',
    attention: 'none',
    seen: true,
    startedAt: event.ts,
    lastEventAt: event.ts,
  };
}

export class SessionStore {
  private map = new Map<string, Session>();

  upsertFromEvent(event: BeaconEvent): Session {
    const existing = this.map.get(event.key) ?? newSession(event);
    const updated = applyEvent(existing, event);
    this.map.set(event.key, updated);
    return updated;
  }

  get(key: string): Session | undefined {
    return this.map.get(key);
  }

  all(): Session[] {
    return [...this.map.values()];
  }

  markSeen(key: string): void {
    const s = this.map.get(key);
    if (s) this.map.set(key, { ...s, seen: true, attention: 'none' });
  }

  clearAll(): void {
    this.map.clear();
  }

  evictStale(now: number, ttlMs: number): void {
    for (const [k, s] of this.map) {
      if (s.state === 'closed' && now - s.lastEventAt > ttlMs) this.map.delete(k);
    }
  }

  attentionCount(): number {
    return this.all().filter((s) => s.attention !== 'none' && !s.seen).length;
  }

  toJSON(): SessionsSnapshot {
    return { version: 1, sessions: this.all() };
  }

  static fromJSON(snap: SessionsSnapshot): SessionStore {
    const store = new SessionStore();
    for (const s of snap.sessions) store.map.set(s.tempId, s);
    return store;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/domain/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/store.ts tests/domain/store.test.ts
git commit -m "feat(domain): session store with badge count + snapshots"
```

---

### Task 6: Atomic persistence + debounced writer

**Files:**
- Create: `src/domain/persistence.ts`
- Test: `tests/domain/persistence.test.ts`

**Interfaces:**
- Consumes: `SessionsSnapshot` (Task 5).
- Produces:
  - `saveSnapshot(path: string, snap: SessionsSnapshot): Promise<void>` (atomic temp+rename)
  - `loadSnapshot(path: string): Promise<SessionsSnapshot | null>` (null on missing/corrupt/wrong-version)
  - `createDebouncedWriter(path: string, delayMs: number): { schedule(snap): void; flush(): Promise<void> }` (single writer)

- [ ] **Step 1: Write the failing test**

```ts
// tests/domain/persistence.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveSnapshot, loadSnapshot, createDebouncedWriter } from '../../src/domain/persistence';
import type { SessionsSnapshot } from '../../src/domain/store';

const snap: SessionsSnapshot = { version: 1, sessions: [] };
let dir: string;

beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'beacon-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('persistence', () => {
  it('saves and loads a snapshot', async () => {
    const p = join(dir, 'nested', 'state.json');
    await saveSnapshot(p, snap);
    expect(await loadSnapshot(p)).toEqual(snap);
  });
  it('returns null for a missing file', async () => {
    expect(await loadSnapshot(join(dir, 'nope.json'))).toBeNull();
  });
  it('returns null for corrupt JSON', async () => {
    const p = join(dir, 'bad.json');
    await writeFile(p, '{ not json', 'utf8');
    expect(await loadSnapshot(p)).toBeNull();
  });
  it('returns null for a wrong-version file', async () => {
    const p = join(dir, 'v.json');
    await writeFile(p, JSON.stringify({ version: 9, sessions: [] }), 'utf8');
    expect(await loadSnapshot(p)).toBeNull();
  });
  it('debounced writer flush persists the latest scheduled snapshot', async () => {
    const p = join(dir, 'state.json');
    const w = createDebouncedWriter(p, 50);
    w.schedule({ version: 1, sessions: [] });
    w.schedule({ version: 1, sessions: [] });
    await w.flush();
    expect(await loadSnapshot(p)).toEqual(snap);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/domain/persistence.test.ts`
Expected: FAIL — cannot resolve `persistence`.

- [ ] **Step 3: Create `src/domain/persistence.ts`**

```ts
import { writeFile, rename, readFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SessionsSnapshot } from './store';

export async function saveSnapshot(path: string, snap: SessionsSnapshot): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(snap, null, 2), 'utf8');
  await rename(tmp, path); // atomic within the same filesystem
}

export async function loadSnapshot(path: string): Promise<SessionsSnapshot | null> {
  try {
    const txt = await readFile(path, 'utf8');
    const data = JSON.parse(txt) as SessionsSnapshot;
    if (data?.version !== 1 || !Array.isArray(data.sessions)) return null;
    return data;
  } catch {
    return null;
  }
}

/** Single-writer debounced persistence: coalesces rapid updates into one write. */
export function createDebouncedWriter(path: string, delayMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: SessionsSnapshot | null = null;
  let inflight: Promise<void> = Promise.resolve();

  const write = async () => {
    if (!pending) return;
    const snap = pending;
    pending = null;
    inflight = inflight.then(() => saveSnapshot(path, snap));
    await inflight;
  };

  return {
    schedule(snap: SessionsSnapshot): void {
      pending = snap;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void write(); }, delayMs);
    },
    async flush(): Promise<void> {
      if (timer) { clearTimeout(timer); timer = null; }
      await write();
      await inflight;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/domain/persistence.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/persistence.ts tests/domain/persistence.test.ts
git commit -m "feat(domain): atomic snapshot persistence + debounced writer"
```

---

### Task 7: Collector — 0600 Unix socket server

**Files:**
- Create: `src/collector/socket-server.ts`
- Test: `tests/collector/socket-server.test.ts`

**Interfaces:**
- Consumes: `RawHookEvent` (Task 2).
- Produces: `startCollector(socketPath: string, onEvent: (raw: RawHookEvent) => void): Promise<{ close(): Promise<void> }>`. Parses newline-delimited JSON; drops malformed lines; chmods the socket to `0600`; unlinks a stale socket first.

- [ ] **Step 1: Write the failing test**

```ts
// tests/collector/socket-server.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import { startCollector } from '../../src/collector/socket-server';
import type { RawHookEvent } from '../../src/domain/types';

let dir: string;
let socketPath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'beacon-sock-'));
  socketPath = join(dir, 'beacon.sock');
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

function send(path: string, payload: string): Promise<void> {
  return new Promise((res, rej) => {
    const c = connect(path, () => { c.write(payload, () => c.end()); });
    c.on('error', rej);
    c.on('close', () => res());
  });
}

const raw: RawHookEvent = {
  tool: 'claude', event: 'Stop', sessionId: 's1', cwd: '/r',
  host: 'terminal', remote: 'none', ts: 1,
};

describe('startCollector', () => {
  it('delivers a parsed event from one JSON line', async () => {
    const received: RawHookEvent[] = [];
    const col = await startCollector(socketPath, (e) => received.push(e));
    await send(socketPath, JSON.stringify(raw) + '\n');
    await new Promise((r) => setTimeout(r, 50));
    expect(received).toHaveLength(1);
    expect(received[0]!.sessionId).toBe('s1');
    await col.close();
  });
  it('reassembles two events split across writes and drops a bad line', async () => {
    const received: RawHookEvent[] = [];
    const col = await startCollector(socketPath, (e) => received.push(e));
    const line = JSON.stringify(raw);
    await send(socketPath, line + '\nnot-json\n' + line + '\n');
    await new Promise((r) => setTimeout(r, 50));
    expect(received).toHaveLength(2);
    await col.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/collector/socket-server.test.ts`
Expected: FAIL — cannot resolve `socket-server`.

- [ ] **Step 3: Create `src/collector/socket-server.ts`**

```ts
import { createServer, type Server } from 'node:net';
import { unlink, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { RawHookEvent } from '../domain/types';

export interface Collector {
  close(): Promise<void>;
}

export async function startCollector(
  socketPath: string,
  onEvent: (raw: RawHookEvent) => void,
): Promise<Collector> {
  if (existsSync(socketPath)) await unlink(socketPath).catch(() => {});

  const server: Server = createServer((sock) => {
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('data', (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        try {
          onEvent(JSON.parse(line) as RawHookEvent);
        } catch {
          /* drop malformed line — never trust/forward bad input */
        }
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  await chmod(socketPath, 0o600).catch(() => {});

  return {
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/collector/socket-server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/collector/socket-server.ts tests/collector/socket-server.test.ts
git commit -m "feat(collector): 0600 unix socket event server"
```

---

### Task 8: Hook process parsers (tty + ps ancestor)

**Files:**
- Create: `src/hook/proc.ts`
- Test: `tests/hook/proc.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface ProcRow { pid: number; ppid: number; lstart: string; comm: string; }`
  - `parseTty(psOutput: string): string | undefined`
  - `parsePsRows(psOutput: string): ProcRow[]`
  - `findAncestorByComm(rows: ProcRow[], startPid: number, comm: string): ProcRow | undefined`

- [ ] **Step 1: Write the failing test**

```ts
// tests/hook/proc.test.ts
import { describe, it, expect } from 'vitest';
import { parseTty, parsePsRows, findAncestorByComm } from '../../src/hook/proc';

describe('parseTty', () => {
  it('normalizes a bare tty name', () => expect(parseTty('ttys003\n')).toBe('/dev/ttys003'));
  it('passes through an absolute dev path', () => expect(parseTty('/dev/ttys001')).toBe('/dev/ttys001'));
  it('returns undefined for no tty', () => {
    expect(parseTty('?')).toBeUndefined();
    expect(parseTty('   ')).toBeUndefined();
  });
});

describe('parsePsRows + findAncestorByComm', () => {
  // columns: pid ppid lstart(5 fields) comm...
  const out = [
    '6001 5000 Mon Jun 22 20:00:00 2026 codex',
    '6100 6001 Mon Jun 22 20:00:01 2026 node',
    '6200 6100 Mon Jun 22 20:00:02 2026 beacon-hook',
  ].join('\n');

  it('parses rows', () => {
    const rows = parsePsRows(out);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ pid: 6001, ppid: 5000, comm: 'codex' });
    expect(rows[0]!.lstart).toBe('Mon Jun 22 20:00:00 2026');
  });
  it('walks up from the hook pid to the codex ancestor', () => {
    const rows = parsePsRows(out);
    const anc = findAncestorByComm(rows, 6200, 'codex');
    expect(anc!.pid).toBe(6001);
    expect(anc!.lstart).toBe('Mon Jun 22 20:00:00 2026');
  });
  it('returns undefined when no matching ancestor exists', () => {
    const rows = parsePsRows(out);
    expect(findAncestorByComm(rows, 6200, 'claude')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/hook/proc.test.ts`
Expected: FAIL — cannot resolve `proc`.

- [ ] **Step 3: Create `src/hook/proc.ts`**

```ts
export interface ProcRow {
  pid: number;
  ppid: number;
  lstart: string;
  comm: string;
}

export function parseTty(psOutput: string): string | undefined {
  const t = psOutput.trim();
  if (!t || t === '?' || t === '??') return undefined;
  return t.startsWith('/dev/') ? t : `/dev/${t}`;
}

/** Each line: `pid ppid <lstart: 5 whitespace-separated fields> comm...`. */
export function parsePsRows(psOutput: string): ProcRow[] {
  const rows: ProcRow[] = [];
  for (const line of psOutput.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 8) continue;
    const pid = Number(parts[0]);
    const ppid = Number(parts[1]);
    if (Number.isNaN(pid) || Number.isNaN(ppid)) continue;
    const lstart = parts.slice(2, 7).join(' ');
    const comm = parts.slice(7).join(' ');
    rows.push({ pid, ppid, lstart, comm });
  }
  return rows;
}

export function findAncestorByComm(rows: ProcRow[], startPid: number, comm: string): ProcRow | undefined {
  const byPid = new Map(rows.map((r) => [r.pid, r]));
  let current = byPid.get(startPid);
  const seen = new Set<number>();
  while (current && !seen.has(current.pid)) {
    if (current.comm === comm || current.comm.endsWith(`/${comm}`)) return current;
    seen.add(current.pid);
    current = byPid.get(current.ppid);
  }
  return undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/hook/proc.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hook/proc.ts tests/hook/proc.test.ts
git commit -m "feat(hook): pure tty + ps-ancestor parsers"
```

---

### Task 9: Hook event builder (host/remote detection)

**Files:**
- Create: `src/hook/build-event.ts`
- Test: `tests/hook/build-event.test.ts`

**Interfaces:**
- Consumes: `RawHookEvent`, `Tool`, `Host`, `RemoteKind` (Task 2).
- Produces:
  - `const CURSOR_BUNDLE_IDS: readonly string[]` (extended in M3 E2E with the real id confirmed on this machine)
  - `detectHost(env): Host`
  - `detectRemote(env): RemoteKind`
  - `buildRawEvent(args): RawHookEvent`

- [ ] **Step 1: Write the failing test**

```ts
// tests/hook/build-event.test.ts
import { describe, it, expect } from 'vitest';
import { detectHost, detectRemote, buildRawEvent } from '../../src/hook/build-event';

describe('detectHost', () => {
  it('Terminal.app by bundle id', () => {
    expect(detectHost({ __CFBundleIdentifier: 'com.apple.Terminal' })).toBe('terminal');
  });
  it('Terminal.app by TERM_PROGRAM', () => {
    expect(detectHost({ TERM_PROGRAM: 'Apple_Terminal' })).toBe('terminal');
  });
  it('VS Code by bundle id', () => {
    expect(detectHost({ __CFBundleIdentifier: 'com.microsoft.VSCode', TERM_PROGRAM: 'vscode' })).toBe('vscode');
  });
  it('Cursor by known todesktop bundle id', () => {
    expect(detectHost({ __CFBundleIdentifier: 'com.todesktop.230313mzl4w4u92', TERM_PROGRAM: 'vscode' })).toBe('cursor');
  });
  it('falls back to vscode for the vscode TERM_PROGRAM family with unknown bundle', () => {
    expect(detectHost({ TERM_PROGRAM: 'vscode', __CFBundleIdentifier: 'com.unknown.fork' })).toBe('vscode');
  });
  it('unknown otherwise', () => {
    expect(detectHost({})).toBe('unknown');
  });
});

describe('detectRemote', () => {
  it('ssh', () => expect(detectRemote({ SSH_CONNECTION: '1.2.3.4 22 5.6.7.8 22' })).toBe('ssh'));
  it('tmux', () => expect(detectRemote({ TMUX: '/tmp/tmux-501/default,123,0' })).toBe('tmux'));
  it('vscode-remote', () => expect(detectRemote({ VSCODE_IPC_HOOK_CLI: '/x', REMOTE_CONTAINERS: 'true' })).toBe('vscode-remote'));
  it('none', () => expect(detectRemote({})).toBe('none'));
});

describe('buildRawEvent', () => {
  it('prefers the stdin cwd/session_id and includes resolved fields', () => {
    const e = buildRawEvent({
      tool: 'claude', event: 'Stop',
      env: { __CFBundleIdentifier: 'com.apple.Terminal', TERM_SESSION_ID: 'T1' },
      stdin: { session_id: 'sid', cwd: '/Users/m/repo' },
      cwd: '/fallback', gitRoot: '/Users/m/repo', tty: '/dev/ttys003', ts: 99,
    });
    expect(e).toMatchObject({
      tool: 'claude', event: 'Stop', sessionId: 'sid', cwd: '/Users/m/repo',
      gitRoot: '/Users/m/repo', host: 'terminal', termSessionId: 'T1',
      tty: '/dev/ttys003', remote: 'none', ts: 99,
    });
  });
  it('uses the fallback cwd when stdin lacks one', () => {
    const e = buildRawEvent({ tool: 'codex', event: 'PermissionRequest', env: {}, stdin: {}, cwd: '/cwd', ts: 1 });
    expect(e.cwd).toBe('/cwd');
    expect(e.sessionId).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/hook/build-event.test.ts`
Expected: FAIL — cannot resolve `build-event`.

- [ ] **Step 3: Create `src/hook/build-event.ts`**

```ts
import type { RawHookEvent, Tool, Host, RemoteKind } from '../domain/types';

export type HookEnv = Record<string, string | undefined>;

// Cursor is a VS Code fork; its host app uses a todesktop bundle id.
// Confirmed/extended during M3 E2E on the user's machine.
export const CURSOR_BUNDLE_IDS: readonly string[] = ['com.todesktop.230313mzl4w4u92'];
const VSCODE_BUNDLE_ID = 'com.microsoft.VSCode';

export function detectHost(env: HookEnv): Host {
  const bundle = env.__CFBundleIdentifier ?? '';
  if (bundle === 'com.apple.Terminal' || env.TERM_PROGRAM === 'Apple_Terminal') return 'terminal';
  if (CURSOR_BUNDLE_IDS.includes(bundle)) return 'cursor';
  if (bundle === VSCODE_BUNDLE_ID || env.TERM_PROGRAM === 'vscode') return 'vscode';
  return 'unknown';
}

export function detectRemote(env: HookEnv): RemoteKind {
  if (env.VSCODE_IPC_HOOK_CLI && env.REMOTE_CONTAINERS) return 'vscode-remote';
  if (env.SSH_CONNECTION || env.SSH_TTY) return 'ssh';
  if (env.TMUX || env.STY) return 'tmux';
  return 'none';
}

export interface BuildEventArgs {
  tool: Tool;
  event: string;
  env: HookEnv;
  stdin: unknown;
  cwd: string;
  gitRoot?: string;
  tty?: string;
  codexAncestorPid?: number;
  codexAncestorStartTime?: string;
  ts: number;
}

export function buildRawEvent(args: BuildEventArgs): RawHookEvent {
  const stdin = (args.stdin ?? {}) as Record<string, unknown>;
  const sessionId = typeof stdin.session_id === 'string' ? stdin.session_id : undefined;
  const stdinCwd = typeof stdin.cwd === 'string' ? stdin.cwd : undefined;
  return {
    tool: args.tool,
    event: args.event,
    sessionId,
    cwd: stdinCwd ?? args.cwd,
    gitRoot: args.gitRoot,
    host: detectHost(args.env),
    termSessionId: args.env.TERM_SESSION_ID,
    tty: args.tty,
    bundleId: args.env.__CFBundleIdentifier,
    remote: detectRemote(args.env),
    codexAncestorPid: args.codexAncestorPid,
    codexAncestorStartTime: args.codexAncestorStartTime,
    ts: args.ts,
    raw: args.stdin,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/hook/build-event.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hook/build-event.ts tests/hook/build-event.test.ts
git commit -m "feat(hook): host/remote detection + raw event builder"
```

---

### Task 10: `beacon-hook` CLI entry + end-to-end pipeline test

**Files:**
- Create: `src/hook/beacon-hook.ts`
- Test: `tests/e2e/pipeline.test.ts`

**Interfaces:**
- Consumes: `buildRawEvent` (Task 9), `parseTty`/`parsePsRows`/`findAncestorByComm` (Task 8), `startCollector` (Task 7), `parseHookEvent` (Task 3), `SessionStore` (Task 5).
- Produces: the runnable hook CLI (`beacon-hook [--beacon-marker <id>] <tool> <event>`), and a proven socket→parse→store pipeline.

The CLI's IO (reading stdin, running `git`/`ps`, opening the socket) is exercised manually (Step 6); the **logic** is covered by the pure-unit tasks above. The e2e test wires the real socket to the real store via `buildRawEvent` + `parseHookEvent` — the exact path the CLI uses.

- [ ] **Step 1: Write the failing e2e test**

```ts
// tests/e2e/pipeline.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import { startCollector } from '../../src/collector/socket-server';
import { buildRawEvent } from '../../src/hook/build-event';
import { parseHookEvent } from '../../src/domain/parser';
import { SessionStore } from '../../src/domain/store';
import type { RawHookEvent } from '../../src/domain/types';

let dir: string;
let socketPath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'beacon-e2e-'));
  socketPath = join(dir, 'beacon.sock');
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

function send(path: string, line: string): Promise<void> {
  return new Promise((res, rej) => {
    const c = connect(path, () => { c.write(line + '\n', () => c.end()); });
    c.on('error', rej);
    c.on('close', () => res());
  });
}

describe('end-to-end pipeline', () => {
  it('hook event -> socket -> parse -> store transitions to needs-you', async () => {
    const store = new SessionStore();
    const col = await startCollector(socketPath, (raw: RawHookEvent) => {
      store.upsertFromEvent(parseHookEvent(raw));
    });

    const startEvent = buildRawEvent({
      tool: 'claude', event: 'SessionStart',
      env: { __CFBundleIdentifier: 'com.apple.Terminal', TERM_SESSION_ID: 'T1' },
      stdin: { session_id: 'sid-1', cwd: '/Users/m/repo' },
      cwd: '/Users/m/repo', gitRoot: '/Users/m/repo', tty: '/dev/ttys003', ts: 1,
    });
    const needsEvent = buildRawEvent({
      tool: 'claude', event: 'Notification',
      env: { __CFBundleIdentifier: 'com.apple.Terminal', TERM_SESSION_ID: 'T1' },
      stdin: { session_id: 'sid-1', cwd: '/Users/m/repo' },
      cwd: '/Users/m/repo', gitRoot: '/Users/m/repo', tty: '/dev/ttys003', ts: 2,
    });

    await send(socketPath, JSON.stringify(startEvent));
    await send(socketPath, JSON.stringify(needsEvent));
    await new Promise((r) => setTimeout(r, 60));

    const s = store.get('claude:sid-1');
    expect(s).toBeDefined();
    expect(s!.state).toBe('waiting');
    expect(s!.attention).toBe('needs-you');
    expect(s!.repoName).toBe('repo');
    expect(store.attentionCount()).toBe(1);

    await col.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/e2e/pipeline.test.ts`
Expected: At this point the imports already exist (Tasks 3,5,7,9), so the test should actually PASS even before the CLI is written. If it fails, fix the wiring before continuing. (This is the integration proof; the CLI in Step 3 reuses exactly these functions.)

- [ ] **Step 3: Create `src/hook/beacon-hook.ts`**

```ts
#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Tool } from '../domain/types';
import { buildRawEvent } from './build-event';
import { parseTty, parsePsRows, findAncestorByComm } from './proc';

// Socket path the Electron main process (M3) will host the collector on.
const SOCKET_PATH = join(homedir(), 'Library', 'Application Support', 'Beacon', 'beacon.sock');

function readStdin(): unknown {
  try {
    const text = readFileSync(0, 'utf8'); // fd 0 = stdin (hook pipes JSON, then EOF)
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

function main(): void {
  // argv: [node, beacon-hook, (--beacon-marker <id>)?, <tool>, <event>]
  const args = process.argv.slice(2).filter((a, i, arr) => {
    if (a === '--beacon-marker') return false;
    if (arr[i - 1] === '--beacon-marker') return false;
    return true;
  });
  const tool = args[0] as Tool;
  const event = args[1];
  if (!tool || !event) process.exit(0);

  const cwd = process.cwd();
  const gitRoot = safe(
    () => execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined,
    undefined,
  );
  const tty = safe(
    () => parseTty(execFileSync('ps', ['-o', 'tty=', '-p', String(process.ppid)], { encoding: 'utf8' })),
    undefined,
  );

  let codexAncestorPid: number | undefined;
  let codexAncestorStartTime: string | undefined;
  if (tool === 'codex') {
    const rows = safe(
      () => parsePsRows(execFileSync('ps', ['-Ao', 'pid=,ppid=,lstart=,comm='], { encoding: 'utf8' })),
      [],
    );
    const anc = findAncestorByComm(rows, process.ppid, 'codex');
    if (anc) { codexAncestorPid = anc.pid; codexAncestorStartTime = anc.lstart; }
  }

  const raw = buildRawEvent({
    tool, event, env: process.env, stdin: readStdin(),
    cwd, gitRoot, tty, codexAncestorPid, codexAncestorStartTime, ts: Date.now(),
  });

  // Fire-and-forget: never block the CLI. Always exit 0.
  const sock = connect(SOCKET_PATH);
  const done = () => process.exit(0);
  sock.on('error', done);
  sock.setTimeout(300, () => { sock.destroy(); done(); });
  sock.on('connect', () => { sock.write(JSON.stringify(raw) + '\n', () => { sock.end(); }); });
  sock.on('close', done);
}

main();
```

- [ ] **Step 4: Run the full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: ALL tests PASS; typecheck clean.

- [ ] **Step 5: Manual smoke of the hook binary**

Run:
```bash
npx tsx src/hook/beacon-hook.ts claude Stop <<< '{"session_id":"manual-1","cwd":"'"$PWD"'"}'; echo "exit=$?"
```
Expected: `exit=0` (no collector is listening yet, so it fails silently and still exits 0 — proving it never blocks the CLI). Install `tsx` if needed: `npm i -D tsx`.

- [ ] **Step 6: Commit**

```bash
git add src/hook/beacon-hook.ts tests/e2e/pipeline.test.ts package.json package-lock.json
git commit -m "feat(hook): beacon-hook CLI entry + end-to-end pipeline test"
```

---

## Self-Review (completed by plan author)

**Spec coverage (M1 portion):**
- Event→state mapping (spec §3, §4.3) → Tasks 3, 4. ✓
- Claude/Codex identity + reconcile, "never merge on weak signals", `--ephemeral` tolerated (degraded = no reconcile) (spec §4.3) → Tasks 2, 5. ✓
- cwd + git-root capture; tty from process tree; tmux/SSH/VS Code-Remote detection → degraded (spec §4.1, §11) → Tasks 8, 9, 3. ✓
- `0600` Unix socket; never shell-interpolate payloads (spec §4.2, §7) → Task 7 (and the CLI uses `execFileSync` with fixed args, never payload data). ✓
- Atomic JSON + single debounced writer (spec §4.3, §10) → Task 6. ✓
- Hook always exits 0 / fire-and-forget (spec §4.1) → Task 10 (Step 5 proves exit 0 with no listener). ✓
- Command/args marker accepted via `--beacon-marker` arg (spec §6) → Task 10 arg parsing (full install logic is M2). ✓

**Deferred to later milestones (intentionally not in M1):** Focuser, Installer (M2); Electron main/Tray/Panel/global-shortcut/IPC/React UI (M3); fullscreen+Stage-Manager, Automation-permission, and measured-latency E2E (M3 manual checklist).

**Placeholder scan:** none — every step contains real code/commands.

**Type consistency:** `RawHookEvent`/`BeaconEvent`/`Session`/`RolloutInfo` defined once in Task 2 and consumed unchanged; `SessionsSnapshot` defined in Task 5, imported by Task 6; store keyed by `tempId` consistently in `upsertFromEvent`/`fromJSON`; `eventKey` output format matches the store key used throughout tests.
