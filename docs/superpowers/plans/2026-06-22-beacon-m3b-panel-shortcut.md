# Beacon M3b — Activating ⌘⇧Space Panel + Global Shortcut Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn the plain M3a window into the ChatGPT-launcher-style panel: a frameless, translucent, **activating** `BrowserWindow` that the user summons with **⌘⇧Space** from anywhere, that **floats over all Spaces and fullscreen apps**, takes focus, and hides on **blur** + **Esc** — with graceful **shortcut-conflict** handling (the combo may be taken) and a persisted user-chosen accelerator. Also: a `second-instance` handler that summons the panel, and first-run hook install + Codex `/hooks` trust surfacing.

**Architecture:** Pure, testable helpers (`panelPosition`, the conflict-handling `createShortcutManager`, accelerator persistence, first-run detection) + thin Electron glue in `src/main` that builds the panel and wires the shortcut/tray/second-instance. The GUI behaviors (frameless look, all-Spaces float, focus-steal, hide-on-blur) are validated by the human via `docs/superpowers/MANUAL-E2E-M3.md` — they cannot be unit-tested.

**Tech Stack:** Electron 42 (APIs verified in `docs/superpowers/research/2026-06-22-electron-macos-reference.md` — READ IT), TypeScript strict, vitest. macOS.

## Global Constraints
- TypeScript strict ESM (headless/test) + the existing tsconfig split; `npm run typecheck` (both projects) MUST stay clean — vitest does NOT typecheck.
- **REGRESSION GATE every task:** the existing **150 tests** + typecheck stay green; `npm run build:app` keeps succeeding; the headless preload smoke (`npx electron scripts/smoke-preload.mjs`) still prints `SMOKE:0`.
- Per-task commits ON `main` AUTHORIZED. Commit style `feat(panel)/feat(shortcut)/feat(main)`. NEVER `Co-Authored-By`.
- Keep the renderer hardened: `contextIsolation:true, nodeIntegration:false, sandbox:true`; preload stays CommonJS (`out/preload/index.js`) — do NOT regress the M3a sandbox-preload fix.
- Panel APIs (verified, use exactly): window opts `{ show:false, frame:false, transparent:true, fullscreenable:false, skipTaskbar:true, focusable:true, resizable:false, alwaysOnTop:true }`; `win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen:true, skipTransformProcessType:true })`; `win.setAlwaysOnTop(true, 'screen-saver')`; summon = `win.show()` then `app.focus({ steal:true })`; hide-on-blur guarded by `win.webContents.isDevToolsFocused()`; Esc via `webContents.on('before-input-event')`.
- globalShortcut: `register()` returns a boolean and fails SILENTLY when the combo is taken — MUST check it; `globalShortcut.unregisterAll()` on `will-quit`; default accelerator `'CommandOrControl+Shift+Space'`.
- Tests touch only `os.tmpdir()` / injected deps — never real paths. Tray must keep working even if the shortcut fails to register.
- All commands from `/Users/marcus/Projects/beacon`.

## Interfaces consumed (built — import, do NOT redefine)
- `src/core/app-paths.ts`: `appPaths(home)` (has `dataDir`). `src/installer/install.ts`: `installHooks`, `defaultTargets`, `CODEX_TRUST_REVIEW_MESSAGE`. `src/main/index.ts`: the existing `showPanel()`/assembly to extend.

---

## File Structure
```
src/main/panel.ts             # CREATE: panelPosition (pure) + createPanel (glue: frameless activating all-Spaces window)
src/main/shortcut.ts          # CREATE: createShortcutManager (conflict-handling) + accelerator persistence (load/save) + first-run helpers
tests/main/panel.test.ts      # panelPosition pure tests
tests/main/shortcut.test.ts   # shortcut manager state-machine + persistence tests (fake globalShortcut)
src/main/index.ts             # MODIFY: use createPanel; wire shortcut manager + second-instance + first-run install
docs/superpowers/MANUAL-E2E-M3.md  # MODIFY: fill in the M3b manual checks
```

---

### Task 1: Panel — `panelPosition` (pure) + `createPanel` (activating all-Spaces window)

