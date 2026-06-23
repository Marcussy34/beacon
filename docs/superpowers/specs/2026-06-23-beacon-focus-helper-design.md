# Beacon Focus Helper — Companion Editor Extension Design Spec

**Date:** 2026-06-23
**Status:** Approved-in-design (pending spec review)
**Builds on:** Beacon M3c (HEAD 7930aa6). Beacon is a macOS menu-bar watcher for Claude Code + Codex CLI sessions.

## 1. Problem

"Go to" must land the user on the **exact** terminal where a session runs. Today, for a session in a Cursor/VS Code **integrated terminal**, Go-to runs `open -b <bundleId> <gitRoot>` which focuses the correct *window* but not the specific terminal *tab*. The user runs many integrated-terminal sessions across repos and needs to land on the precise one that needs attention.

**Verified constraint (firecrawl / VS Code docs, 2026-06-23):** No external process can focus a specific integrated-terminal tab. The `code` CLI only opens files/folders; command-URIs only work inside the editor. The terminal API (`vscode.window.terminals`, `Terminal.show()`) is reachable **only from within an editor extension**. Therefore a companion extension is the only reliable mechanism — confirmed and chosen by the user.

## 2. Goal & Non-Goals

**Goal:** A small "Beacon Focus Helper" extension for Cursor and VS Code that, when asked by Beacon, focuses the integrated terminal whose shell tty matches a target session — making Go-to land on the exact tab.

**Non-Goals (v1):**
- Auto-installing the extension (v1 = manual one-time install per editor).
- Marketplace / Open VSX publishing (local `.vsix` only).
- Non-macOS support (Beacon is macOS-only).
- Focusing terminals in editors other than Cursor/VS Code, or in standalone terminals (Terminal.app already focuses by tty; out of scope here).
- Disambiguating the same repo folder open in two separate windows (documented limitation).

## 3. Architecture & Data Flow

```
User clicks "Go to" (session host=cursor|vscode, tty=/dev/ttysNNN, gitRoot)
        │
        ▼
Beacon focuser (src/focuser)
  step 1:  open -b <bundleId> <gitRoot>          # bring the repo's WINDOW to front (existing)
  step 2:  open "<scheme>://beacon.beacon-focus/focus?tty=%2Fdev%2FttysNNN"
        │      scheme = cursor:// (host=cursor) | vscode:// (host=vscode)
        ▼
Editor routes the URL to the active window's extension host
        ▼
Beacon Focus Helper extension — registerUriHandler:
  parse tty from query → for each vscode.window.terminals:
     pid = await terminal.processId → tty = ps -o tty= -p <pid> (normalized to /dev/ttysNNN)
     if tty === target → terminal.show()  (focus the tab); stop
  (no match in this window → no-op)
```

**Why this shape:**
- **URL handler, not a background server** — no long-running process, uses the editor's built-in URL routing. Step 1 (`open -b`) activates the correct window first, so the URL reaches that window's handler.
- **Match by tty** — Beacon already stores each session's tty (`src/hook/build-event.ts` captures it; persisted in state.json). No hook/store/persistence changes needed. The extension resolves each terminal's shell PID → controlling tty and compares.
- **Best-effort + graceful fallback** — if the extension is absent or the tab isn't found, Step 1 already focused the right window, so behavior degrades to today's. Nothing breaks.

## 4. Components

### 4.1 Extension: `extension/` (new sub-package)
A self-contained VS Code extension (works in Cursor, a VS Code fork). Own `package.json` (CommonJS, `engines.vscode`, `activationEvents: ["onUri"]`, `contributes` none needed), own `tsconfig`. ~100 lines.

- **`activate(context)`**: registers `vscode.window.registerUriHandler({ handleUri })`.
- **`handleUri(uri: vscode.Uri)`**: if `uri.path === '/focus'`, read `tty` from `uri.query`; call `focusTerminalByTty(tty)`.
- **`focusTerminalByTty(tty, terminals, resolvePidTty)`** (pure-ish, injectable deps for testing): iterate terminals, resolve each `await t.processId` → `resolvePidTty(pid)`, compare normalized tty, on match `t.show()` and return true; else false.
- **Pure helpers (unit-tested):**
  - `parseFocusTty(uri): string | null` — extract + decode the `tty` query param; return null if path ≠ `/focus` or no tty.
  - `normalizeTty(raw): string` — map `ps` output (`ttys154`, `s154`, or `/dev/ttys154`) to a canonical `/dev/ttys154`.
