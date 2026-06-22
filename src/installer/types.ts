import type { Tool } from '../domain/types';

/** The marker flag baked into every Beacon hook command (idempotency + uninstall key). */
export const BEACON_MARKER_FLAG = '--beacon-marker';
/** Default marker id value (the flag is what we detect; the id is for readability/versioning). */
export const DEFAULT_MARKER_ID = 'beacon';
/** Bounded safety timeout for every Beacon hook (the hook is sub-second + always exits 0). */
export const HOOK_TIMEOUT_SECONDS = 5;

/** One Beacon hook to register: event, optional matcher, full shell command, optional timeout. */
export interface BeaconHookSpec {
  event: string;
  matcher?: string;
  command: string;
  timeout?: number;
}

/** A single command-hook entry as stored in the config files. */
export interface HookEntry {
  type: 'command';
  command: string;
  timeout?: number;
}

/** A matcher-group: optional matcher + its ordered hook entries. */
export interface HookGroup {
  matcher?: string;
  hooks: HookEntry[];
}

/** event name -> matcher-groups. Shared by Claude settings.json and Codex hooks.json. */
export type HooksMap = Record<string, HookGroup[]>;

/** A config object carrying a `.hooks` map plus arbitrary sibling keys (Claude has many). */
export interface HookConfig {
  hooks?: HooksMap;
  [key: string]: unknown;
}

export interface MergePlan {
  additions: Array<{ event: string; matcher?: string; command: string }>;
  alreadyPresent: Array<{ event: string; matcher?: string; command: string }>;
}

export interface UninstallPlan {
  removals: Array<{ event: string; matcher?: string; command: string }>;
}

export type { Tool };
