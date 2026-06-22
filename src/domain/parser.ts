import { basename } from 'node:path';
import type { RawHookEvent, BeaconEvent, BeaconEventName, GotoPrecision } from './types';
import { eventKey } from './identity';

const CLAUDE_MAP: Record<string, BeaconEventName> = {
  SessionStart: 'session-start',
  UserPromptSubmit: 'working',
  PreToolUse: 'working',
  Notification: 'needs-you',     // installer registers only permission_prompt|idle_prompt matchers
  Stop: 'turn-done',
  SessionEnd: 'session-end',
};

const CODEX_MAP: Record<string, BeaconEventName> = {
  SessionStart: 'session-start',
  UserPromptSubmit: 'working',
  PreToolUse: 'working',
  PermissionRequest: 'needs-you',
  Stop: 'turn-done',
};

export function parseHookEvent(raw: RawHookEvent): BeaconEvent {
  const map = raw.tool === 'claude' ? CLAUDE_MAP : CODEX_MAP;
  const kind = map[raw.event];
  if (!kind) throw new Error(`Unmapped ${raw.tool} event: ${raw.event}`);

  const gitRoot = raw.gitRoot && raw.gitRoot.length > 0 ? raw.gitRoot : raw.cwd;
  const degraded =
    raw.remote !== 'none' ||
    raw.host === 'unknown' ||
    (raw.host === 'terminal' && !raw.tty);
  const gotoPrecision: GotoPrecision = degraded ? 'degraded' : 'precise';

  return {
    kind,
    tool: raw.tool,
    key: eventKey(raw),
    claudeSessionId: raw.tool === 'claude' ? raw.sessionId : undefined,
    cwd: raw.cwd,
    gitRoot,
    repoName: basename(gitRoot) || gitRoot,
    host: raw.host,
    termSessionId: raw.termSessionId,
    tty: raw.tty,
    remote: raw.remote,
    gotoPrecision,
    ts: raw.ts,
  };
}
