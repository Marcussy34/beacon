import { createServer, type Server, type Socket } from 'node:net';
import { unlink, chmod } from 'node:fs/promises';
import type { RawHookEvent } from '../domain/types';

export interface Collector {
  close(): Promise<void>;
}

export async function startCollector(
  socketPath: string,
  onEvent: (raw: RawHookEvent) => void,
): Promise<Collector> {
  // Unconditional unlink avoids a check-then-act (TOCTOU) race; ignore ENOENT.
  await unlink(socketPath).catch(() => {});

  const sockets = new Set<Socket>();
  const server: Server = createServer((sock) => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('data', (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          onEvent(JSON.parse(line) as RawHookEvent);
        } catch {
          /* drop malformed line — never trust/forward bad input */
        }
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onListenError = (err: Error) => reject(err);
    server.once('error', onListenError);
    server.listen(socketPath, () => {
      server.removeListener('error', onListenError);
      // Long-lived handler so a post-listen socket error never crashes the daemon.
      server.on('error', () => {});
      resolve();
    });
  });
  await chmod(socketPath, 0o600).catch(() => {});

  return {
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy(); // drain open connections so close() can't hang
        server.close(() => resolve());
      }),
  };
}
