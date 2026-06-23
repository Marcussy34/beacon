import { describe, it, expect } from 'vitest';
import { resolveHookCommand } from '../../src/installer/resolve-hook-command';
import { defaultTargets } from '../../src/installer/install';

describe('resolveHookCommand', () => {
  it('builds "<node> \"<root>/dist/hook/beacon-hook.cjs\"" with explicit opts', () => {
    expect(resolveHookCommand({ rootDir: '/x', nodeBin: 'node' }))
      .toBe('node "/x/dist/hook/beacon-hook.cjs"');
  });
  it('defaults nodeBin to "node"', () => {
    expect(resolveHookCommand({ rootDir: '/x' }).startsWith('node ')).toBe(true);
  });
  it('shell-quotes a rootDir containing spaces', () => {
    expect(resolveHookCommand({ rootDir: '/a b' }))
      .toContain('"/a b/dist/hook/beacon-hook.cjs"');
  });
  it('escapes embedded quotes/backslashes in the path', () => {
    const out = resolveHookCommand({ rootDir: '/a"b' });
    expect(out).toContain('\\"'); // the embedded quote is backslash-escaped
  });
});

describe('resolveHookCommand (packaged mode)', () => {
  it('returns ELECTRON_RUN_AS_NODE=1 prefix with shell-quoted execPath and hook path', () => {
    const out = resolveHookCommand({ packaged: true, execPath: '/App/Beacon.app/MacOS/Beacon', resourcesPath: '/App/Beacon.app/Resources' });
    expect(out).toBe('ELECTRON_RUN_AS_NODE=1 "/App/Beacon.app/MacOS/Beacon" "/App/Beacon.app/Resources/beacon-hook.cjs"');
  });
  it('shell-quotes paths with spaces in packaged mode', () => {
    const out = resolveHookCommand({ packaged: true, execPath: '/My App/Beacon', resourcesPath: '/My App/Resources' });
    expect(out).toContain('"/My App/Beacon"');
    expect(out).toContain('"/My App/Resources/beacon-hook.cjs"');
  });
  it('throws (no silent broken command) when packaged mode is missing execPath/resourcesPath', () => {
    expect(() => resolveHookCommand({ packaged: true })).toThrow(/required in packaged mode/);
    expect(() => resolveHookCommand({ packaged: true, execPath: '/x' })).toThrow(/required in packaged mode/);
    expect(() => resolveHookCommand({ packaged: true, resourcesPath: '/r' })).toThrow(/required in packaged mode/);
  });
});

describe('packaged invocation wiring (M3c)', () => {
  it('defaultTargets embeds the packaged ELECTRON_RUN_AS_NODE command in every target', () => {
    const invocation = resolveHookCommand({
      packaged: true,
      execPath: '/Applications/Beacon.app/Contents/MacOS/Beacon',
      resourcesPath: '/Applications/Beacon.app/Contents/Resources',
    });
    expect(invocation).toContain('ELECTRON_RUN_AS_NODE=1');
    expect(invocation).toContain('Contents/Resources/beacon-hook.cjs');

    const targets = defaultTargets(invocation);
    expect(targets).toHaveLength(2); // claude + codex
    for (const t of targets) {
      const commands = t.specs.map((s) => s.command);
      expect(commands.length).toBeGreaterThan(0);
      for (const c of commands) expect(c).toContain('ELECTRON_RUN_AS_NODE=1');
    }
  });
});
