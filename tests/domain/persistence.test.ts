// tests/domain/persistence.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveSnapshot, loadSnapshot, createDebouncedWriter } from '../../src/domain/persistence';
import type { SessionsSnapshot } from '../../src/domain/store';

const snap: SessionsSnapshot = { version: 1, sessions: [] };
let dir: string;

beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'beacon-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('persistence', () => {
  it('saves and loads a snapshot', async () => {
    const p = join(dir, 'nested', 'state.json');
    await saveSnapshot(p, snap);
    expect(await loadSnapshot(p)).toEqual(snap);
  });
  it('returns null for a missing file', async () => {
    expect(await loadSnapshot(join(dir, 'nope.json'))).toBeNull();
  });
  it('returns null for corrupt JSON', async () => {
    const p = join(dir, 'bad.json');
    await writeFile(p, '{ not json', 'utf8');
    expect(await loadSnapshot(p)).toBeNull();
  });
  it('returns null for a wrong-version file', async () => {
    const p = join(dir, 'v.json');
    await writeFile(p, JSON.stringify({ version: 9, sessions: [] }), 'utf8');
    expect(await loadSnapshot(p)).toBeNull();
  });
  it('debounced writer flush persists the latest scheduled snapshot', async () => {
    const p = join(dir, 'state.json');
    const w = createDebouncedWriter(p, 50);
    w.schedule({ version: 1, sessions: [] });
    w.schedule({ version: 1, sessions: [] });
    await w.flush();
    expect(await loadSnapshot(p)).toEqual(snap);
  });
  it('flush with nothing scheduled resolves without error', async () => {
    const p = join(dir, 'state.json');
    const w = createDebouncedWriter(p, 50);
    await expect(w.flush()).resolves.toBeUndefined();
  });
  it('a failed write does not poison the chain: a later write still persists', async () => {
    // Put a FILE where saveSnapshot wants a directory → its mkdir(dirname) fails (first write rejects).
    const blocker = join(dir, 'blk');
    await writeFile(blocker, 'x', 'utf8');
    const p = join(blocker, 'state.json'); // dirname(p) === blocker (a file)
    const w = createDebouncedWriter(p, 5);

    w.schedule({ version: 1, sessions: [] });
    await w.flush().catch(() => {}); // first write rejects

    // Unblock: replace the file with a real directory so subsequent writes can succeed.
    await rm(blocker);
    await mkdir(blocker);

    w.schedule({ version: 1, sessions: [] });
    await w.flush(); // must ATTEMPT despite the prior rejection (chain not poisoned)
    expect(await loadSnapshot(p)).not.toBeNull(); // the later snapshot WAS persisted
  });
});
