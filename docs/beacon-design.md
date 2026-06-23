# Beacon — Design Spec

**Date:** 2026-06-22
**Status:** Approved (design, rev 3 — incorporates two independent Codex review rounds) — pending implementation plan
**Platform:** macOS (Darwin)

---

## 1. Summary

Beacon is a macOS **menu-bar app + floating panel** that watches every **Claude Code** and **Codex CLI** session running across all your repos at once. It shows each session's live state, badges the menu bar when a session needs your input or has finished, lets you clear that indicator with a click, and jumps you to the right repo/terminal window.

It behaves like the ChatGPT macOS launcher: summoned with a global hotkey (**⌘⇧Space**, configurable), floating above everything, following you across all screens and Spaces, taking focus so you can navigate/dismiss it by keyboard, and hiding on blur/Esc.

---

## 2. Goals & Non-Goals

### Goals
- One glanceable view of all active/working/waiting/done AI coding sessions across every repo.
- Ambient signal (menu-bar badge) the moment a session needs you or finishes — without summoning the panel.
- Click an indicator to mark it seen (dot clears, badge decrements).
- "Go to" a session → focus the correct repo/editor window (and exact terminal tab where possible).
- Global floating panel that persists across all screens/Spaces, summoned by ⌘⇧Space.
- Works with **both** Claude Code and Codex from the first version.
- Zero per-repo setup — one global hook install covers all repos.

### Non-Goals (for now)
- Not a session *controller* — Beacon observes and navigates; it does not send prompts to sessions.
- No native notification banners or sounds in MVP (Phase 2 toggle if wanted).
- No remote/multi-machine sync — local only.
- No Windows/Linux — macOS only.
- Remote sessions (SSH / VS Code Remote / devcontainers) are detected and shown, but "Go to" is **degraded** for them (see §11).

---

## 3. Verified Technical Facts (researched + independently reviewed 2026-06-22)

### Claude Code (v2.1.185)
- Hooks configured **once globally** in `~/.claude/settings.json` apply to **all** repos. Precedence: Managed > Local > Project > User.
- Event → state mapping:
  - `SessionStart` → session started
  - `PreToolUse` / `UserPromptSubmit` → working
  - `Notification` (matchers `permission_prompt`, `idle_prompt`) → **needs you**
  - `Stop` → turn finished (idle / **done, your move**)
  - `SessionEnd` → closed
- Hook stdin payload includes: `session_id` (stable per `claude` invocation → **dedup key**), `cwd`, `transcript_path`, `hook_event_name`, `permission_mode`.
- Hook subprocess environment exposes `TERM_PROGRAM`, `TERM_SESSION_ID` (Terminal.app), `VSCODE_*` (in VS Code), `__CFBundleIdentifier` (host app bundle id), `CLAUDE_CODE_SESSION_ID`.
- Source: https://code.claude.com/docs/en/hooks.md , https://code.claude.com/docs/en/settings.md

### Codex CLI (v0.141.0)
- Has a Claude-style lifecycle hook system in `~/.codex/hooks.json` **and** inline `[hooks]` in `config.toml` (multiple sources loaded; hooks require a trust review via Codex `/hooks`). Events: `SessionStart`, `Stop`, `PermissionRequest` (= needs-you), `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `SubagentStart`, `SubagentStop`, `PreCompact`, `PostCompact`. Command-type hooks supported.
- The thin `notify` program (only `agent-turn-complete`) has an **unreliable `cwd`** (issue #4005, closed "not planned") — not relied upon.
- ⚠️ **Codex does not document a stable session id in hook payloads.** The hook subprocess's own working directory is the repo, but session identity must be reconciled best-effort (see §4.3).
- Authoritative-but-racy fallback for session UUID + `cwd`: `~/.codex/sessions/YYYY/MM/DD/rollout-<ISO>-<uuid>.jsonl` (append-only JSONL; first line `session_meta` has `payload.id` + `payload.cwd`). **Caveats:** the file may not exist/flush yet when `SessionStart` fires (race), and `codex --ephemeral` skips rollout persistence entirely.
- ⚠️ The user **already has** hooks in `~/.codex/hooks.json` and `~/.claude/settings.json` → installer must **merge, never overwrite**.
- Source: https://developers.openai.com/codex/config-reference , https://github.com/openai/codex , local `~/.codex/` inspection.

---

## 4. Architecture

Single Electron app (TypeScript). Six small, independently-testable units:

```
  Claude Code hooks ─┐
                     ├─► beacon-hook ──(Unix socket, 0600)──► Collector ─► Session Store + State Machine
  Codex hooks ───────┘   (env + stdin)                      (main proc)        │
                                                                                ├─► Tray (menu-bar badge)
                                                                                └─► Panel (renderer, IPC) ─► Focuser
