// tests/e2e/pipeline.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import { startCollector } from '../../src/collector/socket-server';
import { buildRawEvent } from '../../src/hook/build-event';
import { parseHookEvent } from '../../src/domain/parser';
import { SessionStore } from '../../src/domain/store';
import type { RawHookEvent } from '../../src/domain/types';

let dir: string;
let socketPath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'beacon-e2e-'));
  socketPath = join(dir, 'beacon.sock');
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

function send(path: string, line: string): Promise<void> {
  return new Promise((res, rej) => {
    const c = connect(path, () => { c.write(line + '\n', () => c.end()); });
    c.on('error', rej);
    c.on('close', () => res());
  });
}

describe('end-to-end pipeline', () => {
  it('hook event -> socket -> parse -> store transitions to needs-you', async () => {
    const store = new SessionStore();
    const col = await startCollector(socketPath, (raw: RawHookEvent) => {
      store.upsertFromEvent(parseHookEvent(raw));
    });

    const startEvent = buildRawEvent({
      tool: 'claude', event: 'SessionStart',
      env: { __CFBundleIdentifier: 'com.apple.Terminal', TERM_SESSION_ID: 'T1' },
      stdin: { session_id: 'sid-1', cwd: '/Users/m/repo' },
      cwd: '/Users/m/repo', gitRoot: '/Users/m/repo', tty: '/dev/ttys003', ts: 1,
    });
    const needsEvent = buildRawEvent({
      tool: 'claude', event: 'Notification',
      env: { __CFBundleIdentifier: 'com.apple.Terminal', TERM_SESSION_ID: 'T1' },
      stdin: { session_id: 'sid-1', cwd: '/Users/m/repo' },
      cwd: '/Users/m/repo', gitRoot: '/Users/m/repo', tty: '/dev/ttys003', ts: 2,
    });

    await send(socketPath, JSON.stringify(startEvent));
    await send(socketPath, JSON.stringify(needsEvent));
    await new Promise((r) => setTimeout(r, 60));

    const s = store.get('claude:sid-1');
    expect(s).toBeDefined();
    expect(s!.state).toBe('waiting');
    expect(s!.attention).toBe('needs-you');
    expect(s!.repoName).toBe('repo');
    expect(store.attentionCount()).toBe(1);

    await col.close();
  });
});
