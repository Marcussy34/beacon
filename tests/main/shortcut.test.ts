import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createShortcutManager, loadAccelerator, saveAccelerator, DEFAULT_ACCELERATOR, type ShortcutDeps } from '../../src/main/shortcut';

function fakeDeps(registry: Set<string>): { deps: ShortcutDeps; registered: string[] } {
  const registered: string[] = [];
  const deps: ShortcutDeps = {
    register: (acc) => { if (registry.has(acc)) return false; registered.push(acc); return true; }, // taken combos return false
    unregisterAll: () => { registered.length = 0; },
  };
  return { deps, registered };
}

describe('createShortcutManager', () => {
  it('applies the default accelerator successfully when free', () => {
    const { deps } = fakeDeps(new Set());
    const m = createShortcutManager(deps, () => {});
    const r = m.apply(DEFAULT_ACCELERATOR);
    expect(r).toEqual({ ok: true, accelerator: DEFAULT_ACCELERATOR });
    expect(m.current()).toBe(DEFAULT_ACCELERATOR);
    expect(m.lastError()).toBeNull();
  });
  it('records a conflict (does NOT throw) when the combo is taken', () => {
    const { deps } = fakeDeps(new Set([DEFAULT_ACCELERATOR])); // already taken by another app
    const m = createShortcutManager(deps, () => {});
    const r = m.apply(DEFAULT_ACCELERATOR);
    expect(r.ok).toBe(false);
    expect(m.lastError()).toMatch(/in use|taken|conflict/i);
  });
  it('can re-apply an alternate accelerator after a conflict', () => {
    const { deps } = fakeDeps(new Set([DEFAULT_ACCELERATOR]));
    const m = createShortcutManager(deps, () => {});
    expect(m.apply(DEFAULT_ACCELERATOR).ok).toBe(false);
    const alt = m.apply('CommandOrControl+Shift+B');
    expect(alt).toEqual({ ok: true, accelerator: 'CommandOrControl+Shift+B' });
    expect(m.current()).toBe('CommandOrControl+Shift+B');
    expect(m.lastError()).toBeNull();
  });
});

describe('accelerator persistence', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'beacon-acc-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
  it('defaults when the file is missing', () => {
    expect(loadAccelerator(join(dir, 'nope.json'))).toBe(DEFAULT_ACCELERATOR);
  });
  it('round-trips a saved accelerator', () => {
    const p = join(dir, 'shortcut.json');
    saveAccelerator(p, 'CommandOrControl+Shift+B');
    expect(loadAccelerator(p)).toBe('CommandOrControl+Shift+B');
  });
  it('defaults on malformed json', () => {
    const p = join(dir, 'bad.json'); writeFileSync(p, '{ not json');
    expect(loadAccelerator(p)).toBe(DEFAULT_ACCELERATOR);
  });
});
