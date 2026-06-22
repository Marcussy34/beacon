import { join } from 'node:path';

export interface AppPaths {
  dataDir: string;
  socketPath: string;
  statePath: string;
  codexSessionsDir: string;
}

/** Pure: derive Beacon's runtime paths from a home dir (injected for tests; main passes os.homedir()). */
export function appPaths(home: string): AppPaths {
  const dataDir = join(home, 'Library', 'Application Support', 'Beacon');
  return {
    dataDir,
    // FIXME(socket-path): macOS limits a Unix-domain socket path to ~104 bytes (sun_path).
    // This path is ~60 bytes for a normal home; a very long username/home (> ~44 chars) could
    // exceed it → bind() fails silently → no sessions appear. If a user hits this, fall back to a
    // short fixed path (e.g. /tmp/beacon-<uid>.sock) and update beacon-hook.ts's SOCKET_PATH to match.
    socketPath: join(dataDir, 'beacon.sock'),
    statePath: join(dataDir, 'state.json'),
    codexSessionsDir: join(home, '.codex', 'sessions'),
  };
}
