import {
  BEACON_MARKER_FLAG, type BeaconHookSpec, type HookConfig, type HookGroup, type MergePlan, type UninstallPlan,
} from './types';

/**
 * A command belongs to Beacon iff it carries the marker flag.
 * ASSUMPTION: this is a substring match, so a user command that literally contains
 * `--beacon-marker` would be treated as Beacon's and removed on uninstall. Acceptable —
 * `--beacon-marker` is Beacon's private flag and would not appear in a real user hook.
 * M3 hardening option: anchor the match to the resolved invocation prefix, not just the flag.
 */
export function isBeaconCommand(command: string): boolean {
  return command.includes(BEACON_MARKER_FLAG);
}

/** True if the config already has a Beacon hook with this exact command under `event`. */
export function hasBeaconHook(config: HookConfig, event: string, command: string): boolean {
  const groups = config.hooks?.[event];
  if (!groups) return false;
  return groups.some(g => (g.hooks ?? []).some(h => h.command === command));
}

/** Deep clone a plain JSON config (configs are pure JSON). */
function clone(config: HookConfig): HookConfig {
  return JSON.parse(JSON.stringify(config ?? {}));
}

/**
 * Remove any Beacon-marked hook entries from `event` in `hooks`.
 * Prunes groups that become empty; deletes the event key if it becomes empty.
 * Mutates `hooks` in-place (called only on a clone).
 */
function removeBeaconFromEvent(hooks: NonNullable<HookConfig['hooks']>, event: string): void {
  const groups = hooks[event];
  if (!groups) return;
  // filter out Beacon entries from each group, then drop empty groups
  const pruned = groups
    .map(g => ({ ...g, hooks: (g.hooks ?? []).filter(h => !isBeaconCommand(h.command)) }))
    .filter(g => g.hooks.length > 0);
  if (pruned.length > 0) hooks[event] = pruned;
  else delete hooks[event];
}

/**
 * Merge Beacon specs into a config. New object; idempotent; preserves siblings + existing hooks.
 * Idempotency key is (event + marker): if the exact command is already present → no-op;
 * if a DIFFERENT Beacon command exists for the same event → replace it (stale invocation).
 */
export function mergeBeaconHooks(config: HookConfig, specs: BeaconHookSpec[]): HookConfig {
  const next = clone(config);
  const hooks = (next.hooks ??= {});
  for (const spec of specs) {
    if (hasBeaconHook(next, spec.event, spec.command)) continue; // exact match → idempotent no-op
    // Remove any stale Beacon entry for this event before adding the new one
    removeBeaconFromEvent(hooks, spec.event);
    const arr = (hooks[spec.event] ??= []);
    const entry = spec.timeout != null
      ? { type: 'command' as const, command: spec.command, timeout: spec.timeout }
      : { type: 'command' as const, command: spec.command };
    const group: HookGroup = { hooks: [entry] };
    if (spec.matcher !== undefined) group.matcher = spec.matcher; // own isolated group
    arr.push(group);
  }
  return next;
}

/** Remove only marker-bearing entries; prune emptied groups + emptied events. New object. */
export function removeBeaconHooks(config: HookConfig): HookConfig {
  const next = clone(config);
  const hooks = next.hooks;
  if (!hooks) return next;
  for (const event of Object.keys(hooks)) {
    const pruned: HookGroup[] = [];
    for (const g of hooks[event]!) {
      const kept = (g.hooks ?? []).filter(h => !isBeaconCommand(h.command));
      if (kept.length > 0) pruned.push({ ...g, hooks: kept });
    }
    if (pruned.length > 0) hooks[event] = pruned;
    else delete hooks[event];
  }
  return next;
}

export function planMerge(config: HookConfig, specs: BeaconHookSpec[]): MergePlan {
  const additions: MergePlan['additions'] = [];
  const alreadyPresent: MergePlan['alreadyPresent'] = [];
  for (const spec of specs) {
    const entry = { event: spec.event, matcher: spec.matcher, command: spec.command };
    (hasBeaconHook(config, spec.event, spec.command) ? alreadyPresent : additions).push(entry);
  }
  return { additions, alreadyPresent };
}

export function planUninstall(config: HookConfig): UninstallPlan {
  const removals: UninstallPlan['removals'] = [];
  const hooks = config.hooks ?? {};
  for (const event of Object.keys(hooks)) {
    for (const g of hooks[event]!) {
      for (const h of g.hooks ?? []) {
        if (isBeaconCommand(h.command)) removals.push({ event, matcher: g.matcher, command: h.command });
      }
    }
  }
  return { removals };
}
