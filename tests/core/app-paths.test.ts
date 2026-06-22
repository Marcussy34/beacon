import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { appPaths } from '../../src/core/app-paths';

describe('appPaths', () => {
  it('derives Beacon paths under Application Support/Beacon', () => {
    const p = appPaths('/Users/m');
    const base = join('/Users/m', 'Library', 'Application Support', 'Beacon');
    expect(p.dataDir).toBe(base);
    expect(p.socketPath).toBe(join(base, 'beacon.sock'));
    expect(p.statePath).toBe(join(base, 'state.json'));
    expect(p.codexSessionsDir).toBe(join('/Users/m', '.codex', 'sessions'));
  });
});
