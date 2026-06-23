import type { Session } from '../domain/types';
import type { FocusCommand } from './types';

// Activation bundle ids — must match host detection in src/hook/build-event.ts.
const BUNDLE = {
  vscode: 'com.microsoft.VSCode',
  cursor: 'com.todesktop.230313mzl4w4u92',
} as const;

export function buildFocusCommand(session: Session): FocusCommand {
  const path = session.gitRoot;

  // Degraded: can't focus the exact window. Reveal locally; copy path if remote.
  if (session.gotoPrecision === 'degraded') {
    return session.remote === 'none'
      ? { kind: 'reveal', path }
      : { kind: 'copy-path', path };
  }

  if (session.host === 'terminal' && session.tty) {
    return { kind: 'terminal-app', tty: session.tty };
  }
  if (session.host === 'vscode') {
    return { kind: 'editor', cli: 'code', gitRoot: path, bundleId: BUNDLE.vscode, tty: session.tty };
  }
  if (session.host === 'cursor') {
    return { kind: 'editor', cli: 'cursor', gitRoot: path, bundleId: BUNDLE.cursor, tty: session.tty };
  }
  // Defensive: a precise session should always match a branch above. The only
  // way to reach here is a 'terminal' host with no tty — which M1's parser
  // already marks 'degraded', so this is unreachable via the real pipeline.
  // Reveal locally as the safe fallback.
  return { kind: 'reveal', path };
}
