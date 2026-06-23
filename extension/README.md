# Beacon Focus Helper

A companion extension for [Beacon](https://github.com/predictefy/beacon). When you click **Go to** in Beacon
for a session running in this editor's integrated terminal, Beacon opens a `beacon.beacon-focus` URL and this
extension reveals the exact terminal tab whose shell matches the session.

- **Trigger:** `cursor://beacon.beacon-focus/focus?tty=<tty>` (Cursor) or `vscode://beacon.beacon-focus/focus?tty=<tty>` (VS Code).
- **What it does:** matches the URL's `tty` against each integrated terminal's shell tty (`ps -o tty= -p <pid>`) and calls `terminal.show()` on the match.
- **No match / not our URL:** no-op. The editor window is already focused by Beacon, so nothing breaks.

## Install

See `docs/EXTENSION-INSTALL.md` in the Beacon repo.
