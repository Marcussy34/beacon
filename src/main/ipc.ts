import type { BeaconCore } from '../core/beacon-core';
import type { SessionsSnapshot } from '../domain/store';

export interface IpcHandlers {
  snapshot(): SessionsSnapshot;
  markSeen(key: string): void;
  dismiss(key: string): void;
  move(key: string, group: 'needsYou' | 'done'): void;
  goto(key: string): Promise<{ ok: boolean; message: string }>;
}

/** Pure-ish IPC handlers over the core. `focus` is injected (main passes the focuser). */
export function createIpcHandlers(
  core: BeaconCore,
  focus: (key: string) => Promise<{ ok: boolean; message: string }>,
): IpcHandlers {
  return {
    snapshot: () => core.snapshot(),
    markSeen: (key) => core.markSeen(key),
    dismiss: (key) => core.dismiss(key),
    move: (key, group) => core.moveToGroup(key, group),
    goto: async (key) => { core.markSeen(key); return focus(key); }, // "Go to" also marks seen (spec §4.6)
  };
}
