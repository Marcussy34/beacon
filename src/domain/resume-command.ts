import type { Session } from './types';

// Build the CLI command that resumes this session, or null when we have no id for its
// tool (e.g. a Codex session whose rollout hasn't been reconciled yet). null → no button.
// Pure + side-effect free → trivially testable and safe to call in render.
export function resumeCommand(
  session: Pick<Session, 'tool' | 'claudeSessionId' | 'codexSessionId'>,
): string | null {
  // Interactive resume forms (paste into a terminal), verified against official CLI docs.
  if (session.tool === 'claude') {
    return session.claudeSessionId ? `claude --resume ${session.claudeSessionId}` : null;
  }
  if (session.tool === 'codex') {
    return session.codexSessionId ? `codex resume ${session.codexSessionId}` : null;
  }
  return null;
}
