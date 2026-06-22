# Beacon — Design Spec

**Date:** 2026-06-22
**Status:** Approved (design) — pending implementation plan
**Platform:** macOS (Darwin)

---

## 1. Summary

Beacon is a macOS **menu-bar app + floating panel** that watches every **Claude Code** and **Codex CLI** session running across all your repos at once. It shows each session's live state, badges the menu bar when a session needs your input or has finished, lets you clear that indicator with a click, and jumps you to the right repo/terminal window.

It behaves like the ChatGPT macOS launcher: summoned with a global hotkey (**⌘⇧Space**, configurable), floating above everything, following you across all screens and Spaces, and dismissed on blur/Esc.

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

---

## 3. Verified Technical Facts (researched 2026-06-22)

### Claude Code (v2.1.185)
- Hooks configured **once globally** in `~/.claude/settings.json` apply to **all** repos. Precedence: Managed > Local > Project > User.
- Event → state mapping:
  - `SessionStart` → session started
  - `PreToolUse` / `UserPromptSubmit` → working
  - `Notification` (matchers `permission_prompt`, `idle_prompt`) → **needs you**
  - `Stop` → turn finished (idle / **done, your move**)
  - `SessionEnd` → closed
- Hook stdin payload includes: `session_id` (stable per `claude` invocation → **dedup key**), `cwd` (the repo), `transcript_path`, `hook_event_name`, `permission_mode`.
- Hook subprocess environment exposes `TERM_PROGRAM`, `TERM_SESSION_ID` (Terminal.app), `VSCODE_*` (in VS Code), `__CFBundleIdentifier` (host app bundle id), and `CLAUDE_CODE_SESSION_ID`.
- Source: https://code.claude.com/docs/en/hooks.md , https://code.claude.com/docs/en/settings.md

### Codex CLI (v0.141.0)
- Has a Claude-style lifecycle hook system in `~/.codex/hooks.json` (and inline `[hooks]` in `config.toml`). Events: `SessionStart`, `Stop`, `PermissionRequest` (= needs-you), `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `SubagentStart`, `SubagentStop`, `PreCompact`, `PostCompact`. Command-type hooks supported.
- The thin `notify` program (only `agent-turn-complete`) has an **unreliable `cwd`** (see issue #4005, closed "not planned") — so we do **not** rely on it.
- The hook subprocess's **own working directory is the repo** → capture `cwd` via the hook script itself.
- Authoritative fallback for stable session UUID + `cwd`: `~/.codex/sessions/YYYY/MM/DD/rollout-<ISO>-<uuid>.jsonl` (append-only JSONL; first line `session_meta` has `payload.id` + `payload.cwd`; `event_msg` lines carry `task_started`/`task_complete`).
- ⚠️ The user **already has** hooks in `~/.codex/hooks.json` and `~/.claude/settings.json` → installer must **merge, never overwrite**.
- Source: https://developers.openai.com/codex/config-reference , https://github.com/openai/codex (config docs), local `~/.codex/` inspection.

---

## 4. Architecture

Single Electron app (TypeScript). Six small, independently-testable units:

```
  Claude Code hooks ─┐
                     ├─► beacon-hook ──HTTP POST──► Collector ─► Session Store + State Machine
  Codex hooks ───────┘   (env + stdin)             (localhost)        │
                                                                       ├─► Tray (menu-bar badge)
                                                                       └─► Panel (renderer, IPC) ─► Focuser
