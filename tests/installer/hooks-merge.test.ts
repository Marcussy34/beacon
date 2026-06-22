import { describe, it, expect } from 'vitest';
import {
  isBeaconCommand, hasBeaconHook, mergeBeaconHooks, removeBeaconHooks, planMerge, planUninstall,
} from '../../src/installer/hooks-merge';
import type { BeaconHookSpec, HookConfig } from '../../src/installer/types';

// Mirrors the real Claude settings.json shape: many sibling keys + pre-existing hooks (synthetic commands).
function existingClaude(): HookConfig {
  return {
    env: { FOO: 'bar' },
    permissions: { allow: [] },
    statusLine: { type: 'command' },
    hooks: {
      Notification: [{ matcher: 'permission_prompt', hooks: [{ type: 'command', command: 'afplay glass.aiff' }] }],
      SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: 'user-prime' }] }],
      Stop: [{ hooks: [{ type: 'command', command: 'user-done' }] }],
    },
  };
}

const SPECS: BeaconHookSpec[] = [
  { event: 'SessionStart', matcher: '', command: 'bh --beacon-marker beacon claude SessionStart', timeout: 5 },
  { event: 'Notification', matcher: 'permission_prompt|idle_prompt', command: 'bh --beacon-marker beacon claude Notification', timeout: 5 },
  { event: 'Stop', command: 'bh --beacon-marker beacon claude Stop', timeout: 5 },
  { event: 'UserPromptSubmit', command: 'bh --beacon-marker beacon claude UserPromptSubmit', timeout: 5 },
];

describe('isBeaconCommand', () => {
  it('detects the marker flag', () => {
    expect(isBeaconCommand('bh --beacon-marker beacon claude Stop')).toBe(true);
    expect(isBeaconCommand('user-done')).toBe(false);
  });
});

describe('mergeBeaconHooks', () => {
  it('does not mutate the input config', () => {
    const input = existingClaude();
    const snapshot = JSON.parse(JSON.stringify(input));
    mergeBeaconHooks(input, SPECS);
    expect(input).toEqual(snapshot);
  });

  it('preserves all sibling keys and existing hooks', () => {
    const merged = mergeBeaconHooks(existingClaude(), SPECS);
    expect(merged.env).toEqual({ FOO: 'bar' });
    expect(merged.permissions).toEqual({ allow: [] });
    expect(merged.statusLine).toEqual({ type: 'command' });
    // user's Notification group still present, untouched
    expect(merged.hooks!.Notification!).toContainEqual(
      { matcher: 'permission_prompt', hooks: [{ type: 'command', command: 'afplay glass.aiff' }] },
    );
  });

  it('adds Beacon entries as their own isolated groups', () => {
    const merged = mergeBeaconHooks(existingClaude(), SPECS);
    // SessionStart now has the user group + a Beacon group
    expect(merged.hooks!.SessionStart).toHaveLength(2);
    const beaconGroup = merged.hooks!.SessionStart!.find(g =>
      g.hooks.some(h => h.command.includes('--beacon-marker')));
    expect(beaconGroup).toEqual({
      matcher: '',
      hooks: [{ type: 'command', command: 'bh --beacon-marker beacon claude SessionStart', timeout: 5 }],
    });
    // brand-new event created for UserPromptSubmit
    expect(merged.hooks!.UserPromptSubmit).toHaveLength(1);
  });

  it('omits the matcher field when the spec omits it', () => {
    const merged = mergeBeaconHooks(existingClaude(), SPECS);
    const ups = merged.hooks!.UserPromptSubmit![0]!;
    expect('matcher' in ups).toBe(false);
  });

  it('is idempotent: re-merging changes nothing', () => {
    const once = mergeBeaconHooks(existingClaude(), SPECS);
    const twice = mergeBeaconHooks(once, SPECS);
    expect(twice).toEqual(once);
  });
});

describe('removeBeaconHooks round-trips merge', () => {
  it('restores exactly the original hooks (and siblings)', () => {
    const original = existingClaude();
    const merged = mergeBeaconHooks(original, SPECS);
    const restored = removeBeaconHooks(merged);
    expect(restored).toEqual(original);
  });

  it('prunes emptied Beacon-only events entirely', () => {
    const merged = mergeBeaconHooks(existingClaude(), SPECS);
    const restored = removeBeaconHooks(merged);
    expect(restored.hooks!.UserPromptSubmit).toBeUndefined();
  });

  it('leaves a config with no Beacon hooks untouched', () => {
    const plain = existingClaude();
    expect(removeBeaconHooks(plain)).toEqual(plain);
  });
});

describe('planMerge / planUninstall', () => {
  it('planMerge reports additions vs alreadyPresent', () => {
    const fresh = planMerge(existingClaude(), SPECS);
    expect(fresh.additions).toHaveLength(SPECS.length);
    expect(fresh.alreadyPresent).toHaveLength(0);

    const merged = mergeBeaconHooks(existingClaude(), SPECS);
    const again = planMerge(merged, SPECS);
    expect(again.additions).toHaveLength(0);
    expect(again.alreadyPresent).toHaveLength(SPECS.length);
  });

  it('planUninstall lists every marker-bearing entry', () => {
    const merged = mergeBeaconHooks(existingClaude(), SPECS);
    const plan = planUninstall(merged);
    expect(plan.removals).toHaveLength(SPECS.length);
    expect(plan.removals.every(r => r.command.includes('--beacon-marker'))).toBe(true);
  });
});
