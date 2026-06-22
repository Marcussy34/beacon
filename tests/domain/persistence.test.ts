// tests/domain/persistence.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
});
