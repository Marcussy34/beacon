# Beacon M3a — Electron Foundation + Main-Process Integration + Tray Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the headless core (domain + collector + hook + focuser + installer, all built in M1/M2) into an actually-runnable macOS tray app: an Electron main process that hosts the collector + session store + persistence + Codex rollout watcher, shows a menu-bar Tray with an attention badge, exposes a contextBridge IPC API, and renders a minimal live session list — so `npm run dev` launches Beacon and it reflects real Claude/Codex sessions end-to-end. Also lands the installer's packaged-invocation + idempotency fix.

**Architecture:** Scaffold `electron-vite` (+ `electron-builder`) INTO the existing repo without disturbing the headless `src/{domain,collector,hook,focuser,installer}` libraries or the vitest suite. A pure, Electron-free `BeaconCore` factory wires collector→store→persistence→rollout-watcher and is unit/integration-tested headlessly; `src/main` is thin Electron glue that instantiates it. Renderer talks to main only through a contextBridge `window.beacon` API. The panel's activating/all-Spaces behavior and the polished UI are deferred to M3b/M3c — M3a uses an ordinary (but already frameless-capable) window just to prove the pipeline.

**Tech Stack:** Electron 42, electron-vite 5, electron-builder 26, React 19, Vite 7, TypeScript strict, vitest. macOS. (Reference: `docs/superpowers/research/2026-06-22-electron-macos-reference.md` — READ IT; it has the exact APIs + packaging facts.)

## Global Constraints

- TypeScript strict ESM for the headless libs + renderer; main/preload build as CJS via electron-vite. `npm run typecheck` MUST stay clean and MUST still cover the existing headless code + tests. **vitest does NOT typecheck** — run typecheck separately every task.
- **REGRESSION GATE:** the existing **136 tests** and a clean typecheck MUST keep passing after every task. Any task that reduces the green test count or breaks typecheck is a failed task. The existing `src/{domain,collector,hook,focuser,installer}` modules and `tests/**` MUST NOT be moved or have their behavior changed (M3a only ADDS `src/main`, `src/preload`, `src/renderer`, `src/core`, config, and the installer idempotency fix).
- Per-task commits ON `main` are AUTHORIZED. Commit style `feat(main)/feat(core)/feat(tray)/feat(ipc)/chore(build)/fix(installer)`. NEVER include `Co-Authored-By`.
- Renderer hardened: `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`. ALL Node work (socket, fs, watcher, child_process focuser, installer) stays in MAIN. Preload only bridges IPC via wrapper functions (never expose raw `ipcRenderer`).
- No code-signing / notarization in M3a (needs Apple creds). Packaging config is added but `electron-builder --mac` runs UNSIGNED/local. LSUIElement set so there is no dock icon.
- Socket path = `~/Library/Application Support/Beacon/beacon.sock` (matches the hardcoded path in `src/hook/beacon-hook.ts`). Data/snapshot path = `~/Library/Application Support/Beacon/state.json`.
- Tests touch only `os.tmpdir()` / injected paths — NEVER the real Application Support dir or real dotfiles.
- All commands run from `/Users/marcus/Projects/beacon`. Electron GUI behaviors that cannot be unit-tested get a MANUAL E2E checklist (Task 7), not a fake passing test.

## Interfaces consumed (already built — import, do NOT redefine)
- `src/domain/store.ts`: `SessionStore` (+ `reconcileCodex`, `toJSON`, `static fromJSON`, `upsertFromEvent`, `markSeen`, `all`, `get`, `attentionCount`, `evictStale`).
- `src/domain/parser.ts`: `parseHookEvent`. `src/domain/persistence.ts`: `saveSnapshot`, `loadSnapshot`, `createDebouncedWriter`. `src/domain/types.ts`: `Session`, `RawHookEvent`, `SessionsSnapshot`.
- `src/collector/socket-server.ts`: `startCollector(socketPath, onEvent): Promise<{close()}>`.
- `src/collector/rollout-watcher.ts`: `startRolloutWatcher(dir, onRollout): {close()}`.
- `src/focuser/focus.ts`: `focusSession(session, run)`, `systemRunner`. `src/focuser/build-command.ts` etc.
- `src/installer/install.ts`: `installHooks`, `dryRunInstall`, `defaultTargets`, `CODEX_TRUST_REVIEW_MESSAGE`. `src/installer/resolve-hook-command.ts`: `resolveHookCommand`. `src/installer/hooks-merge.ts`: `hasBeaconHook` (to be revised in Task 6).

---

## File Structure