**Files:** Create `src/main/panel.ts`, `tests/main/panel.test.ts`.

**Interfaces produced:**
- `panelPosition(workArea: { x: number; y: number; width: number; height: number }, size: { width: number; height: number }): { x: number; y: number }` — horizontally centered in the work area; vertically near the top (y = workArea.y + round(workArea.height * 0.12)). Clamped so the panel stays within the work area.
- `PANEL_SIZE = { width: 680, height: 520 }`.
- `createPanel(opts: { preloadPath: string; loadDevUrl?: string; loadFile: string; onHidden?: () => void }): { show(): void; hide(): void; toggle(): void; send(channel: string, payload: unknown): void; isVisible(): boolean; destroy(): void }` — builds the frameless activating panel, positions it on the active display before each show, summons via `show()`+`app.focus({steal:true})`, hides on blur (devtools-guarded) and Esc. (Glue — verified by build/typecheck/launch + manual E2E; the position math is the unit-tested part.)

- [ ] **Step 1: Failing test** `tests/main/panel.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { panelPosition, PANEL_SIZE } from '../../src/main/panel';

describe('panelPosition', () => {
  it('centers horizontally and sits near the top of the work area', () => {
    const wa = { x: 0, y: 25, width: 1440, height: 875 }; // 25 = menu bar offset
    const pos = panelPosition(wa, PANEL_SIZE);
    expect(pos.x).toBe(Math.round((1440 - PANEL_SIZE.width) / 2));
    expect(pos.y).toBe(25 + Math.round(875 * 0.12));
  });
  it('respects a non-zero work-area origin (second display)', () => {
    const wa = { x: 1440, y: 0, width: 1920, height: 1080 };
    const pos = panelPosition(wa, PANEL_SIZE);
    expect(pos.x).toBe(1440 + Math.round((1920 - PANEL_SIZE.width) / 2));
    expect(pos.y).toBe(Math.round(1080 * 0.12));
  });
  it('clamps within the work area for a tiny screen', () => {
    const wa = { x: 0, y: 0, width: 400, height: 300 };
    const pos = panelPosition(wa, PANEL_SIZE);
    expect(pos.x).toBeGreaterThanOrEqual(0);
    expect(pos.y).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2:** run → FAIL (module missing).

- [ ] **Step 3:** write `src/main/panel.ts`:
```ts
import { app, BrowserWindow, screen } from 'electron';

export const PANEL_SIZE = { width: 680, height: 520 } as const;

export interface WorkArea { x: number; y: number; width: number; height: number; }
export interface Size { width: number; height: number; }

/** Centered horizontally, near the top of the work area; clamped to stay on-screen. */
export function panelPosition(workArea: WorkArea, size: Size): { x: number; y: number } {
  const x = workArea.x + Math.round((workArea.width - size.width) / 2);
  const y = workArea.y + Math.round(workArea.height * 0.12);
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max));
  return {
    x: clamp(x, workArea.x, workArea.x + Math.max(0, workArea.width - size.width)),
    y: clamp(y, workArea.y, workArea.y + Math.max(0, workArea.height - size.height)),
  };
}

export interface Panel {
  show(): void; hide(): void; toggle(): void;
  send(channel: string, payload: unknown): void;
  isVisible(): boolean; destroy(): void;
}

