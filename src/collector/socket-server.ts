import { createServer, type Server } from 'node:net';
import { unlink, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { RawHookEvent } from '../domain/types';

export interface Collector {
  close(): Promise<void>;
}

export async function startCollector(
  socketPath: string,
  onEvent: (raw: RawHookEvent) => void,
): Promise<Collector> {
  if (existsSync(socketPath)) await unlink(socketPath).catch(() => {});

  const server: Server = createServer((sock) => {
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('data', (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        try {
          onEvent(JSON.parse(line) as RawHookEvent);
        } catch {
          /* drop malformed line — never trust/forward bad input */
        }
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  await chmod(socketPath, 0o600).catch(() => {});

  return {
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