- **PID→tty resolution:** `ps -o tty= -p <pid>` via `child_process.execFile` (macOS); wrapped so a failure yields no match (never throws).

### 4.2 Beacon focuser change: `src/focuser`
- `FocusCommand` editor variant gains `tty?: string` (already has `cli`, `gitRoot`, `bundleId`).
- `buildFocusCommand(session)` (editor branch): include `session.tty` on the editor command.
- `toExecSteps` (editor branch): emit
  1. `{ program: 'open', args: ['-b', bundleId, gitRoot] }` (existing), then
  2. when `tty` is present: `{ program: 'open', args: ['<scheme>://beacon.beacon-focus/focus?tty=<encodeURIComponent(tty)>'] }`, where `scheme` is `cursor` if `cli==='cursor'` else `vscode`.
- The URL step is best-effort: `open <scheme>://…` returns success because the editor is registered for its scheme, so it never triggers the reveal/copy fallback. The reveal/copy fallback still triggers only when Step 1 (`open -b`) fails (editor not installed).

### 4.3 Distribution & install (v1 = manual)
- Build a prebuilt `extension/beacon-focus-<version>.vsix` via `@vscode/vsce` (a `build:extension` script).
- Document the one-time install command per editor in the README / a short doc:
  - Cursor: `cursor --install-extension <path>/beacon-focus-<v>.vsix`
  - VS Code: `code --install-extension <path>/beacon-focus-<v>.vsix` (or the editor UI: Extensions → "Install from VSIX…", the universal fallback when the `code` CLI isn't on PATH).
- Reload/restart the editor once after install.

## 5. URL Contract
- **Scheme:** `cursor://` (Cursor) or `vscode://` (VS Code), chosen by Beacon from the session host.
- **Authority:** `beacon.beacon-focus` (the extension id `publisher.name`).
- **Path:** `/focus`.
- **Query:** `tty=<URL-encoded absolute tty path>` (e.g. `tty=%2Fdev%2Fttys154`).
- Example: `cursor://beacon.beacon-focus/focus?tty=%2Fdev%2Fttys154`.

## 6. Error Handling
- Extension: `handleUri` never throws; unknown path or missing tty → no-op. PID/tty resolution failure for any terminal → that terminal is skipped. No match → no-op (the window is already focused).
- Beacon: emitting the URL is best-effort; if `open` errors it's swallowed by the existing focuser try/catch (Step 1 already succeeded). Editor not installed → Step 1 fails → existing reveal/copy fallback.

## 7. Testing
- **Unit (vitest, pure):** `parseFocusTty` (valid/invalid path, encoded tty, missing param); `normalizeTty` (`ttys154` / `s154` / `/dev/ttys154` → `/dev/ttys154`); `focusTerminalByTty` with injected fake terminals + a fake pid→tty resolver (matches the right one, calls `show()`; no match → returns false; resolver-throw → skipped).
- **Unit (Beacon focuser):** `buildFocusCommand` includes tty on editor commands; `toExecSteps` editor emits `open -b …` then the correct `cursor://`/`vscode://` focus URL with the encoded tty; no URL step when tty absent.
- **Manual E2E:** install the .vsix in Cursor + VS Code; with two terminals in one window and sessions across repos, Go-to lands on the exact tab; fallback still works when the extension is absent.

## 8. Limitations (v1, documented)
- Same repo folder open in two windows → the URL may reach the wrong window (rare).
- macOS-only PID→tty resolution (acceptable — Beacon is macOS-only).
- If the extension isn't installed, `open <scheme>://…` may surface a brief "no handler" notice in the editor; benign, and avoided once the extension is installed.

## 9. Out of scope / future
- Auto-install via the editors' bundled CLIs (fast-follow).
- Bundling the .vsix into the packaged `.app` + a Beacon "Install editor extension" action.
- Reporting terminals back to Beacon for a server-based (multi-window-perfect) trigger, if URL routing proves insufficient in practice.