export function createPanel(opts: {
  preloadPath: string; loadDevUrl?: string; loadFile: string; onHidden?: () => void;
}): Panel {
  let win: BrowserWindow | null = null;

  function build(): BrowserWindow {
    const w = new BrowserWindow({
      ...PANEL_SIZE,
      show: false, frame: false, transparent: true, resizable: false,
      fullscreenable: false, skipTaskbar: true, focusable: true, alwaysOnTop: true,
      webPreferences: { preload: opts.preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    // Float over all Spaces + fullscreen apps; skipTransformProcessType because we are an LSUIElement app.
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    w.setAlwaysOnTop(true, 'screen-saver');
    if (opts.loadDevUrl) w.loadURL(opts.loadDevUrl); else w.loadFile(opts.loadFile);
    w.on('closed', () => { win = null; });
    w.on('blur', () => { if (win && !win.webContents.isDevToolsFocused()) hide(); }); // hide on click-away
    w.webContents.on('before-input-event', (_e, input) => { if (input.key === 'Escape') hide(); });
    return w;
  }
  function positionOnActiveDisplay(w: BrowserWindow): void {
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const { x, y } = panelPosition(display.workArea, PANEL_SIZE);
    w.setPosition(x, y);
  }
  function show(): void {
    if (!win) win = build();
    positionOnActiveDisplay(win);
    win.show();
    app.focus({ steal: true }); // activating: take focus like Spotlight/ChatGPT
  }
  function hide(): void { if (win && win.isVisible()) { win.hide(); opts.onHidden?.(); } }
  function toggle(): void { if (win && win.isVisible()) hide(); else show(); }
  function send(channel: string, payload: unknown): void {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }
  return { show, hide, toggle, send, isVisible: () => !!win && win.isVisible(), destroy: () => win?.destroy() };
}
```

- [ ] **Step 4:** run panel test → PASS; `npm run typecheck` → clean; `npx vitest run` → 153 green (150 + 3); `npm run build:app` → ok.

- [ ] **Step 5:** Commit `feat(panel): activating all-Spaces frameless panel + centered-top positioning`.

---

### Task 2: Shortcut manager (conflict-handling) + accelerator persistence

**Files:** Create `src/main/shortcut.ts`, `tests/main/shortcut.test.ts`.

**Interfaces produced:**
- `DEFAULT_ACCELERATOR = 'CommandOrControl+Shift+Space'`.
- `ShortcutDeps { register(accelerator: string, cb: () => void): boolean; unregisterAll(): void }` (the injectable slice of Electron's `globalShortcut`).
- `createShortcutManager(deps: ShortcutDeps, onTrigger: () => void): { apply(accelerator: string): { ok: boolean; accelerator: string }; current(): string; lastError(): string | null; dispose(): void }` — `apply` unregisters all, then `register`s the accelerator; on `false` (combo taken) it records a `lastError` but does NOT throw (tray keeps working); returns `{ok, accelerator}`. `current()` is the last successfully-applied accelerator (or the attempted one if none succeeded yet).
- `loadAccelerator(path: string): string` (returns `DEFAULT_ACCELERATOR` if missing/invalid) and `saveAccelerator(path: string, accelerator: string): void` — persist the user's chosen accelerator as JSON `{ accelerator }`.

- [ ] **Step 1: Failing test** `tests/main/shortcut.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createShortcutManager, loadAccelerator, saveAccelerator, DEFAULT_ACCELERATOR, type ShortcutDeps } from '../../src/main/shortcut';

function fakeDeps(registry: Set<string>): { deps: ShortcutDeps; registered: string[] } {
  const registered: string[] = [];
  const deps: ShortcutDeps = {
    register: (acc) => { if (registry.has(acc)) return false; registered.push(acc); return true; }, // taken combos return false
    unregisterAll: () => { registered.length = 0; },
  };
  return { deps, registered };
}

describe('createShortcutManager', () => {
  it('applies the default accelerator successfully when free', () => {
    const { deps } = fakeDeps(new Set());
    const m = createShortcutManager(deps, () => {});
    const r = m.apply(DEFAULT_ACCELERATOR);
    expect(r).toEqual({ ok: true, accelerator: DEFAULT_ACCELERATOR });
    expect(m.current()).toBe(DEFAULT_ACCELERATOR);
    expect(m.lastError()).toBeNull();
  });
  it('records a conflict (does NOT throw) when the combo is taken', () => {
    const { deps } = fakeDeps(new Set([DEFAULT_ACCELERATOR])); // already taken by another app
    const m = createShortcutManager(deps, () => {});
    const r = m.apply(DEFAULT_ACCELERATOR);
    expect(r.ok).toBe(false);
    expect(m.lastError()).toMatch(/in use|taken|conflict/i);
  });
  it('can re-apply an alternate accelerator after a conflict', () => {
    const { deps } = fakeDeps(new Set([DEFAULT_ACCELERATOR]));
    const m = createShortcutManager(deps, () => {});
    expect(m.apply(DEFAULT_ACCELERATOR).ok).toBe(false);
    const alt = m.apply('CommandOrControl+Shift+B');
    expect(alt).toEqual({ ok: true, accelerator: 'CommandOrControl+Shift+B' });
    expect(m.current()).toBe('CommandOrControl+Shift+B');
    expect(m.lastError()).toBeNull();
  });
});

describe('accelerator persistence', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'beacon-acc-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
  it('defaults when the file is missing', () => {
    expect(loadAccelerator(join(dir, 'nope.json'))).toBe(DEFAULT_ACCELERATOR);
  });
  it('round-trips a saved accelerator', () => {
    const p = join(dir, 'shortcut.json');
    saveAccelerator(p, 'CommandOrControl+Shift+B');
    expect(loadAccelerator(p)).toBe('CommandOrControl+Shift+B');
  });
  it('defaults on malformed json', () => {
    const p = join(dir, 'bad.json'); writeFileSync(p, '{ not json');
    expect(loadAccelerator(p)).toBe(DEFAULT_ACCELERATOR);
  });
});
```

- [ ] **Step 2:** run → FAIL.

- [ ] **Step 3:** write `src/main/shortcut.ts`:
```ts
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const DEFAULT_ACCELERATOR = 'CommandOrControl+Shift+Space';

export interface ShortcutDeps {
  register(accelerator: string, cb: () => void): boolean;
  unregisterAll(): void;
}

export interface ShortcutManager {
  apply(accelerator: string): { ok: boolean; accelerator: string };
  current(): string;
  lastError(): string | null;
  dispose(): void;
}

/** Register a global accelerator with conflict detection. register() fails silently (false) when
 *  the combo is taken — we surface that as lastError and keep going (the Tray still works). */
export function createShortcutManager(deps: ShortcutDeps, onTrigger: () => void): ShortcutManager {
  let applied = DEFAULT_ACCELERATOR;
  let error: string | null = null;
  return {
    apply(accelerator) {
      deps.unregisterAll();
      const ok = deps.register(accelerator, onTrigger);
      if (ok) { applied = accelerator; error = null; }
      else { error = `Shortcut "${accelerator}" is already in use by another app; pick another.`; }
      return { ok, accelerator };
    },
    current: () => applied,
    lastError: () => error,
    dispose: () => deps.unregisterAll(),
  };
}

export function loadAccelerator(path: string): string {
  if (!existsSync(path)) return DEFAULT_ACCELERATOR;
  try {
    const v = JSON.parse(readFileSync(path, 'utf8'))?.accelerator;
    return typeof v === 'string' && v.length > 0 ? v : DEFAULT_ACCELERATOR;
  } catch { return DEFAULT_ACCELERATOR; }
}

export function saveAccelerator(path: string, accelerator: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ accelerator }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
}
```

- [ ] **Step 4:** run shortcut test → PASS; `npm run typecheck` → clean; full suite green (159 = 153 + 6); build:app ok.

- [ ] **Step 5:** Commit `feat(shortcut): conflict-handling global-shortcut manager + accelerator persistence`.

---

### Task 3: Wire panel + shortcut + second-instance + first-run install into main

**Files:** Modify `src/main/index.ts`; modify `docs/superpowers/MANUAL-E2E-M3.md`.

**This is glue** (verified by build/typecheck/launch-smoke + the human checklist). Replace the M3a `showPanel()`/window code with the `createPanel` panel, wire the shortcut manager (load persisted accelerator → apply → on conflict, log + keep tray working), summon via the panel's `toggle`, register a `second-instance` handler that shows the panel, run the installer on first run, and surface the Codex trust message.

- [ ] **Step 1: Implement the wiring** — in `src/main/index.ts`:
  - Import: `createPanel` from `./panel`; `createShortcutManager, loadAccelerator, DEFAULT_ACCELERATOR` from `./shortcut`; `globalShortcut` from electron; `installHooks, defaultTargets, CODEX_TRUST_REVIEW_MESSAGE` from `../installer/install`; `existsSync` from node:fs; `join` already imported.
  - Build the panel once: `const panel = createPanel({ preloadPath: join(__dirname,'../preload/index.js'), loadDevUrl: (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) || undefined, loadFile: join(__dirname,'../renderer/index.html') });`
  - Tray `onToggle: () => panel.toggle()`.
  - `refresh()` now does `tray.setBadge(core.attentionCount()); panel.send('update', core.snapshot());` (panel.send already guards destroyed).
  - IPC `snapshot`/`markSeen`/`goto` unchanged (they call handlers). After `goto`/`markSeen` the renderer state updates via the next `update` push (touched()→refresh()).
  - Shortcut: `const shortcut = createShortcutManager({ register: (a, cb) => globalShortcut.register(a, cb), unregisterAll: () => globalShortcut.unregisterAll() }, () => panel.toggle()); const acc = loadAccelerator(join(paths.dataDir,'shortcut.json')); const res = shortcut.apply(acc); if (!res.ok) console.warn('Beacon:', shortcut.lastError()); // tray still works`
  - `second-instance`: `app.on('second-instance', () => panel.show());`
  - First-run install: after core is up, `const flag = join(paths.dataDir, '.installed'); if (!existsSync(flag)) { try { const { trustMessage } = installHooks(defaultTargets()); console.log('Beacon installed hooks.', trustMessage); writeFileSync(flag, new Date().toISOString()); } catch (e) { console.error('Beacon first-run install failed:', e); } }` (import `writeFileSync`). Note: `defaultTargets()` uses the DEV `resolveHookCommand()` here; a packaged build should pass the packaged invocation — leave a `// TODO(M3c): packaged invocation via resolveHookCommand({packaged,execPath,resourcesPath})` since the user may have already installed manually (idempotent merge makes re-install safe).
  - `will-quit`: also `globalShortcut.unregisterAll()` (or `shortcut.dispose()`), then the existing `core.close().catch().finally(...)`. Keep `panel.destroy()` + `tray.destroy()`.

