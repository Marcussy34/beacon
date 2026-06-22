export type Tool = 'claude' | 'codex';
export type Host = 'terminal' | 'vscode' | 'cursor' | 'unknown';
export type RemoteKind = 'none' | 'tmux' | 'ssh' | 'vscode-remote';
export type GotoPrecision = 'precise' | 'degraded';
export type SessionState = 'started' | 'working' | 'waiting' | 'done' | 'closed';
export type Attention = 'none' | 'needs-you' | 'done';
export type BeaconEventName = 'session-start' | 'working' | 'needs-you' | 'turn-done' | 'session-end';

/** Raw event as written by beacon-hook (untrusted JSON shape). */
export interface RawHookEvent {
  tool: Tool;
  event: string;                  // raw hook_event_name
  sessionId?: string;             // Claude session_id (if present)
  cwd: string;
  gitRoot?: string;
  host: Host;
  termSessionId?: string;
  tty?: string;
  bundleId?: string;
  remote: RemoteKind;
  codexAncestorPid?: number;
  codexAncestorStartTime?: string;
  ts: number;                     // epoch ms
  raw?: unknown;
}

/** Normalized event consumed by the store. */
export interface BeaconEvent {
  kind: BeaconEventName;
  tool: Tool;
  key: string;
  claudeSessionId?: string;
  cwd: string;
  gitRoot: string;
  repoName: string;
  host: Host;
  termSessionId?: string;
  tty?: string;
  remote: RemoteKind;
  gotoPrecision: GotoPrecision;
  ts: number;
}

export interface Session {
  id: string;                     // stable id (claude session_id, reconciled codex id, or temp key)
  tempId: string;
  tool: Tool;
  claudeSessionId?: string;
  codexSessionId?: string;        // set after rollout reconcile
  repoPath: string;
  gitRoot: string;
  repoName: string;
  host: Host;
  termSessionId?: string;
  tty?: string;
  remote: RemoteKind;
  gotoPrecision: GotoPrecision;
  state: SessionState;
  attention: Attention;
  seen: boolean;
  startedAt: number;
  lastEventAt: number;
}

export interface RolloutInfo {
  codexSessionId: string;
  gitRoot: string;
  startedAt: number;
}
