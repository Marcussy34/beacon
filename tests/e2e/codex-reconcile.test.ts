import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore } from '../../src/domain/store';
import { parseHookEvent } from '../../src/domain/parser';
import { buildRawEvent } from '../../src/hook/build-event';
import { startRolloutWatcher } from '../../src/collector/rollout-watcher';

async function waitFor(pred: () => boolean, timeoutMs = 3000, stepMs = 20): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  throw new Error('waitFor: condition not met in time');
}

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'beacon-codex-e2e-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('Codex temp-id -> rollout reconcile (end to end)', () => {
  it('reconciles a temp-keyed Codex session when its rollout file appears, then mark-seen works by tempId', async () => {
    const sessionsDir = join(dir, 'sessions');
    const dateDir = join(sessionsDir, '2025', '06', '22');
    await mkdir(dateDir, { recursive: true }); // exists before watch (deterministic)

    const store = new SessionStore();

    // 1) A Codex turn-done event arrives via the hook pipeline -> temp-keyed session, attention=done.
    const raw = buildRawEvent({
      tool: 'codex', event: 'Stop',
      env: { __CFBundleIdentifier: 'com.apple.Terminal', TERM_SESSION_ID: 'T9' },
      stdin: {}, cwd: '/Users/m/proj', gitRoot: '/Users/m/proj', tty: '/dev/ttys009',
      codexAncestorPid: 4242, codexAncestorStartTime: 'StartA', ts: 1_750_000_000_000,
    });
    const session = store.upsertFromEvent(parseHookEvent(raw));
    const tempId = session.tempId;
    expect(session.codexSessionId).toBeUndefined();
    expect(store.attentionCount()).toBe(1); // done + unseen

    // 2) Watcher running; M3 wires the callback to store.reconcileCodex.
    const watcher = startRolloutWatcher(sessionsDir, (info) => { store.reconcileCodex(info); });

    // 3) Codex writes the rollout file (first line = session_meta), start time within tolerance.
    const metaLine = JSON.stringify({
      type: 'session_meta',
      payload: { id: 'uuid-codex-1', cwd: '/Users/m/proj' },
      timestamp: new Date(1_750_000_003_000).toISOString(),
    }) + '\n';
    await writeFile(join(dateDir, 'rollout-2025-06-22T20-00-00-uuid-codex-1.jsonl'), metaLine);

    // 4) Watcher reconciles the temp session in place.
    await waitFor(() => store.get(tempId)?.codexSessionId === 'uuid-codex-1');

    const reconciled = store.get(tempId)!;
    expect(reconciled.codexSessionId).toBe('uuid-codex-1');
    expect(reconciled.id).toBe('codex:uuid-codex-1');
    expect(reconciled.tempId).toBe(tempId); // key unchanged

    // 5) Mark-seen / badge still keyed by tempId after reconcile.
    store.markSeen(tempId);
    expect(store.get(tempId)!.seen).toBe(true);
    expect(store.attentionCount()).toBe(0);

    watcher.close();
  });
});
