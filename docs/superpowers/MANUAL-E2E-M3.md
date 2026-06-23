# Beacon — Manual E2E Checklist (M3)

These are the runtime behaviors that cannot be unit-tested (they need a real macOS display, real Spaces, and real `claude`/`codex` sessions). Run through this on the machine. M3a items are checkable now; M3b/M3c items are marked.

## Setup
- [ ] `cd ~/Projects/beacon`
- [ ] `npm run build:hook` (produces `dist/hook/beacon-hook.cjs`)
- [ ] Install Beacon's hooks (DEV invocation, dry-run first): `node dist/installer/cli.cjs --dry-run` → review, then `node dist/installer/cli.cjs`
- [ ] In Codex, run `/hooks` and TRUST the newly-added Beacon hooks (they won't fire until trusted)
- [ ] Launch Beacon: `npm run dev` (dev) — or open the packaged app: `open dist/mac-arm64/Beacon.app`

## M3a — foundation (checkable now)
- [ ] **No dock icon**: Beacon does NOT appear in the Dock or Cmd-Tab switcher.
- [ ] **Tray icon**: a Beacon icon appears in the menu bar; it adapts to light/dark menu bar.
- [ ] **Window toggles**: clicking the tray icon shows the window; clicking again hides it.
- [ ] **Live sessions**: start a real `claude` session in a repo → it appears in the window within ~1s; start a `codex` session → it appears too.
- [ ] **State transitions**: as a session works / asks for permission / finishes a turn, its state/attention updates live (working → needs-you → done).
- [ ] **Badge**: the tray title shows a count when one or more sessions are needs-you/done AND unseen; it clears to empty at 0.
- [ ] **Mark seen**: clicking "seen" on a row clears its dot and decrements the badge.
- [ ] **Go to** (per host):
  - [ ] Terminal.app (plain local tab): brings the exact tab forward (tty match).
  - [ ] VS Code: brings the right VS Code window forward (`code --reuse-window`).
  - [ ] Cursor: brings the right Cursor window forward.
  - [ ] Degraded (tmux / ssh / remote / tty unknown): reveals the repo in Finder (local) or copies the path (remote), with a clear message.
- [ ] **Automation permission**: the first "Go to" against Terminal/VS Code triggers the macOS Automation prompt; granting it makes focus work; denying it shows a graceful fallback + how-to-grant.
- [ ] **Codex reconcile**: a Codex session (created under a temp id) gets its real id once its `~/.codex/sessions/.../rollout-*.jsonl` appears (no visible glitch; mark-seen keeps working).
- [ ] **Persistence**: quit Beacon and relaunch → previously-seen sessions are still listed (loaded from `~/Library/Application Support/Beacon/state.json`).
- [ ] **Hook latency**: the CLI feels no slower with hooks installed (the hook is fire-and-forget, exits in ~tens of ms).
- [ ] **Uninstall**: `node dist/installer/cli.cjs --uninstall` removes ONLY Beacon's hooks; your existing hooks remain; a backup was written next to each config.

## M3b — activating panel + global shortcut (when built)
- [ ] **⌘⇧Space** summons the panel and it TAKES focus (type-to-filter / arrow keys work immediately).
- [ ] Panel **floats over a fullscreen app** (e.g. fullscreen Safari) and appears on whatever Space you're on.
- [ ] Panel behaves under **Stage Manager** and on a **second display**.
- [ ] Panel **hides on blur** (click elsewhere) and on **Esc**.
- [ ] **Shortcut conflict**: if ⌘⇧Space is already taken, Beacon shows an in-app warning, the tray still works, and you can pick another accelerator (persisted).

## M3c — polished UI (when built)
- [ ] Groups render: Needs you / Working / Done / Recently closed, each with the right dot color.
- [ ] Tool + host icons, repo name, relative time all render correctly.
- [ ] Packaged-app hook invocation: after installing from the packaged `.app`, the hook command uses the `ELECTRON_RUN_AS_NODE` form and still fires (reinstalling from dev→packaged does NOT double-add — the installer replaces the stale entry).

## M3c — UI polish (dev: `npm run dev`)
- [ ] Panel is a translucent dark frosted card (rounded, blurred) — not an opaque rectangle.
- [ ] Sessions are grouped under **Needs you / Working / Done / Recently closed**; empty groups are hidden.
- [ ] Each row shows: a status dot, a tool icon (Claude/Codex), repo name, a host icon (Terminal/VS Code/Cursor), relative time, a **Go to** button, and a **mark-seen** check when it needs attention.
- [ ] A session running under a degraded host shows a small amber "degraded" badge.
- [ ] Clicking **Go to** on a session whose window can't be focused shows a toast with the reason (e.g. reveal-in-Finder fallback).
- [ ] Clicking the mark-seen check clears the dot and decrements the menu-bar badge.

## Notes
- The packaged `.app` is UNSIGNED (local build). On first launch macOS Gatekeeper may require right-click → Open. Signing/notarization needs an Apple Developer ID (not set up).
- Socket path is `~/Library/Application Support/Beacon/beacon.sock` (~60 bytes for this user — under the macOS ~104-byte limit). If a future user has a very long home path and sees no sessions, that's the documented `FIXME(socket-path)` in `src/core/app-paths.ts`.
