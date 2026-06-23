<div align="center">

# 🔦 Beacon

### Mission control for your AI coding agents.

See every **Claude Code** and **Codex CLI** session across all your repos — and jump straight to the one that needs you.

![Beacon demo: many agents running, Beacon showing which one needs attention, then jumping to it](docs/media/demo.gif)

</div>

---

## The problem

If you run more than a couple of AI coding agents at once, you know the tax: a `claude` here, three
`codex` sessions there, scattered across terminal tabs, VS Code, and Cursor windows. One is waiting on
a permission prompt. Another finished two minutes ago. **Which one?** You end up cycling through windows
hunting for the agent that needs you.

**Beacon watches them all at once.** It lives in your menu bar, badges the moment any session needs input
or finishes, and — with one keystroke — shows you everything in a floating panel. Click **Go to** and it
snaps you to the exact terminal tab or editor window.

## Features

- **All your agents, one glance** — live state for every Claude Code and Codex session across every repo:
  `needs-you` / `working` / `done` / `recently closed`.
- **Ambient menu-bar badge** — the icon lights up with a count the instant a session needs you or finishes.
  No need to summon anything.
- **⌘⇧Space floating panel** — a persistent, movable HUD that floats above everything, across all Spaces and
  displays. Summon and dismiss it instantly (shortcut configurable).
- **"Go to" that actually lands** — focuses the right window, and on supported setups the **exact
  integrated-terminal tab** (via the optional [editor companion extension](#exact-terminal-focus-vs-code--cursor)).
- **Click to clear** — mark a session seen; the dot clears and the badge decrements.
- **Zero per-repo setup** — one global hook install covers every repo, for both tools, from day one.

## Requirements

- **macOS** (Apple Silicon or Intel). Beacon is macOS-only.
- **[Claude Code](https://code.claude.com)** and/or **[Codex CLI](https://developers.openai.com/codex)** —
  Beacon watches whichever you have.

## Install

> First public release is in progress. Until the signed build is published, see
> [Build from source](#build-from-source).

**Homebrew (recommended once released):**
```bash
brew install --cask marcussy34/beacon/beacon
```

**Direct download:** grab the latest `Beacon-<version>-<arch>.dmg` from
[Releases](https://github.com/Marcussy34/beacon/releases), open it, and drag Beacon to Applications.

## First-run setup

Beacon is a menu-bar app — **no Dock icon**. Look for its icon in the menu bar. On first launch it:

1. **Installs its hooks** into `~/.claude/settings.json` and `~/.codex` — *merged into* your existing
   config, never overwritten (atomic write, with a backup). This is how Beacon learns about session events.
2. **Asks for macOS Automation permission** so "Go to" can focus your terminal/editor via AppleScript.
   If you deny it, Beacon still works — "Go to" just falls back to revealing the repo in Finder.
3. **Codex only:** approve Beacon's hooks via Codex's `/hooks` trust review (Codex requires this for any hook).

Then start a `claude` or `codex` session anywhere and watch it appear. Hit **⌘⇧Space** to open the panel.

### Exact-terminal focus (VS Code / Cursor)

VS Code and Cursor can't normally target a specific integrated-terminal *tab* from the outside — Beacon can
only bring the right **window** forward. The optional **Beacon Focus Helper** extension fixes that: it reveals
the exact terminal tab your agent is running in. See [docs/superpowers/EXTENSION-INSTALL.md](docs/superpowers/EXTENSION-INSTALL.md).

## What Beacon touches (and what it doesn't)

Beacon runs on your machine and watches your dev environment, so here's exactly what it does — no surprises:

- **Reads** lifecycle events from Claude Code / Codex hooks: repo path, git root, terminal/editor identity,
  and the session's state. Nothing leaves your machine.
- **Writes** only to its own hook entries in `~/.claude/settings.json` and `~/.codex` (merged, backed up,
  marker-tagged, cleanly uninstallable) and its own app-support data.
- **Local-only.** No network calls, no telemetry, no remote sync. The collector listens on a `0600` Unix
  socket scoped to your user — not an open network port.
- **Observes, never controls.** Beacon does not send prompts to your agents or run commands on your behalf
  beyond focusing a window when you click "Go to".
- **Does not read your code or transcripts.** It keys off event metadata (paths, state), not file contents.

## How it works

```
  Claude Code hooks ─┐
                     ├─► beacon-hook ──(0600 Unix socket)──► Collector ─► Session Store + State Machine
  Codex hooks ───────┘   (env + stdin)                      (main proc)        │
                                                                                ├─► Tray (menu-bar badge)
                                                                                └─► Panel (renderer/IPC) ─► Focuser
```

1. A hook fires when an agent starts, works, needs input, or finishes.
2. `beacon-hook` captures the repo, git root, tty, and host (Terminal/VS Code/Cursor), then fire-and-forgets
   to Beacon's socket — it never slows your CLI down and exits cleanly even if Beacon isn't running.
3. The collector validates the event; the store + state machine update each session's status.
4. The menu-bar badge updates and the panel refreshes live over IPC.
5. **Go to** dispatches a per-host focus strategy (AppleScript for Terminal, `open -b` + the companion
   extension for editors), with graceful fallbacks when a session is remote or a window is gone.

For the full design, see [docs/superpowers/specs/2026-06-22-beacon-design.md](docs/superpowers/specs/2026-06-22-beacon-design.md).

## Known limitations

- **VS Code / Cursor:** window-level focus by default; exact-tab focus needs the companion extension.
- **Terminal.app:** exact-tab focus works for plain local tabs — not under tmux/SSH/detached sessions.
- **Remote sessions** (SSH, VS Code Remote, devcontainers): shown, but "Go to" degrades to copying the repo path.
- **Codex identity:** Codex has no documented stable session id, so sessions are tracked best-effort and
  reconciled from rollout files; `codex --ephemeral` runs in degraded mode.

## Build from source

```bash
git clone https://github.com/Marcussy34/beacon.git
cd beacon
npm install

npm run dev          # run Beacon in development
npm run test         # unit tests (vitest)
npm run typecheck    # TypeScript checks

npm run pack:mac     # unsigned local .app for smoke-testing (no Apple account needed)
```

**Tech stack:** Electron + electron-vite + TypeScript, React 19 + Tailwind v4 + shadcn/ui + lucide.

## Releasing

Maintainers: see [docs/RELEASING.md](docs/RELEASING.md) for the signed + notarized release pipeline
(GitHub Actions on a version tag) and the Homebrew cask update steps.

## License

[MIT](LICENSE) © Marcus

## Contributing

Issues and PRs welcome. Beacon is built in small, independently-testable units with TDD — please keep
new logic covered by tests (`npm run test`).
