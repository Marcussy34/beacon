import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { SessionStore } from '../domain/store';
import { parseHookEvent } from '../domain/parser';
import { loadSnapshot, createDebouncedWriter } from '../domain/persistence';
import { startCollector } from '../collector/socket-server';
import { startRolloutWatcher } from '../collector/rollout-watcher';
import type { SessionsSnapshot } from '../domain/store';
import type { AppPaths } from './app-paths';

export interface BeaconCore {
  store: SessionStore;
  snapshot(): SessionsSnapshot;
  attentionCount(): number;
  markSeen(key: string): void;
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

  return {
    store,
    snapshot: () => store.toJSON(),
    attentionCount: () => store.attentionCount(),
    markSeen: (key) => { store.markSeen(key); touched(); },
    // stop watcher + collector, then flush any pending write
    close: async () => { watcher?.close(); await collector.close(); await writer.flush(); },
  };
}
