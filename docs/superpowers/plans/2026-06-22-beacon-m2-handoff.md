# Beacon — M1 → M2 Handoff Notes

**M1 status:** COMPLETE. 15 commits (`2918143..de07727` on `main`). 61/61 tests across 10 files, `tsc --noEmit` clean. Final whole-branch review (opus): no Critical issues; verdict "ready to hand to M2 with documentation-only fixes" (this file is that documentation).

## What M1 delivered (headless core, Electron-free)
- Domain: `types`, `identity` (eventKey + reconcile helpers), `parser`, `state-machine`, `store`, `persistence` (atomic + debounced).
- Collector: `0600` Unix socket, drains connections on close, durable error handler, drops malformed lines, never interpolates payloads.
- Hook: pure `proc` parsers, `build-event` (host/remote detection), `beacon-hook` CLI (always exits 0, fixed-argv `git`/`ps`, `readFileSync(0)` stdin, `--beacon-marker` strip).
- Proven end-to-end (Claude) by `tests/e2e/pipeline.test.ts`: socket → parse → store, badge count correct.

## MUST pick up in M2 (explicitly deferred from M1)
1. **Wire Codex reconcile.** `parseRolloutMeta` / `matchesRollout` / `reconcile` in `src/domain/identity.ts` are unit-tested but have ZERO callers. M2 must:
   - Add a watcher over `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` that reads the first `session_meta` line, calls `matchesRollout` against temp-keyed Codex sessions, and applies `reconcile`.
   - Add a **Codex temp-id → reconcile integration test** (M1's e2e is Claude-only). Confirm a Codex session created via temp key still resolves and `markSeen`/badge work after reconcile.
2. **Decide the `id` vs `tempId` lookup contract.** Store keys on `tempId` (stable across reconcile); `reconcile` writes a display `id` that nothing reads yet. Either add an `id→tempId` index or document `id` as display-only before M3 addresses sessions by `id`.

## SHOULD backfill (low-risk hardening, deferred by final review)
- Tests: `parseRolloutMeta` on malformed timestamp; `eventKey` for a Claude event lacking `session_id` (currently falls through to the `codex:` branch — pin that intentionally); parser `SessionEnd`→`session-end` and `UserPromptSubmit`/`PreToolUse`→`working` mappings.
- `parseHookEvent` tool-selector: explicit `switch (raw.tool)` instead of `=== 'claude' ? : ` fallthrough (type-safe today under the strict `Tool` union).
- Replace fixed `setTimeout` settles in collector/e2e tests with a `waitFor(predicate)` helper before the suite grows.
- Comments: `matchesRollout` `<=`/10s tolerance rationale.

## M2 scope (from spec §9, unchanged)
Focuser (Terminal AppleScript tty-match; `code`/`cursor --reuse-window` + bundle-id activation; degraded fallbacks) + Installer (schema-specific merge into `~/.claude/settings.json` and `~/.codex/hooks.json`; atomic + lock + backup + dry-run + marker uninstall via the `beacon-hook --beacon-marker <id>` command vector; Codex `/hooks` trust-review prompt). M3 = Electron shell + Tray + activating all-Spaces panel + ⌘⇧Space + React/Tailwind UI.

## Note: `beacon-hook` has no `package.json` "bin" entry yet — intentional; the installer (M2) defines how the hook is invoked.
