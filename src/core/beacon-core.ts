import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { SessionStore } from '../domain/store';
import { parseHookEvent } from '../domain/parser';
import { loadSnapshot, createDebouncedWriter } from '../domain/persistence';
import { startCollector } from '../collector/socket-server';
import { startRolloutWatcher } from '../collector/rollout-watcher';
import type { SessionsSnapshot } from '../domain/store';
import type { AppPaths } from './app-paths';

// Staleness sweep: a session is "silent" when no hook events have arrived for it. The sweep
// removes silent-past-threshold sessions (see store.sweepStale). Active needs-you prompts stay
// until handled; closed, working/started, and done/finished rows drop after 24 h silent.
const CLOSED_TTL_MS = 24 * 60 * 60 * 1000;
const DEAD_TTL_MS = 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60_000;

export interface BeaconCore {
  store: SessionStore;
  snapshot(): SessionsSnapshot;
  attentionCount(): number;
  markSeen(key: string): void;
  dismiss(key: string): void;
  moveToGroup(key: string, group: 'needsYou' | 'done'): void;
  close(): Promise<void>;
}

export async function createBeaconCore(opts: {
  paths: AppPaths; persistDebounceMs?: number; onChange?: () => void;
}): Promise<BeaconCore> {
  const { paths, persistDebounceMs = 400, onChange } = opts;
  await mkdir(paths.dataDir, { recursive: true });

  // Load persisted state or start fresh
  const loaded = await loadSnapshot(paths.statePath).catch(() => null);
  const store = loaded ? SessionStore.fromJSON(loaded) : new SessionStore();

  const writer = createDebouncedWriter(paths.statePath, persistDebounceMs, () => {});
  // On every mutation: debounce-persist + notify caller
  const touched = () => { writer.schedule(store.toJSON()); onChange?.(); };

  // Start the Unix socket collector; each hook event → parse → upsert → persist
  const collector = await startCollector(paths.socketPath, (raw) => {
    try { store.upsertFromEvent(parseHookEvent(raw)); touched(); } catch { /* drop unmapped */ }
  });

  // Ensure codex sessions dir exists, then start rollout watcher if available
  let watcher: { close(): void } | undefined;
  await mkdir(paths.codexSessionsDir, { recursive: true }).catch(() => {});
  if (existsSync(paths.codexSessionsDir)) {
    watcher = startRolloutWatcher(paths.codexSessionsDir, (info) => { if (store.reconcileCodex(info)) touched(); });
  }

  // Periodic staleness sweep. unref so the timer never keeps the process (or a test runner) alive;
  // Electron's main run loop keeps firing it. Only persist/refresh when something was actually removed.
  const sweep = setInterval(() => {
    if (store.sweepStale(Date.now(), CLOSED_TTL_MS, DEAD_TTL_MS)) touched();
  }, SWEEP_INTERVAL_MS);
  sweep.unref?.();

  return {
    store,
    snapshot: () => store.toJSON(),
    attentionCount: () => store.attentionCount(),
    markSeen: (key) => { store.markSeen(key); touched(); },
    dismiss: (key) => { store.dismiss(key); touched(); },
    moveToGroup: (key, group) => { store.moveToGroup(key, group); touched(); },
    // stop sweep + watcher + collector, then flush any pending write
    close: async () => { clearInterval(sweep); watcher?.close(); await collector.close(); await writer.flush(); },
  };
}
