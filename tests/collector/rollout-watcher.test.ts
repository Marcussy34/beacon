import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRolloutMeta, scanRolloutDir } from '../../src/collector/rollout-watcher';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'beacon-rollout-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const meta = (id: string, cwd: string) =>
  JSON.stringify({ type: 'session_meta', payload: { id, cwd }, timestamp: '2025-06-22T20:00:00Z' }) + '\n';

describe('readRolloutMeta', () => {
  it('parses the first session_meta line of a rollout file', async () => {
    const p = join(dir, 'rollout-x.jsonl');
    await writeFile(p, meta('uuid-1', '/r') + JSON.stringify({ type: 'event_msg' }) + '\n');
    expect(await readRolloutMeta(p)).toEqual({ codexSessionId: 'uuid-1', gitRoot: '/r', startedAt: Date.parse('2025-06-22T20:00:00Z') });
  });
  it('returns null when the first line is not yet flushed (no newline)', async () => {
    const p = join(dir, 'rollout-partial.jsonl');
    await writeFile(p, '{"type":"session_meta"'); // no newline yet
    expect(await readRolloutMeta(p)).toBeNull();
  });
  it('returns null for a missing file', async () => {
    expect(await readRolloutMeta(join(dir, 'nope.jsonl'))).toBeNull();
  });
  it('returns null for a non-meta first line', async () => {
    const p = join(dir, 'rollout-evt.jsonl');
    await writeFile(p, JSON.stringify({ type: 'event_msg' }) + '\n');
    expect(await readRolloutMeta(p)).toBeNull();
  });
});

describe('scanRolloutDir', () => {
  it('finds rollout files in nested date dirs and ignores non-rollout files', async () => {
    const dateDir = join(dir, '2025', '06', '22');
    await mkdir(dateDir, { recursive: true });
    await writeFile(join(dateDir, 'rollout-a.jsonl'), meta('uuid-a', '/ra'));
    await writeFile(join(dateDir, 'rollout-b.jsonl'), meta('uuid-b', '/rb'));
    await writeFile(join(dateDir, 'notes.txt'), 'ignore me');
    const infos = await scanRolloutDir(dir);
    expect(infos.map(i => i.codexSessionId).sort()).toEqual(['uuid-a', 'uuid-b']);
  });
  it('returns [] for a missing directory', async () => {
    expect(await scanRolloutDir(join(dir, 'absent'))).toEqual([]);
  });
});
