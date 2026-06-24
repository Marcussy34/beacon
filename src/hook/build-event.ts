import type { RawHookEvent, Tool, Host, RemoteKind } from '../domain/types';

export type HookEnv = Record<string, string | undefined>;

// Cursor is a VS Code fork; its host app uses a todesktop bundle id.
// Confirmed/extended during M3 E2E on the user's machine.
export const CURSOR_BUNDLE_IDS: readonly string[] = ['com.todesktop.230313mzl4w4u92'];
const VSCODE_BUNDLE_ID = 'com.microsoft.VSCode';

export function detectHost(env: HookEnv): Host {
  const bundle = env.__CFBundleIdentifier ?? '';
  if (bundle === 'com.apple.Terminal' || env.TERM_PROGRAM === 'Apple_Terminal') return 'terminal';
  if (CURSOR_BUNDLE_IDS.includes(bundle)) return 'cursor';
  if (bundle === VSCODE_BUNDLE_ID || env.TERM_PROGRAM === 'vscode') return 'vscode';
  return 'unknown';
}

export function detectRemote(env: HookEnv): RemoteKind {
  if (env.VSCODE_IPC_HOOK_CLI && env.REMOTE_CONTAINERS) return 'vscode-remote';
  if (env.SSH_CONNECTION || env.SSH_TTY) return 'ssh';
  if (env.TMUX || env.STY) return 'tmux';
  return 'none';
}

export interface BuildEventArgs {
  tool: Tool;
  event: string;
  env: HookEnv;
  stdin: unknown;
  cwd: string;
  gitRoot?: string;
  tty?: string;
  codexAncestorPid?: number;
  codexAncestorStartTime?: string;
  ts: number;
}

export function buildRawEvent(args: BuildEventArgs): RawHookEvent {
  const stdin = (args.stdin ?? {}) as Record<string, unknown>;
  const sessionId = typeof stdin.session_id === 'string' ? stdin.session_id : undefined;
  const stdinCwd = typeof stdin.cwd === 'string' ? stdin.cwd : undefined;
  // UserPromptSubmit carries the user's prompt; other events don't. Used only to derive a
  // short session-summary snippet downstream — the full prompt is never persisted.
  const prompt = typeof stdin.prompt === 'string' ? stdin.prompt : undefined;
  return {
    tool: args.tool,
    event: args.event,
    sessionId,
    cwd: stdinCwd ?? args.cwd,
    prompt,
    gitRoot: args.gitRoot,
    host: detectHost(args.env),
    termSessionId: args.env.TERM_SESSION_ID,
    tty: args.tty,
    bundleId: args.env.__CFBundleIdentifier,
    remote: detectRemote(args.env),
    codexAncestorPid: args.codexAncestorPid,
    codexAncestorStartTime: args.codexAncestorStartTime,
    ts: args.ts,
    raw: args.stdin,
  };
}
