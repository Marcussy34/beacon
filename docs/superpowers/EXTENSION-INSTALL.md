# Beacon Focus Helper — Install (v1, manual)

The Beacon Focus Helper extension lets "Go to" land on the **exact** integrated-terminal tab of a
Cursor/VS Code session (not just the editor window). It is optional: without it, Beacon still focuses
the correct editor window. Install once per editor.

## 1. Build the .vsix

From the Beacon repo root:

```bash
npm run build:extension
```

This installs the extension's dev deps, compiles it, and produces `extension/beacon-focus-0.0.1.vsix`.

## 2. Install into your editor

**Cursor** (CLI available at `/usr/local/bin/cursor`):

```bash
cursor --install-extension extension/beacon-focus-0.0.1.vsix
```

**VS Code:** the `code` CLI is NOT on PATH on this machine, so use the UI:
1. Open VS Code → Extensions view (⇧⌘X).
2. Click the `…` menu → **Install from VSIX…**.
3. Select `extension/beacon-focus-0.0.1.vsix`.

(If you later add the `code` CLI: `code --install-extension extension/beacon-focus-0.0.1.vsix`.)

## 3. Reload

Reload/restart the editor once after installing (Cursor/VS Code: **Developer: Reload Window**).

## 4. Verify

1. In the editor, open a repo and start a Claude Code or Codex session in an **integrated terminal**.
2. Open a second integrated terminal in the same window.
3. In Beacon (⌘⇧Space), click **Go to** for that session.
4. The editor comes forward AND the exact terminal tab for that session is revealed.

If the extension isn't installed, step 4 still brings the editor window forward — only the tab isn't auto-selected.

## How it works

Beacon runs `open -b <bundleId> <gitRoot>` to focus the window, then
`open "<scheme>://beacon.beacon-focus/focus?tty=<tty>"`. The extension catches that URL, finds the
integrated terminal whose shell tty matches, and calls `terminal.show()`.

## Limitations (v1)

- If the same repo folder is open in two windows, the URL may reach the wrong window (rare).
- macOS only.
- The extension is not on any marketplace; rebuild + reinstall to update.