- [ ] **Step 2: Verify the regression + build gate**
  - `npm run typecheck` → clean (both projects).
  - `npx vitest run` → 159 green (unchanged from Task 2; this task adds no tests — it's glue).
  - `npm run build:app` → ok.
  - `npx electron scripts/smoke-preload.mjs` → `SMOKE:0` (preload still loads).

- [ ] **Step 3: Fill in the M3b manual checks** in `docs/superpowers/MANUAL-E2E-M3.md` (the M3b section already exists — confirm/expand): ⌘⇧Space summons + takes focus; floats over a fullscreen app + on the current Space; Stage Manager + second display; hide on blur + Esc; frameless/translucent look; conflict path (temporarily bind ⌘⇧Space elsewhere → Beacon logs the conflict, tray still toggles); second-instance (launch twice → panel shows); first-run install on a clean profile.

- [ ] **Step 4: Commit** `feat(main): wire activating panel + ⌘⇧Space shortcut + second-instance + first-run install`.

---

## Post-Plan Notes (controller)
- Tasks 1 (panelPosition) and 2 (shortcut manager + persistence) are TDD-testable → normal implementer/review loop. Task 1's `createPanel` and Task 3 are Electron glue → review for correctness vs the research doc; the panel/Spaces/shortcut runtime behavior is the human MANUAL-E2E (I cannot observe it).
- After Task 3: deliver a fresh `npm run dev` build for the user to validate ⌘⇧Space + all-Spaces + hide-on-blur/Esc. Codex independent pass on the main wiring + globalShortcut lifecycle recommended before declaring M3b done.
- M3c (polished React/Tailwind/shadcn UI) follows; it also lands the deferred packaged-Go-to PATH fix (#5) + externalizeDepsPlugin cleanup, and the packaged first-run invocation TODO above.
- The M3a window code in `showPanel()` is fully replaced by `createPanel`; remove the old `win`/`showPanel` remnants.
