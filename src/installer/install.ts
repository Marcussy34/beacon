import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Tool } from '../domain/types';
import { claudeHookSpecs, codexHookSpecs } from './hook-specs';
import { mergeBeaconHooks, planMerge, planUninstall, removeBeaconHooks } from './hooks-merge';
import { readJsonOrDefault, writeJsonAtomic } from './atomic-file';
import { resolveHookCommand } from './resolve-hook-command';
import { DEFAULT_MARKER_ID, type BeaconHookSpec, type HookConfig, type MergePlan } from './types';

export interface InstallTarget {
  tool: Tool;
  path: string;
  specs: BeaconHookSpec[];
}

/** The two real dotfile targets. `invocation`/`markerId` are injectable for tests. */
export function defaultTargets(invocation = resolveHookCommand(), markerId = DEFAULT_MARKER_ID): InstallTarget[] {
  return [
    { tool: 'claude', path: join(homedir(), '.claude', 'settings.json'), specs: claudeHookSpecs(invocation, markerId) },
    { tool: 'codex', path: join(homedir(), '.codex', 'hooks.json'), specs: codexHookSpecs(invocation, markerId) },
  ];
}

export const CODEX_TRUST_REVIEW_MESSAGE =
  'Codex: run `/hooks` inside the Codex CLI to review and trust the newly added Beacon hooks ' +
  '(they will not fire until trusted).';

export interface TargetPlan { tool: Tool; path: string; merge: MergePlan; }
export function dryRunInstall(targets: InstallTarget[]): TargetPlan[] {
  return targets.map(t => ({
    tool: t.tool,
    path: t.path,
    merge: planMerge(readJsonOrDefault<HookConfig>(t.path, {}), t.specs),
  }));
}

export interface InstallResult { tool: Tool; path: string; added: number; backupPath?: string; }
export function installHooks(targets: InstallTarget[], opts: { now?: number } = {}): {
  results: InstallResult[]; trustMessage: string;
} {
  const results: InstallResult[] = [];
  for (const t of targets) {
    const current = readJsonOrDefault<HookConfig>(t.path, {});
    const plan = planMerge(current, t.specs);
    if (plan.additions.length === 0) { results.push({ tool: t.tool, path: t.path, added: 0 }); continue; }
    const { backupPath } = writeJsonAtomic(t.path, mergeBeaconHooks(current, t.specs), { now: opts.now });
    results.push({ tool: t.tool, path: t.path, added: plan.additions.length, backupPath });
  }
  return { results, trustMessage: CODEX_TRUST_REVIEW_MESSAGE };
}

export interface UninstallResult { tool: Tool; path: string; removed: number; backupPath?: string; }
export function uninstallHooks(targets: InstallTarget[], opts: { now?: number } = {}): UninstallResult[] {
  const results: UninstallResult[] = [];
  for (const t of targets) {
    const current = readJsonOrDefault<HookConfig>(t.path, {});
    const plan = planUninstall(current);
    if (plan.removals.length === 0) { results.push({ tool: t.tool, path: t.path, removed: 0 }); continue; }
    const { backupPath } = writeJsonAtomic(t.path, removeBeaconHooks(current), { now: opts.now });
    results.push({ tool: t.tool, path: t.path, removed: plan.removals.length, backupPath });
  }
  return results;
}