```
electron.vite.config.ts          # CREATE: main/preload/renderer build config
electron-builder.yml             # CREATE: mac packaging (LSUIElement, extraResources, entitlements)
build/entitlements.mac.plist     # CREATE: minimal hardened-runtime entitlements
tsconfig.json                    # MODIFY: reference node+web projects
tsconfig.node.json               # CREATE: main+preload+headless libs+tests (Node)
tsconfig.web.json                # CREATE: renderer (DOM+React)
package.json                     # MODIFY: deps, main field, dev/build scripts (keep test/typecheck/build:hook/build:installer)
src/core/app-paths.ts            # CREATE: pure path resolver (socket, data dir, state file)
src/core/beacon-core.ts          # CREATE: Electron-free BeaconCore factory (collector+store+persistence+watcher)
src/core/view-model.ts           # CREATE: pure Session[] -> grouped view model + badge text
src/main/index.ts                # CREATE: Electron main (single-instance, LSUIElement, lifecycle, hosts core)
src/main/tray.ts                 # CREATE: Tray + badge wiring
src/main/ipc.ts                  # CREATE: ipcMain handlers over BeaconCore (+ focuser, mark-seen)
src/preload/index.ts             # CREATE: contextBridge window.beacon API
src/renderer/index.html          # CREATE
src/renderer/src/main.tsx        # CREATE: React root
src/renderer/src/App.tsx         # CREATE: minimal live session list (M3c polishes)
resources/iconTemplate.png       # CREATE: 16x16 black+alpha menu-bar icon (+ @2x)
tests/core/app-paths.test.ts
tests/core/beacon-core.test.ts
tests/core/view-model.test.ts
tests/main/ipc.test.ts
tests/installer/hooks-merge-idempotency.test.ts   # Task 6 gated fix
```

---

### Task 1: Scaffold electron-vite into the repo (REGRESSION GATE)

**Goal:** add Electron build tooling + config + tsconfig split + a trivial main/preload/renderer that builds and launches, WITHOUT breaking the 136 existing tests or typecheck.

**Files:** create `electron.vite.config.ts`, `tsconfig.node.json`, `tsconfig.web.json`, `src/main/index.ts` (trivial), `src/preload/index.ts` (trivial), `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx` (trivial); modify `package.json`, `tsconfig.json`.

- [ ] **Step 1: Install dependencies**

```bash
npm install --save-dev electron@^42 electron-vite@^5 electron-builder@^26 @vitejs/plugin-react@^5 vite@^7 react@^19 react-dom@^19 @types/react@^19 @types/react-dom@^19
npm install @electron-toolkit/utils@^4 @electron-toolkit/preload@^3
```

- [ ] **Step 2: Create `electron.vite.config.ts`**

```ts
import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts') } } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve('src/preload/index.ts') } } },
  },
  renderer: {
    root: 'src/renderer',
    build: { rollupOptions: { input: { index: resolve('src/renderer/index.html') } } },
    resolve: { alias: { '@renderer': resolve('src/renderer/src') } },
    plugins: [react()],
  },
});
```

- [ ] **Step 3: Split tsconfig**

Create `tsconfig.node.json` (main + preload + the headless libs + tests + config — Node side). Copy the EXISTING `tsconfig.json` compilerOptions verbatim (strict, ESNext/Bundler, noUncheckedIndexedAccess, etc.) and set the include set:

```jsonc
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["node"],
    "lib": ["ES2023"]
  },
  "include": [
    "src/domain", "src/collector", "src/hook", "src/focuser", "src/installer",
    "src/core", "src/main", "src/preload",
    "tests", "electron.vite.config.ts"
  ]
}
```

Create `tsconfig.web.json` (renderer only — DOM + React):

```jsonc
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "jsx": "react-jsx",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": []
  },
  "include": ["src/renderer"]
}
```

