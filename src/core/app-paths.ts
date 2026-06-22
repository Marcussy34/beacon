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
    socketPath: join(dataDir, 'beacon.sock'),
    statePath: join(dataDir, 'state.json'),
    codexSessionsDir: join(home, '.codex', 'sessions'),
  };
}
