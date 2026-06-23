import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { connect } from 'node:net';
import { createBeaconCore } from '../../src/core/beacon-core';
import { appPaths } from '../../src/core/app-paths';
import { buildRawEvent } from '../../src/hook/build-event';

function send(path: string, line: string): Promise<void> {
  return new Promise((res, rej) => { const c = connect(path, () => c.write(line + '\n', () => c.end())); c.on('error', rej); c.on('close', () => res()); });
}
async function waitFor(p: () => boolean, ms = 2000): Promise<void> {
  const t = Date.now(); while (Date.now() - t < ms) { if (p()) return; await new Promise(r => setTimeout(r, 20)); } throw new Error('timeout');
}

let home: string;
// Use /tmp directly (not tmpdir()) — macOS tmpdir() resolves to a long /var/folders/... path
// that exceeds the 104-byte Unix socket path limit when combined with the Beacon socket path.
beforeEach(async () => { home = await mkdtemp(join('/tmp', 'beacon-core-')); });
afterEach(async () => { await rm(home, { recursive: true, force: true }); });

describe('createBeaconCore', () => {
  it('hosts the collector: a hook event over the socket updates the store + badge', async () => {
    const paths = appPaths(home);
    await mkdir(paths.dataDir, { recursive: true });
    const core = await createBeaconCore({ paths, persistDebounceMs: 10 });

    const ev = buildRawEvent({
      tool: 'claude', event: 'Notification',
      env: { __CFBundleIdentifier: 'com.apple.Terminal', TERM_SESSION_ID: 'T1' },
      stdin: { session_id: 'sid-1', cwd: '/r' }, cwd: '/r', gitRoot: '/r', tty: '/dev/ttys003', ts: 1,
    });
    await send(paths.socketPath, JSON.stringify(ev));
    await waitFor(() => core.attentionCount() === 1);

    expect(core.store.get('claude:sid-1')!.attention).toBe('needs-you');
    await core.close();
  });

  it('dismiss removes a session and notifies onChange', async () => {
    const paths = appPaths(home);
    await mkdir(paths.dataDir, { recursive: true });
    let changes = 0;
    const core = await createBeaconCore({ paths, persistDebounceMs: 10, onChange: () => { changes++; } });

    const ev = buildRawEvent({ tool: 'claude', event: 'SessionStart', env: {}, stdin: { session_id: 'sid-d', cwd: '/r' }, cwd: '/r', gitRoot: '/r', ts: 1 });
    await send(paths.socketPath, JSON.stringify(ev));
    await waitFor(() => core.store.get('claude:sid-d') !== undefined);

    const before = changes;
    core.dismiss('claude:sid-d');
    expect(core.store.get('claude:sid-d')).toBeUndefined();
    expect(changes).toBeGreaterThan(before);
    await core.close();
  });

  it('moveToGroup demotes a session and notifies onChange', async () => {
    const paths = appPaths(home);
    await mkdir(paths.dataDir, { recursive: true });
    let changes = 0;
    const core = await createBeaconCore({ paths, persistDebounceMs: 10, onChange: () => { changes++; } });

    const ev = buildRawEvent({ tool: 'claude', event: 'Notification', env: {}, stdin: { session_id: 'sid-m', cwd: '/r' }, cwd: '/r', gitRoot: '/r', ts: 1 });
    await send(paths.socketPath, JSON.stringify(ev));
    await waitFor(() => core.store.get('claude:sid-m')?.attention === 'needs-you');

    const before = changes;
    core.moveToGroup('claude:sid-m', 'done');
    expect(core.store.get('claude:sid-m')!.state).toBe('done');
    expect(changes).toBeGreaterThan(before);
    await core.close();
  });

  it('persists across restart: state.json is reloaded into a fresh core', async () => {
    const paths = appPaths(home);
    await mkdir(paths.dataDir, { recursive: true });
    const core1 = await createBeaconCore({ paths, persistDebounceMs: 5 });
    const ev = buildRawEvent({ tool: 'claude', event: 'SessionStart', env: {}, stdin: { session_id: 'sid-9', cwd: '/r' }, cwd: '/r', gitRoot: '/r', ts: 1 });
    await send(paths.socketPath, JSON.stringify(ev));
    await waitFor(() => core1.store.get('claude:sid-9') !== undefined);
    await core1.close(); // flush persistence

    const core2 = await createBeaconCore({ paths, persistDebounceMs: 5 });
    expect(core2.store.get('claude:sid-9')).toBeDefined();
    await core2.close();
  });
});