The existing base `tsconfig.json` is (verbatim): `compilerOptions: { target:"ES2022", module:"ESNext", moduleResolution:"Bundler", strict:true, noUncheckedIndexedAccess:true, esModuleInterop:true, skipLibCheck:true, resolveJsonModule:true, types:["node"] }` and `include:["src","tests"]`. **MODIFY it: REMOVE the `"include": ["src", "tests"]` line** (the two child projects now own the include sets; leaving `include:["src"]` in the base would pull the DOM/React renderer into a Node-typed check and fail). Keep all base `compilerOptions` unchanged (do NOT add `lib` or DOM to the base — the Node project must not see DOM globals; the base's `types:["node"]` is overridden to `[]` by `tsconfig.web.json`). Do NOT use `composite`/project-`references`: `npm run typecheck` runs each child with `tsc -p <child> --noEmit` directly (Step 5), so build-mode is not used.

> **Self-check while editing:** the headless code (`src/domain` …) and `tests/**` currently typecheck under the existing config. After the split they must typecheck IDENTICALLY under `tsconfig.node.json`. Do NOT relax any strict flag.

- [ ] **Step 4: Trivial Electron entry points**

`src/main/index.ts`:
```ts
import { app, BrowserWindow } from 'electron';

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    const win = new BrowserWindow({ width: 680, height: 480, show: true });
    if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL']);
    else win.loadFile('out/renderer/index.html');
  });
}
```

`src/preload/index.ts`:
```ts
// contextBridge API is added in Task 5.
export {};
```

`src/renderer/index.html`:
```html
<!doctype html>
<html>
  <head><meta charset="UTF-8" /><title>Beacon</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
```

`src/renderer/src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
```

`src/renderer/src/App.tsx`:
```tsx
export function App() {
  return <div>Beacon — starting…</div>;
}
```

- [ ] **Step 5: Update `package.json`**

Add `"main": "./out/main/index.js"`. Merge scripts (KEEP existing `test`, `test:watch`, `build:hook`, `build:installer`):
```jsonc
{
  "main": "./out/main/index.js",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json",
    "build:hook": "esbuild src/hook/beacon-hook.ts --bundle --platform=node --target=node20 --format=cjs --outfile=dist/hook/beacon-hook.cjs",
    "build:installer": "esbuild src/installer/cli-entry.ts --bundle --platform=node --target=node20 --format=cjs --outfile=dist/installer/cli.cjs",
    "dev": "electron-vite dev",
    "build:app": "npm run build:hook && electron-vite build",
    "pack:mac": "npm run build:app && electron-builder --mac --dir"
  }
}
```
(`pack:mac` uses `--dir` = unsigned, no DMG/notarization. `build:installer` stays for the standalone CLI.)

- [ ] **Step 6: REGRESSION GATE — verify nothing broke**

```bash
npm run typecheck            # MUST be clean (both projects)
npx vitest run               # MUST be 136 passed (unchanged)
npm run build:app            # electron-vite build MUST succeed (out/main, out/preload, out/renderer)
```
Expected: typecheck clean; **136 passed**; build produces `out/`. If the test count dropped or typecheck fails, the tsconfig split is wrong — fix before committing. Add `out/` to `.gitignore`.

- [ ] **Step 7: Commit**
```bash
grep -qxF 'out/' .gitignore || printf 'out/\n' >> .gitignore
git add electron.vite.config.ts tsconfig.json tsconfig.node.json tsconfig.web.json package.json package-lock.json .gitignore src/main src/preload src/renderer
git commit -m "chore(build): scaffold electron-vite (main/preload/renderer) without breaking headless suite"
```

---

### Task 2: App-paths module (pure)

**Files:** create `src/core/app-paths.ts`, `tests/core/app-paths.test.ts`.

**Interfaces produced:** `appPaths(home: string): { dataDir: string; socketPath: string; statePath: string; codexSessionsDir: string }` — pure, derives the Beacon paths from a home dir (so tests inject tmp). `socketPath` MUST equal `<home>/Library/Application Support/Beacon/beacon.sock` (matching `beacon-hook.ts`).

- [ ] **Step 1: Failing test** `tests/core/app-paths.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { appPaths } from '../../src/core/app-paths';

describe('appPaths', () => {
  it('derives Beacon paths under Application Support/Beacon', () => {
    const p = appPaths('/Users/m');
    const base = join('/Users/m', 'Library', 'Application Support', 'Beacon');
    expect(p.dataDir).toBe(base);
    expect(p.socketPath).toBe(join(base, 'beacon.sock'));
    expect(p.statePath).toBe(join(base, 'state.json'));
    expect(p.codexSessionsDir).toBe(join('/Users/m', '.codex', 'sessions'));
  });
});
```
- [ ] **Step 2:** run → FAIL (module missing).
- [ ] **Step 3:** `src/core/app-paths.ts`:
```ts
import { join } from 'node:path';

export interface AppPaths {
  dataDir: string;
  socketPath: string;
  statePath: string;
  codexSessionsDir: string;
}

/** Pure: derive Beacon's runtime paths from a home dir (injected for tests; main passes os.homedir()). */
export function appPaths(home: string): AppPaths {
  const dataDir = join(home, 'Library', 'Application Support', 'Beacon');
  return {
    dataDir,
    socketPath: join(dataDir, 'beacon.sock'),
    statePath: join(dataDir, 'state.json'),
    codexSessionsDir: join(home, '.codex', 'sessions'),
  };
}
```
- [ ] **Step 4:** run → PASS; `npm run typecheck` clean.
- [ ] **Step 5:** commit `feat(core): app-paths resolver (socket/state/codex-sessions)`.

---

### Task 3: BeaconCore factory (Electron-free) + integration test

**Files:** create `src/core/beacon-core.ts`, `tests/core/beacon-core.test.ts`.

**Interfaces produced:**
- `createBeaconCore(opts: { paths: AppPaths; persistDebounceMs?: number; onChange?: () => void }): Promise<BeaconCore>`
- `interface BeaconCore { store: SessionStore; snapshot(): SessionsSnapshot; attentionCount(): number; markSeen(key: string): void; close(): Promise<void> }`
- Behavior: ensures `dataDir` exists; loads the persisted snapshot into a `SessionStore` (via `loadSnapshot`+`fromJSON`, empty store if none); starts the collector on `socketPath` feeding `parseHookEvent`→`store.upsertFromEvent`; starts the rollout watcher on `codexSessionsDir` (only if it exists — `mkdir -p` it first) feeding `store.reconcileCodex`; on every mutation, debounce-persists the snapshot and calls `onChange`. `close()` stops collector + watcher + flushes the writer.

- [ ] **Step 1: Failing integration test** `tests/core/beacon-core.test.ts` (tmpdir only):
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import { createBeaconCore } from '../../src/core/beacon-core';
import { appPaths } from '../../src/core/app-paths';
import { buildRawEvent } from '../../src/hook/build-event';

function send(path: string, line: string): Promise<void> {
  return new Promise((res, rej) => { const c = connect(path, () => c.write(line + '\n', () => c.end())); c.on('error', rej); c.on('close', () => res()); });
}
async function waitFor(p: () => boolean, ms = 2000): Promise<void> {
  const t = Date.now(); while (Date.now() - t < ms) { if (p()) return; await new Promise(r => setTimeout(r, 20)); } throw new Error('timeout');
}

let home: string;
beforeEach(async () => { home = await mkdtemp(join(tmpdir(), 'beacon-core-')); });
afterEach(async () => { await rm(home, { recursive: true, force: true }); });

describe('createBeaconCore', () => {
  it('hosts the collector: a hook event over the socket updates the store + badge', async () => {
    const paths = appPaths(home);
    await mkdir(paths.dataDir, { recursive: true });
    const core = await createBeaconCore({ paths, persistDebounceMs: 10 });

    const ev = buildRawEvent({
      tool: 'claude', event: 'Notification',
      env: { __CFBundleIdentifier: 'com.apple.Terminal', TERM_SESSION_ID: 'T1' },
      stdin: { session_id: 'sid-1', cwd: '/r' }, cwd: '/r', gitRoot: '/r', tty: '/dev/ttys003', ts: 1,
    });
    await send(paths.socketPath, JSON.stringify(ev));
    await waitFor(() => core.attentionCount() === 1);

    expect(core.store.get('claude:sid-1')!.attention).toBe('needs-you');
    await core.close();
  });

  it('persists across restart: state.json is reloaded into a fresh core', async () => {
    const paths = appPaths(home);
    await mkdir(paths.dataDir, { recursive: true });
    const core1 = await createBeaconCore({ paths, persistDebounceMs: 5 });
    const ev = buildRawEvent({ tool: 'claude', event: 'SessionStart', env: {}, stdin: { session_id: 'sid-9', cwd: '/r' }, cwd: '/r', gitRoot: '/r', ts: 1 });
    await send(paths.socketPath, JSON.stringify(ev));
    await waitFor(() => core1.store.get('claude:sid-9') !== undefined);
    await core1.close(); // flush persistence

    const core2 = await createBeaconCore({ paths, persistDebounceMs: 5 });
    expect(core2.store.get('claude:sid-9')).toBeDefined();
    await core2.close();
  });
});
```
- [ ] **Step 2:** run → FAIL (module missing).
- [ ] **Step 3:** implement `src/core/beacon-core.ts`:
```ts
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { SessionStore } from '../domain/store';
import { parseHookEvent } from '../domain/parser';
import { loadSnapshot, createDebouncedWriter } from '../domain/persistence';
import { startCollector } from '../collector/socket-server';
import { startRolloutWatcher } from '../collector/rollout-watcher';
import type { SessionsSnapshot } from '../domain/store';
import type { AppPaths } from './app-paths';

export interface BeaconCore {
  store: SessionStore;
  snapshot(): SessionsSnapshot;
  attentionCount(): number;
  markSeen(key: string): void;
  close(): Promise<void>;
}

export async function createBeaconCore(opts: {
  paths: AppPaths; persistDebounceMs?: number; onChange?: () => void;
}): Promise<BeaconCore> {
  const { paths, persistDebounceMs = 400, onChange } = opts;
  await mkdir(paths.dataDir, { recursive: true });

  const loaded = await loadSnapshot(paths.statePath).catch(() => null);
  const store = loaded ? SessionStore.fromJSON(loaded) : new SessionStore();

  const writer = createDebouncedWriter(paths.statePath, persistDebounceMs, () => {});
  const touched = () => { writer.schedule(store.toJSON()); onChange?.(); };

  const collector = await startCollector(paths.socketPath, (raw) => {
    try { store.upsertFromEvent(parseHookEvent(raw)); touched(); } catch { /* drop unmapped */ }
  });

  let watcher: { close(): void } | undefined;
  await mkdir(paths.codexSessionsDir, { recursive: true }).catch(() => {});
  if (existsSync(paths.codexSessionsDir)) {
    watcher = startRolloutWatcher(paths.codexSessionsDir, (info) => { if (store.reconcileCodex(info)) touched(); });
  }

  return {
    store,
    snapshot: () => store.toJSON(),
    attentionCount: () => store.attentionCount(),
    markSeen: (key) => { store.markSeen(key); touched(); },
    close: async () => { watcher?.close(); await collector.close(); await writer.flush(); },
  };
}
```
> **NOTE for implementer:** confirm the EXACT signatures of `createDebouncedWriter` (does it expose `schedule(snapshot)` + `flush()`? if the API differs, adapt the calls to the real signature in `src/domain/persistence.ts` — do NOT change persistence.ts) and `loadSnapshot` (sync vs async; returns `SessionsSnapshot | null`?). Read `src/domain/persistence.ts` first and match its real API. This is the one task where you must reconcile against existing code rather than transcribe.
- [ ] **Step 4:** run → PASS (both). `npm run typecheck` clean. Full suite still green.
- [ ] **Step 5:** commit `feat(core): BeaconCore factory hosting collector+store+persistence+rollout watcher`.

---

### Task 4: View-model + badge (pure) and Tray wiring

**Files:** create `src/core/view-model.ts`, `tests/core/view-model.test.ts`, `src/main/tray.ts`.

**Interfaces produced (pure, tested):**
- `badgeText(count: number): string` — `''` for 0, the number for 1–9, `'9+'` for ≥10 (used for `tray.setTitle`).
- `groupSessions(sessions: Session[]): { needsYou: Session[]; working: Session[]; done: Session[]; closed: Session[] }` — buckets by state/attention (needs-you → needsYou; state 'working'|'started' → working; attention 'done' → done; state 'closed' → closed), each sorted by `lastEventAt` desc.

**Tray (`src/main/tray.ts`, glue — verified by launch, not unit test):**
- `createTray(opts: { iconPath: string; onToggle(): void; onQuit(): void }): { setBadge(count: number): void; destroy(): void }` — builds a template-image `Tray`, `tray.on('click', onToggle)`, `setBadge` calls `tray.setTitle(badgeText(count))`. Do NOT set a context menu (it suppresses click on macOS); provide quit via a separate menu only if needed — for M3a, quit is wired in main via app menu / Cmd-Q.

- [ ] **Step 1: Failing tests** `tests/core/view-model.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { badgeText, groupSessions } from '../../src/core/view-model';
import type { Session } from '../../src/domain/types';

const base: Session = {
  id: 'k', tempId: 'k', tool: 'claude', repoPath: '/r', gitRoot: '/r', repoName: 'r',
  host: 'terminal', remote: 'none', gotoPrecision: 'precise',
  state: 'started', attention: 'none', seen: true, startedAt: 1, lastEventAt: 1,
};

describe('badgeText', () => {
  it('is empty for 0, the count for 1-9, 9+ for >=10', () => {
    expect(badgeText(0)).toBe('');
    expect(badgeText(3)).toBe('3');
    expect(badgeText(9)).toBe('9');
    expect(badgeText(12)).toBe('9+');
  });
});

describe('groupSessions', () => {
  it('buckets by attention/state and sorts each by lastEventAt desc', () => {
    const s = (over: Partial<Session>): Session => ({ ...base, ...over });
    const g = groupSessions([
      s({ id: 'a', attention: 'needs-you', state: 'waiting', lastEventAt: 5 }),
      s({ id: 'b', state: 'working', lastEventAt: 9 }),
      s({ id: 'c', attention: 'done', state: 'done', lastEventAt: 2 }),
      s({ id: 'd', state: 'closed', lastEventAt: 1 }),
      s({ id: 'e', state: 'working', lastEventAt: 11 }),
    ]);
    expect(g.needsYou.map(x => x.id)).toEqual(['a']);
    expect(g.working.map(x => x.id)).toEqual(['e', 'b']); // desc by lastEventAt
    expect(g.done.map(x => x.id)).toEqual(['c']);
    expect(g.closed.map(x => x.id)).toEqual(['d']);
  });
});
```
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement `src/core/view-model.ts`:
```ts
import type { Session } from '../domain/types';

export function badgeText(count: number): string {
  if (count <= 0) return '';
  return count >= 10 ? '9+' : String(count);
}

export interface GroupedSessions {
  needsYou: Session[]; working: Session[]; done: Session[]; closed: Session[];
}

const byRecent = (a: Session, b: Session) => b.lastEventAt - a.lastEventAt;

export function groupSessions(sessions: Session[]): GroupedSessions {
  const g: GroupedSessions = { needsYou: [], working: [], done: [], closed: [] };
  for (const s of sessions) {
    if (s.state === 'closed') g.closed.push(s);
    else if (s.attention === 'needs-you') g.needsYou.push(s);
    else if (s.attention === 'done') g.done.push(s);
    else g.working.push(s); // started | working | (waiting handled above via attention)
  }
  g.needsYou.sort(byRecent); g.working.sort(byRecent); g.done.sort(byRecent); g.closed.sort(byRecent);
  return g;
}
```
Then `src/main/tray.ts`:
```ts
import { Tray, nativeImage, type NativeImage } from 'electron';
import { badgeText } from '../core/view-model';

export interface BeaconTray { setBadge(count: number): void; destroy(): void; }

export function createTray(opts: { iconPath: string; onToggle: () => void }): BeaconTray {
  const icon: NativeImage = nativeImage.createFromPath(opts.iconPath);
  icon.setTemplateImage(true);
  const tray = new Tray(icon);
  tray.setToolTip('Beacon');
  tray.on('click', () => opts.onToggle()); // no context menu — it would suppress click on macOS
  return {
    setBadge: (count) => tray.setTitle(badgeText(count), { fontType: 'monospacedDigit' }),
    destroy: () => tray.destroy(),
  };
}
```
- [ ] **Step 4:** run view-model test → PASS; `npm run typecheck` clean (tray.ts is glue, compiles). Full suite green.
- [ ] **Step 5:** commit `feat(tray): pure badge/group view-model + Tray wiring`.

---

### Task 5: IPC bridge + minimal live renderer

**Files:** create `src/main/ipc.ts`, `tests/main/ipc.test.ts`; rewrite `src/preload/index.ts`, `src/renderer/src/App.tsx`; modify `src/main/index.ts` to assemble core+tray+ipc+window.

**Interfaces produced:**
- Pure handlers in `ipc.ts`: `createIpcHandlers(core: BeaconCore, focus: (key: string) => Promise<{ ok: boolean; message: string }>): { snapshot(): SessionsSnapshot; markSeen(key: string): void; goto(key: string): Promise<{ ok: boolean; message: string }> }`. `goto` marks the session seen then focuses it. These are registered with `ipcMain.handle` in `index.ts` and unit-tested directly here.
- Preload exposes `window.beacon = { getSnapshot(), onUpdate(cb), markSeen(key), goto(key) }` (wrapper fns; never raw ipcRenderer).

- [ ] **Step 1: Failing test** `tests/main/ipc.test.ts` (no Electron — test the pure handlers over a real BeaconCore):
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import { createBeaconCore } from '../../src/core/beacon-core';
import { appPaths } from '../../src/core/app-paths';
import { buildRawEvent } from '../../src/hook/build-event';
import { createIpcHandlers } from '../../src/main/ipc';

function send(p: string, l: string): Promise<void> { return new Promise((res, rej) => { const c = connect(p, () => c.write(l + '\n', () => c.end())); c.on('error', rej); c.on('close', () => res()); }); }
async function waitFor(p: () => boolean, ms = 2000) { const t = Date.now(); while (Date.now() - t < ms) { if (p()) return; await new Promise(r => setTimeout(r, 20)); } throw new Error('timeout'); }

let home: string;
beforeEach(async () => { home = await mkdtemp(join(tmpdir(), 'beacon-ipc-')); });
afterEach(async () => { await rm(home, { recursive: true, force: true }); });

describe('ipc handlers', () => {
  it('snapshot reflects sessions; markSeen clears attention; goto marks seen + focuses', async () => {
    const paths = appPaths(home); await mkdir(paths.dataDir, { recursive: true });
    const core = await createBeaconCore({ paths, persistDebounceMs: 5 });
    const focused: string[] = [];
    const h = createIpcHandlers(core, async (key) => { focused.push(key); return { ok: true, message: 'focused' }; });

    const ev = buildRawEvent({ tool: 'claude', event: 'Notification', env: {}, stdin: { session_id: 'sid-1', cwd: '/r' }, cwd: '/r', gitRoot: '/r', ts: 1 });
    await send(paths.socketPath, JSON.stringify(ev));
    await waitFor(() => core.attentionCount() === 1);

    expect(h.snapshot().sessions.find(s => s.id === 'claude:sid-1')!.attention).toBe('needs-you');
    const r = await h.goto('claude:sid-1');
    expect(r.ok).toBe(true);
    expect(focused).toEqual(['claude:sid-1']);
    expect(core.store.get('claude:sid-1')!.seen).toBe(true); // goto marked seen
    expect(core.attentionCount()).toBe(0);
    await core.close();
  });
});
```
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement `src/main/ipc.ts`:
```ts
import type { BeaconCore } from '../core/beacon-core';
import type { SessionsSnapshot } from '../domain/store';

export interface IpcHandlers {
  snapshot(): SessionsSnapshot;
  markSeen(key: string): void;
  goto(key: string): Promise<{ ok: boolean; message: string }>;
}

/** Pure-ish IPC handlers over the core. `focus` is injected (main passes the focuser). */
export function createIpcHandlers(
  core: BeaconCore,
  focus: (key: string) => Promise<{ ok: boolean; message: string }>,
): IpcHandlers {
  return {
    snapshot: () => core.snapshot(),
    markSeen: (key) => core.markSeen(key),
    goto: async (key) => { core.markSeen(key); return focus(key); }, // "Go to" also marks seen (spec §4.6)
  };
}
```
Wire `src/main/index.ts` (glue — assemble everything; verified by launch in Task 7):
```ts
import { app, BrowserWindow, ipcMain } from 'electron';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { appPaths } from '../core/app-paths';
import { createBeaconCore } from '../core/beacon-core';
import { createTray } from './tray';
import { createIpcHandlers } from './ipc';
import { focusSession, systemRunner } from '../focuser/focus';

if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.whenReady().then(async () => {
    app.dock?.hide();
    const paths = appPaths(homedir());
    let win: BrowserWindow | null = null;

    const core = await createBeaconCore({ paths, onChange: () => {
      tray.setBadge(core.attentionCount());
      win?.webContents.send('update', core.snapshot());
    }});

    const tray = createTray({
      iconPath: app.isPackaged
        ? join(process.resourcesPath, 'iconTemplate.png')
        : join(__dirname, '../../resources/iconTemplate.png'),
      onToggle: () => { if (win?.isVisible()) win.hide(); else showPanel(); },
    });
    tray.setBadge(core.attentionCount());

    const handlers = createIpcHandlers(core, async (key) => {
      const s = core.store.get(key);
      if (!s) return { ok: false, message: 'session gone' };
      const r = await focusSession(s, systemRunner);
      return { ok: r.ok, message: r.message };
    });
    ipcMain.handle('snapshot', () => handlers.snapshot());
    ipcMain.handle('markSeen', (_e, key: string) => handlers.markSeen(key));
    ipcMain.handle('goto', (_e, key: string) => handlers.goto(key));

    function showPanel() {
      if (!win) {
        win = new BrowserWindow({
          width: 680, height: 520, show: false,
          webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
        });
        if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL']);
        else win.loadFile(join(__dirname, '../renderer/index.html'));
      }
      win.show();
    }

    app.on('will-quit', () => { void core.close(); tray.destroy(); });
  });
}
```
Preload `src/preload/index.ts`:
```ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('beacon', {
  getSnapshot: () => ipcRenderer.invoke('snapshot'),
  markSeen: (key: string) => ipcRenderer.invoke('markSeen', key),
  goto: (key: string) => ipcRenderer.invoke('goto', key),
  onUpdate: (cb: (snap: unknown) => void) => {
    const h = (_e: unknown, snap: unknown) => cb(snap);
    ipcRenderer.on('update', h);
    return () => ipcRenderer.removeListener('update', h);
  },
});
```
Minimal `src/renderer/src/App.tsx` (M3c polishes; just prove the live pipeline):
```tsx
import { useEffect, useState } from 'react';

interface Snap { version: number; sessions: Array<{ id: string; repoName: string; tool: string; state: string; attention: string; seen: boolean }>; }
declare global {
  interface Window { beacon: { getSnapshot(): Promise<Snap>; markSeen(k: string): Promise<void>; goto(k: string): Promise<{ ok: boolean; message: string }>; onUpdate(cb: (s: Snap) => void): () => void; }; }
}

export function App() {
  const [snap, setSnap] = useState<Snap>({ version: 1, sessions: [] });
  useEffect(() => { window.beacon.getSnapshot().then(setSnap); return window.beacon.onUpdate(setSnap); }, []);
  return (
    <div style={{ fontFamily: 'system-ui', padding: 12 }}>
      <h3>Beacon — {snap.sessions.length} session(s)</h3>
      <ul>
        {snap.sessions.map((s) => (
          <li key={s.id}>
            <b>{s.repoName}</b> [{s.tool}] {s.state} {s.attention !== 'none' && !s.seen ? '●' : ''}
            {' '}<button onClick={() => window.beacon.goto(s.id)}>Go to</button>
            {' '}<button onClick={() => window.beacon.markSeen(s.id)}>seen</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```
- [ ] **Step 4:** run ipc test → PASS; `npm run typecheck` clean; full suite green; `npm run build:app` succeeds.
- [ ] **Step 5:** commit `feat(ipc): contextBridge bridge + minimal live renderer + main assembly`.

---

### Task 6: Installer packaged-invocation + GATED idempotency fix

**Why now:** M3 introduces the packaged invocation (`ELECTRON_RUN_AS_NODE=1 "<execPath>" "<resources>/beacon-hook.cjs" …`), which DIFFERS from the dev invocation. The installer currently keys idempotency/uninstall on the EXACT command string, so a reinstall after the invocation changes would DOUBLE-ADD. This task makes idempotency match on tool+event+marker (replace stale) — landing WITH the invocation change, per the M2b/Codex gated finding.

**Files:** modify `src/installer/hooks-merge.ts` (+ `resolve-hook-command.ts` for packaged mode); create `tests/installer/hooks-merge-idempotency.test.ts`. Keep existing installer tests green.

- [ ] **Step 1: Failing test** `tests/installer/hooks-merge-idempotency.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mergeBeaconHooks, planMerge } from '../../src/installer/hooks-merge';
import type { BeaconHookSpec, HookConfig } from '../../src/installer/types';

const specA = (e: string): BeaconHookSpec => ({ event: e, command: `node "/old/beacon-hook.cjs" --beacon-marker beacon claude ${e}`, timeout: 5 });
const specB = (e: string): BeaconHookSpec => ({ event: e, command: `ELECTRON_RUN_AS_NODE=1 "/App/Beacon" "/res/beacon-hook.cjs" --beacon-marker beacon claude ${e}`, timeout: 5 });

describe('idempotency across a changed invocation', () => {
  it('reinstall with a DIFFERENT invocation replaces the stale Beacon hook, not double-adds', () => {
    let cfg: HookConfig = mergeBeaconHooks({}, [specA('SessionStart')]);
    cfg = mergeBeaconHooks(cfg, [specB('SessionStart')]); // invocation changed
    const groups = cfg.hooks!.SessionStart;
    const beaconCmds = groups.flatMap(g => g.hooks).filter(h => h.command.includes('--beacon-marker'));
    expect(beaconCmds).toHaveLength(1);                       // exactly one, not two
    expect(beaconCmds[0]!.command).toContain('ELECTRON_RUN_AS_NODE'); // the NEW one won
  });
  it('same-invocation reinstall is still a no-op (added 0)', () => {
    const cfg = mergeBeaconHooks({}, [specB('SessionStart')]);
    const plan = planMerge(cfg, [specB('SessionStart')]);
    expect(plan.additions).toHaveLength(0);
  });
  it('preserves a user hook in the same event', () => {
    const user: HookConfig = { hooks: { SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: 'user-cmd' }] }] } };
    let cfg = mergeBeaconHooks(user, [specA('SessionStart')]);
    cfg = mergeBeaconHooks(cfg, [specB('SessionStart')]);
    const cmds = cfg.hooks!.SessionStart.flatMap(g => g.hooks).map(h => h.command);
    expect(cmds).toContain('user-cmd');                       // user hook untouched
    expect(cmds.filter(c => c.includes('--beacon-marker'))).toHaveLength(1);
  });
});
```
- [ ] **Step 2:** run → FAIL (current exact-match merge double-adds).
- [ ] **Step 3:** revise `hooks-merge.ts` so a Beacon hook is keyed on (tool,event,marker), replacing any stale Beacon entry for the same event before adding. Concretely: add a helper that, in `mergeBeaconHooks`, BEFORE inserting a spec, removes any existing Beacon-marked hook entry under that event whose command differs (prune emptied groups), then inserts. Keep `planMerge` reporting "already present" only when the EXACT command is already present (so same-invocation reinstall = 0 additions). Update `hasBeaconHook`/`removeBeaconHooks` only as needed; do NOT break existing installer tests. (Implementer: read the current `hooks-merge.ts`; the minimal change is a `replaceBeaconHook` step inside the merge loop. Show the diff in your report.)
- [ ] **Step 4:** run new test → PASS; run ALL installer tests (`npx vitest run tests/installer`) → still green; `npm run typecheck` clean.
- [ ] **Step 5:** Update `resolve-hook-command.ts` to support packaged mode: add `resolveHookCommand({ packaged?: boolean; execPath?: string; resourcesPath?: string })` → when `packaged`, return `ELECTRON_RUN_AS_NODE=1 "<execPath>" "<resourcesPath>/beacon-hook.cjs"` (shell-quoted); else the existing dev form. Add a focused test. Keep the existing dev behavior + tests green.
- [ ] **Step 6:** commit `fix(installer): tool+event+marker idempotency + packaged hook invocation`.

---

### Task 7: Build, package, and MANUAL E2E checklist

**Files:** create `resources/iconTemplate.png` (+ `@2x`), `electron-builder.yml`, `build/entitlements.mac.plist`; this task produces the runnable artifact + the human checklist (no new unit tests).

- [ ] **Step 1: Tray icon.** Add a 16×16 black+alpha `resources/iconTemplate.png` and 32×32 `resources/iconTemplate@2x.png` (a simple filled beacon/dot glyph). (If image generation isn't available, commit a placeholder solid-dot PNG; note it for M3c polish.)

- [ ] **Step 2: `electron-builder.yml`** (unsigned local build; LSUIElement; bundle beacon-hook + icon):
```yaml
appId: com.marcus.beacon
productName: Beacon
directories:
  buildResources: build
files:
  - out/**
  - package.json
extraResources:
  - from: dist/hook/beacon-hook.cjs
    to: beacon-hook.cjs
  - from: resources/iconTemplate.png
    to: iconTemplate.png
  - from: resources/iconTemplate@2x.png
    to: iconTemplate@2x.png
mac:
  category: public.app-category.developer-tools
  target: [{ target: dir }]      # unsigned local build (no dmg/notarization)
  extendInfo:
    LSUIElement: true
    NSAppleEventsUsageDescription: "Beacon focuses your terminal/editor windows via AppleScript when you click 'Go to'."
  entitlementsInherit: build/entitlements.mac.plist
```

- [ ] **Step 3: `build/entitlements.mac.plist`** (minimal; allow Apple events + JIT for Chromium):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.security.automation.apple-events</key><true/>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
</dict></plist>
```

- [ ] **Step 4: Build gate.**
```bash
npm run build:hook
npm run build:app          # electron-vite build -> out/
npm run pack:mac           # electron-builder --mac --dir -> dist/mac*/Beacon.app (unsigned)
```
Expected: all succeed; `dist/mac*/Beacon.app` exists. (Commit nothing under `dist/`/`out/` — gitignored.)

- [ ] **Step 5: Launch smoke (controller/human runs this).**
```bash
npm run dev    # Beacon launches: NO dock icon, a Tray icon appears in the menu bar
```
Verify: tray icon present; clicking it shows the window; with a real `claude`/`codex` session running (after installing hooks via `node dist/installer/cli.cjs`), the window lists the session and the tray title shows the attention count.

- [ ] **Step 6: Commit** `chore(build): electron-builder mac packaging + tray icon + entitlements`.

- [ ] **Step 7: Write `docs/superpowers/MANUAL-E2E-M3.md`** — the human validation checklist (carried into M3b/M3c too): tray appears / no dock icon; window shows live sessions; badge count tracks needs-you+done unseen; mark-seen clears dot+badge; "Go to" focuses Terminal.app (tty match) / VS Code / Cursor and the degraded fallbacks; install hooks → run real claude+codex → observe transitions; Automation-permission prompt on first "Go to" + denial fallback; persistence across app restart; hook latency feel. (M3b adds: ⌘⇧Space summons the panel over fullscreen + Stage Manager + multi-display; hide on blur/Esc; shortcut-conflict UX.)

---

## Post-Plan Notes (controller)
- Tasks 2,3,4(view-model),5(ipc),6 are TDD-testable and get the normal implementer→review loop. Tasks 1,4(tray),5(main glue),7 are Electron glue/packaging verified by build+typecheck+launch, not unit tests — review them for correctness against the research doc, and rely on the manual E2E checklist for runtime behavior.
- After Task 7: full suite (136 + new) + typecheck green; `npm run dev` launches; Codex independent pass recommended on the main-process assembly + the installer idempotency change (risk surfaces).
- M3b (activating all-Spaces panel + ⌘⇧Space + conflict UX + hide-on-blur/Esc) and M3c (React/Tailwind/shadcn polished UI) follow as separate plans. The window created in Task 5 becomes the panel in M3b.
