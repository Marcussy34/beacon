import { describe, it, expect } from 'vitest';
import { resolveHookCommand } from '../../src/installer/resolve-hook-command';

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