```

### 4.1 `beacon-hook` (shipped script)
- One small script (Node or bash). Hook configs only ever call `beacon-hook <event>`, keeping settings files clean and logic in code we own.
- Captures: `cwd` (= the repo, since the hook runs inside it), `TERM_PROGRAM`, `TERM_SESSION_ID`, `__CFBundleIdentifier`, `tty` (via ancestor shell), the host PID chain, and the event's stdin JSON.
- **Fire-and-forget POST** to the Collector with a short timeout, and **always exits 0** — it can never slow down or break the user's Claude/Codex CLI. If Beacon isn't running, the POST fails silently.

### 4.2 Collector
- Localhost-only HTTP listener (`127.0.0.1`, fixed port) in the Electron **main** process.
- Receives `beacon-hook` POSTs, validates/parses the payload, hands normalized events to the Store.
- Bound to loopback only; ignores non-local connections.

### 4.3 Session Store + State Machine
- In-memory map keyed by `session_id` (Claude) or session UUID / composite `host+tty+cwd` key (Codex), **persisted to disk** (small JSON or SQLite) so state survives an app restart.
- Per-session record: `{ id, tool: claude|codex, repoPath, repoName, host: terminal|vscode|cursor, termSessionId, tty, state, attention: none|needs-you|done, seen, lastEventAt, startedAt }`.
- State machine transitions:
  - `started` → on SessionStart
  - `working` → on PreToolUse / UserPromptSubmit
  - `waiting (needs-you)` → on Notification(permission_prompt|idle_prompt) / Codex PermissionRequest → `attention=needs-you`, `seen=false`
  - `done (turn-ended)` → on Stop → `attention=done`, `seen=false`
  - `closed` → on SessionEnd (kept briefly in a "recently closed" group, then evicted)
- Staleness: TTL eviction + manual "clear all" + Codex rollout-file reconcile for `cwd`/liveness.

### 4.4 Tray (menu-bar)
- `NSStatusItem`-equivalent via Electron `Tray`. Icon shows a colored badge/dot + count whenever any session has `attention != none && !seen`.
- Click toggles the Panel.

### 4.5 Panel (renderer)
- Frameless, rounded, translucent `BrowserWindow`. React + Tailwind + shadcn/ui + lucide icons.
- Window behavior: `alwaysOnTop` (`floating`/`screen-saver` level), `setVisibleOnAllWorkspaces({ visibleOnAllWorkspaces: true, visibleOnFullScreen: true })`, `app.dock.hide()` + `LSUIElement` (no Dock icon).
- Global shortcut **⌘⇧Space** toggles show/hide (configurable, conflict-detected on register). Blur and Esc hide it.
- Layout: sessions grouped by state — **Needs you** / **Working** / **Done** / **Recently closed**. Each row: status dot (🔴 needs-you / 🟢 working / ✅ done), repo name, tool icon (Claude/Codex), host icon (Terminal/VS Code/Cursor), relative time, and a **Go to** button.
- Live updates pushed from main via IPC.

### 4.6 Focuser ("Go to")
Per-host strategy, dispatched by detected `host`:
- **Terminal.app** → AppleScript targets the exact window/tab by matching `tty`. Precise.
- **VS Code** → `code <repoPath>` focuses the correct editor window.
- **Cursor** → `cursor <repoPath>` (Cursor detected via `__CFBundleIdentifier`).
- VS Code/Cursor limitation: the exact integrated-terminal *tab inside* a window cannot be reliably focused externally — Beacon brings the right **window** to the front; the terminal is normally already visible.
- Fallback (window gone / CLI missing): reveal the folder in Finder / copy repo path + show a toast.
- "Go to" also marks the session seen.

---

## 5. Data Flow

1. A hook fires (Claude or Codex).
2. `beacon-hook` gathers env + stdin JSON → POST to Collector.
3. Collector normalizes → Store updates → State Machine transitions.
4. Tray badge updates; live state pushed to Panel via IPC.
5. User clicks a row/dot → marked seen (dot clears, badge decrements), or **Go to** → Focuser brings the right window forward.

---

## 6. Installer & Safety

- First run **merges** Beacon hook entries into `~/.claude/settings.json` and `~/.codex/hooks.json`:
  - Back up each file first.
  - Idempotent: never double-add; detect existing Beacon entries.
  - Preserve the user's existing hooks (append alongside, both formats use arrays).
- Clean **uninstall** that removes only Beacon's entries.
- **Single-instance lock** so only one Beacon (and one Collector) runs.

---

## 7. Error Handling

- Collector down → hooks fail silently (short timeout, `|| true`, exit 0). The CLI is never blocked.
- Hook-file merge → back up + idempotent + uninstall; abort with a clear message on parse failure rather than corrupting the file.
- Focus failure → graceful fallback (open folder / copy path) + toast.
- Stale sessions → `SessionEnd` + TTL eviction + manual "clear all" + Codex rollout reconcile.
- Codex `cwd` → from the hook's own working dir; rollout-file as backup source of truth.

---

## 8. Testing Strategy

TDD on logic-heavy units:
- **State machine** — event-sequence → expected state/attention/seen.
- **Hook-payload parser** — Claude and Codex payloads → normalized event.
- **Focuser command-builders** — given a session record, assert the correct AppleScript / CLI invocation per host **without executing** it.
- **Installer merge** — given existing hook files, assert correct idempotent merge + clean uninstall (using fixtures, never the real dotfiles).

Integration:
- Mock event-sender posts realistic event sequences → assert Store + Tray badge state.

Manual E2E checklist:
- Real `claude` and `codex` sessions in Terminal.app, VS Code, and Cursor → verify state transitions, badge, panel, mark-seen, and Go-to for each host.

---

## 9. Scope & Build Order

**MVP (Phase 1):**
- Both **Claude Code and Codex** watching (collector is tool-agnostic; Codex adds its hook installer + rollout-file `cwd` reconcile).
- Hosts: Terminal.app (precise focus) + VS Code + Cursor (window-level focus).
- Menu-bar badge + floating panel + Go-to + mark-seen.
- ⌘⇧Space global hotkey (configurable).
- Safe merging hook installer + uninstall.

**Phase 2 (only if wanted):**
- Search / filter sessions; per-repo grouping options.
- Double-tap-modifier hotkey option (needs a small native key-listener helper).
- Optional native notification banners + sound.
- Richer "recently closed" history.

---

## 10. Tech Stack

- **Runtime:** Electron + TypeScript.
- **UI:** React + Tailwind CSS + shadcn/ui + lucide icons.
- **IPC:** Electron contextBridge / ipcMain.
- **Persistence:** local JSON or SQLite (decide in plan).
- **Hook transport:** localhost HTTP (loopback only).
- **OS integration:** Electron `Tray`, `globalShortcut`, `BrowserWindow` (all-Spaces panel), AppleScript (`osascript`) + `code`/`cursor` CLIs for focusing.
