import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import { startCollector } from '../../src/collector/socket-server';
import type { RawHookEvent } from '../../src/domain/types';

let dir: string;
let socketPath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'beacon-sock-'));
  socketPath = join(dir, 'beacon.sock');
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

function send(path: string, payload: string): Promise<void> {
  return new Promise((res, rej) => {
    const c = connect(path, () => { c.write(payload, () => c.end()); });
    c.on('error', rej);
    c.on('close', () => res());
  });
}

const raw: RawHookEvent = {
  tool: 'claude', event: 'Stop', sessionId: 's1', cwd: '/r',
  host: 'terminal', remote: 'none', ts: 1,
};

describe('startCollector', () => {
  it('delivers a parsed event from one JSON line', async () => {
    const received: RawHookEvent[] = [];
    const col = await startCollector(socketPath, (e) => received.push(e));
    await send(socketPath, JSON.stringify(raw) + '\n');
    await new Promise((r) => setTimeout(r, 50));
    expect(received).toHaveLength(1);
    expect(received[0]!.sessionId).toBe('s1');
    await col.close();
  });
  it('reassembles two events split across writes and drops a bad line', async () => {
    const received: RawHookEvent[] = [];
    const col = await startCollector(socketPath, (e) => received.push(e));
    const line = JSON.stringify(raw);
    await send(socketPath, line + '\nnot-json\n' + line + '\n');
    await new Promise((r) => setTimeout(r, 50));
    expect(received).toHaveLength(2);
    await col.close();
  });
});
