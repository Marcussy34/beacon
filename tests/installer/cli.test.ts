import { describe, it, expect } from 'vitest';
import { runInstallerCli, type CliDeps } from '../../src/installer/cli';
import { CODEX_TRUST_REVIEW_MESSAGE } from '../../src/installer/install';

function makeDeps(overrides: Partial<CliDeps> = {}): { deps: CliDeps; calls: string[]; logs: string[] } {
  const calls: string[] = [];
  const logs: string[] = [];
  const deps: CliDeps = {
    targets: [],
    dryRun: ((_t) => { calls.push('dryRun'); return [{ tool: 'claude', path: '/c', merge: { additions: [{ event: 'Stop', command: 'x' }], alreadyPresent: [] } }]; }) as CliDeps['dryRun'],
    install: ((_t) => { calls.push('install'); return { results: [{ tool: 'claude', path: '/c', added: 6, backupPath: '/c.bak' }], trustMessage: CODEX_TRUST_REVIEW_MESSAGE }; }) as CliDeps['install'],
    uninstall: ((_t) => { calls.push('uninstall'); return [{ tool: 'claude', path: '/c', removed: 6 }]; }) as CliDeps['uninstall'],
    log: (s) => logs.push(s),
    ...overrides,
  };
  return { deps, calls, logs };
}

describe('runInstallerCli', () => {
  it('default (no flags) installs and prints the Codex trust message', () => {
    const { deps, calls, logs } = makeDeps();
    expect(runInstallerCli([], deps)).toBe(0);
    expect(calls).toEqual(['install']);
    expect(logs.join('\n')).toContain(CODEX_TRUST_REVIEW_MESSAGE);
    expect(logs.join('\n')).toContain('added 6');
  });

  it('--dry-run plans only, never installs or uninstalls', () => {
    const { deps, calls, logs } = makeDeps();
    expect(runInstallerCli(['--dry-run'], deps)).toBe(0);
    expect(calls).toEqual(['dryRun']);
    expect(logs.join('\n')).toContain('to add');
  });

  it('--uninstall removes only, never installs', () => {
    const { deps, calls } = makeDeps();
    expect(runInstallerCli(['--uninstall'], deps)).toBe(0);
    expect(calls).toEqual(['uninstall']);
  });
});
