import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InstallTarget } from '../../src/installer/install';
import { dryRunInstall, installHooks, uninstallHooks, defaultTargets, CODEX_TRUST_REVIEW_MESSAGE } from '../../src/installer/install';
import { claudeHookSpecs, codexHookSpecs } from '../../src/installer/hook-specs';

let dir: string;
let claudePath: string;
let codexPath: string;
const INV = 'node "/x/dist/hook/beacon-hook.cjs"';

function targets(): InstallTarget[] {
  return [
    { tool: 'claude', path: claudePath, specs: claudeHookSpecs(INV, 'beacon') },
    { tool: 'codex', path: codexPath, specs: codexHookSpecs(INV, 'beacon') },
  ];
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'beacon-install-'));
  claudePath = join(dir, 'settings.json');
  codexPath = join(dir, 'hooks.json');
  // Pre-existing user content (must survive).
  writeFileSync(claudePath, JSON.stringify({
    env: { A: '1' },
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'user-done' }] }] },
  }));
  writeFileSync(codexPath, JSON.stringify({
    hooks: { SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: 'user-codex' }] }] },
  }));
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('defaultTargets', () => {
  it('targets the two real dotfiles with the right specs', () => {
    const ts = defaultTargets(INV, 'beacon');
    expect(ts.map(t => t.tool)).toEqual(['claude', 'codex']);
    expect(ts[0]!.path.endsWith('/.claude/settings.json')).toBe(true);
    expect(ts[1]!.path.endsWith('/.codex/hooks.json')).toBe(true);
    expect(ts[0]!.specs.length).toBe(6);
    expect(ts[1]!.specs.length).toBe(5);
  });
});

describe('dryRunInstall', () => {
  it('reports planned additions and mutates nothing', () => {
    const before = readFileSync(claudePath, 'utf8');
    const plans = dryRunInstall(targets());
    expect(plans.find(p => p.tool === 'claude')!.merge.additions).toHaveLength(6);
    expect(plans.find(p => p.tool === 'codex')!.merge.additions).toHaveLength(5);
    expect(readFileSync(claudePath, 'utf8')).toBe(before); // unchanged
    expect(existsSync(`${claudePath}.beacon-backup-`)).toBe(false);
  });
});

describe('installHooks', () => {
  it('merges Beacon hooks, preserves user hooks, backs up, returns trust message', () => {
    const { results, trustMessage } = installHooks(targets(), { now: 1 });
    expect(trustMessage).toBe(CODEX_TRUST_REVIEW_MESSAGE);

    const claude = JSON.parse(readFileSync(claudePath, 'utf8'));
    expect(claude.env).toEqual({ A: '1' });                       // sibling preserved
    expect(JSON.stringify(claude)).toContain('--beacon-marker');  // beacon installed
    expect(JSON.stringify(claude)).toContain('user-done');        // user hook preserved

    expect(results.find(r => r.tool === 'claude')!.added).toBe(6);
    expect(results.find(r => r.tool === 'claude')!.backupPath).toBe(`${claudePath}.beacon-backup-1`);
    expect(existsSync(`${claudePath}.beacon-backup-1`)).toBe(true);
  });

  it('is idempotent: a second install adds nothing and writes nothing', () => {
    installHooks(targets(), { now: 1 });
    const afterFirst = readFileSync(claudePath, 'utf8');
    const { results } = installHooks(targets(), { now: 2 });
    expect(results.find(r => r.tool === 'claude')!.added).toBe(0);
    expect(readFileSync(claudePath, 'utf8')).toBe(afterFirst);            // unchanged
    expect(existsSync(`${claudePath}.beacon-backup-2`)).toBe(false);      // no second backup
  });

  it('handles a missing target file by creating it from scratch', () => {
    rmSync(codexPath);
    installHooks(targets(), { now: 1 });
    const codex = JSON.parse(readFileSync(codexPath, 'utf8'));
    expect(JSON.stringify(codex)).toContain('--beacon-marker');
  });
});

describe('uninstallHooks', () => {
  it('removes only Beacon hooks and restores the original user config', () => {
    const originalClaude = readFileSync(claudePath, 'utf8');
    const originalCodex = readFileSync(codexPath, 'utf8');

    installHooks(targets(), { now: 1 });
    const results = uninstallHooks(targets(), { now: 2 });

    expect(results.find(r => r.tool === 'claude')!.removed).toBe(6);
    expect(results.find(r => r.tool === 'codex')!.removed).toBe(5);
    // Beacon gone; user hooks intact (compare parsed structure to the originals).
    expect(JSON.parse(readFileSync(claudePath, 'utf8'))).toEqual(JSON.parse(originalClaude));
    expect(JSON.parse(readFileSync(codexPath, 'utf8'))).toEqual(JSON.parse(originalCodex));
  });

  it('is a no-op when nothing is installed', () => {
    const results = uninstallHooks(targets());
    expect(results.every(r => r.removed === 0)).toBe(true);
  });
});
