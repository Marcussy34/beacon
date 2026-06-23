import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { connect } from 'node:net';
import { createBeaconCore } from '../../src/core/beacon-core';
import { appPaths } from '../../src/core/app-paths';
import { buildRawEvent } from '../../src/hook/build-event';
import { createIpcHandlers } from '../../src/main/ipc';

function send(p: string, l: string): Promise<void> { return new Promise((res, rej) => { const c = connect(p, () => c.write(l + '\n', () => c.end())); c.on('error', rej); c.on('close', () => res()); }); }
async function waitFor(p: () => boolean, ms = 2000) { const t = Date.now(); while (Date.now() - t < ms) { if (p()) return; await new Promise(r => setTimeout(r, 20)); } throw new Error('timeout'); }

let home: string;
// Use /tmp (not os.tmpdir()) to keep the socket path under macOS's 104-byte sun_path limit.
beforeEach(async () => { home = await mkdtemp(join('/tmp', 'beacon-ipc-')); });
afterEach(async () => { await rm(home, { recursive: true, force: true }); });

describe('ipc handlers', () => {
  it('snapshot reflects sessions; markSeen clears attention; goto marks seen + focuses', async () => {
    const paths = appPaths(home); await mkdir(paths.dataDir, { recursive: true });
    const core = await createBeaconCore({ paths, persistDebounceMs: 5 });
    const focused: string[] = [];
    const h = createIpcHandlers(core, async (key) => { focused.push(key); return { ok: true, message: 'focused' }; });

    const ev = buildRawEvent({ tool: 'claude', event: 'Notification', env: {}, stdin: { session_id: 'sid-1', cwd: '/r' }, cwd: '/r', gitRoot: '/r', ts: 1 });
    await send(paths.socketPath, JSON.stringify(ev));
    await waitFor(() => core.attentionCount() === 1);

    expect(h.snapshot().sessions.find(s => s.id === 'claude:sid-1')!.attention).toBe('needs-you');
    const r = await h.goto('claude:sid-1');
    expect(r.ok).toBe(true);
    expect(focused).toEqual(['claude:sid-1']);
    expect(core.store.get('claude:sid-1')!.seen).toBe(true); // goto marked seen
    expect(core.attentionCount()).toBe(0);
    await core.close();
  });

  it('dismiss removes a session from the snapshot', async () => {
    const paths = appPaths(home); await mkdir(paths.dataDir, { recursive: true });
    const core = await createBeaconCore({ paths, persistDebounceMs: 5 });
    const h = createIpcHandlers(core, async () => ({ ok: true, message: 'x' }));

    const ev = buildRawEvent({ tool: 'claude', event: 'SessionStart', env: {}, stdin: { session_id: 'sid-2', cwd: '/r' }, cwd: '/r', gitRoot: '/r', ts: 1 });
    await send(paths.socketPath, JSON.stringify(ev));
    await waitFor(() => core.store.get('claude:sid-2') !== undefined);

    h.dismiss('claude:sid-2');
    expect(core.store.get('claude:sid-2')).toBeUndefined();
    await core.close();
  });
});
