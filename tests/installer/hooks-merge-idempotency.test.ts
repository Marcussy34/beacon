import { describe, it, expect } from 'vitest';
import { mergeBeaconHooks, planMerge } from '../../src/installer/hooks-merge';
import type { BeaconHookSpec, HookConfig } from '../../src/installer/types';

const specA = (e: string): BeaconHookSpec => ({ event: e, command: `node "/old/beacon-hook.cjs" --beacon-marker beacon claude ${e}`, timeout: 5 });
const specB = (e: string): BeaconHookSpec => ({ event: e, command: `ELECTRON_RUN_AS_NODE=1 "/App/Beacon" "/res/beacon-hook.cjs" --beacon-marker beacon claude ${e}`, timeout: 5 });

describe('idempotency across a changed invocation', () => {
  it('reinstall with a DIFFERENT invocation replaces the stale Beacon hook, not double-adds', () => {
    let cfg: HookConfig = mergeBeaconHooks({}, [specA('SessionStart')]);
    cfg = mergeBeaconHooks(cfg, [specB('SessionStart')]); // invocation changed
    const groups = cfg.hooks!.SessionStart!;
    const beaconCmds = groups.flatMap(g => g.hooks).filter(h => h.command.includes('--beacon-marker'));
    expect(beaconCmds).toHaveLength(1);                       // exactly one, not two
    expect(beaconCmds[0]!.command).toContain('ELECTRON_RUN_AS_NODE'); // the NEW one won
  });
  it('same-invocation reinstall is still a no-op (added 0)', () => {
    const cfg = mergeBeaconHooks({}, [specB('SessionStart')]);
    const plan = planMerge(cfg, [specB('SessionStart')]);
    expect(plan.additions).toHaveLength(0);
  });
  it('preserves a user hook in the same event', () => {
    const user: HookConfig = { hooks: { SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: 'user-cmd' }] }] } };
    let cfg = mergeBeaconHooks(user, [specA('SessionStart')]);
    cfg = mergeBeaconHooks(cfg, [specB('SessionStart')]);
    const cmds = cfg.hooks!.SessionStart!.flatMap(g => g.hooks).map(h => h.command);
    expect(cmds).toContain('user-cmd');                       // user hook untouched
    expect(cmds.filter(c => c.includes('--beacon-marker'))).toHaveLength(1);
  });
});