```

### 4.1 `beacon-hook` (shipped script)
- One tiny compiled/standalone binary or minimal Node script. Hook configs only ever call `beacon-hook <event>`, keeping settings files clean and logic in code we own.
- Captures: `cwd` **and derived git root**; terminal identity from `TERM_PROGRAM`, `TERM_SESSION_ID`, `__CFBundleIdentifier`; `tty` derived from the **process tree** (`ps -o tty= -p <ancestor-shell-pid>`, not stdin); the host PID chain + process start time; and the event's stdin JSON.
- **Environment flags captured for degraded-mode detection:** `TMUX`, `STY`, `SSH_CONNECTION`/`SSH_TTY`, and VS Code Remote markers. Any of these → mark the session's "Go to" precision as **degraded** and `tty`/host as possibly `unknown`.
- **Fire-and-forget** write to the Collector's Unix socket with a very short timeout, and **always exits 0**. Designed not to *materially* slow the CLI (exact per-event overhead measured in the E2E checklist, §8). If Beacon isn't running, the write fails silently.
- **Performance:** keep the binary tiny, avoid shell startup, only register hooks for events we actually consume; per-event overhead measured in the E2E checklist.

### 4.2 Collector
- **Unix domain socket** in the app-support dir with `0600` perms (preferred over an open localhost port). Listens in the Electron **main** process.
- Rationale: a fixed unauthenticated localhost port lets *any* local process forge events or race-bind the port. A `0600` socket scopes access to the current user. (If a socket proves impractical, fallback = random localhost port + per-install HMAC token read from a `0600` file; reject unauthenticated events.)
- **Threat model (explicit):** the socket protects against *other users* and port-race/binding by other processes. It does **not** defend against a malicious process running **as the same user** — that is **out of scope** for this personal, single-user dev tool. The Collector treats inbound events as integrity-limited local telemetry, validates shape, and never trusts payloads for anything dangerous (no shell interpolation; all external-command args passed discretely and escaped).
- **Never shell-interpolates repo paths or any payload field.** All downstream use (AppleScript, CLI args) is passed as discrete, escaped arguments.
- Validates/normalizes each payload, then hands events to the Store.

### 4.3 Session Store + State Machine
- In-memory map, **persisted to disk as atomic JSON** (debounced write, **single main-process writer**), surviving restarts. (SQLite deferred to Phase 2 only if history/search needs it.)
- **Identity / dedup:**
  - **Claude:** key on `session_id` (stable, documented).
  - **Codex:** assign a **temporary event id** immediately, keyed on the **resolved long-lived Codex *ancestor* process** (walk the pid chain to the `codex` process, not the short-lived hook subprocess) → `(codex-ancestor-pid + that ancestor's start-time + git-root + tty/host)`. Unknown fields are allowed but **never used alone** to merge sessions, so two same-repo Codex sessions don't collapse into one and a single session doesn't fragment. **Reconcile asynchronously** to the rollout `payload.id` when a matching `rollout-*.jsonl` appears (match on cwd/git-root + start-time + mtime). Tolerate an **"unknown Codex session id"** — never merge two unrelated sessions on weak signals. `--ephemeral` sessions are supported in degraded mode (no rollout reconcile).
- Per-session record: `{ id, tempId, tool, repoPath, gitRoot, repoName, host: terminal|vscode|cursor|unknown, termSessionId, tty, remote: none|tmux|ssh|vscode-remote, gotoPrecision: precise|degraded, state, attention: none|needs-you|done, seen, lastEventAt, startedAt }`.
- State machine:
  - `started` → SessionStart
  - `working` → PreToolUse / UserPromptSubmit
  - `waiting (needs-you)` → Notification(permission_prompt|idle_prompt) / Codex PermissionRequest → `attention=needs-you`, `seen=false`
  - `done (turn-ended)` → Stop → `attention=done`, `seen=false`
  - `closed` → SessionEnd (kept briefly in "recently closed", then evicted)
- Staleness: TTL eviction + manual "clear all" + Codex rollout reconcile.

### 4.4 Tray (menu-bar)
- Electron `Tray`. Icon shows a colored badge/dot + count whenever any session has `attention != none && !seen`. Click toggles the Panel. Tray keeps working even if the global shortcut fails to register.

### 4.5 Panel (renderer) — **activating, ChatGPT-style**
- Frameless, rounded, translucent `BrowserWindow`. React + Tailwind + shadcn/ui + lucide icons.
- **Window config:** `{ show:false, frame:false, transparent:true, fullscreenable:false, skipTaskbar:true, focusable:true }`, plus `app.dock.hide()` + `LSUIElement`.
- **All-Spaces / fullscreen / always-on-top (correct API):**
  - `win.setAlwaysOnTop(true, "screen-saver")`
  - `win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })`
- **Focus model — REVISED (persistent HUD, per user decision 2026-06-23):** summon with `show()` (takes focus). The panel then **stays visible** across every Space/display and over other apps; it does **NOT** hide on blur. It is **movable** (the header is a `-webkit-app-region: drag` handle) and **resizable** (`resizable:true`, `minWidth/Height`). Dismiss only via the global shortcut, **Esc**, or the in-panel **close (X)** button. (The original "ChatGPT-style hide-on-blur" launcher model was dropped: it made the panel flash-and-vanish on a Space switch and disappear on any click elsewhere — the opposite of the always-on-screen behavior the user wants.)
- ⚠️ Fullscreen + Stage Manager behavior must be confirmed in the E2E checklist — known area of macOS quirks.
- Global shortcut **⌘⇧Space** toggles show/hide (configurable). See §4.7 for conflict handling.
- Layout: sessions grouped — **Needs you** / **Working** / **Done** / **Recently closed**. Each row: status dot (🔴 needs-you / 🟢 working / ✅ done), repo name, tool icon (Claude/Codex), host icon (Terminal/VS Code/Cursor), a "degraded" marker when applicable, relative time, and a **Go to** button.
- Live updates pushed from main via IPC (contextBridge, no nodeIntegration).

### 4.6 Focuser ("Go to")
Per-host strategy, dispatched by detected `host`; **respects `gotoPrecision`**:
- **Terminal.app (local, plain tab)** → AppleScript matching the tab whose `tty` equals the captured tty, then activate. **Precise only for plain local Terminal tabs** — not under tmux/SSH/detached hooks.
  - Requires the **macOS Automation permission** (Apple Events). Ship `NSAppleEventsUsageDescription`; do a first-run permission check; on denial, fall back gracefully and tell the user how to grant it.
- **VS Code** → `code --reuse-window <repoPath>` (when the CLI is installed), then activate the app by bundle id (`com.microsoft.VSCode`). Falls back if CLI missing.
- **Cursor** → `cursor --reuse-window <repoPath>` + activate by Cursor's bundle id (detected via `__CFBundleIdentifier`).
- VS Code/Cursor can't target the integrated-terminal *tab inside* a window — Beacon brings the right **window** forward; the terminal is normally already visible.
- **Degraded / fallback** (remote session, tty unknown, window gone, CLI missing): if the path exists **locally**, reveal the git root in Finder; otherwise (remote/non-local path) **copy the repo path** to the clipboard. Either way, show a clear toast explaining the limitation.
- "Go to" also marks the session seen.

### 4.7 Global Shortcut Manager
- On launch and on every change: call `globalShortcut.register(...)` and check its **boolean return** + `globalShortcut.isRegistered(...)`. Registration fails **silently** when the combo is taken — so we verify explicitly.
- On failure: show an in-app warning, **keep the Tray fully working**, prompt the user to pick another accelerator, and persist the last good shortcut.
- `globalShortcut.unregisterAll()` on quit.

---

## 5. Data Flow

1. A hook fires (Claude or Codex).
2. `beacon-hook` gathers env + git-root + tty + stdin JSON → writes to the Collector's `0600` Unix socket.
3. Collector validates/normalizes → Store updates → State Machine transitions (Codex: temp id now, reconcile later).
4. Tray badge updates; live state pushed to Panel via IPC.
5. User clicks a row/dot → marked seen (dot clears, badge decrements), or **Go to** → Focuser brings the right window forward (or degraded fallback).

---

## 6. Installer & Safety

- First run **merges** Beacon hook entries into the user's existing config, with **schema-specific mergers** (Claude `settings.json` strict-validated; Codex `hooks.json` and inline `config.toml [hooks]`):
  - Strict parse + validate BEFORE writing; abort with a clear message rather than corrupt a file.
  - **Atomic write** (temp file + rename) under a **file lock**; **back up** each file first.
  - Idempotent via a marker baked into the **command/args vector itself** — e.g. `beacon-hook --beacon-marker <id> <event>` (or an exact, recognizable command path) — **not** an extra JSON field that strict schema validation might reject. Detect existing Beacon entries by matching that command/args; never double-add; preserve all existing hooks.
  - Offer a **dry-run diff** of what will change.
- Clean **uninstall** removes only entries whose command/args bear the Beacon marker.
- After installing Codex hooks, surface that the user must approve them via Codex's `/hooks` **trust review**.
- **Single-instance lock** so only one Beacon (and one Collector socket) runs.

---

## 7. Error Handling & Security

- Collector down → hooks fail silently (short timeout, exit 0). The CLI is never blocked.
- Collector access scoped by `0600` socket; payload fields never shell-interpolated; all external-command args passed discretely and escaped.
- Hook-file merge → backup + strict-validate + atomic + lock + marker-based uninstall.
- Focus failure / remote / permission-denied → graceful degraded fallback + explanatory toast.
- Stale sessions → `SessionEnd` + TTL eviction + manual "clear all" + Codex rollout reconcile.
- Codex identity → temp id + async reconcile; tolerate "unknown"; `--ephemeral` degraded.
- Renderer hardened: `contextIsolation: true`, `nodeIntegration: false`, preload via contextBridge.

---

## 8. Testing Strategy

TDD on logic-heavy units:
- **State machine** — event-sequence → expected state/attention/seen, including Codex temp-id → reconcile transitions.
- **Hook-payload parser** — Claude and Codex payloads → normalized event; degraded-mode flag derivation (tmux/SSH/remote).
- **Identity/reconcile** — temp-id assignment + rollout-match logic; "unknown" handling; no false merges.
- **Focuser command-builders** — given a session record, assert the correct AppleScript / CLI invocation per host **and the degraded fallback**, without executing.
- **Installer merge** — fixtures of existing hook files → idempotent merge, dry-run diff, atomic write, marker-based uninstall (never touches real dotfiles in tests).
- **Shortcut manager** — simulate register success/failure → correct UX state.

Integration:
- Mock event-sender over the socket posts realistic sequences → assert Store + Tray badge state.

Manual E2E checklist (the macOS-quirk surface):
- Real `claude` and `codex` sessions in Terminal.app, VS Code, and Cursor → verify state transitions, badge, panel, mark-seen, Go-to per host.
- **Panel over a fullscreen app and under Stage Manager**; multi-display; multiple Spaces.
- Automation-permission first-run + denial path.
- Per-hook latency overhead measurement.

---

## 9. Scope & Build Order

**MVP (Phase 1):**
- Both **Claude Code and Codex** watching (collector is tool-agnostic). Codex ships with **degraded identity accepted** (temp id + best-effort rollout reconcile; `--ephemeral` degraded).
- Hosts: Terminal.app (precise for plain local tabs) + VS Code + Cursor (window-level). Remote/tmux/SSH → detected + degraded Go-to.
- Menu-bar badge + activating floating panel + Go-to + mark-seen.
- ⌘⇧Space global hotkey (configurable) with conflict-handling UX.
- Safe merging hook installer (atomic + lock + backup + dry-run + uninstall) + Codex trust-review prompt.
- `0600` Unix-socket collector.

**Phase 2 (only if wanted):**
- Search / filter; per-repo grouping options.
- Double-tap-modifier hotkey option (needs a small native key-listener helper).
- Optional native notification banners + sound.
- Richer "recently closed" history (may motivate SQLite).
- Tighter Codex identity if upstream adds a stable hook session id.

---

## 10. Tech Stack

- **Runtime:** Electron + TypeScript.
- **UI:** React + Tailwind CSS + shadcn/ui + lucide icons.
- **IPC:** Electron contextBridge / ipcMain (contextIsolation on, nodeIntegration off).
- **Persistence:** atomic JSON, debounced, single main-process writer (SQLite only if Phase 2 needs it).
- **Hook transport:** Unix domain socket, `0600` (fallback: localhost + HMAC token).
- **OS integration:** Electron `Tray`, `globalShortcut`, `BrowserWindow` (all-Spaces panel via `setVisibleOnAllWorkspaces(true, {...})` + `setAlwaysOnTop(true,"screen-saver")`), AppleScript (`osascript`) + `code`/`cursor` CLIs for focusing.

---

## 11. Known Limitations / Degraded Modes (explicit)

- **VS Code/Cursor:** focus is window-level, not the specific integrated-terminal tab.
- **Terminal.app precision:** only for plain local tabs; tmux/SSH/detached → degraded.
- **Remote sessions** (SSH, VS Code Remote, devcontainers): hooks run on the remote; paths/tty aren't local → session is shown but "Go to" falls back to copy-path.
- **Codex identity:** no documented stable hook session id → temp id + best-effort reconcile; `--ephemeral` has no rollout to reconcile against.
- **Fullscreen / Stage Manager** panel behavior: validated by E2E, not assumed.
- **Automation permission:** Terminal focus requires the user to grant macOS Automation access on first use.
