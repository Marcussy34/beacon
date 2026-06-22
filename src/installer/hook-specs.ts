import type { Tool } from '../domain/types';
import { BEACON_MARKER_FLAG, HOOK_TIMEOUT_SECONDS, type BeaconHookSpec } from './types';

/** Compose one hook command. `invocation` is an already-resolved, shell-safe prefix. */
export function buildHookCommand(invocation: string, markerId: string, tool: Tool, event: string): string {
  return `${invocation} ${BEACON_MARKER_FLAG} ${markerId} ${tool} ${event}`;
}

/** Claude hooks (must match parser CLAUDE_MAP). Notification = one pipe-list matcher group. */
export function claudeHookSpecs(invocation: string, markerId: string): BeaconHookSpec[] {
  const cmd = (e: string) => buildHookCommand(invocation, markerId, 'claude', e);
  const t = HOOK_TIMEOUT_SECONDS;
  return [
    { event: 'SessionStart', matcher: '', command: cmd('SessionStart'), timeout: t },
    { event: 'UserPromptSubmit', command: cmd('UserPromptSubmit'), timeout: t },
    { event: 'PreToolUse', matcher: '', command: cmd('PreToolUse'), timeout: t },
    { event: 'Notification', matcher: 'permission_prompt|idle_prompt', command: cmd('Notification'), timeout: t },
    { event: 'Stop', command: cmd('Stop'), timeout: t },
    { event: 'SessionEnd', command: cmd('SessionEnd'), timeout: t },
  ];
}

/** Codex hooks (must match parser CODEX_MAP). No SessionEnd; PermissionRequest = needs-you. */
export function codexHookSpecs(invocation: string, markerId: string): BeaconHookSpec[] {
  const cmd = (e: string) => buildHookCommand(invocation, markerId, 'codex', e);
  const t = HOOK_TIMEOUT_SECONDS;
  return [
    { event: 'SessionStart', matcher: '', command: cmd('SessionStart'), timeout: t },
    { event: 'UserPromptSubmit', command: cmd('UserPromptSubmit'), timeout: t },
    { event: 'PreToolUse', matcher: '', command: cmd('PreToolUse'), timeout: t },
    { event: 'PermissionRequest', command: cmd('PermissionRequest'), timeout: t },
    { event: 'Stop', command: cmd('Stop'), timeout: t },
  ];
}
